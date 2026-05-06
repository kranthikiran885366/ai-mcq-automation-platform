/**
 * UI Dashboard Module
 * Displays conversation history, answers, and controls
 */

class UIDashboard {
  constructor(config = {}) {
    this.containerId = config.containerId || 'mcq-dashboard';
    this.orchestrator = null;
    this.isVisible = false;
    this.currentTab = 'chat'; // 'chat', 'answers', 'settings'
  }

  /**
   * Initialize UI
   */
  async init(orchestrator) {
    this.orchestrator = orchestrator;
    this.createDashboard();
    this.attachEventListeners();
    this.setupOrchstratorListeners();
    console.log('[UIDashboard] Initialized');
  }

  /**
   * Create dashboard HTML
   */
  createDashboard() {
    // Remove existing dashboard if any
    const existing = document.getElementById(this.containerId);
    if (existing) existing.remove();

    // Create container
    const container = document.createElement('div');
    container.id = this.containerId;
    container.className = 'mcq-dashboard';
    container.innerHTML = `
      <div class="mcq-dashboard-wrapper">
        <!-- Header -->
        <div class="mcq-header">
          <div class="mcq-header-content">
            <h2>MCQ Assistant</h2>
            <div class="mcq-header-actions">
              <button id="mcq-minimize-btn" class="mcq-btn-icon" title="Minimize">
                <span>−</span>
              </button>
              <button id="mcq-close-btn" class="mcq-btn-icon" title="Close">
                <span>✕</span>
              </button>
            </div>
          </div>

          <!-- Tabs -->
          <div class="mcq-tabs">
            <button class="mcq-tab active" data-tab="chat">
              <span>💬</span> Chat
            </button>
            <button class="mcq-tab" data-tab="answers">
              <span>✓</span> Answers
            </button>
            <button class="mcq-tab" data-tab="settings">
              <span>⚙</span> Settings
            </button>
          </div>
        </div>

        <!-- Main Content -->
        <div class="mcq-content">
          <!-- Chat Tab -->
          <div class="mcq-tab-panel active" data-panel="chat">
            <div class="mcq-chat-container">
              <div id="mcq-messages" class="mcq-messages"></div>
              
              <div class="mcq-chat-controls">
                <button id="mcq-screenshot-btn" class="mcq-btn-primary">
                  📸 Take Screenshot
                </button>
                <button id="mcq-clear-btn" class="mcq-btn-secondary">
                  🗑️ Clear
                </button>
              </div>
            </div>
          </div>

          <!-- Answers Tab -->
          <div class="mcq-tab-panel" data-panel="answers">
            <div class="mcq-answers-container">
              <div id="mcq-answers" class="mcq-answers-list"></div>
              <div class="mcq-answers-stats">
                <div class="mcq-stat">
                  <span class="mcq-stat-label">Total Questions:</span>
                  <span class="mcq-stat-value" id="mcq-total-questions">0</span>
                </div>
                <div class="mcq-stat">
                  <span class="mcq-stat-label">Answers Received:</span>
                  <span class="mcq-stat-value" id="mcq-total-answers">0</span>
                </div>
                <div class="mcq-stat">
                  <span class="mcq-stat-label">Applied:</span>
                  <span class="mcq-stat-value" id="mcq-applied-answers">0</span>
                </div>
                <div class="mcq-stat">
                  <span class="mcq-stat-label">Success Rate:</span>
                  <span class="mcq-stat-value" id="mcq-success-rate">0%</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Settings Tab -->
          <div class="mcq-tab-panel" data-panel="settings">
            <div class="mcq-settings-container">
              <div class="mcq-setting-group">
                <label class="mcq-checkbox">
                  <input type="checkbox" id="mcq-auto-send" checked>
                  <span>Auto-send screenshots</span>
                </label>
              </div>

              <div class="mcq-setting-group">
                <label class="mcq-checkbox">
                  <input type="checkbox" id="mcq-auto-apply" checked>
                  <span>Auto-apply answers</span>
                </label>
              </div>

              <div class="mcq-setting-group">
                <label class="mcq-checkbox">
                  <input type="checkbox" id="mcq-notifications" checked>
                  <span>Show notifications</span>
                </label>
              </div>

              <div class="mcq-setting-group">
                <label>WhatsApp Number:</label>
                <input type="tel" id="mcq-whatsapp-number" placeholder="+1234567890" class="mcq-input">
              </div>

              <div class="mcq-setting-group">
                <button id="mcq-save-settings-btn" class="mcq-btn-primary">
                  Save Settings
                </button>
              </div>

              <hr class="mcq-divider">

              <div class="mcq-setting-group">
                <h3>About</h3>
                <p>MCQ Assistant v1.0</p>
                <p>Send MCQ screenshots to WhatsApp, receive answers, auto-select them.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="mcq-footer">
          <span class="mcq-status" id="mcq-status">Ready</span>
        </div>
      </div>
    `;

    // Add styles
    this.addStyles();

    // Append to body
    document.body.appendChild(container);
  }

