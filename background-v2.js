/**
 * Background Service Worker
 * Handles WhatsApp webhook, timers, and cross-tab communication
 */

console.log('[Background] Service worker loaded');

// Store for active tabs with MCQ extension
const activeTabs = new Map();

/**
 * Listen for tab updates
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    console.log('[Background] Tab updated:', tabId, tab.url);
    
    // Inject content script if needed
    if (shouldInjectExtension(tab.url)) {
      injectContentScript(tabId);
    }
  }
});

/**
 * Listen for tab removal
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  console.log('[Background] Tab removed:', tabId);
  activeTabs.delete(tabId);
});

/**
 * Listen for messages from content scripts
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background] Message received:', request.action);

  switch (request.action) {
    case 'whatsappMessageReceived':
      handleWhatsAppMessage(request.data, sender);
      sendResponse({ success: true });
      break;

    case 'registerTab':
      activeTabs.set(sender.tab.id, {
        url: sender.tab.url,
        title: sender.tab.title,
        registered: Date.now()
      });
      console.log('[Background] Tab registered:', sender.tab.id);
      sendResponse({ success: true });
      break;

    case 'getActiveTabs':
      sendResponse({ tabs: Array.from(activeTabs.entries()) });
      break;

    case 'broadcastMessage':
      broadcastToTabs(request.message);
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }

  return true; // Keep channel open for async responses
});

/**
 * Handle WhatsApp message webhook
 */
function handleWhatsAppMessage(data, sender) {
  console.log('[Background] WhatsApp message received');

  // Parse the message
  const message = {
    from: data.from,
    body: data.body,
    mediaUrl: data.mediaUrl,
    messageId: data.messageSid,
    timestamp: Date.now(),
    senderType: 'bot' // Mark as bot response
  };

  // Send to all active tabs
  for (const [tabId] of activeTabs) {
    chrome.tabs.sendMessage(tabId, {
      action: 'whatsappAnswerReceived',
      data: message
    }).catch(err => {
      console.warn('[Background] Failed to send to tab', tabId, err);
    });
  }
}

/**
 * Broadcast message to all active tabs
 */
function broadcastToTabs(message) {
  console.log('[Background] Broadcasting message to all tabs');

  for (const [tabId] of activeTabs) {
    chrome.tabs.sendMessage(tabId, {
      action: 'broadcastMessage',
      data: message
    }).catch(err => {
      console.warn('[Background] Failed to broadcast to tab', tabId, err);
    });
  }
}

/**
 * Check if URL should have extension
 */
function shouldInjectExtension(url) {
  // Don't inject on chrome:// or extension pages
  if (url.startsWith('chrome://') || url.startsWith('moz-extension://')) {
    return false;
  }

  return true;
}

/**
 * Inject content script
 */
function injectContentScript(tabId) {
  const scripts = [
    'modules/storage.js',
    'modules/whatsapp.js',
    'modules/screenshot.js',
    'modules/auto-answer.js',
    'modules/mcq-orchestrator.js',
    'modules/ui-dashboard.js',
    'content-v2.js'
  ];

  for (const script of scripts) {
    chrome.scripting.executeScript({
      target: { tabId },
      files: [script]
    }).catch(err => {
      console.warn('[Background] Failed to inject', script, err);
    });
  }
}

/**
 * Listen for extension icon click
 */
chrome.action.onClicked.addListener((tab) => {
  console.log('[Background] Extension icon clicked');

  // Toggle dashboard in current tab
  chrome.tabs.sendMessage(tab.id, {
    action: 'toggleDashboard'
  }).catch(err => {
    console.warn('[Background] Failed to toggle dashboard:', err);
  });
});

/**
 * Handle WhatsApp webhook (incoming messages)
 * This should be called from your backend when receiving WhatsApp messages
 * POST /webhook/whatsapp -> chrome.runtime.sendMessage(extensionId, { action: 'whatsappMessageReceived', data: ... })
 */
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (request.action === 'whatsappWebhook') {
    console.log('[Background] Webhook received:', request.data);
    handleWhatsAppMessage(request.data, sender);
    sendResponse({ success: true });
  }
});

/**
 * Setup alarms for periodic tasks
 */
function setupAlarms() {
  // Create alarm for checking message queue every 30 seconds
  chrome.alarms.create('checkMessageQueue', { periodInMinutes: 0.5 });
  
  // Create alarm for cleanup every 24 hours
  chrome.alarms.create('cleanupOldData', { periodInMinutes: 1440 });

  console.log('[Background] Alarms setup complete');
}

/**
 * Handle alarms
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  console.log('[Background] Alarm triggered:', alarm.name);

  switch (alarm.name) {
    case 'checkMessageQueue':
      // Check if any messages are queued in WhatsApp manager
      broadcastToTabs({
        action: 'checkMessageQueue'
      });
      break;

    case 'cleanupOldData':
      // Clean up old conversations (older than 30 days)
      broadcastToTabs({
        action: 'cleanupOldData',
        olderThan: 30 * 24 * 60 * 60 * 1000 // 30 days
      });
      break;
  }
});

/**
 * Initialize on extension load
 */
function initialize() {
  console.log('[Background] Initializing...');
  
  setupAlarms();

  // Request all tabs and inject if needed
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (shouldInjectExtension(tab.url)) {
        injectContentScript(tab.id);
      }
    }
  });

  console.log('[Background] Initialization complete');
}

// Initialize when service worker starts
initialize();

/**
 * Handle storage changes
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync') {
    console.log('[Background] Settings changed:', changes);

    // Broadcast changes to all tabs
    for (const [tabId] of activeTabs) {
      chrome.tabs.sendMessage(tabId, {
        action: 'settingsChanged',
        changes
      }).catch(err => {
        console.warn('[Background] Failed to notify tab', tabId, err);
      });
    }
  }
});

/**
 * Show notification
 */
function showNotification(title, options = {}) {
  chrome.notifications.create({
    type: 'basic',
    title,
    message: options.message || '',
    iconUrl: 'icons/icon128.png',
    ...options
  });
}

// Export for external use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { handleWhatsAppMessage, showNotification };
}
