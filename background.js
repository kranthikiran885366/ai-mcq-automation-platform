/**
 * Production Background Service Worker
 * Handles messaging, webhooks, and tab management
 */

// Keep track of connected tabs
const connectedTabs = new Map();

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background] Received message:', request.action, 'from tab', sender.tab.id);

  switch (request.action) {
    case 'screenshotSent':
      handleScreenshotSent(request, sender, sendResponse);
      break;
    case 'answerReceived':
      handleAnswerReceived(request, sender, sendResponse);
      break;
    case 'answersApplied':
      handleAnswersApplied(request, sender, sendResponse);
      break;
    case 'getTabStatus':
      sendResponse({ tabId: sender.tab.id, status: 'connected' });
      break;
    case 'logEvent':
      console.log('[Background]', request.event, request.data);
      sendResponse({ success: true });
      break;
    default:
      console.warn('[Background] Unknown action:', request.action);
      sendResponse({ error: 'Unknown action' });
  }

  return true; // Keep channel open for async response
});

/**
 * Handle screenshot sent event
 */
function handleScreenshotSent(request, sender, sendResponse) {
  console.log('[Background] Screenshot sent from tab', sender.tab.id);
  
  // Store in Chrome storage
  chrome.storage.sync.get('screenshots', (result) => {
    const screenshots = result.screenshots || [];
    screenshots.push({
      tabId: sender.tab.id,
      url: sender.tab.url,
      timestamp: Date.now(),
      messageId: request.messageId,
      status: 'sent'
    });
    
    chrome.storage.sync.set({ screenshots });
    sendResponse({ success: true });
  });
}

/**
 * Handle answer received event
 */
function handleAnswerReceived(request, sender, sendResponse) {
  console.log('[Background] Answer received from tab', sender.tab.id);
  
  // Store answer
  chrome.storage.sync.get('answers', (result) => {
    const answers = result.answers || [];
    answers.push({
      tabId: sender.tab.id,
      messageId: request.messageId,
      answers: request.answers,
      timestamp: Date.now(),
      status: 'received'
    });
    
    chrome.storage.sync.set({ answers });
    
    // Broadcast to all tabs
    broadcastToAllTabs({
      action: 'answerReceived',
      messageId: request.messageId,
      answers: request.answers
    });
    
    sendResponse({ success: true });
  });
}

/**
 * Handle answers applied event
 */
function handleAnswersApplied(request, sender, sendResponse) {
  console.log('[Background] Answers applied from tab', sender.tab.id);
  
  // Store statistics
  chrome.storage.sync.get('statistics', (result) => {
    const stats = result.statistics || {};
    stats.answersApplied = (stats.answersApplied || 0) + request.count;
    stats.successCount = (stats.successCount || 0) + request.successful;
    stats.lastUpdate = Date.now();
    
    chrome.storage.sync.set({ statistics: stats });
    sendResponse({ success: true });
  });
}

/**
 * Broadcast message to all tabs
 */
function broadcastToAllTabs(message) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {
        // Tab might not have content script loaded
      });
    }
  });
}

/**
 * Tab update listener
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    console.log('[Background] Tab loaded:', tab.url);
    
    // Inject content script if needed
    chrome.scripting.executeScript({
      target: { tabId },
      function: () => {
        console.log('[Content] Injected');
      }
    }).catch((err) => {
      // Extension not enabled or tab doesn't allow injection
    });
  }
});

/**
 * Handle extension installation
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Background] Extension installed');
    
    // Open welcome page
    chrome.tabs.create({ url: 'options.html?welcome=true' });
    
    // Initialize storage
    chrome.storage.sync.set({
      statistics: {
        screenshotsTaken: 0,
        answersReceived: 0,
        answersApplied: 0,
        successCount: 0
      }
    });
  } else if (details.reason === 'update') {
    console.log('[Background] Extension updated');
  }
});

/**
 * Webhook endpoint for WhatsApp messages (if using local relay)
 * This would be called by backend via chrome.runtime.sendMessage
 */
async function relayWhatsAppMessage(messageData) {
  console.log('[Background] Relaying WhatsApp message:', messageData);
  
  // Broadcast to all tabs
  broadcastToAllTabs({
    action: 'whatsappMessageReceived',
    data: messageData
  });
}

/**
 * Set up periodic sync/polling if needed
 */
chrome.alarms.create('checkMessages', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkMessages') {
    console.log('[Background] Checking for new messages...');
    // Implement polling logic here if needed
  }
});

console.log('[Background] Service worker loaded and ready');
