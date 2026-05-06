/**
 * Production Content Script - Complete MCQ Automation System
 * Integrates all modules for end-to-end MCQ detection, screenshot, WhatsApp, answer parsing, and auto-selection
 */

// ============================================================================
// INITIALIZATION
// ============================================================================

let automationSystem = null;
let mcqDetector = null;
let isInitialized = false;

// Initialize system on load
document.addEventListener('DOMContentLoaded', async () => {
  await initializeAutomationSystem();
});

// Also init on document ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', async () => {
    if (!isInitialized) {
      await initializeAutomationSystem();
    }
  });
} else {
  // Document already loaded
  initializeAutomationSystem();
}

/**
 * Initialize the complete automation system
 */
async function initializeAutomationSystem() {
  if (isInitialized) return;

  try {
    console.log('[Production] Initializing automation system...');

    // Create MCQ detector
    mcqDetector = new MCQDetector({ debugMode: false });

    // Create automation system
    automationSystem = new MCQAutomationSystem({
      autoMode: true,
      autoScreenshot: false,  // Require user action
      autoSendWhatsApp: false,  // Require configuration
      autoApplyAnswers: true,
      pollInterval: 3000,
      maxRetries: 3
    });

    // Initialize
    await automationSystem.init();
    isInitialized = true;

    console.log('[Production] Automation system ready');

    // Setup event listeners
    setupEventListeners();

    // Create UI
    createFloatingButton();
    createDashboard();

    // Start MCQ detection
    startMCQDetection();

  } catch (error) {
    console.error('[Production] Initialization failed:', error);
  }
}

// ============================================================================
// MCQ DETECTION
// ============================================================================

function startMCQDetection() {
  if (!mcqDetector) return;

  // Initial detection
  const mcqs = mcqDetector.detectMCQs();
  console.log('[Production] Initial detection found', mcqs.length, 'MCQs');

  // Watch for new MCQs (dynamic pages)
  mcqDetector.watchForNewMCQs((mcqs) => {
    console.log('[Production] Detected', mcqs.length, 'MCQs on page');
    updateDashboardWithMCQs(mcqs);
  }, 2000);
}

// ============================================================================
// UI COMPONENTS
// ============================================================================

let floatingButton = null;
let dashboard = null;

