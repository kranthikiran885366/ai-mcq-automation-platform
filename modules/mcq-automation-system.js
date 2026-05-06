/**
 * MCQ Complete Automation System
 * Production-grade end-to-end automation for MCQ detection, screenshot, WhatsApp, answer parsing, auto-selection
 */

class MCQAutomationSystem {
  constructor(config = {}) {
    // Initialize all modules
    this.storage = new StorageManager();
    this.whatsapp = new WhatsAppManager(config.whatsapp || {});
    this.screenshot = new ScreenshotManager(config.screenshot || {});
    this.autoAnswer = new AutoAnswerManager(config.autoAnswer || {});
    this.orchestrator = new MCQOrchestrator(config.orchestrator || {});

    // Configuration
    this.config = {
      autoMode: config.autoMode !== false,
      autoScreenshot: config.autoScreenshot !== false,
      autoSendWhatsApp: config.autoSendWhatsApp !== false,
      autoApplyAnswers: config.autoApplyAnswers !== false,
      pollInterval: config.pollInterval || 3000,
      maxRetries: config.maxRetries || 3,
      ...config
    };

    // State management
    this.state = {
      initialized: false,
      activeConversation: null,
      isProcessing: false,
      lastScreenshot: null,
      pendingAnswers: [],
      stats: {
        screenshotsSent: 0,
        answersReceived: 0,
        answersApplied: 0,
        failedAttempts: 0
      }
    };

    // Message queue
    this.messageQueue = [];
    this.isQueueProcessing = false;

    console.log('[MCQAutomationSystem] Initialized with config:', this.config);
  }

