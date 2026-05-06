/**
 * Content Script - Main Integration
 * Coordinates all modules: Storage, WhatsApp, Screenshot, AutoAnswer, UI
 */

console.log('[MCQ Extension] Content script loaded');

// Global instances
let orchestrator = null;
let uiDashboard = null;

/**
 * Initialize the extension on page load
 */
async function initializeExtension() {
  try {
    console.log('[MCQ Extension] Initializing...');

    // Wait for all modules to be available
    await waitForModules();

    // Create instances
    const storage = new StorageManager();
    const whatsapp = new WhatsAppManager();
    const screenshot = new ScreenshotManager();
    const autoAnswer = new AutoAnswerManager();
    orchestrator = new MCQOrchestrator();

    // Initialize all modules
    await orchestrator.init(storage, whatsapp, screenshot, autoAnswer);

    // Create and initialize UI
    uiDashboard = new UIDashboard();
    await uiDashboard.init(orchestrator);

    // Show dashboard
    uiDashboard.show();

    // Start session
    await orchestrator.startSession({
      url: window.location.href,
      title: document.title,
      userAgent: navigator.userAgent
    });

    console.log('[MCQ Extension] Initialized successfully');

    // Setup keyboard shortcuts
    setupKeyboardShortcuts();

    // Listen for messages from background script
    chrome.runtime.onMessage.addListener(handleBackgroundMessage);

  } catch (error) {
    console.error('[MCQ Extension] Initialization error:', error);
  }
}

/**
 * Wait for all modules to load
 */
async function waitForModules(timeout = 5000) {
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    if (typeof StorageManager !== 'undefined' &&
        typeof WhatsAppManager !== 'undefined' &&
        typeof ScreenshotManager !== 'undefined' &&
        typeof AutoAnswerManager !== 'undefined' &&
        typeof MCQOrchestrator !== 'undefined' &&
        typeof UIDashboard !== 'undefined') {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error('Modules failed to load');
}

/**
 * Setup keyboard shortcuts
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+M: Take screenshot
    if (e.ctrlKey && e.shiftKey && e.key === 'M') {
      e.preventDefault();
      orchestrator.captureAndSend().catch(err => {
        console.error('[Shortcut] Screenshot failed:', err);
      });
    }

    // Ctrl+Shift+H: Toggle dashboard
    if (e.ctrlKey && e.shiftKey && e.key === 'H') {
      e.preventDefault();
      uiDashboard.toggleVisibility();
    }
  });

  console.log('[MCQ Extension] Keyboard shortcuts enabled (Ctrl+Shift+M, Ctrl+Shift+H)');
}

/**
 * Handle messages from background script
 */
function handleBackgroundMessage(request, sender, sendResponse) {
  console.log('[MCQ Extension] Message received:', request.action);

  switch (request.action) {
    case 'captureAndSend':
      orchestrator.captureAndSend()
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'receiveAnswer':
      orchestrator.receiveAnswer(request.data)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'toggleDashboard':
      uiDashboard.toggleVisibility();
      sendResponse({ success: true });
      break;

    case 'getStats':
      orchestrator.getStats()
        .then(stats => sendResponse({ success: true, stats }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'clearConversation':
      orchestrator.clearConversation()
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }
}

/**
 * Create floating button for easy access
 */
function createFloatingButton() {
  const button = document.createElement('button');
  button.id = 'mcq-floating-btn';
  button.textContent = '📸';
  button.title = 'MCQ Assistant (Ctrl+Shift+M)';
  button.style.cssText = `
    position: fixed;
    bottom: 30px;
    left: 20px;
    width: 60px;
    height: 60px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: none;
    border-radius: 50%;
    color: white;
    font-size: 24px;
    cursor: pointer;
    z-index: 9999;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  button.addEventListener('click', () => {
    orchestrator.captureAndSend().catch(err => {
      console.error('[FloatingButton] Screenshot failed:', err);
    });
  });

  button.addEventListener('mouseover', () => {
    button.style.transform = 'scale(1.1)';
    button.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.4)';
  });

  button.addEventListener('mouseout', () => {
    button.style.transform = 'scale(1)';
    button.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
  });

  document.body.appendChild(button);
}

/**
 * Load settings and configure
 */
function loadSettings() {
  chrome.storage.sync.get(['mcqSettings'], (result) => {
    if (result.mcqSettings) {
      const settings = result.mcqSettings;
      console.log('[MCQ Extension] Settings loaded:', settings);

      if (orchestrator) {
        orchestrator.config.autoSendScreenshot = settings.autoSend !== false;
        orchestrator.config.autoApplyAnswers = settings.autoApply !== false;
        orchestrator.config.showNotifications = settings.notifications !== false;
      }

      if (settings.whatsappNumber) {
        // Update WhatsApp manager with phone number
        if (orchestrator && orchestrator.whatsapp) {
          orchestrator.whatsapp.toNumber = settings.whatsappNumber;
        }
      }
    }
  });
}

/**
 * Check for MCQs on the page and suggest action
 */
function checkForMCQs() {
  const selectors = [
    '.question',
    '.mcq-question',
    '[data-question]',
    '.exam-question',
    '.quiz-question'
  ];

  let totalQuestions = 0;
  for (const selector of selectors) {
    totalQuestions += document.querySelectorAll(selector).length;
    if (totalQuestions > 0) break;
  }

  if (totalQuestions > 0) {
    console.log(`[MCQ Extension] Found ${totalQuestions} MCQ questions on page`);
    
    if (uiDashboard) {
      uiDashboard.addMessage(`🎯 Found ${totalQuestions} MCQ questions`, 'system');
    }
  }
}

/**
 * Setup periodic checks
 */
function setupPeriodicChecks() {
  // Check for MCQs every 5 seconds
  setInterval(() => {
    checkForMCQs();
  }, 5000);
}

/**
 * Main initialization
 */
document.addEventListener('DOMContentLoaded', () => {
  console.log('[MCQ Extension] DOM ready, starting initialization...');
  
  initializeExtension()
    .then(() => {
      console.log('[MCQ Extension] Full initialization complete');
      
      // Load settings
      loadSettings();

      // Create floating button
      createFloatingButton();

      // Setup periodic checks
      setupPeriodicChecks();

      // Initial MCQ check
      checkForMCQs();
    })
    .catch(error => {
      console.error('[MCQ Extension] Initialization failed:', error);
    });
});

// If DOM is already loaded
if (document.readyState === 'interactive' || document.readyState === 'complete') {
  console.log('[MCQ Extension] DOM already loaded');
  
  initializeExtension()
    .then(() => {
      console.log('[MCQ Extension] Full initialization complete');
      loadSettings();
      createFloatingButton();
      setupPeriodicChecks();
      checkForMCQs();
    })
    .catch(error => {
      console.error('[MCQ Extension] Initialization failed:', error);
    });
}
