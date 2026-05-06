/**
 * MCQ Orchestrator Module
 * Main coordinator for the entire end-to-end flow:
 * Screenshot → WhatsApp → Receive Answers → Auto-Select → UI Display
 */

class MCQOrchestrator {
  constructor(config = {}) {
    this.storage = null;
    this.whatsapp = null;
    this.screenshot = null;
    this.autoAnswer = null;

    this.currentConversation = null;
    this.config = {
      autoSendScreenshot: config.autoSendScreenshot !== false,
      autoApplyAnswers: config.autoApplyAnswers !== false,
      showNotifications: config.showNotifications !== false,
      ...config
    };

    this.listeners = new Map();
  }

  /**
   * Initialize all modules
   */
  async init(storageManager, whatsappManager, screenshotManager, autoAnswerManager) {
    this.storage = storageManager;
    this.whatsapp = whatsappManager;
    this.screenshot = screenshotManager;
    this.autoAnswer = autoAnswerManager;

    // Initialize storage
    await this.storage.init();

    console.log('[MCQOrchestrator] Initialized with all modules');
    return this;
  }

  /**
   * Start new MCQ session
   */
  async startSession(metadata = {}) {
    try {
      const conversation = await this.storage.createConversation({
        url: window.location.href,
        title: document.title,
        questionCount: this.detectQuestionCount(),
        metadata
      });

      this.currentConversation = conversation;

      console.log('[MCQOrchestrator] Session started:', conversation.id);

      // Emit event
      this.emit('sessionStarted', { conversation });

      return conversation;
    } catch (error) {
      console.error('[MCQOrchestrator] Session start failed:', error);
      throw error;
    }
  }

  /**
   * Detect number of questions on page
   */
  detectQuestionCount() {
    const questionSelectors = [
      '.question',
      '.mcq-question',
      '[data-question]',
      '.exam-question'
    ];

    for (const selector of questionSelectors) {
      const count = document.querySelectorAll(selector).length;
      if (count > 0) return count;
    }

    return 0;
  }

  /**
   * Capture and send screenshot to WhatsApp
   */
  async captureAndSend() {
    if (!this.currentConversation) {
      throw new Error('No active conversation');
    }

    try {
      // 1. Capture screenshot
      console.log('[MCQOrchestrator] Capturing screenshot...');
      const screenshot = await this.screenshot.captureScreenshot();

      // 2. Validate screenshot
      const validation = this.screenshot.validateScreenshot(screenshot);
      if (!validation.valid) {
        throw new Error(`Screenshot validation failed: ${validation.errors.join(', ')}`);
      }

      // 3. Store screenshot
      await this.storage.storeScreenshot(this.currentConversation.id, screenshot);

      // 4. Add message to storage
      const message = await this.storage.addMessage(this.currentConversation.id, {
        type: 'screenshot',
        content: screenshot.dataUrl,
        status: 'sent',
        metadata: screenshot.metadata
      });

      // 5. Send via WhatsApp
      console.log('[MCQOrchestrator] Sending to WhatsApp...');
      await this.whatsapp.sendScreenshot(screenshot, this.currentConversation);

      console.log('[MCQOrchestrator] Screenshot sent successfully');

      // Emit event
      this.emit('screenshotSent', {
        conversation: this.currentConversation,
        screenshot,
        message
      });

      return { screenshot, message };
    } catch (error) {
      console.error('[MCQOrchestrator] Screenshot capture/send failed:', error);
      
      if (this.currentConversation) {
        await this.storage.addMessage(this.currentConversation.id, {
          type: 'system',
          content: `Error: ${error.message}`,
          status: 'failed',
          senderType: 'extension'
        });
      }

      this.emit('error', { error });
      throw error;
    }
  }