  /**
   * Initialize the entire system
   */
  async init() {
    try {
      console.log('[MCQAutomationSystem] Initializing...');

      // Initialize storage
      await this.storage.init();
      console.log('[MCQAutomationSystem] Storage initialized');

      // Initialize orchestrator with all modules
      await this.orchestrator.init(this.storage, this.whatsapp, this.screenshot, this.autoAnswer);
      console.log('[MCQAutomationSystem] Orchestrator initialized');

      // Setup event listeners
      this.setupEventListeners();
      console.log('[MCQAutomationSystem] Event listeners setup');

      this.state.initialized = true;
      console.log('[MCQAutomationSystem] System ready');

      return true;
    } catch (error) {
      console.error('[MCQAutomationSystem] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Setup internal event listeners
   */
  setupEventListeners() {
    // Listen for screenshot sent event
    this.orchestrator.on('screenshotSent', (data) => {
      this.state.stats.screenshotsSent++;
      this.state.lastScreenshot = data.screenshot;
      this.emitEvent('screenshotSent', data);
    });

    // Listen for answer received
    this.orchestrator.on('answerReceived', (data) => {
      this.state.stats.answersReceived++;
      this.state.pendingAnswers.push(...data.answers);
      this.emitEvent('answerReceived', data);

      // Auto-apply if enabled
      if (this.config.autoApplyAnswers) {
        this.applyPendingAnswers();
      }
    });

    // Listen for answers applied
    this.orchestrator.on('answersApplied', (data) => {
      const successCount = data.results.filter(r => r.success).length;
      this.state.stats.answersApplied += successCount;
      this.state.pendingAnswers = [];
      this.emitEvent('answersApplied', data);
    });

    // Listen for errors
    this.orchestrator.on('error', (data) => {
      this.state.stats.failedAttempts++;
      this.emitEvent('error', data);
    });
  }

  /**
   * Start complete automation flow
   */
  async startAutomation() {
    if (!this.state.initialized) {
      throw new Error('System not initialized. Call init() first');
    }

    try {
      console.log('[MCQAutomationSystem] Starting automation flow');

      // 1. Start session
      const conversation = await this.orchestrator.startSession({
        autoMode: true,
        timestamp: Date.now()
      });
      this.state.activeConversation = conversation;
      console.log('[MCQAutomationSystem] Session started:', conversation.id);

      // 2. Capture and send screenshot
      if (this.config.autoScreenshot) {
        await this.captureAndSendScreenshot();
      }

      return conversation;
    } catch (error) {
      console.error('[MCQAutomationSystem] Automation start failed:', error);
      this.emitEvent('error', { error, phase: 'startAutomation' });
      throw error;
    }
  }

  /**
   * Capture and send screenshot
   */
  async captureAndSendScreenshot() {
    if (!this.state.activeConversation) {
      throw new Error('No active conversation');
    }

    try {
      console.log('[MCQAutomationSystem] Capturing screenshot...');
      const result = await this.orchestrator.captureAndSend();
      console.log('[MCQAutomationSystem] Screenshot sent successfully');
      return result;
    } catch (error) {
      console.error('[MCQAutomationSystem] Screenshot capture/send failed:', error);
      throw error;
    }
  }

  /**
   * Receive and process WhatsApp answer
   */
  async receiveAnswer(messageData) {
    if (!this.state.activeConversation) {
      console.warn('[MCQAutomationSystem] Received answer but no active conversation');
      return null;
    }

    try {
      console.log('[MCQAutomationSystem] Receiving answer...');
      const result = await this.orchestrator.receiveAnswer(messageData);
      return result;
    } catch (error) {
      console.error('[MCQAutomationSystem] Answer reception failed:', error);
      throw error;
    }
  }

  /**
   * Apply all pending answers
   */
  async applyPendingAnswers() {
    if (this.state.pendingAnswers.length === 0) {
      console.log('[MCQAutomationSystem] No pending answers');
      return [];
    }

    try {
      console.log('[MCQAutomationSystem] Applying', this.state.pendingAnswers.length, 'answers');
      const results = await this.orchestrator.applyAnswers(this.state.pendingAnswers);
      return results;
    } catch (error) {
      console.error('[MCQAutomationSystem] Answer application failed:', error);
      throw error;
    }
  }

  /**
   * Get current statistics
   */
  getStats() {
    return {
      ...this.state.stats,
      conversationId: this.state.activeConversation?.id,
      hasPendingAnswers: this.state.pendingAnswers.length > 0,
      isProcessing: this.state.isProcessing
    };
  }

  /**
   * Get conversation history
   */
  async getHistory() {
    if (!this.state.activeConversation) {
      return null;
    }
    return await this.orchestrator.getHistory();
  }

  /**
   * End current session
   */
  async endSession() {
    try {
      // Apply any remaining answers
      if (this.state.pendingAnswers.length > 0) {
        await this.applyPendingAnswers();
      }

      // Get final stats
      const finalStats = await this.orchestrator.getStats();
      console.log('[MCQAutomationSystem] Session ended with stats:', finalStats);

      this.state.activeConversation = null;
      this.state.pendingAnswers = [];

      this.emitEvent('sessionEnded', { stats: finalStats });
      return finalStats;
    } catch (error) {
      console.error('[MCQAutomationSystem] Session end failed:', error);
      throw error;
    }
  }

  /**
   * Reset all data
   */
  async reset() {
    try {
      if (this.state.activeConversation) {
        await this.orchestrator.clearConversation();
      }

      this.state.activeConversation = null;
      this.state.pendingAnswers = [];
      this.state.stats = {
        screenshotsSent: 0,
        answersReceived: 0,
        answersApplied: 0,
        failedAttempts: 0
      };

      this.emitEvent('systemReset');
      console.log('[MCQAutomationSystem] System reset');
    } catch (error) {
      console.error('[MCQAutomationSystem] Reset failed:', error);
      throw error;
    }
  }

  /**
   * Event emitter
   */
  listeners = new Map();

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  emitEvent(event, data) {
    if (this.listeners.has(event)) {
      for (const callback of this.listeners.get(event)) {
        try {
          callback(data);
        } catch (error) {
          console.error(`[MCQAutomationSystem] Event listener error for ${event}:`, error);
        }
      }
    }
  }

  /**
   * Get system health status
   */
  getStatus() {
    return {
      initialized: this.state.initialized,
      hasActiveConversation: !!this.state.activeConversation,
      isProcessing: this.state.isProcessing,
      pendingAnswers: this.state.pendingAnswers.length,
      stats: this.state.stats,
      config: this.config
    };
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MCQAutomationSystem;
}
