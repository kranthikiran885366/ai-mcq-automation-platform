/**
 * Production Background Service Worker
 * Handles messaging, webhooks, and tab management
 */

// Keep track of connected tabs
const connectedTabs = new Map();

const BACKEND = 'http://localhost:5050';
const WS_URLS = ['ws://127.0.0.1:5050/ws', 'ws://localhost:5050/ws'];

// ── WebSocket relay from backend ──────────────────────────
let _ws = null;
let _wsReconnectTimer = null;
let _wsBackoffMs = 2000;
let _wsUrlIndex = 0;

function scheduleWSReconnect() {
  if (_wsReconnectTimer) {
    return;
  }

  const waitMs = _wsBackoffMs;
  _wsReconnectTimer = setTimeout(() => {
    _wsReconnectTimer = null;
    connectBackendWS();
  }, waitMs);

  _wsBackoffMs = Math.min(_wsBackoffMs * 2, 30000);
  console.log(`[Background] WS closed, reconnecting in ${Math.round(waitMs / 1000)}s...`);
}

async function connectBackendWS() {
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    const healthRes = await fetch(`${BACKEND}/api/health`, { method: 'GET', cache: 'no-store' });
    if (!healthRes.ok) {
      scheduleWSReconnect();
      return;
    }

    const wsUrl = WS_URLS[_wsUrlIndex % WS_URLS.length];
    _ws = new WebSocket(wsUrl);

    _ws.onopen = () => {
      _wsBackoffMs = 2000;
      console.log(`[Background] WS connected to backend (${wsUrl})`);
    };

    _ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.action === 'whatsappMessageReceived') {
          // Normalize backend keys to extension-friendly names
          const d = payload.data || {};
          const normalized = {
            body: d.Body || d.body || '',
            from: d.From || d.from || '',
            messageId: d.MessageSid || d.MessageSid || d.messageId || d.MessageId || '',
            conversationId: d.conversationId || d.conversation_id || d.conv_id || null,
            answers: Array.isArray(d.answers) ? d.answers : (d.answers || []) ,
            raw: d
          };

          // Respect user opt-in for auto-apply; attach flag so content can decide
          chrome.storage.sync.get('autoApplyFromWhatsApp', (res) => {
            const autoApply = res.autoApplyFromWhatsApp !== false;
            normalized.autoApply = autoApply;
            broadcastToAllTabs({ action: 'whatsappMessageReceived', data: normalized });
          });
        }
      } catch (e) {
        console.warn('[Background] WS parse error:', e);
      }
    };

    _ws.onclose = (event) => {
      _ws = null;
      if (event?.code === 1006 && WS_URLS.length > 1) {
        _wsUrlIndex = (_wsUrlIndex + 1) % WS_URLS.length;
      }
      scheduleWSReconnect();
    };

    _ws.onerror = () => {
      console.warn('[Background] WS error: connection issue');
      // onclose will handle reconnect/backoff
    };
  } catch (e) {
    _ws = null;
    console.warn('[Background] WS connect failed:', e?.message || e);
    scheduleWSReconnect();
  }
}

connectBackendWS();

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const senderTabId = sender && sender.tab ? sender.tab.id : 'extension';
  console.log('[Background] Received message:', request.action, 'from tab', senderTabId);

  switch (request.action) {
    case 'injectContentScripts':
      // Popup asks background to inject scripts into a specific tab
      ensureContentScripts(request.tabId, null).then(() => sendResponse({ success: true })).catch(() => sendResponse({ success: false }));
      break;
    case 'screenshotSent':
      handleScreenshotSent(request, sender, sendResponse);
      break;
    case 'answerReceived':
      handleAnswerReceived(request, sender, sendResponse);
      break;
    case 'answersApplied':
      handleAnswersApplied(request, sender, sendResponse);
      break;
    case 'updateStats':
      handleUpdateStats(request, sender, sendResponse);
      break;
    case 'getTabStatus':
      sendResponse({ tabId: sender.tab.id, status: 'connected' });
      break;
    case 'logEvent':
      console.log('[Background]', request.event, request.data);
      sendResponse({ success: true });
      break;
    case 'captureVisibleTab':
      captureVisibleTab(sendResponse, request.options || {});
      break;
    case 'captureAndSendToWhatsApp':
      captureAndSendToWhatsApp(request.caption || '📸 MCQ Screenshot', sendResponse);
      break;
    case 'fetchUrl':
      // Google Search fallback — fetches any URL from the background (has <all_urls> permission)
      // No API key needed — uses device internet directly
      fetchUrlForContent(request.url, sendResponse);
      break;
    case 'testApiConnection':
      // Quick connectivity test — just ping the backend health endpoint
      fetch('http://localhost:5050/api/health', { method: 'GET' })
        .then(r => r.ok ? sendResponse({ success: true }) : sendResponse({ success: false, error: 'Backend returned ' + r.status }))
        .catch(e => sendResponse({ success: false, error: 'Backend not reachable: ' + e.message }));
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
  chrome.storage.local.get('screenshots', (result) => {
    const screenshots = result.screenshots || [];
    screenshots.push({
      tabId: sender.tab.id,
      url: sender.tab.url,
      timestamp: Date.now(),
      messageId: request.messageId,
      status: 'sent'
    });
    
    chrome.storage.local.set({ screenshots });
    sendResponse({ success: true });
  });
}

