/**
 * IndexedDB Storage Module
 * Handles all persistent storage for MCQ conversations, messages, and answer history
 */

class StorageManager {
  constructor() {
    this.dbName = 'MCQAssistant';
    this.version = 1;
    this.db = null;
    this.stores = {
      conversations: 'conversations',
      messages: 'messages',
      answers: 'answers',
      screenshots: 'screenshots',
      history: 'history'
    };
  }

  /**
   * Initialize IndexedDB
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Conversations store
        if (!db.objectStoreNames.contains(this.stores.conversations)) {
          const convStore = db.createObjectStore(this.stores.conversations, { 
            keyPath: 'id' 
          });
          convStore.createIndex('url', 'url', { unique: false });
          convStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Messages store
        if (!db.objectStoreNames.contains(this.stores.messages)) {
          const msgStore = db.createObjectStore(this.stores.messages, { 
            keyPath: 'id' 
          });
          msgStore.createIndex('conversationId', 'conversationId', { unique: false });
          msgStore.createIndex('timestamp', 'timestamp', { unique: false });
          msgStore.createIndex('type', 'type', { unique: false });
        }

        // Answers store
        if (!db.objectStoreNames.contains(this.stores.answers)) {
          const ansStore = db.createObjectStore(this.stores.answers, { 
            keyPath: 'id' 
          });
          ansStore.createIndex('conversationId', 'conversationId', { unique: false });
          ansStore.createIndex('questionIndex', 'questionIndex', { unique: false });
          ansStore.createIndex('applied', 'applied', { unique: false });
        }

        // Screenshots store
        if (!db.objectStoreNames.contains(this.stores.screenshots)) {
          const ssStore = db.createObjectStore(this.stores.screenshots, { 
            keyPath: 'id' 
          });
          ssStore.createIndex('conversationId', 'conversationId', { unique: false });
          ssStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // History store (for analytics)
        if (!db.objectStoreNames.contains(this.stores.history)) {
          const histStore = db.createObjectStore(this.stores.history, { 
            keyPath: 'id' 
          });
          histStore.createIndex('timestamp', 'timestamp', { unique: false });
          histStore.createIndex('action', 'action', { unique: false });
        }
      };
    });
  }

  /**
   * Create new conversation
   */
  async createConversation(data) {
    const conversation = {
      id: this.generateUUID(),
      url: data.url,
      title: data.title,
      timestamp: Date.now(),
      status: 'active',
      questionCount: data.questionCount || 0,
      answeredCount: 0,
      appliedCount: 0,
      metadata: data.metadata || {}
    };

    return this.set(this.stores.conversations, conversation);
  }

  /**
   * Get conversation by ID
   */
  async getConversation(id) {
    return this.get(this.stores.conversations, id);
  }

  /**
   * Get all conversations
   */
  async getAllConversations() {
    return this.getAll(this.stores.conversations);
  }

  /**
   * Add message to conversation
   */
  async addMessage(conversationId, data) {
    const message = {
      id: this.generateUUID(),
      conversationId,
      type: data.type, // 'screenshot', 'question', 'answer', 'system'
      content: data.content,
      timestamp: Date.now(),
      status: data.status || 'sent', // 'sent', 'delivered', 'read', 'failed'
      metadata: data.metadata || {},
      whatsappId: data.whatsappId || null,
      senderType: data.senderType || 'user' // 'user', 'bot', 'extension'
    };

    return this.set(this.stores.messages, message);
  }

  /**
   * Get messages for conversation
   */
  async getMessages(conversationId) {
    return this.getAllByIndex(this.stores.messages, 'conversationId', conversationId);
  }

  /**
   * Store answer
   */
  async storeAnswer(conversationId, data) {
    const answer = {
      id: this.generateUUID(),
      conversationId,
      questionIndex: data.questionIndex,
      questionText: data.questionText,
      options: data.options, // array of option texts
      selectedOption: data.selectedOption,
      selectedIndex: data.selectedIndex,
      confidence: data.confidence || 0.8,
      timestamp: Date.now(),
      applied: false,
      appliedAt: null,
      appliedSelector: null,
      selectorType: data.selectorType || null, // 'radio', 'checkbox', 'button'
      messageId: data.messageId || null
    };

    return this.set(this.stores.answers, answer);
  }

  /**
   * Get answers for conversation
   */
  async getAnswers(conversationId) {
    return this.getAllByIndex(this.stores.answers, 'conversationId', conversationId);
  }

  /**
   * Update answer as applied
   */
  async markAnswerApplied(answerId, selectorInfo) {
    const answer = await this.get(this.stores.answers, answerId);
    if (answer) {
      answer.applied = true;
      answer.appliedAt = Date.now();
      answer.appliedSelector = selectorInfo;
      return this.set(this.stores.answers, answer);
    }
  }

  /**
   * Store screenshot
   */
  async storeScreenshot(conversationId, data) {
    const screenshot = {
      id: this.generateUUID(),
      conversationId,
      dataUrl: data.dataUrl,
      size: data.size,
      timestamp: Date.now(),
      metadata: data.metadata || {}
    };

    return this.set(this.stores.screenshots, screenshot);
  }

  /**
   * Get screenshot for conversation
   */
  async getScreenshot(conversationId) {
    const screenshots = await this.getAllByIndex(
      this.stores.screenshots,
      'conversationId',
      conversationId
    );
    return screenshots.length > 0 ? screenshots[screenshots.length - 1] : null;
  }

  /**
   * Add history entry
   */
  async addHistory(data) {
    const entry = {
      id: this.generateUUID(),
      timestamp: Date.now(),
      action: data.action,
      details: data.details || {},
      url: data.url,
      conversationId: data.conversationId || null,
      success: data.success !== false
    };

    return this.set(this.stores.history, entry);
  }

  /**
   * Generic get
   */
  async get(storeName, key) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Generic set
   */
  async set(storeName, value) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(value);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Generic get all
   */
  async getAll(storeName) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Get all by index
   */
  async getAllByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Delete conversation and related data
   */
  async deleteConversation(conversationId) {
    const messages = await this.getMessages(conversationId);
    const answers = await this.getAnswers(conversationId);

    for (const msg of messages) {
      await this.delete(this.stores.messages, msg.id);
    }

    for (const ans of answers) {
      await this.delete(this.stores.answers, ans.id);
    }

    return this.delete(this.stores.conversations, conversationId);
  }

  /**
   * Generic delete
   */
  async delete(storeName, key) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Clear all data
   */
  async clearAll() {
    for (const storeName of Object.values(this.stores)) {
      await new Promise((resolve, reject) => {
        const transaction = this.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
    }
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

  /**
   * Get statistics
   */
  async getStats(conversationId) {
    const conversation = await this.getConversation(conversationId);
    const messages = await this.getMessages(conversationId);
    const answers = await this.getAnswers(conversationId);

    const appliedAnswers = answers.filter(a => a.applied);

    return {
      conversationId,
      totalQuestions: conversation.questionCount,
      totalAnswers: answers.length,
      appliedAnswers: appliedAnswers.length,
      successRate: conversation.questionCount > 0 
        ? (appliedAnswers.length / conversation.questionCount * 100).toFixed(2) + '%'
        : '0%',
      messages: messages.length,
      duration: Date.now() - conversation.timestamp,
      url: conversation.url
    };
  }
}

// Export for use in content script and background
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
}