  /**
   * Receive and process WhatsApp message with answers
   */
  async receiveAnswer(messageData) {
    if (!this.currentConversation) {
      console.warn('[MCQOrchestrator] Received answer but no active conversation');
      return;
    }

    try {
      console.log('[MCQOrchestrator] Receiving answer message...');

      // 1. Parse answers from message
      const answers = this.whatsapp.parseAnswers(messageData.body);

      // 2. Store message
      const message = await this.storage.addMessage(this.currentConversation.id, {
        type: 'answer',
        content: messageData.body,
        status: 'received',
        senderType: messageData.senderType || 'bot',
        whatsappId: messageData.messageId
      });

      // 3. Store each answer
      const storedAnswers = [];
      for (const answer of answers) {
        const stored = await this.storage.storeAnswer(this.currentConversation.id, {
          questionIndex: answer.questionIndex,
          selectedOption: answer.answer,
          selectedIndex: this.answerLetterToIndex(answer.answer),
          confidence: 0.9,
          messageId: message.id,
          selectorType: 'radio'
        });
        storedAnswers.push(stored);
      }

      console.log('[MCQOrchestrator] Received and stored', answers.length, 'answers');

      // 4. Auto-apply answers if enabled
      if (this.config.autoApplyAnswers && answers.length > 0) {
        const results = await this.applyAnswers(answers);
        
        // Mark answers as applied
        for (const result of results) {
          if (result.success) {
            const answerToMark = storedAnswers.find(a => a.questionIndex === result.questionIndex);
            if (answerToMark) {
              await this.storage.markAnswerApplied(answerToMark.id, result.selectorInfo);
            }
          }
        }

        this.emit('answersApplied', { results, message });
      }

      // Emit event
      this.emit('answerReceived', {
        message,
        answers,
        storedAnswers
      });

      return { message, answers, storedAnswers };
    } catch (error) {
      console.error('[MCQOrchestrator] Answer reception failed:', error);
      this.emit('error', { error });
      throw error;
    }
  }

  /**
   * Apply answers to page
   */
  async applyAnswers(answers) {
    try {
      console.log('[MCQOrchestrator] Applying', answers.length, 'answers...');

      const results = await this.autoAnswer.applyAnswers(answers, this.currentConversation.id);

      // Highlight applied answers
      const successfulResults = results.filter(r => r.success);
      if (successfulResults.length > 0) {
        this.autoAnswer.highlightAppliedAnswers(successfulResults);
      }

      console.log('[MCQOrchestrator] Applied', successfulResults.length, 'answers successfully');

      return results;
    } catch (error) {
      console.error('[MCQOrchestrator] Answer application failed:', error);
      throw error;
    }
  }

  /**
   * Convert answer letter to index (A→0, B→1, C→2, D→3)
   */
  answerLetterToIndex(letter) {
    const mapping = { 'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4 };
    return mapping[letter.toUpperCase()] || 0;
  }

  /**
   * Get conversation history
   */
  async getHistory() {
    if (!this.currentConversation) {
      return null;
    }

    return {
      conversation: this.currentConversation,
      messages: await this.storage.getMessages(this.currentConversation.id),
      answers: await this.storage.getAnswers(this.currentConversation.id),
      screenshot: await this.storage.getScreenshot(this.currentConversation.id),
      stats: await this.storage.getStats(this.currentConversation.id)
    };
  }

  /**
   * Get all conversations
   */
  async getAllConversations() {
    return await this.storage.getAllConversations();
  }

  /**
   * Clear conversation
   */
  async clearConversation() {
    if (this.currentConversation) {
      await this.storage.deleteConversation(this.currentConversation.id);
      this.currentConversation = null;

      // Clear highlights from page
      this.autoAnswer.clearHighlights();

      this.emit('conversationCleared');
    }
  }

  /**
   * Get current statistics
   */
  async getStats() {
    if (!this.currentConversation) {
      return null;
    }

    return await this.storage.getStats(this.currentConversation.id);
  }

  /**
   * Event listener system
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  /**
   * Emit event
   */
  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const callback of this.listeners.get(event)) {
        try {
          callback(data);
        } catch (error) {
          console.error('[MCQOrchestrator] Event listener error:', error);
        }
      }
    }
  }

  /**
   * Remove event listener
   */
  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Take screenshot (alias)
   */
  async takeScreenshot() {
    return this.captureAndSend();
  }

  /**
   * Submit answers (alias)
   */
  async submitAnswers(answers) {
    return this.receiveAnswer({
      body: this.formatAnswersText(answers),
      messageId: this.generateUUID(),
      senderType: 'manual'
    });
  }

  /**
   * Format answers as text (for manual submission)
   */
  formatAnswersText(answers) {
    return answers
      .map(a => `Q${a.questionIndex + 1}: ${a.answer}`)
      .join('\n');
  }

  /**
   * Generate UUID
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MCQOrchestrator;
}
