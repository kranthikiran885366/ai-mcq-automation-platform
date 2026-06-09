/**
 * WhatsApp Communication Module
 * Handles screenshot delivery and answer receipt via WhatsApp/Twilio
 */

var WhatsAppManager = globalThis.WhatsAppManager || class WhatsAppManager {
  constructor(config = {}) {
    this.apiUrl = config.apiUrl || 'https://api.twilio.com';
    this.accountSid = config.accountSid || null;
    this.authToken = config.authToken || null;
    this.fromNumber = config.fromNumber || null;
    this.toNumber = config.toNumber || null;
    this.webhookUrl = config.webhookUrl || null;
    this.backendUrl = config.backendUrl || null;
    this.retryAttempts = config.retryAttempts || 3;
    this.retryDelay = config.retryDelay || 2000;
    this.messageQueue = [];
    this.isProcessing = false;
  }

  /**
   * Resolve the backend API base URL from shared app config or instance config.
   */
  getBackendApiBase() {
    if (typeof window !== 'undefined' && window.APP_CONFIG && window.APP_CONFIG.API_BASE) {
      return window.APP_CONFIG.API_BASE;
    }

    if (this.backendUrl) {
      return this.backendUrl.replace(/\/$/, '') + '/api';
    }

    return 'http://localhost:5050/api';
  }

  /**
   * Send screenshot to WhatsApp via Twilio
   */
  async sendScreenshot(screenshot, conversationData) {
    try {
      const payload = {
        conversationId: conversationData.id,
        screenshotId: screenshot.id,
        url: conversationData.url,
        title: conversationData.title,
        timestamp: Date.now(),
        questionCount: conversationData.questionCount
      };

      const message = {
        to: this.toNumber,
        from: this.fromNumber,
        body: `📋 MCQ Screenshot - ${conversationData.title}\n\nURL: ${conversationData.url}\nQuestions: ${conversationData.questionCount}\n\nPlease provide answers in the format:\nQ1: A\nQ2: B\nQ3: C`,
        mediaUrl: screenshot.dataUrl,
        metadata: JSON.stringify(payload)
      };

      return await this.sendMessage(message, 'screenshot');
    } catch (error) {
      console.error('[WhatsApp] Error sending screenshot:', error);
      throw error;
    }
  }

  /**
   * Send message via WhatsApp/Twilio
   */
  async sendMessage(messageData, type = 'text') {
    const request = {
      id: this.generateUUID(),
      type,
      data: messageData,
      timestamp: Date.now(),
      attempts: 0,
      maxAttempts: this.retryAttempts,
      status: 'queued'
    };

    this.messageQueue.push(request);
    return this.processQueue();
  }

  /**
   * Process message queue with retry logic
   */
  async processQueue() {
    if (this.isProcessing || this.messageQueue.length === 0) {
      return { success: false, skipped: true, reason: 'queue_empty_or_busy' };
    }

    this.isProcessing = true;
    try {
      while (this.messageQueue.length > 0) {
        const request = this.messageQueue.shift();

        try {
          request.attempts++;
          request.status = 'sending';

          const response = await this.sendViaBackend(request.data);

          request.status = 'sent';
          request.response = response;
          return response;
        } catch (error) {
          // Skip retry if credentials are missing - it will never succeed
          const isCredentialError = !this.toNumber || !this.fromNumber;
          if (isCredentialError || request.attempts >= request.maxAttempts) {
            request.status = 'failed';
            request.error = error.message;
            if (!isCredentialError) {
              console.warn('[WhatsApp] Message failed after all retries:', error.message);
            }
            throw new Error(request.error || 'Failed to send WhatsApp message');
          }

          await this.delay(this.retryDelay * Math.pow(2, request.attempts - 1));
          this.messageQueue.unshift(request);
        }
      }

      return { success: false, skipped: true, reason: 'queue_empty' };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Send message via backend API
   */
  async sendViaBackend(messageData) {
    // The backend has WhatsApp credentials configured in .env (WHATSAPP_TO)
    // We don't need local credentials to use the backend API
    const apiBase = this.getBackendApiBase();
    
    if (!apiBase) {
      console.warn('[WhatsApp] Backend URL not configured, cannot send.');
      return { success: false, skipped: true, reason: 'backend_not_configured' };
    }

    const rawMedia = messageData.mediaUrl || null;
    const imageBase64 = rawMedia
      ? (rawMedia.includes(',') ? rawMedia.split(',')[1] : rawMedia)
      : null;

    const response = await fetch(`${apiBase}/whatsapp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64,
        message: imageBase64 ? (messageData.body || '') : (messageData.body || ''),
        screenshotId: messageData.screenshotId || this.generateUUID(),
        metadata: messageData.metadata
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const reason = payload.error || payload.message || `HTTP Error: ${response.status}`;
      throw new Error(reason);
    }

    return payload;
  }

  /**
   * Listen for incoming WhatsApp messages
   * This should be called from background service worker
   */
  async listenForMessages(chrome) {
    return new Promise((resolve) => {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'whatsappMessageReceived') {
          this.handleIncomingMessage(request.data);
          sendResponse({ success: true });
        }
      });
      resolve();
    });
  }

  /**
   * Handle incoming message from webhook
   */
  async handleIncomingMessage(data) {
    try {
      // Webhook format from Twilio
      const message = {
        from: data.From,
        body: data.Body,
        mediaUrl: data.MediaUrl0 || null,
        timestamp: Date.now(),
        messageId: data.MessageSid || this.generateUUID(),
        conversationId: data.conversationId || null
      };

      // Parse answer format: Q1: A\nQ2: B\nQ3: C
      const answers = this.parseAnswers(message.body);
      
      return {
        success: true,
        message,
        answers,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('[WhatsApp] Error handling incoming message:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Parse answer format from WhatsApp message
   * Expected format: Q1: A\nQ2: B\nQ3: C
   */
  parseAnswers(text) {
    const answers = [];
    if (!text || typeof text !== 'string') return answers;

    // Normalize line endings and trim
    const normalized = text.replace(/\r/g, '').trim();
    const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);

    // First try line-by-line patterns like: Q1: A  or 1: A  or Q1. A
    for (const line of lines) {
      let m = line.match(/Q?\s*(\d+)\s*[:\.\)]\s*([A-E])/i);
      if (m) {
        answers.push({ questionIndex: parseInt(m[1], 10) - 1, answer: m[2].toUpperCase(), raw: line });
        continue;
      }

      // Try patterns like: 1 A  or 1-A
      m = line.match(/^(\d+)\s*[-\s]\s*([A-E])$/i);
      if (m) {
        answers.push({ questionIndex: parseInt(m[1], 10) - 1, answer: m[2].toUpperCase(), raw: line });
        continue;
      }

      // Try comma-separated pairs: 1:A,2:B
      const pairs = line.split(/[;,]+/).map(p => p.trim()).filter(Boolean);
      if (pairs.length > 1) {
        let foundPair = false;
        for (const pair of pairs) {
          const pm = pair.match(/Q?\s*(\d+)\s*[:\.\)]?\s*([A-E])/i);
          if (pm) {
            answers.push({ questionIndex: parseInt(pm[1], 10) - 1, answer: pm[2].toUpperCase(), raw: pair });
            foundPair = true;
          }
        }
        if (foundPair) continue;
      }
    }

    // Fallback: single-line letter list like "A B C" or "A,B,C" or "ABC"
    if (answers.length === 0) {
      // Try split by spaces or commas
      const singleLine = normalized.replace(/\n/g, ' ');
      let tokens = singleLine.split(/[ ,]+/).map(t => t.trim()).filter(Boolean);
      if (tokens.length === 0) return answers;

      // If tokens are single letters, map them to Q1, Q2, ...
      const areLetters = tokens.every(t => /^[A-E]$/i.test(t));
      if (areLetters) {
        for (let i = 0; i < tokens.length; i++) {
          answers.push({ questionIndex: i, answer: tokens[i].toUpperCase(), raw: tokens[i] });
        }
        return answers;
      }

      // If the string is a continuous sequence like "ABC", split characters
      if (/^[A-E]{2,}$/i.test(singleLine.replace(/[^A-Z]/gi, ''))) {
        const chars = singleLine.replace(/[^A-Z]/gi, '').split('');
        for (let i = 0; i < chars.length; i++) {
          if (/^[A-E]$/i.test(chars[i])) {
            answers.push({ questionIndex: i, answer: chars[i].toUpperCase(), raw: chars[i] });
          }
        }
        return answers;
      }
    }

    return answers;
  }

  /**
   * Set WhatsApp credentials
   */
  setCredentials(config) {
    this.accountSid = config.accountSid;
    this.authToken = config.authToken;
    this.fromNumber = config.fromNumber;
    this.toNumber = config.toNumber;
    this.webhookUrl = config.webhookUrl;
  }

  /**
   * Verify webhook signature (Twilio)
   */
  verifyWebhookSignature(body, twilioSignature, url) {
    // This should be implemented on backend for security
    // Sending to backend to verify
    return fetch(`${this.getBackendApiBase()}/whatsapp/verify-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body,
        twilioSignature,
        url
      })
    }).then(r => r.json());
  }

  /**
   * Format screenshot for WhatsApp
   */
  async formatScreenshot(screenshotData) {
    try {
      // Convert to JPEG if needed (WhatsApp supports JPEG, PNG)
      // For now, using canvas-based compression
      const canvas = await this.compressImage(screenshotData, 0.8);
      return canvas.toDataURL('image/jpeg', 0.8);
    } catch (error) {
      console.error('[WhatsApp] Error formatting screenshot:', error);
      return screenshotData;
    }
  }

  /**
   * Compress image for WhatsApp (max 16MB)
   */
  async compressImage(dataUrl, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxWidth = 1280;
        const maxHeight = 720;
        
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas);
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  /**
   * Utility: Generate UUID
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Utility: Delay promise
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get message queue status
   */
  getQueueStatus() {
    return {
      queued: this.messageQueue.length,
      isProcessing: this.isProcessing,
      queue: this.messageQueue.map(m => ({
        id: m.id,
        type: m.type,
        status: m.status,
        attempts: m.attempts
      }))
    };
  }

  /**
   * Clear failed messages
   */
  clearFailedMessages() {
    this.messageQueue = this.messageQueue.filter(m => m.status !== 'failed');
  }

  /**
   * Retry failed message
   */
  retryMessage(messageId) {
    const failed = this.messageQueue.find(m => m.id === messageId && m.status === 'failed');
    if (failed) {
      failed.attempts = 0;
      failed.status = 'queued';
      this.processQueue();
      return true;
    }
    return false;
  }
}

globalThis.WhatsAppManager = WhatsAppManager;

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WhatsAppManager;
}