  /**
   * Add CSS styles
   */
  addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .mcq-dashboard {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 450px;
        height: 600px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .mcq-dashboard-wrapper {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      /* Header */
      .mcq-header {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 16px;
      }

      .mcq-header-content {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }

      .mcq-header h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
      }

      .mcq-header-actions {
        display: flex;
        gap: 8px;
      }

      .mcq-btn-icon {
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: white;
        width: 32px;
        height: 32px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 16px;
        transition: all 0.2s;
      }

      .mcq-btn-icon:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      /* Tabs */
      .mcq-tabs {
        display: flex;
        gap: 8px;
      }

      .mcq-tab {
        background: rgba(255, 255, 255, 0.1);
        border: none;
        color: white;
        padding: 8px 16px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        transition: all 0.2s;
      }

      .mcq-tab:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      .mcq-tab.active {
        background: white;
        color: #667eea;
        font-weight: 600;
      }

      /* Content */
      .mcq-content {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
      }

      .mcq-tab-panel {
        display: none;
      }

      .mcq-tab-panel.active {
        display: block;
      }

      /* Chat */
      .mcq-messages {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 16px;
        max-height: 400px;
        overflow-y: auto;
      }

      .mcq-message {
        padding: 12px;
        border-radius: 8px;
        font-size: 13px;
        line-height: 1.4;
        word-wrap: break-word;
      }

      .mcq-message.user {
        background: #667eea;
        color: white;
        margin-left: 20px;
      }

      .mcq-message.bot {
        background: #f0f0f0;
        color: #333;
        margin-right: 20px;
      }

      .mcq-message.system {
        background: #fff3cd;
        color: #856404;
        margin-left: 0;
        margin-right: 0;
        text-align: center;
      }

      .mcq-message.error {
        background: #f8d7da;
        color: #721c24;
      }

      .mcq-message-time {
        font-size: 11px;
        opacity: 0.7;
        margin-top: 4px;
      }

      /* Buttons */
      .mcq-chat-controls {
        display: flex;
        gap: 8px;
      }

      .mcq-btn-primary {
        flex: 1;
        background: #667eea;
        color: white;
        border: none;
        padding: 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: all 0.2s;
      }

      .mcq-btn-primary:hover {
        background: #5568d3;
      }

      .mcq-btn-primary:active {
        transform: scale(0.98);
      }

      .mcq-btn-secondary {
        flex: 1;
        background: #e0e0e0;
        color: #333;
        border: none;
        padding: 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: all 0.2s;
      }

      .mcq-btn-secondary:hover {
        background: #d0d0d0;
      }

      /* Answers */
      .mcq-answers-list {
        max-height: 400px;
        overflow-y: auto;
        margin-bottom: 16px;
      }

      .mcq-answer-item {
        background: #f9f9f9;
        border: 1px solid #e0e0e0;
        padding: 12px;
        border-radius: 6px;
        margin-bottom: 8px;
        font-size: 13px;
      }

      .mcq-answer-question {
        font-weight: 600;
        color: #333;
        margin-bottom: 4px;
      }

      .mcq-answer-content {
        color: #666;
      }

      .mcq-answer-applied {
        background: #e8f5e9;
        border-color: #4caf50;
      }

      .mcq-answer-applied::before {
        content: '✓ ';
        color: #4caf50;
        font-weight: bold;
      }

      /* Settings */
      .mcq-setting-group {
        margin-bottom: 16px;
      }

      .mcq-setting-group label {
        display: block;
        font-size: 13px;
        font-weight: 500;
        margin-bottom: 6px;
        color: #333;
      }

      .mcq-checkbox {
        display: flex;
        align-items: center;
        cursor: pointer;
        font-size: 13px;
      }

      .mcq-checkbox input {
        margin-right: 8px;
        cursor: pointer;
      }

      .mcq-input {
        width: 100%;
        padding: 8px;
        border: 1px solid #ddd;
        border-radius: 6px;
        font-size: 13px;
        box-sizing: border-box;
      }

      .mcq-divider {
        border: none;
        border-top: 1px solid #e0e0e0;
        margin: 16px 0;
      }

      /* Stats */
      .mcq-answers-stats {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }

      .mcq-stat {
        background: #f9f9f9;
        padding: 12px;
        border-radius: 6px;
        border-left: 4px solid #667eea;
      }

      .mcq-stat-label {
        display: block;
        font-size: 12px;
        color: #666;
        margin-bottom: 4px;
      }

      .mcq-stat-value {
        display: block;
        font-size: 20px;
        font-weight: bold;
        color: #667eea;
      }

      /* Footer */
      .mcq-footer {
        background: #f5f5f5;
        padding: 8px 16px;
        border-top: 1px solid #e0e0e0;
        font-size: 12px;
        color: #666;
      }

      .mcq-status {
        display: inline-block;
      }

      .mcq-status.loading::after {
        content: ' ...';
        animation: dotanimation 1s steps(4, end) infinite;
      }

      @keyframes dotanimation {
        0%, 20% { content: ' '; }
        40% { content: ' .'; }
        60% { content: ' ..'; }
        80%, 100% { content: ' ...'; }
      }

      /* Responsive */
      @media (max-width: 600px) {
        .mcq-dashboard {
          width: 100%;
          height: 100%;
          bottom: 0;
          right: 0;
          border-radius: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Tab switching
    document.querySelectorAll('.mcq-tab').forEach(tab => {
      tab.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
    });

    // Button actions
    document.getElementById('mcq-screenshot-btn')?.addEventListener('click', () => {
      this.takeScreenshot();
    });

    document.getElementById('mcq-clear-btn')?.addEventListener('click', () => {
      this.clearConversation();
    });

    document.getElementById('mcq-minimize-btn')?.addEventListener('click', () => {
      this.toggleVisibility();
    });

    document.getElementById('mcq-close-btn')?.addEventListener('click', () => {
      this.hide();
    });

    document.getElementById('mcq-save-settings-btn')?.addEventListener('click', () => {
      this.saveSettings();
    });
  }

  /**
   * Setup orchestrator listeners
   */
  setupOrchstratorListeners() {
    this.orchestrator.on('sessionStarted', (data) => {
      this.addMessage('Session started', 'system');
    });

    this.orchestrator.on('screenshotSent', (data) => {
      this.addMessage('Screenshot sent to WhatsApp ✓', 'system');
      this.updateStatus('Waiting for answer...');
    });

    this.orchestrator.on('answerReceived', (data) => {
      const { answers } = data;
      this.addMessage(`Received ${answers.length} answers from WhatsApp`, 'bot');
      this.updateAnswersTab();
    });

    this.orchestrator.on('answersApplied', (data) => {
      const { results } = data;
      const successful = results.filter(r => r.success).length;
      this.addMessage(`Applied ${successful}/${results.length} answers ✓`, 'system');
      this.updateStatus('Answers applied');
    });

    this.orchestrator.on('error', (data) => {
      this.addMessage(`Error: ${data.error.message}`, 'error');
      this.updateStatus('Error');
    });
  }

  /**
   * Switch tab
   */
  switchTab(tabName) {
    // Update active tab button
    document.querySelectorAll('.mcq-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update active panel
    document.querySelectorAll('.mcq-tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.dataset.panel === tabName);
    });

    this.currentTab = tabName;

    if (tabName === 'answers') {
      this.updateAnswersTab();
    }
  }

  /**
   * Add message to chat
   */
  addMessage(text, type = 'user') {
    const messagesDiv = document.getElementById('mcq-messages');
    const messageEl = document.createElement('div');
    messageEl.className = `mcq-message ${type}`;
    
    const time = new Date().toLocaleTimeString();
    messageEl.innerHTML = `
      ${text}
      <div class="mcq-message-time">${time}</div>
    `;

    messagesDiv.appendChild(messageEl);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  /**
   * Update answers tab
   */
  async updateAnswersTab() {
    const history = await this.orchestrator.getHistory();
    if (!history) return;

    const answersDiv = document.getElementById('mcq-answers');
    answersDiv.innerHTML = '';

    const { answers, stats } = history;

    // Update stats
    document.getElementById('mcq-total-questions').textContent = stats.totalQuestions;
    document.getElementById('mcq-total-answers').textContent = stats.totalAnswers;
    document.getElementById('mcq-applied-answers').textContent = stats.appliedAnswers;
    document.getElementById('mcq-success-rate').textContent = stats.successRate;

    // Display answers
    for (const answer of answers) {
      const answerEl = document.createElement('div');
      answerEl.className = `mcq-answer-item ${answer.applied ? 'mcq-answer-applied' : ''}`;
      answerEl.innerHTML = `
        <div class="mcq-answer-question">Q${answer.questionIndex + 1}: ${answer.selectedOption}</div>
        <div class="mcq-answer-content">${answer.questionText || 'Question'}</div>
      `;
      answersDiv.appendChild(answerEl);
    }
  }

  /**
   * Update status
   */
  updateStatus(text) {
    const status = document.getElementById('mcq-status');
    if (status) {
      status.textContent = text;
    }
  }

  /**
   * Take screenshot
   */
  async takeScreenshot() {
    this.updateStatus('Capturing...');
    try {
      await this.orchestrator.captureAndSend();
    } catch (error) {
      this.addMessage(`Failed to capture: ${error.message}`, 'error');
    }
  }

  /**
   * Clear conversation
   */
  async clearConversation() {
    if (confirm('Clear conversation and all data?')) {
      await this.orchestrator.clearConversation();
      document.getElementById('mcq-messages').innerHTML = '';
      this.addMessage('Conversation cleared', 'system');
    }
  }

  /**
   * Save settings
   */
  saveSettings() {
    const settings = {
      autoSend: document.getElementById('mcq-auto-send').checked,
      autoApply: document.getElementById('mcq-auto-apply').checked,
      notifications: document.getElementById('mcq-notifications').checked,
      whatsappNumber: document.getElementById('mcq-whatsapp-number').value
    };

    chrome.storage.sync.set({ mcqSettings: settings }, () => {
      this.addMessage('Settings saved ✓', 'system');
    });
  }

  /**
   * Toggle visibility
   */
  toggleVisibility() {
    this.isVisible ? this.hide() : this.show();
  }

  /**
   * Show dashboard
   */
  show() {
    const dashboard = document.getElementById(this.containerId);
    if (dashboard) {
      dashboard.style.display = 'flex';
      this.isVisible = true;
    }
  }

  /**
   * Hide dashboard
   */
  hide() {
    const dashboard = document.getElementById(this.containerId);
    if (dashboard) {
      dashboard.style.display = 'none';
      this.isVisible = false;
    }
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UIDashboard;
}