/**
 * Handle answer received event
 */
function handleAnswerReceived(request, sender, sendResponse) {
  console.log('[Background] Answer received from tab', sender.tab.id);
  
  // Store answer
  chrome.storage.local.get('answers', (result) => {
    const answers = result.answers || [];
    answers.push({
      tabId: sender.tab.id,
      messageId: request.messageId,
      answers: request.answers,
      timestamp: Date.now(),
      status: 'received'
    });
    
    chrome.storage.local.set({ answers });
    
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
  chrome.storage.local.get('statistics', (result) => {
    const stats = result.statistics || {};
    stats.answersApplied = (stats.answersApplied || 0) + request.count;
    stats.successCount = (stats.successCount || 0) + request.successful;
    stats.lastUpdate = Date.now();
    
    chrome.storage.local.set({ statistics: stats });
    sendResponse({ success: true });
  });
}

/**
 * Handle live stats updates from content script
 */
function handleUpdateStats(request, sender, sendResponse) {
  const senderTabId = sender && sender.tab ? sender.tab.id : null;
  const incoming = request && request.stats ? request.stats : {};

  chrome.storage.local.get('stats', (result) => {
    const current = result.stats || {};
    const merged = {
      ...current,
      ...incoming,
      tabId: senderTabId,
      lastUpdate: Date.now()
    };

    chrome.storage.local.set({ stats: merged }, () => {
      sendResponse({ success: true, stats: merged });
    });
  });
}

function captureVisibleTab(sendResponse, options = {}) {
  const format = options.format || 'jpeg';
  const quality = typeof options.quality === 'number' ? options.quality : 70;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab) {
      sendResponse({ success: false, error: 'No active tab found' });
      return;
    }
    chrome.tabs.captureVisibleTab(null, { format, quality }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message || '';
        const isFullscreen = msg.toLowerCase().includes('fullscreen') ||
                             msg.toLowerCase().includes('screen capture') ||
                             msg.toLowerCase().includes('tab not active');
        if (isFullscreen) {
          // Fallback: ask content script to capture via html2canvas
          chrome.tabs.sendMessage(tab.id, { action: 'captureViaHtml2Canvas' }, (res) => {
            if (chrome.runtime.lastError || !res || !res.dataUrl) {
              sendResponse({ success: false, error: 'Fullscreen capture failed — html2canvas unavailable' });
            } else {
              sendResponse({ success: true, dataUrl: res.dataUrl, source: 'html2canvas' });
            }
          });
          return;
        }
        sendResponse({ success: false, error: msg });
        return;
      }
      sendResponse({ success: true, dataUrl });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch any URL on behalf of content scripts (they can't due to CORS).
 * Used by the Google Search fallback — no API key required.
 * Returns the raw HTML text of the page.
 */
async function fetchUrlForContent(url, sendResponse) {
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        // Mimic a real browser request so Google returns actual HTML
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    if (!resp.ok) {
      sendResponse({ success: false, error: `HTTP ${resp.status}` });
      return;
    }
    const html = await resp.text();
    sendResponse({ success: true, html });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

const API_BASE = BACKEND; // must match PORT in backend/.env

// Poll /api/whatsapp/status until ready or timeout
async function waitForWhatsAppReady(maxWaitMs = 30000, intervalMs = 2000) {
  const deadline = Date.now() + maxWaitMs;
  let consecutiveErrors = 0;
  while (Date.now() < deadline) {
    try {
      const r = await fetchWithTimeout(`${API_BASE}/api/whatsapp/status`, {}, 3000);
      const s = await r.json();
      consecutiveErrors = 0;
      if (s.ready) return { ready: true };
      if (s.qrPending) return { ready: false, qrPending: true };
    } catch (e) {
      consecutiveErrors++;
      if (consecutiveErrors >= 3) return { ready: false, offline: true }; // backend truly down
    }
    await new Promise(res => setTimeout(res, intervalMs));
  }
  return { ready: false, timeout: true };
}

async function captureAndSendToWhatsApp(caption, sendResponse) {
  // Step 1: get active tab first
  const tabs = await new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
  const activeTab = tabs && tabs[0];

  // Step 2: try captureVisibleTab; if fullscreen blocks it, fallback to html2canvas via content script
  let dataUrl = null;
  await new Promise(resolve => {
    chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 60 }, (url) => {
      if (chrome.runtime.lastError) {
        const msg = (chrome.runtime.lastError.message || '').toLowerCase();
        const isFullscreen = msg.includes('fullscreen') || msg.includes('screen capture') || msg.includes('tab not active');
        if (isFullscreen && activeTab) {
          chrome.tabs.sendMessage(activeTab.id, { action: 'captureViaHtml2Canvas' }, (res) => {
            if (!chrome.runtime.lastError && res && res.dataUrl) {
              dataUrl = res.dataUrl;
            }
            resolve();
          });
        } else {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          resolve('error');
        }
      } else {
        dataUrl = url;
        resolve();
      }
    });
  });

  if (!dataUrl) {
    // html2canvas also failed
    sendResponse({ success: false, error: 'Screen capture failed in fullscreen — html2canvas unavailable' });
    return;
  }

  // Step 3: check backend + WhatsApp status
  let status;
  try {
    const r = await fetchWithTimeout(`${API_BASE}/api/whatsapp/status`, {}, 4000);
    status = await r.json();
  } catch (e) {
    sendResponse({ success: false, dataUrl, error: 'Backend not running -- start python run_server.py' });
    return;
  }

  // Step 4: wait for bridge if still initialising
  if (!status.ready && !status.qrPending) {
    console.log('[Background] Bridge initialising, waiting up to 30s...');
    status = await waitForWhatsAppReady(30000, 2000);
  }

  if (!status.ready) {
    if (status.offline) {
      sendResponse({ success: false, dataUrl, error: 'Backend not running -- start python run_server.py' });
    } else if (status.qrPending) {
      sendResponse({ success: false, dataUrl, needsQR: true, error: 'Scan QR at http://localhost:5050/whatsapp' });
    } else {
      sendResponse({ success: false, dataUrl, error: 'WhatsApp bridge not ready -- check server logs' });
    }
    return;
  }

  // Step 5: send
  try {
    const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
    const res = await fetchWithTimeout(`${API_BASE}/api/whatsapp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64, mimeType: 'image/jpeg', message: caption })
    }, 65000);
    const payload = await res.json().catch(() => ({}));
    sendResponse({ success: !!payload.success, dataUrl, error: payload.error || null, needsQR: !!payload.needsQR });
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'Send timed out -- WhatsApp bridge is slow, try again' : ('Send failed: ' + (e?.message || 'unknown'));
    sendResponse({ success: false, dataUrl, error: msg });
  }
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

// Content script files listed in manifest order
const CONTENT_SCRIPTS = [
  'modules/storage.js',
  'modules/whatsapp.js',
  'modules/screenshot.js',
  'modules/auto-answer.js',
  'modules/mcq-orchestrator.js',
  'modules/mcq-detector.js',
  'modules/mcq-automation-system.js',
  'modules/ui-dashboard.js',
  'modules/platform-config.js',
  'modules/code-writer.js',
  'content.js'
];

/**
 * Inject content scripts into a tab that doesn't have them yet.
 * Safe to call multiple times — checks for existing content script first.
 */
async function ensureContentScripts(tabId, tabUrl) {
  // If URL not provided, fetch it
  if (!tabUrl) {
    try {
      const tab = await chrome.tabs.get(tabId);
      tabUrl = tab.url || '';
    } catch (_) { return; }
  }

  // Skip chrome:// and extension pages
  if (!tabUrl || tabUrl.startsWith('chrome') || tabUrl.startsWith('about:') || tabUrl.startsWith('edge://')) return;

  // Check if content script is already alive
  const alive = await new Promise(resolve => {
    try {
      chrome.tabs.sendMessage(tabId, { action: 'ping' }, (res) => {
        resolve(!chrome.runtime.lastError && res && res.success);
      });
    } catch (_) { resolve(false); }
  });

  if (alive) return; // Already running

  // Inject all content scripts in order
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_SCRIPTS
    });
    console.log('[Background] Content scripts injected into tab', tabId);
  } catch (err) {
    // Normal for restricted pages — silently ignore
  }
}

/**
 * Tab update listener — re-inject if tab navigated while extension was alive
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    ensureContentScripts(tabId, tab.url);
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
    chrome.storage.local.set({ statistics: {
        screenshotsTaken: 0,
        answersReceived: 0,
        answersApplied: 0,
        successCount: 0
      }
    });
    // Default opt-in: auto-apply answers received via WhatsApp
    chrome.storage.sync.get('autoApplyFromWhatsApp', (res) => {
      if (res.autoApplyFromWhatsApp === undefined) {
        chrome.storage.sync.set({ autoApplyFromWhatsApp: true });
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
  
  // Normalize incoming messageData and broadcast
  const d = messageData || {};
  const normalized = {
    body: d.Body || d.body || '',
    from: d.From || d.from || '',
    messageId: d.MessageSid || d.messageId || d.MessageId || '',
    conversationId: d.conversationId || d.conversation_id || null,
    answers: Array.isArray(d.answers) ? d.answers : (d.answers || []),
    raw: d
  };

  chrome.storage.sync.get('autoApplyFromWhatsApp', (res) => {
    normalized.autoApply = res.autoApplyFromWhatsApp !== false;
    broadcastToAllTabs({ action: 'whatsappMessageReceived', data: normalized });
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
