/**
 * MCQ Orchestrator Module
 * Main coordinator for the entire end-to-end flow:
 * Screenshot → WhatsApp → Receive Answers → Auto-Select → UI Display
 */

var MCQOrchestrator = class MCQOrchestrator {
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
    try {
      const detector = globalThis.__mcqDetectorInstance;
      if (detector) {
        const mcqs = detector.detectedQuestions?.length
          ? detector.detectedQuestions
          : detector.detectMCQs();
        if (mcqs.length > 0) return mcqs.length;
      }
    } catch (_) {}

    const questionSelectors = [
      '.question', '.mcq-question', '[data-question]', '.exam-question',
      '[role="radiogroup"]', '#q-btn-group', '.btn-group'
    ];

    for (const selector of questionSelectors) {
      const count = document.querySelectorAll(selector).length;
      if (count > 0) return count;
    }

    const card = document.querySelector('#q-card, .q-card, .question-card');
    if (card) {
      if (card.querySelectorAll('[role="radio"], [role="option"]').length >= 2) return 1;
      if (card.querySelectorAll('.btn-opt, button.option, button.choice').length >= 2) return 1;
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
      const startedAt = performance.now();

      // 1. Capture screenshot
      console.log('[MCQOrchestrator] Capturing screenshot...');
      const captureStart = performance.now();
      const screenshot = await this.screenshot.captureScreenshot();
      const captureMs = Math.round(performance.now() - captureStart);
      console.log(`[MCQOrchestrator] Screenshot captured in ${captureMs}ms (${this.screenshot.formatSize(screenshot.size)})`);

      // 2. Validate screenshot
      const validation = this.screenshot.validateScreenshot(screenshot);
      if (!validation.valid) {
        throw new Error(`Screenshot validation failed: ${validation.errors.join(', ')}`);
      }

      // 3. Send via WhatsApp first for lower latency.
      console.log('[MCQOrchestrator] Sending to WhatsApp...');
      const sendStart = performance.now();
      await this.whatsapp.sendScreenshot(screenshot, this.currentConversation);
      const sendMs = Math.round(performance.now() - sendStart);
      const totalMs = Math.round(performance.now() - startedAt);
      console.log(`[MCQOrchestrator] WhatsApp send confirmed in ${sendMs}ms (total ${totalMs}ms)`);

      // 4. Persist after send succeeds.
      await this.storage.storeScreenshot(this.currentConversation.id, screenshot);

      // 5. Add message to storage
      const message = await this.storage.addMessage(this.currentConversation.id, {
        type: 'screenshot',
        content: screenshot.dataUrl,
        status: 'sent',
        metadata: screenshot.metadata
      });

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
      console.warn('[MCQOrchestrator] Received answer but no active conversation — creating one');
      try {
        await this.startSession({ auto: true });
      } catch (_) {
        return { message: null, answers: [], storedAnswers: [] };
      }
    }

    try {
      console.log('[MCQOrchestrator] Receiving answer message...');

      // 1. Use parsed answers if the backend already provided them; otherwise parse locally.
      const answers = Array.isArray(messageData.answers) && messageData.answers.length > 0
        ? messageData.answers
        : this.whatsapp.parseAnswers(messageData.body);

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
        try {
          const stored = await this.storage.storeAnswer(this.currentConversation.id, {
            questionIndex: answer.questionIndex,
            selectedOption: answer.answer,
            selectedIndex: this.answerLetterToIndex(answer.answer),
            confidence: 0.9,
            messageId: message.id,
            selectorType: 'radio'
          });
          if (stored) storedAnswers.push(stored);
        } catch (storeErr) {
          console.warn('[MCQOrchestrator] storeAnswer failed:', storeErr);
        }
      }

      console.log('[MCQOrchestrator] Received and stored', answers.length, 'answers');

      // 4. Auto-apply answers if enabled
      if (this.config.autoApplyAnswers && answers.length > 0) {
        const results = await this.applyAnswers(answers);
        
        // Mark answers as applied
        for (const result of results) {
          if (result.success && result.questionIndex !== undefined) {
            const answerToMark = storedAnswers.find(a => a && a.questionIndex === result.questionIndex);
            if (answerToMark && answerToMark.id != null) {
              await this.storage.markAnswerApplied(answerToMark.id, result.selectorInfo || {});
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

      const convId = this.currentConversation?.id ?? null;
      const results = await this.autoAnswer.applyAnswers(answers, convId);

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

globalThis.MCQOrchestrator = MCQOrchestrator;

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MCQOrchestrator;
}
