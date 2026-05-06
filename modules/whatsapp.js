/**
 * WhatsApp Communication Module
 * Handles screenshot delivery and answer receipt via WhatsApp/Twilio
 */

class WhatsAppManager {
  constructor(config = {}) {
    this.apiUrl = config.apiUrl || 'https://api.twilio.com';
    this.accountSid = config.accountSid || null;
    this.authToken = config.authToken || null;
    this.fromNumber = config.fromNumber || null;
    this.toNumber = config.toNumber || null;
    this.webhookUrl = config.webhookUrl || null;
    this.retryAttempts = config.retryAttempts || 3;
    this.retryDelay = config.retryDelay || 2000;
    this.messageQueue = [];
    this.isProcessing = false;
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
      return;
    }

    this.isProcessing = true;

    while (this.messageQueue.length > 0) {
      const request = this.messageQueue.shift();
      
      try {
        request.attempts++;
        request.status = 'sending';

        const response = await this.sendViaBackend(request.data);
        
        request.status = 'sent';
        request.response = response;
      } catch (error) {
        console.error(`[WhatsApp] Send attempt ${request.attempts} failed:`, error);

        if (request.attempts < request.maxAttempts) {
          // Exponential backoff retry
          await this.delay(this.retryDelay * Math.pow(2, request.attempts - 1));
          this.messageQueue.unshift(request);
        } else {
          request.status = 'failed';
          request.error = error.message;
          console.error('[WhatsApp] Message failed after all retries:', request);
        }
      }
    }

    this.isProcessing = false;
  }

  /**
   * Send message via backend API
   */
  async sendViaBackend(messageData) {
    try {
      const response = await fetch('http://localhost:5000/api/whatsapp/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: this.toNumber,
          from: this.fromNumber,
          message: messageData.body,
          mediaUrl: messageData.mediaUrl || null,
          metadata: messageData.metadata || null
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
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
    const lines = text.split('\n');

    for (const line of lines) {
      const match = line.match(/Q(\d+):\s*([A-Z0-9])/i);
      if (match) {
        answers.push({
          questionIndex: parseInt(match[1]) - 1, // 0-indexed
          answer: match[2].toUpperCase(),
          raw: line.trim()
        });
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
    return fetch('http://localhost:5000/api/whatsapp/verify-webhook', {
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

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WhatsAppManager;
}
