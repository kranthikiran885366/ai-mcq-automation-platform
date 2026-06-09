/**
 * WhatsApp Integration Manager
 * Supports Twilio WhatsApp API, WhatsApp Web Automation, and WhatsApp Business API
 */

class WhatsAppManager {
  constructor(config = {}) {
    this.config = {
      provider: config.provider || 'twilio', // 'twilio', 'web-automation', 'business-api'
      twilioAccountSid: config.twilioAccountSid || '',
      twilioAuthToken: config.twilioAuthToken || '',
      twilioPhoneNumber: config.twilioPhoneNumber || '',
      businessPhoneId: config.businessPhoneId || '',
      businessAccessToken: config.businessAccessToken || '',
      backendUrl: config.backendUrl || 'https://mcq-bot-backend.railway.app/api',
      enableMediaAttachment: config.enableMediaAttachment !== false,
      maxMessageLength: config.maxMessageLength || 4096,
      retryAttempts: config.retryAttempts || 3
    };

    this.messageHistory = [];
    this.maxHistorySize = 100;
  }

  /**
   * Send answer via WhatsApp
   */
  async sendAnswer(phoneNumber, answer, metadata = {}) {
    if (!this.validatePhoneNumber(phoneNumber)) {
      return { success: false, error: 'Invalid phone number format' };
    }

    const message = this.formatAnswerMessage(answer, metadata);

    try {
      const result = await this.sendMessage(phoneNumber, message, metadata);
      
      if (result.success) {
        this.addToHistory({
          phoneNumber,
          type: 'answer',
          message,
          metadata,
          status: 'sent',
          timestamp: new Date().toISOString()
        });
      }

      return result;
    } catch (error) {
      console.error('[WhatsAppManager] Send answer failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send quiz completion summary
   */
  async sendQuizSummary(phoneNumber, summary) {
    const message = this.formatSummaryMessage(summary);
    const screenshotUrl = summary.screenshotUrl || null;

    try {
      const result = await this.sendMessageWithMedia(
        phoneNumber,
        message,
        screenshotUrl
      );

      if (result.success) {
        this.addToHistory({
          phoneNumber,
          type: 'summary',
          message,
          screenshotUrl,
          status: 'sent',
          timestamp: new Date().toISOString()
        });
      }

      return result;
    } catch (error) {
      console.error('[WhatsAppManager] Send summary failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send message based on configured provider
   */
  async sendMessage(phoneNumber, message, metadata = {}) {
    switch (this.config.provider) {
      case 'twilio':
        return this.sendViaTwilio(phoneNumber, message, metadata);
      case 'web-automation':
        return this.sendViaWebAutomation(phoneNumber, message, metadata);
      case 'business-api':
        return this.sendViaBusinessAPI(phoneNumber, message, metadata);
      default:
        return { success: false, error: 'Unknown WhatsApp provider' };
    }
  }

  /**
   * Send via Twilio WhatsApp API
   */
  async sendViaTwilio(phoneNumber, message, metadata = {}) {
    if (!this.config.twilioAccountSid || !this.config.twilioAuthToken) {
      return { success: false, error: 'Twilio credentials not configured' };
    }

    try {
      // Send to backend to handle Twilio API call (for security)
      const response = await fetch(`${this.config.backendUrl}/send-whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'twilio',
          phoneNumber: this.formatPhoneNumber(phoneNumber),
          message: message,
          twilioAccountSid: this.config.twilioAccountSid,
          twilioAuthToken: this.config.twilioAuthToken,
          twilioPhoneNumber: this.config.twilioPhoneNumber,
          metadata: metadata
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Twilio API error');
      }

      const result = await response.json();
      return {
        success: true,
        messageId: result.messageId || result.sid,
        provider: 'twilio',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('[WhatsAppManager] Twilio send failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send via WhatsApp Web Automation
   */
  async sendViaWebAutomation(phoneNumber, message, metadata = {}) {
    try {
      // Open WhatsApp Web in new tab
      const whatsappUrl = `https://web.whatsapp.com/send?phone=${encodeURIComponent(
        this.formatPhoneNumber(phoneNumber)
      )}&text=${encodeURIComponent(message)}`;

      chrome.tabs.create({ url: whatsappUrl }, (tab) => {
        console.log('[WhatsAppManager] Opened WhatsApp Web');

        // Note: Automated sending via web.whatsapp.com requires manual user interaction
        // This method requires user to manually click send button
      });

      return {
        success: true,
        method: 'web_automation',
        warning: 'Manual user interaction required',
        tabId: tab ? tab.id : null
      };
    } catch (error) {
      console.error('[WhatsAppManager] Web automation failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send via WhatsApp Business API
   */
  async sendViaBusinessAPI(phoneNumber, message, metadata = {}) {
    if (!this.config.businessPhoneId || !this.config.businessAccessToken) {
      return { success: false, error: 'WhatsApp Business API credentials not configured' };
    }

    try {
      const url = `https://graph.instagram.com/v18.0/${this.config.businessPhoneId}/messages`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.businessAccessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: this.formatPhoneNumber(phoneNumber),
          type: 'text',
          text: {
            body: message
          }
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Business API error');
      }

      const result = await response.json();
      return {
        success: true,
        messageId: result.messages[0].id,
        provider: 'business-api',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('[WhatsAppManager] Business API send failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send message with media attachment
   */
  async sendMessageWithMedia(phoneNumber, message, mediaUrl) {
    if (!this.config.enableMediaAttachment || !mediaUrl) {
      return this.sendMessage(phoneNumber, message);
    }

    try {
      const response = await fetch(`${this.config.backendUrl}/send-whatsapp-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: this.formatPhoneNumber(phoneNumber),
          message: message,
          mediaUrl: mediaUrl,
          provider: this.config.provider,
          credentials: {
            twilioAccountSid: this.config.twilioAccountSid,
            twilioPhoneNumber: this.config.twilioPhoneNumber
          }
        })
      });

      if (!response.ok) {
        throw new Error('Media send failed');
      }

      const result = await response.json();
      return {
        success: true,
        messageId: result.messageId,
        mediaId: result.mediaId,
        provider: this.config.provider
      };
    } catch (error) {
      console.error('[WhatsAppManager] Media send failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Format answer message
   */
  formatAnswerMessage(answer, metadata = {}) {
    const {
      question = 'Question',
      options = [],
      selectedIndex = -1,
      confidence = 0,
      ai_provider = 'unknown'
    } = metadata;

    const selectedAnswer = options[selectedIndex] || answer;

    let message = `📝 *MCQ Answer*\n\n`;
    message += `*Question:* ${question}\n\n`;
    message += `*Your Answer:* ${selectedAnswer}\n`;
    message += `*Confidence:* ${(confidence * 100).toFixed(1)}%\n`;
    message += `*AI Provider:* ${ai_provider}\n\n`;

    if (options.length > 0) {
      message += `*Options:*\n`;
      options.forEach((opt, idx) => {
        const marker = idx === selectedIndex ? '✓ ' : '  ';
        message += `${marker}${String.fromCharCode(65 + idx)}) ${opt}\n`;
      });
    }

    return message;
  }

  /**
   * Format quiz summary message
   */
  formatSummaryMessage(summary) {
    const {
      totalQuestions = 0,
      correctAnswers = 0,
      accuracy = 0,
      duration = 0,
      ai_provider = 'unknown',
      sessionId = ''
    } = summary;

    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;

    let message = `🎉 *Quiz Complete!*\n\n`;
    message += `*Result Summary:*\n`;
    message += `📊 Score: ${correctAnswers}/${totalQuestions}\n`;
    message += `📈 Accuracy: ${accuracy.toFixed(1)}%\n`;
    message += `⏱️ Duration: ${minutes}m ${seconds}s\n`;
    message += `🤖 AI Provider: ${ai_provider}\n`;
    message += `📌 Session: ${sessionId}\n\n`;

    if (accuracy >= 90) {
      message += `🏆 *Outstanding Performance!*\n`;
    } else if (accuracy >= 70) {
      message += `✅ *Great Job!*\n`;
    } else if (accuracy >= 50) {
      message += `⚡ *Good Effort!*\n`;
    } else {
      message += `💪 *Keep Practicing!*\n`;
    }

    message += `\n_Generated by MCQ Automation Bot_`;

    return message;
  }

  /**
   * Format phone number to WhatsApp format
   */
  formatPhoneNumber(phoneNumber) {
    // Remove all non-digit characters
    const cleaned = phoneNumber.replace(/\D/g, '');

    // Add country code if not present
    if (!cleaned.startsWith('1') && cleaned.length === 10) {
      return '1' + cleaned;
    }

    return cleaned;
  }

  /**
   * Validate phone number format
   */
  validatePhoneNumber(phoneNumber) {
    // Basic validation: should have at least 10 digits
    const cleaned = phoneNumber.replace(/\D/g, '');
    return cleaned.length >= 10 && cleaned.length <= 15;
  }

  /**
   * Test WhatsApp connection
   */
  async testConnection() {
    try {
      const response = await fetch(`${this.config.backendUrl}/test-whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: this.config.provider,
          credentials: {
            twilioAccountSid: this.config.twilioAccountSid,
            businessPhoneId: this.config.businessPhoneId
          }
        })
      });

      if (!response.ok) {
        return { success: false, error: 'Connection test failed' };
      }

      const result = await response.json();
      return {
        success: result.success !== false,
        provider: this.config.provider,
        message: result.message || 'Connected'
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get message history
   */
  getHistory(filters = {}) {
    let history = this.messageHistory;

    if (filters.phoneNumber) {
      history = history.filter(m => m.phoneNumber === filters.phoneNumber);
    }

    if (filters.type) {
      history = history.filter(m => m.type === filters.type);
    }

    if (filters.status) {
      history = history.filter(m => m.status === filters.status);
    }

    if (filters.limit) {
      history = history.slice(-filters.limit);
    }

    return history;
  }

  /**
   * Add to message history
   */
  addToHistory(entry) {
    this.messageHistory.push(entry);

    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory.shift();
    }

    // Persist to Chrome storage
    chrome.storage.local.get('whatsappHistory', (result) => {
      const history = result.whatsappHistory || [];
      history.push(entry);

      if (history.length > this.maxHistorySize) {
        history.shift();
      }

      chrome.storage.local.set({ whatsappHistory: history });
    });
  }

  /**
   * Parse answers from WhatsApp reply text.
   * Supports ALL formats:
   *   1:Paris  |  1:A  |  Q1:A  |  1.Paris  |  1-Paris
   *   1:2,3    (multiple checkbox by option text)
   *   A / B    (sequential bare letter)
   *   Paris    (sequential plain text)
   *   1:A,B    (multiple checkbox by letter)
   */
  parseAnswers(text) {
    if (!text) return [];
    const answers = [];
    const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);

    for (const line of lines) {
      // Format: 1:Paris,London  /  1:A,B  /  Q1:A  /  1.Paris  /  1-A
      const m = line.match(/^[Qq]?(\d+)\s*[:.)\-]\s*(.+)$/);
      if (m) {
        const qi = parseInt(m[1]) - 1;
        const rawAnswer = m[2].trim();
        if (qi >= 0 && rawAnswer.length > 0) {
          // Support multiple answers separated by comma (checkboxes)
          const parts = rawAnswer.split(',').map(p => p.trim()).filter(Boolean);
          if (parts.length > 1) {
            // Multiple: push one entry per answer with same questionIndex
            for (const part of parts) {
              answers.push({ questionIndex: qi, answer: part, raw: line, multiple: true });
            }
          } else {
            answers.push({ questionIndex: qi, answer: rawAnswer, raw: line });
          }
          continue;
        }
      }

      // Format: bare letter (A / B / C) — sequential
      if (/^[A-Ea-e]$/.test(line)) {
        answers.push({ questionIndex: answers.length, answer: line.toUpperCase(), raw: line });
        continue;
      }

      // Format: bare digit (1-5) — sequential, treat as letter index
      if (/^[1-5]$/.test(line)) {
        const letter = String.fromCharCode(64 + parseInt(line));
        answers.push({ questionIndex: answers.length, answer: letter, raw: line });
        continue;
      }

      // Format: plain text ("Paris", "Mars") — sequential
      if (line.length > 0 && line.length <= 150) {
        answers.push({ questionIndex: answers.length, answer: line, raw: line });
      }
    }
    return answers;
  }

  /**
   * Send screenshot via backend WhatsApp bridge
   */
  async sendScreenshot(screenshot, conversation) {
    const backendUrl = (typeof window !== 'undefined' && window.APP_CONFIG && window.APP_CONFIG.API_BASE)
      || this.config.backendUrl
      || 'http://localhost:5050/api';
    const base = backendUrl.replace(/\/api\/?$/, '');
    const caption = `MCQ Screenshot - ${new Date().toLocaleTimeString()}`;

    let imageB64 = screenshot.dataUrl || screenshot;
    if (typeof imageB64 === 'string' && imageB64.includes(',')) {
      imageB64 = imageB64.split(',')[1];
    }

    const conversationId = conversation && conversation.id;
    const res = await fetch(`${base}/api/whatsapp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: imageB64,
        message: caption,
        metadata: conversationId ? { conversationId } : {}
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `WhatsApp send failed: HTTP ${res.status}`);
    }
    return res.json();
  }

  /**
   * Clear history
   */
  clearHistory() {
    this.messageHistory = [];
    chrome.storage.local.set({ whatsappHistory: [] });
  }

  /**
   * Get configuration status
   */
  getConfigurationStatus() {
    const status = {
      provider: this.config.provider,
      configured: false,
      missingFields: []
    };

    switch (this.config.provider) {
      case 'twilio':
        if (!this.config.twilioAccountSid) status.missingFields.push('Twilio Account SID');
        if (!this.config.twilioAuthToken) status.missingFields.push('Twilio Auth Token');
        if (!this.config.twilioPhoneNumber) status.missingFields.push('Twilio Phone Number');
        status.configured = status.missingFields.length === 0;
        break;

      case 'business-api':
        if (!this.config.businessPhoneId) status.missingFields.push('Business Phone ID');
        if (!this.config.businessAccessToken) status.missingFields.push('Business Access Token');
        status.configured = status.missingFields.length === 0;
        break;

      case 'web-automation':
        status.configured = true;
        break;
    }

    return status;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WhatsAppManager;
}