function createFloatingButton() {
  // Create button container
  const button = document.createElement('div');
  button.id = 'mcq-automation-button';
  button.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 60px;
    height: 60px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 99999;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    font-size: 24px;
    transition: all 0.3s ease;
    border: none;
  `;
  
  button.innerHTML = '📸';
  button.title = 'MCQ Automation - Click to screenshot';

  button.addEventListener('click', () => toggleDashboard());
  button.addEventListener('mouseenter', () => {
    button.style.transform = 'scale(1.1)';
    button.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.4)';
  });
  button.addEventListener('mouseleave', () => {
    button.style.transform = 'scale(1)';
    button.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
  });

  document.body.appendChild(button);
  floatingButton = button;
}

function createDashboard() {
  const dashboard = document.createElement('div');
  dashboard.id = 'mcq-automation-dashboard';
  dashboard.style.cssText = `
    position: fixed;
    bottom: 90px;
    right: 20px;
    width: 350px;
    max-height: 500px;
    background: white;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    z-index: 99998;
    display: none;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    overflow: hidden;
  `;

  dashboard.innerHTML = `
    <div style="
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
    ">
      <span>MCQ Automation</span>
      <button id="close-dashboard" style="
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: white;
        cursor: pointer;
        font-size: 18px;
        padding: 0 8px;
      ">✕</button>
    </div>

    <div style="
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    ">
      <div id="mcq-stats" style="
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-bottom: 16px;
      ">
        <div style="
          background: #f0f4ff;
          padding: 12px;
          border-radius: 8px;
          text-align: center;
        ">
          <div style="font-size: 12px; color: #666;">MCQs Found</div>
          <div id="mcq-count" style="font-size: 24px; font-weight: 600; color: #667eea;">0</div>
        </div>
        <div style="
          background: #f0f4ff;
          padding: 12px;
          border-radius: 8px;
          text-align: center;
        ">
          <div style="font-size: 12px; color: #666;">Answers Applied</div>
          <div id="applied-count" style="font-size: 24px; font-weight: 600; color: #667eea;">0</div>
        </div>
      </div>

      <div style="margin-bottom: 16px;">
        <button id="take-screenshot-btn" style="
          width: 100%;
          padding: 12px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.3s ease;
        ">
          📸 Take Screenshot
        </button>
      </div>

      <div id="status-message" style="
        padding: 12px;
        background: #f5f5f5;
        border-radius: 8px;
        font-size: 13px;
        color: #666;
        display: none;
      "></div>

      <div id="message-log" style="
        margin-top: 12px;
        padding: 12px;
        background: #f9f9f9;
        border-radius: 8px;
        border-left: 3px solid #667eea;
        max-height: 200px;
        overflow-y: auto;
        font-size: 12px;
        color: #333;
      "></div>
    </div>
  `;

  document.body.appendChild(dashboard);

  // Event listeners
  document.getElementById('close-dashboard').addEventListener('click', () => toggleDashboard());
  document.getElementById('take-screenshot-btn').addEventListener('click', () => takeScreenshot());

  // Auto-show status on activity
  automationSystem.on('screenshotSent', (data) => {
    showStatus('📸 Screenshot sent!', 'success');
  });

  automationSystem.on('answerReceived', (data) => {
    showStatus(`📨 Received ${data.answers.length} answers!`, 'success');
  });

  automationSystem.on('answersApplied', (data) => {
    const count = data.results.filter(r => r.success).length;
    showStatus(`✅ Applied ${count} answers!`, 'success');
  });

  automationSystem.on('error', (data) => {
    showStatus('❌ Error: ' + data.error.message, 'error');
  });

  return dashboard;
}

function toggleDashboard() {
  if (!dashboard) dashboard = document.getElementById('mcq-automation-dashboard');
  const isVisible = dashboard.style.display !== 'none';
  dashboard.style.display = isVisible ? 'none' : 'flex';
}

function showStatus(message, type = 'info') {
  const statusEl = document.getElementById('status-message');
  const logEl = document.getElementById('message-log');

  if (statusEl) {
    statusEl.textContent = message;
    statusEl.style.display = 'block';
    statusEl.style.background = type === 'error' ? '#ffebee' : type === 'success' ? '#e8f5e9' : '#e3f2fd';
    statusEl.style.color = type === 'error' ? '#c62828' : type === 'success' ? '#2e7d32' : '#1565c0';
  }

  // Add to log
  if (logEl) {
    const entry = document.createElement('div');
    entry.style.marginBottom = '4px';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function updateDashboardWithMCQs(mcqs) {
  const countEl = document.getElementById('mcq-count');
  if (countEl) {
    countEl.textContent = mcqs.length;
  }
  showStatus(`Found ${mcqs.length} MCQs on page`, 'info');
}

// ============================================================================
// ACTIONS
// ============================================================================

async function takeScreenshot() {
  try {
    showStatus('📷 Taking screenshot...', 'info');
    
    if (!automationSystem.state.activeConversation) {
      await automationSystem.startAutomation();
    }

    await automationSystem.captureAndSendScreenshot();
    showStatus('✅ Screenshot sent to WhatsApp!', 'success');
    
  } catch (error) {
    console.error('[Production] Screenshot failed:', error);
    showStatus('❌ Screenshot failed: ' + error.message, 'error');
  }
}

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

function setupEventListeners() {
  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessage(request).then(response => {
      sendResponse(response);
    }).catch(error => {
      console.error('[Production] Message handling error:', error);
      sendResponse({ error: error.message });
    });
    return true;  // Keep channel open for async response
  });
}

async function handleMessage(request) {
  console.log('[Production] Received message:', request.action);

  switch (request.action) {
    case 'whatsappMessageReceived':
      return await handleWhatsAppMessage(request.data);

    case 'detectMCQs':
      return {
        mcqs: mcqDetector.detectMCQs(),
        count: mcqDetector.getAllMCQs().length
      };

    case 'applyAnswers':
      return await applyAnswersManually(request.answers);

    case 'getStatus':
      return automationSystem.getStatus();

    case 'reset':
      await automationSystem.reset();
      return { success: true };

    default:
      return { error: 'Unknown action: ' + request.action };
  }
}

/**
 * Handle incoming WhatsApp message with answers
 */
async function handleWhatsAppMessage(messageData) {
  try {
    console.log('[Production] Processing WhatsApp message:', messageData.body);

    const result = await automationSystem.receiveAnswer({
      body: messageData.body,
      messageId: messageData.messageId,
      senderType: 'bot'
    });

    return {
      success: true,
      answersApplied: result.answers.length,
      results: result.storedAnswers
    };
  } catch (error) {
    console.error('[Production] WhatsApp message processing failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Apply answers manually (user submission)
 */
async function applyAnswersManually(answers) {
  try {
    const results = await automationSystem.applyPendingAnswers();
    return {
      success: true,
      applied: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================

document.addEventListener('keydown', (e) => {
  // Ctrl+Shift+M: Take screenshot
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyM') {
    e.preventDefault();
    takeScreenshot();
  }

  // Ctrl+Shift+H: Toggle dashboard
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyH') {
    e.preventDefault();
    toggleDashboard();
  }
});

// ============================================================================
// EXPORTS (for testing)
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    automationSystem,
    mcqDetector,
    initializeAutomationSystem,
    takeScreenshot,
    toggleDashboard,
    showStatus
  };
}

console.log('[Production] Content script loaded and ready');
