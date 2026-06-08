/**
 * MCQ Complete Automation System
 * Production-grade end-to-end automation for MCQ detection, screenshot, WhatsApp, answer parsing, auto-selection
 */

var MCQAutomationSystem = class MCQAutomationSystem {
  constructor(config = {}) {
    const StorageCtor = globalThis.__MCQStorageManager || StorageManager;
    this.storage = new StorageCtor();
    this.whatsapp = new WhatsAppManager(config.whatsapp || {});
    this.screenshot = new ScreenshotManager(config.screenshot || {});
    this.autoAnswer = new AutoAnswerManager(config.autoAnswer || {});
    this.orchestrator = new MCQOrchestrator(config.orchestrator || {});
    this.notifications = typeof NotificationManager !== 'undefined'
      ? new NotificationManager()
      : null;

    this.config = {
      autoMode: config.autoMode !== false,
      autoScreenshot: config.autoScreenshot !== false,
      autoSendWhatsApp: config.autoSendWhatsApp !== false,
      autoApplyAnswers: config.autoApplyAnswers !== false,
      pollInterval: config.pollInterval || 3000,
      maxRetries: config.maxRetries || 3,
      // AI pipeline config
      aiProvider: config.aiProvider || 'gemini',
      useAIFirst: config.useAIFirst !== false,       // try AI before WhatsApp
      whatsappFallback: config.whatsappFallback !== false, // fall back to WhatsApp if AI fails
      answerPollInterval: config.answerPollInterval || 1000,
      answerPollTimeout: config.answerPollTimeout || 60000,
      ...config
    };

    this.state = {
      initialized: false,
      activeConversation: null,
      isProcessing: false,
      lastScreenshot: null,
      pendingAnswers: [],
      pollTimer: null,
      stats: {
        screenshotsSent: 0,
        answersReceived: 0,
        answersApplied: 0,
        failedAttempts: 0
      }
    };

    this.messageQueue = [];
    this.isQueueProcessing = false;
    this.listeners = new Map();
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
      if (!this.config.autoApplyAnswers) {
        this.state.pendingAnswers.push(...data.answers);
      }
      this.emitEvent('answerReceived', data);
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
   * Flow: AI first → if fails → WhatsApp fallback
   */
  async startAutomation() {
    if (!this.state.initialized) {
      throw new Error('System not initialized. Call init() first');
    }

    try {
      console.log('[MCQAutomationSystem] Starting automation flow');

      const conversation = await this.orchestrator.startSession({
        autoMode: true,
        timestamp: Date.now()
      });
      this.state.activeConversation = conversation;

      if (this.config.autoScreenshot) {
        await this.captureAndSendScreenshot();
      }

      return conversation;
    } catch (error) {
      this.emitEvent('error', { error, phase: 'startAutomation' });
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────
  // AI ANSWER PIPELINE
  // ─────────────────────────────────────────────────────────

  /**
   * Full hybrid pipeline:
   * 1. Capture screenshot
   * 2. Send to backend OCR + AI
   * 3. If AI returns answer → auto-apply
   * 4. If AI fails → send to WhatsApp, poll for reply
   */
  async runHybridPipeline(mcqs) {
    if (this.state.isProcessing) {
      console.log('[MCQAutomationSystem] Pipeline already running, skipping duplicate request');
      return [];
    }

    this.state.isProcessing = true;
    this._notify('info', '🤖 Processing MCQs...');

    try {
      if (this.config.useAIFirst) {
        // Refresh detector cache so AutoAnswerManager has up-to-date element refs
        if (globalThis.__mcqDetectorInstance) {
          globalThis.__mcqDetectorInstance.detectMCQs();
        }
        const aiAnswers = await this._getAnswersFromAI(mcqs);
        if (aiAnswers && aiAnswers.length > 0) {
          this._notify('success', `✅ AI answered ${aiAnswers.length} question(s)`);
          await this._applyAnswers(aiAnswers);
          return aiAnswers;
        }
        console.warn('[MCQAutomationSystem] AI returned no answers — trying Google Search fallback');
      }

      // ── Google Search fallback (works on every device with internet) ──
      const searchAnswers = await this._getAnswersFromGoogleSearch(mcqs);
      if (searchAnswers && searchAnswers.length > 0) {
        this._notify('success', `🔍 Search answered ${searchAnswers.length} question(s)`);
        await this._applyAnswers(searchAnswers);
        return searchAnswers;
      }
      console.warn('[MCQAutomationSystem] Search fallback returned no answers — trying WhatsApp');

      if (this.config.whatsappFallback) {
        return await this._whatsappFallbackPipeline();
      }

      this._notify('error', '❌ No answer source available');
      return [];
    } catch (error) {
      this.state.stats.failedAttempts++;
      this._notify('error', '❌ Pipeline error: ' + error.message);
      this.emitEvent('error', { error });
      return [];
    } finally {
      this.state.isProcessing = false;
    }
  }

  /**
   * Send each MCQ to backend /api/get-answer and collect results
   */
  async _getAnswersFromAI(mcqs) {
    const apiBase = 'http://localhost:5050/api';

    let provider = 'groq';
    try {
      const res = await fetch('http://localhost:5050/api/provider-status');
      if (res.ok) {
        const status = await res.json();
        if (status.groq) provider = 'groq';
        else {
          const stored = await new Promise(resolve =>
            chrome.storage.sync.get('apiProvider', r => resolve(r.apiProvider))
          );
          const order = ['deepseek', 'openai', 'gemini'];
          const req = (stored || '').toLowerCase();
          if (status[req]) provider = req;
          else for (const p of order) { if (status[p]) { provider = p; break; } }
        }
      }
    } catch (_) {}

    console.log(`[MCQAutomationSystem] Using AI provider: ${provider}`);
    const answers = [];
    let firstError = null;

    for (let i = 0; i < mcqs.length; i++) {
      const mcq = mcqs[i];
      const questionText = mcq.text || mcq.question || '';
      const options = (mcq.options || []).map(o => ({ text: o.text || String(o) }));
      const questionType = mcq.type || 'radio'; // pass checkbox/radio to backend

      if (!questionText || options.length < 2) {
        console.warn(`[MCQAutomationSystem] Q${i+1} skipped — missing question text or options`);
        continue;
      }

      try {
        console.log(`[MCQAutomationSystem] Asking AI (${provider}) for Q${i+1} [${questionType}]: "${questionText.substring(0,60)}"`);

        const res = await fetch(`${apiBase}/get-answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: questionText, options, provider, type: questionType })
        });

        const data = await res.json().catch(() => ({}));

        if (res.status === 429) {
          // Rate limited — switch provider and back off
          const waitMs = 3000;
          console.warn(`[MCQAutomationSystem] 429 on ${provider} — backing off ${waitMs}ms then retrying Q${i+1} with next provider`);
          await this._delay(waitMs);
          const order = ['groq', 'deepseek', 'openai'];
          provider = order[(order.indexOf(provider) + 1) % order.length];
          // retry this question
          i--;
          continue;
        }

        if (!res.ok || !data.success) {
          const reason = data.error || `HTTP ${res.status}`;
          console.warn(`[MCQAutomationSystem] Q${i+1} AI failed (${provider}): ${reason}`);
          if (!firstError) firstError = reason;
          continue;
        }

        if (data.answer === null || data.answer === undefined) {
          console.warn(`[MCQAutomationSystem] Q${i+1}: AI returned null answer`);
          continue;
        }

        const rawOptions = mcq.options || [];

        // Multi-select: backend returns data.answers array
        if (data.is_multi && Array.isArray(data.answers) && data.answers.length > 0) {
          for (const a of data.answers) {
            const txt = (rawOptions[a.index] && rawOptions[a.index].text) || a.text || String.fromCharCode(65 + a.index);
            console.log(`[MCQAutomationSystem] Q${i+1} multi → "${txt}" (index ${a.index})`);
            answers.push({ questionIndex: i, answer: txt, answerIndex: a.index, source: 'ai', provider });
          }
          continue;
        }

        // Single answer
        const answerIndex = Number(data.answer);
        const answerText = data.selected_option
          || (rawOptions[answerIndex] && rawOptions[answerIndex].text)
          || String.fromCharCode(65 + answerIndex);

        console.log(`[MCQAutomationSystem] Q${i+1} → "${answerText}" (index ${answerIndex})`);
        answers.push({ questionIndex: i, answer: answerText, answerIndex, source: 'ai', provider });
      } catch (e) {
        console.warn(`[MCQAutomationSystem] Q${i+1} network error:`, e.message);
        if (!firstError) firstError = e.message;
      }
    }

    if (answers.length === 0 && firstError) {
      console.error(`[MCQAutomationSystem] AI pipeline failed. Provider: ${provider}. Reason: ${firstError}`);
      this._notify('error', `❌ AI (${provider}) failed: ${firstError}`);
    }

    console.log(`[MCQAutomationSystem] AI answered ${answers.length}/${mcqs.length} questions`);
    return answers;
  }

  // ─────────────────────────────────────────────────────────
  // GOOGLE SEARCH FALLBACK
  // Works on every device with internet — zero API key needed.
  // Builds a search query from question+options, asks the background
  // script to fetch the Google search result page, then scores each
  // option by how many times its text appears in the snippets.
  // ─────────────────────────────────────────────────────────

  async _getAnswersFromGoogleSearch(mcqs) {
    const answers = [];
    for (let i = 0; i < mcqs.length; i++) {
      try {
        const mcq   = mcqs[i];
        const qText = (mcq.text || mcq.question || '').trim();
        const opts  = (mcq.options || []).map(o => (o.text || String(o)).trim());
        if (!qText || opts.length < 2) continue;

        this._notify('info', `🔍 Searching Google for Q${i+1}...`);

        // Build query: question + all option texts
        const query = encodeURIComponent(
          qText.substring(0, 120) + ' ' + opts.slice(0, 4).join(' ')
        );
        const searchUrl = `https://www.google.com/search?q=${query}&num=5`;

        // Fetch via background (avoids CORS; background has <all_urls> permission)
        let html = '';
        try {
          html = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
              { action: 'fetchUrl', url: searchUrl },
              (r) => {
                if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                if (r && r.html) return resolve(r.html);
                reject(new Error(r?.error || 'fetchUrl failed'));
              }
            );
          });
        } catch (fetchErr) {
          console.warn(`[Search] Q${i+1} fetch failed:`, fetchErr.message);
          continue;
        }

        // Strip tags, lowercase
        const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();

        // Score each option: count occurrences of key words in result text
        const scores = opts.map(opt => {
          const words = opt.toLowerCase()
            .replace(/^[a-e][.)\s]+/, '')   // strip "A) " prefix
            .split(/\s+/)
            .filter(w => w.length > 2);     // ignore tiny words
          if (!words.length) return 0;
          return words.reduce((sum, w) => {
            const re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
            return sum + (text.match(re) || []).length;
          }, 0);
        });

        const maxScore = Math.max(...scores);
        if (maxScore === 0) {
          console.warn(`[Search] Q${i+1}: no keyword matches in results`);
          continue;
        }

        const bestIdx  = scores.indexOf(maxScore);
        const bestText = opts[bestIdx];
        console.log(`[Search] Q${i+1} scores:`, scores, `→ index ${bestIdx} "${bestText}"`);
        this._notify('info', `🔍 Q${i+1} search → "${bestText.substring(0,40)}"`);
        answers.push({
          questionIndex: i,
          answer: bestText,
          answerIndex: bestIdx,
          source: 'search',
          score: maxScore
        });

      } catch (e) {
        console.warn(`[Search] Q${i+1} error:`, e.message);
      }
    }
    return answers;
  }

  /**
   * OCR pipeline: send screenshot to backend, get text + MCQs back
   */
  async runOCRPipeline() {
    const apiBase = (typeof window !== 'undefined' && window.APP_CONFIG)
      ? window.APP_CONFIG.API_BASE
      : 'http://localhost:5050/api';

    try {
      // Capture via background service worker (captureVisibleTab not available in content scripts)
      const dataUrl = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { action: 'captureVisibleTab', options: { format: 'jpeg', quality: 85 } },
          (r) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else if (r?.success) resolve(r.dataUrl);
            else reject(new Error(r?.error || 'captureVisibleTab failed'));
          }
        );
      });

      const res = await fetch(`${apiBase}/ocr-detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_data: dataUrl, lang: 'eng' })
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'OCR failed');

      return { text: data.text, mcqs: data.mcqs || [] };
    } catch (error) {
      console.error('[MCQAutomationSystem] OCR pipeline failed:', error);
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────
  // WHATSAPP FALLBACK PIPELINE
  // ─────────────────────────────────────────────────────────

  /**
   * Capture screenshot → send to WhatsApp → poll backend for reply
   */
  async _whatsappFallbackPipeline() {
    this._notify('info', '📲 Sending to WhatsApp...');

    try {
      if (!this.state.activeConversation) {
        await this.startAutomation();
      }

      await this.captureAndSendScreenshot();

      // Only poll if we now have a valid conversation ID
      if (!this.state.activeConversation?.id) {
        this._notify('error', '❌ No conversation started, cannot poll');
        return [];
      }

      this._notify('info', '⏳ Waiting for WhatsApp reply...');
      const answers = await this._pollForAnswers();

      if (answers.length > 0) {
        this._notify('success', `📨 Got ${answers.length} answer(s) from WhatsApp`);
        await this._applyAnswers(answers);
      } else {
        this._notify('error', '⏰ No reply received in time');
      }
      return answers;
    } catch (e) {
      this._notify('error', '❌ WhatsApp fallback failed: ' + e.message);
      return [];
    }
  }

  /**
   * Poll backend /api/whatsapp/conversations until answers arrive or timeout
   */
  async _pollForAnswers() {
    const apiBase = (typeof window !== 'undefined' && window.APP_CONFIG)
      ? window.APP_CONFIG.API_BASE
      : 'http://localhost:5050/api';

    const convId = this.state.activeConversation?.id;

    // Don't poll if no valid conversation ID
    if (!convId || convId === 'undefined') {
      console.warn('[MCQAutomationSystem] No valid conversation ID, skipping poll');
      return [];
    }

    const deadline = Date.now() + this.config.answerPollTimeout;

    while (Date.now() < deadline) {
      await this._delay(this.config.answerPollInterval);
      try {
        const res = await fetch(`${apiBase}/whatsapp/conversation/${convId}`);
        if (!res.ok) continue;
        const data = await res.json();
        const messages = data.conversation?.messages || [];
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.answers && lastMsg.answers.length > 0) {
          return lastMsg.answers;
        }
      } catch (e) {
        // keep polling
      }
    }
    return [];
  }

  // ─────────────────────────────────────────────────────────
  // APPLY ANSWERS
  // ─────────────────────────────────────────────────────────

  async _applyAnswers(answers) {
    this.state.pendingAnswers = answers;
    const results = await this.orchestrator.applyAnswers(answers);
    const ok = results.filter(r => r.success).length;
    this.state.stats.answersApplied += ok;
    this.state.pendingAnswers = [];
    this.emitEvent('answersApplied', { results });
    return results;
  }

  /**
   * Capture screenshot via background → send to WhatsApp via backend
   */
  async captureAndSendScreenshot() {
    const apiBase = 'http://localhost:5050/api';

    // 1. Capture tab screenshot via background service worker
    const dataUrl = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'captureVisibleTab', options: { format: 'jpeg', quality: 85 } },
        (r) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (r && r.success) resolve(r.dataUrl);
          else reject(new Error(r?.error || 'captureVisibleTab failed'));
        }
      );
    });

    this.state.lastScreenshot = { dataUrl };

    // 2. Generate a conversation ID if none exists
    if (!this.state.activeConversation) {
      this.state.activeConversation = {
        id: 'conv_' + Date.now(),
        url: window.location.href,
        title: document.title
      };
    }

    const convId = this.state.activeConversation.id;

    // 3. Send image + text to backend → WhatsApp
    const imageBase64 = dataUrl.split(',')[1];
    const res = await fetch(`${apiBase}/whatsapp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64,
        message: `MCQ Screenshot\nURL: ${window.location.href}\nReply format:\n1:Paris\n2:2,3\n3:Mars`,
        metadata: { conversationId: convId }
      })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'WhatsApp send failed');

    this.state.stats.screenshotsSent++;
    this.emitEvent('screenshotSent', { screenshot: this.state.lastScreenshot });
    return data;
  }

  /**
   * Receive and process WhatsApp answer (called from content.js message handler)
   */
  async receiveAnswer(messageData) {
    try {
      // If there's no local active conversation, create one so answers can be stored
      if (!this.state.activeConversation) {
        console.log('[MCQAutomationSystem] No active conversation — creating local session for incoming WhatsApp answers');
        const conv = await this.orchestrator.startSession({
          metadata: { remoteConversationId: messageData.conversationId || null }
        });
        this.state.activeConversation = conv;
      }

      const result = await this.orchestrator.receiveAnswer(messageData);
      this.state.stats.answersReceived++;
      this._notify('success', `📨 Answer received from WhatsApp`);
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
      const finalStats = await this.orchestrator.getStats().catch(() => ({}));
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

  // ─────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────

  _notify(type, message) {
    if (this.notifications) {
      this.notifications['show' + type.charAt(0).toUpperCase() + type.slice(1)]?.('MCQ Bot', message);
    }
    this.emitEvent('notification', { type, message });
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

globalThis.MCQAutomationSystem = MCQAutomationSystem;

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MCQAutomationSystem;
}
