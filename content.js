/**
 * Production Content Script - Complete MCQ Automation System
 * Integrates all modules for end-to-end MCQ detection, screenshot, WhatsApp, answer parsing, and auto-selection
 */

// ============================================================================
// CONTEXT VALIDITY GUARD
// ============================================================================

function isExtensionContextValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (_) {
    return false;
  }
}

function showReloadBanner() {
  if (document.getElementById('mcq-reload-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'mcq-reload-banner';
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#e53935;color:#fff;text-align:center;padding:10px 16px;font:600 14px/1.4 sans-serif;display:flex;align-items:center;justify-content:center;gap:12px';
  banner.innerHTML = '⚠️ MCQ Bot extension was updated. <button id="mcq-reload-btn" style="background:#fff;color:#e53935;border:none;border-radius:4px;padding:4px 12px;font-weight:700;cursor:pointer">Reload Page</button> to re-activate.';
  document.body.appendChild(banner);
  document.getElementById('mcq-reload-btn').addEventListener('click', () => location.reload());
}

// ============================================================================
// INITIALIZATION
// ============================================================================

let automationSystem = null;
let mcqDetector = null;
let codeWriter = null;
let isInitialized = false;
let lastCaptureDataUrl = null;
let _lastProcessedMCQSignature = null;
let _pipelineDebounceTimer = null;
let _pipelineRunning = false;
let uiStats = {
  found: 0,
  answered: 0,
  correct: 0,
  accuracy: 0,
};
const runtimeSettings = {
  botEnabled: true,
  voiceEnabled: false,
  autoAnswer: true,
  mode: 'auto',
  humanMouseMovement: false,
  aiProvider: 'groq',
};

function recalculateAccuracy() {
  uiStats.accuracy = uiStats.answered > 0
    ? Math.round((uiStats.correct / uiStats.answered) * 100)
    : 0;
}

let _statsWriteTimer = null;
function persistAndBroadcastStats() {
  recalculateAccuracy();

  try {
    // Debounce: write to local storage at most once per 10s
    if (_statsWriteTimer) clearTimeout(_statsWriteTimer);
    _statsWriteTimer = setTimeout(() => {
      try { chrome.storage.local.set({ stats: uiStats }); } catch(e) {}
    }, 10000);
  } catch (error) {
    console.warn('[Production] Failed to persist stats:', error);
  }

  try {
    if (isExtensionContextValid()) {
      chrome.runtime.sendMessage({ action: 'updateStats', stats: uiStats });
    }
  } catch (error) {
    // Popup may be closed or context invalidated; ignore.
  }
}

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

    // Load saved settings
    const settings = await new Promise(resolve =>
      chrome.storage.sync.get(['apiProvider', 'autoAnswer', 'botEnabled', 'humanMouseMovement'], resolve)
    );

    if (settings.humanMouseMovement !== undefined) {
      runtimeSettings.humanMouseMovement = !!settings.humanMouseMovement;
    }
    runtimeSettings.aiProvider = await resolveAiProvider(settings.apiProvider);

    mcqDetector = new MCQDetector({ debugMode: false });
    globalThis.__mcqDetectorInstance = mcqDetector;

    codeWriter = new CodeWriter({ apiBase: 'http://localhost:5050/api', humanLike: false });
    globalThis.__codeWriterInstance = codeWriter;

    automationSystem = new MCQAutomationSystem({
      autoMode: true,
      autoScreenshot: false,
      autoSendWhatsApp: false,
      autoApplyAnswers: settings.autoAnswer !== false,
      useAIFirst: true,
      whatsappFallback: true,
      aiProvider: runtimeSettings.aiProvider,
      pollInterval: 3000,
      answerPollInterval: 2000,
      answerPollTimeout: 60000,
      maxRetries: 3
    });

    await automationSystem.init();
    isInitialized = true;

    console.log('[Production] Automation system ready');

    setupEventListeners();
    createFloatingButton();
    dashboard = createDashboard();
    startMCQDetection();

  } catch (error) {
    console.error('[Production] Initialization failed:', error);
  }
}

// ============================================================================
// MCQ DETECTION
// ============================================================================

/** Run full MCQ detection (includes Q6 role-radio / Q7 button fallbacks). */
function detectMCQsOnPage() {
  if (!mcqDetector) return [];
  return mcqDetector.detectMCQs();
}

/** Detect coding questions on the current page. */
function detectCodingOnPage() {
  if (!codeWriter) return [];
  try {
    return codeWriter.detectCodeQuestions();
  } catch (e) {
    console.warn('[Production] Coding detection failed:', e.message);
    return [];
  }
}

/** Pick a working AI provider — Groq first when its key is configured on the backend. */
async function resolveAiProvider(requested) {
  try {
    const res = await fetch('http://localhost:5050/api/provider-status');
    if (res.ok) {
      const status = await res.json();
      if (status.groq) return 'groq';
      const order = ['deepseek', 'openai', 'gemini'];
      const req = (requested || '').toLowerCase();
      if (status[req]) return req;
      for (const p of order) {
        if (status[p]) return p;
      }
    }
  } catch (_) {}
  return 'groq';
}

/**
 * Full scan: MCQs + coding rounds. Auto-fixes and runs dynamic test cases.
 */
async function runFullScanAndSolve() {
  if (_pipelineRunning) {
    showStatus('⏳ Scan already in progress...', 'info');
    return { mcqs: [], codeResults: [] };
  }
  _pipelineRunning = true;
  try {
  const provider = await resolveAiProvider(runtimeSettings.aiProvider);
  runtimeSettings.aiProvider = provider;
  const mcqs = detectMCQsOnPage();
  const codeQs = detectCodingOnPage();

  updateDashboardWithMCQs(mcqs);

  if (mcqs.length === 0 && codeQs.length === 0) {
    showStatus('⚠️ No MCQs or coding questions found on this page', 'error');
    return { mcqs: [], codeResults: [] };
  }

  const codeResults = [];
  if (codeQs.length > 0) {
    const langs = [...new Set(codeQs.map(q => q.language))].join(', ');
    showStatus(`💻 ${codeQs.length} coding Q(s) detected [${langs}] — writing, testing, auto-submit...`, 'info');
    const results = await codeWriter.runPipeline(provider, (msg, type) => showStatus(msg, type));
    codeResults.push(...results);
    const ok = results.filter(r => r.success).length;
    const submitted = results.filter(r => r.submitted).length;
    if (ok > 0) {
      showStatus(`✅ Coding: ${ok}/${codeQs.length} solved${submitted ? `, ${submitted} submitted` : ''}`, 'success');
    }
  }

  if (mcqs.length > 0) {
    _lastProcessedMCQSignature = null;
    showStatus(`🤖 Answering ${mcqs.length} MCQ(s)...`, 'info');
    await automationSystem.runHybridPipeline(mcqs);
  }

  return { mcqs, codeResults };
  } finally {
    _pipelineRunning = false;
  }
}

function _pageContentSignature() {
  const mcqs = detectMCQsOnPage();
  const codeQs = detectCodingOnPage();
  return [
    ...mcqs.map(m => 'm:' + m.text.substring(0, 40)),
    ...codeQs.map(c => 'c:' + c.question.substring(0, 40) + ':' + c.language)
  ].join('|');
}

function startMCQDetection() {
  if (!mcqDetector) return;

  const mcqs = detectMCQsOnPage();
  const codeQs = detectCodingOnPage();
  console.log('[Production] Initial detection:', mcqs.length, 'MCQs,', codeQs.length, 'coding');

  if (runtimeSettings.botEnabled && (mcqs.length > 0 || codeQs.length > 0)) {
    _pipelineDebounceTimer = setTimeout(() => {
      runFullScanAndSolve().catch(e =>
        console.warn('[Production] Auto-pipeline error:', e.message)
      );
    }, 3000);
  }

  // Watch for new MCQs or coding questions on dynamic pages
  mcqDetector.watchForNewMCQs(() => {
    const sig = _pageContentSignature();
    if (!sig) return;
    if (sig === _lastProcessedMCQSignature) return;
    _lastProcessedMCQSignature = sig;

    const mcqCount = detectMCQsOnPage().length;
    const codeCount = detectCodingOnPage().length;
    console.log('[Production] Page changed:', mcqCount, 'MCQs,', codeCount, 'coding');
    updateDashboardWithMCQs(detectMCQsOnPage());

    if (_pipelineDebounceTimer) clearTimeout(_pipelineDebounceTimer);
    _pipelineDebounceTimer = setTimeout(() => {
      if (runtimeSettings.botEnabled) {
        runFullScanAndSolve().catch(e =>
          console.warn('[Production] Auto-pipeline error:', e.message)
        );
      }
    }, 4000);
  }, 2000);
}

// ============================================================================
// UI COMPONENTS
// ============================================================================

let floatingButton = null;
let dashboard = null;

function createFloatingButton() {
  const button = document.createElement('div');
  button.id = 'mcq-automation-button';
  button.style.cssText = [
    'position:fixed',
    'bottom:20px',
    'right:20px',
    'width:60px',
    'height:60px',
    'background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)',
    'border-radius:50%',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'cursor:pointer',
    'z-index:2147483647',
    'box-shadow:0 4px 12px rgba(0,0,0,.3)',
    'font-size:24px',
    'transition:transform .2s,box-shadow .2s',
    'border:none',
    'pointer-events:all'
  ].join(';');
  button.innerHTML = '🤖';
  button.title = 'MCQ Automation — Click to open';
  button.addEventListener('click', () => toggleDashboard());
  button.addEventListener('mouseenter', () => { button.style.transform='scale(1.1)'; button.style.boxShadow='0 6px 16px rgba(0,0,0,.4)'; });
  button.addEventListener('mouseleave', () => { button.style.transform='scale(1)';   button.style.boxShadow='0 4px 12px rgba(0,0,0,.3)'; });
  _getUIRoot().appendChild(button);
  floatingButton = button;
}

function createDashboard() {
  const dashboard = document.createElement('div');
  dashboard.id = 'mcq-automation-dashboard';
  dashboard.style.cssText = [
    'position:fixed',
    'bottom:90px',
    'right:20px',
    'width:350px',
    'max-height:500px',
    'background:white',
    'border-radius:12px',
    'box-shadow:0 8px 32px rgba(0,0,0,.25)',
    'z-index:2147483646',
    'display:none',
    'flex-direction:column',
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
    'overflow:hidden',
    'pointer-events:all'
  ].join(';');

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
        <button id="scan-answer-btn" style="
          width: 100%;
          padding: 12px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          margin-bottom: 8px;
          transition: all 0.3s ease;
        ">
          🤖 Scan &amp; Answer MCQs
        </button>
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

      <div style="margin-bottom: 16px;">
        <button id="write-code-btn" style="
          width: 100%;
          padding: 12px;
          background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.3s ease;
        ">
          💻 Auto-Write Code
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

  // Watch fullscreen changes — re-parent UI into fullscreen element so it stays visible
  _watchFullscreen();

  // Event listeners
  document.getElementById('close-dashboard').addEventListener('click', () => toggleDashboard());
  document.getElementById('take-screenshot-btn').addEventListener('click', () => takeScreenshot());

  // Scan & Answer — MCQs + coding rounds (auto-fix + dynamic tests)
  document.getElementById('scan-answer-btn').addEventListener('click', async () => {
    showStatus('🔍 Scanning page for MCQs & coding questions...', 'info');
    await runFullScanAndSolve();
  });

  // Auto-Write Code button
  document.getElementById('write-code-btn').addEventListener('click', async () => {
    showStatus('💻 Detecting coding questions...', 'info');
    const provider = await resolveAiProvider(runtimeSettings.aiProvider);
    runtimeSettings.aiProvider = provider;
    await codeWriter.runPipeline(provider, (msg, type) => showStatus(msg, type));
  });

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
    const appliedEl = document.getElementById('applied-count');
    if (appliedEl) appliedEl.textContent = count;

    const totalAttempted = Array.isArray(data.results) ? data.results.length : 0;
    uiStats.answered += totalAttempted;
    uiStats.correct += count;
    persistAndBroadcastStats();
  });

  automationSystem.on('error', (data) => {
    showStatus('❌ Error: ' + data.error.message, 'error');
  });

  // Hybrid pipeline notifications
  automationSystem.on('notification', (data) => {
    showStatus(data.message, data.type);
  });

  return dashboard;
}

function toggleDashboard() {
  if (!dashboard) dashboard = document.getElementById('mcq-automation-dashboard');
  const isVisible = dashboard.style.display !== 'none';
  dashboard.style.display = isVisible ? 'none' : 'flex';
  // Ensure UI is in the right container (fullscreen or body)
  _reparentUIToRoot();
}

/**
 * Returns the element that should host fixed UI.
 * In fullscreen mode that is the fullscreen element;
 * otherwise document.body.
 */
function _getUIRoot() {
  return document.fullscreenElement ||
         document.webkitFullscreenElement ||
         document.mozFullScreenElement ||
         document.msFullscreenElement ||
         document.body;
}

/**
 * Move the floating button and dashboard into the current UI root.
 * Called when fullscreen state changes.
 */
function _reparentUIToRoot() {
  const root = _getUIRoot();
  if (floatingButton && floatingButton.parentElement !== root) {
    root.appendChild(floatingButton);
  }
  const dash = document.getElementById('mcq-automation-dashboard');
  if (dash && dash.parentElement !== root) {
    root.appendChild(dash);
  }
}

/**
 * Watch for fullscreen changes and re-parent UI so it remains visible.
 */
function _watchFullscreen() {
  const handler = () => {
    _reparentUIToRoot();
    // If entering fullscreen, ensure button is visible
    const inFS = !!document.fullscreenElement;
    if (floatingButton) {
      floatingButton.style.display = 'flex';
    }
    console.log('[Production] Fullscreen change — UI re-parented, inFullscreen:', inFS);
  };
  document.addEventListener('fullscreenchange',       handler);
  document.addEventListener('webkitfullscreenchange', handler);
  document.addEventListener('mozfullscreenchange',    handler);
  document.addEventListener('MSFullscreenChange',     handler);
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
  uiStats.found = mcqs.length;
  persistAndBroadcastStats();
  showStatus(`Found ${mcqs.length} MCQs on page`, 'info');
}

// ============================================================================
// ACTIONS
// ============================================================================

async function takeScreenshot() {
  showStatus('📷 Capturing & sending to WhatsApp...', 'info');

  if (!isExtensionContextValid()) {
    showReloadBanner();
    return captureViaBackendDirectly();
  }

  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        { action: 'captureAndSendToWhatsApp', caption: '📸 MCQ Screenshot' },
        async (response) => {
          try {
            if (chrome.runtime.lastError) {
              const errMsg = chrome.runtime.lastError.message || '';
              if (errMsg.includes('invalidated') || errMsg.includes('disconnected')) {
                showReloadBanner();
                return resolve(await captureViaBackendDirectly());
              }
              showStatus('❌ ' + errMsg, 'error');
              return reject(new Error(errMsg));
            }
            if (response && response.dataUrl) lastCaptureDataUrl = response.dataUrl;
            if (response && response.success) {
              showStatus('✅ Screenshot sent to WhatsApp!', 'success');
              return resolve({ success: true, dataUrl: response.dataUrl });
            }
            const msg = (response && response.error) || 'Send failed';
            showStatus('⚠️ Captured but WhatsApp send failed: ' + msg, 'error');
            return resolve({ success: false, dataUrl: response && response.dataUrl });
          } catch (cbErr) {
            return reject(cbErr);
          }
        }
      );
    } catch (err) {
      const msg = (err && err.message) || String(err);
      if (msg.includes('invalidated') || msg.includes('disconnected') || msg.includes('Extension context')) {
        showReloadBanner();
        showStatus('⚠️ Extension reloaded — please reload the page or using direct capture', 'info');
        captureViaBackendDirectly().then(resolve).catch(reject);
      } else {
        console.warn('[Production] sendMessage threw:', err);
        reject(err);
      }
    }
  });
}

async function captureViaBackendDirectly() {
  try {
    if (typeof html2canvas === 'undefined') {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = chrome.runtime.getURL('html2canvas.min.js');
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    const canvas = await html2canvas(document.body, { useCORS: true, logging: false });
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    lastCaptureDataUrl = dataUrl;
    const base64 = dataUrl.split(',')[1];
    const res = await fetch('http://localhost:5050/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64, mimeType: 'image/jpeg', message: '📸 MCQ Screenshot (direct)' })
    });
    const payload = await res.json().catch(() => ({}));
    if (payload.success) {
      showStatus('✅ Screenshot sent (direct mode)!', 'success');
      return { success: true, dataUrl };
    }
    showStatus('⚠️ Direct send failed: ' + (payload.error || 'unknown'), 'error');
    return { success: false, dataUrl, error: payload.error };
  } catch (e) {
    showStatus('❌ Direct capture failed: ' + e.message, 'error');
    return { success: false, error: e.message };
  }
}

async function captureTabViaBackground() {
  if (!isExtensionContextValid()) throw new Error('Extension context invalidated');
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ action: 'captureVisibleTab' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || !response.success || !response.dataUrl) {
          reject(new Error(response?.error || 'Failed to capture visible tab'));
          return;
        }
        resolve(response.dataUrl);
      });
    } catch (err) {
      reject(err);
    }
  });
}

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

function setupEventListeners() {
  if (!isExtensionContextValid()) return;
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessage(request).then(response => {
      sendResponse(response);
    }).catch(error => {
      console.error('[Production] Message handling error:', error);
      sendResponse({ error: error.message });
    });
    return true;
  });
}

async function handleMessage(request) {
  console.log('[Production] Received message:', request.action);

  switch (request.action) {
    case 'runCodeWriter':
      {
        const provider = await resolveAiProvider(request.provider || runtimeSettings.aiProvider);
        runtimeSettings.aiProvider = provider;
        const results = await codeWriter.runPipeline(provider, (msg, type) => showStatus(msg, type));
        return { success: true, results };
      }

    case 'captureViaHtml2Canvas':
      {
        try {
          // Dynamically load html2canvas if not already present
          if (typeof html2canvas === 'undefined') {
            await new Promise((resolve, reject) => {
              const s = document.createElement('script');
              s.src = chrome.runtime.getURL('html2canvas.min.js');
              s.onload = resolve;
              s.onerror = reject;
              document.head.appendChild(s);
            });
          }
          const canvas = await html2canvas(document.documentElement, {
            useCORS: true, logging: false, scale: 0.8,
            width: window.innerWidth, height: window.innerHeight,
            x: window.scrollX, y: window.scrollY
          });
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          lastCaptureDataUrl = dataUrl;
          return { success: true, dataUrl };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }

    case 'ping':
      return { success: true, ready: true };

    case 'whatsappMessageReceived':
      return await handleWhatsAppMessage(request.data);

    case 'detectMCQs':
      {
        const mcqs = detectMCQsOnPage();
        uiStats.found = mcqs.length;
        persistAndBroadcastStats();
        return {
          success: true,
          mcqs,
          count: mcqs.length,
          stats: uiStats,
        };
      }

    case 'scanForMCQs':
    case 'scanForMCQsScan':
      {
        const mcqs = detectMCQsOnPage();
        const codeQs = detectCodingOnPage();
        uiStats.found = mcqs.length + codeQs.length;
        persistAndBroadcastStats();
        updateDashboardWithMCQs(mcqs);

        const sig = [
          ...mcqs.map(m => m.text.substring(0, 40)),
          ...codeQs.map(c => c.question.substring(0, 40))
        ].join('|');

        if ((mcqs.length > 0 || codeQs.length > 0) && sig !== _lastProcessedMCQSignature) {
          _lastProcessedMCQSignature = sig;
          runFullScanAndSolve().catch(e =>
            console.warn('[Production] Hybrid pipeline error:', e.message)
          );
        }

        return {
          success: mcqs.length > 0 || codeQs.length > 0,
          mcqs,
          codeQuestions: codeQs.length,
          count: mcqs.length + codeQs.length,
          lastMCQ: mcqs[0] ? { question: mcqs[0].text, answer: 'Processing...' } : null,
          stats: uiStats,
        };
      }

    case 'applyAnswers':
      return await applyAnswersManually(request.answers);

    case 'captureScreen':
      {
        try {
          // Prefer browser-level tab capture to avoid blank/black canvas captures.
          try {
            lastCaptureDataUrl = await captureTabViaBackground();
            showStatus('📸 Screen captured', 'success');
            return {
              success: true,
              dataUrl: lastCaptureDataUrl,
              ocrText: '',
            };
          } catch (captureError) {
            console.warn('[Production] Background capture failed, falling back to automation screenshot:', captureError);
          }

          const result = await takeScreenshot();
          return {
            success: true,
            dataUrl: result?.dataUrl || lastCaptureDataUrl,
            ocrText: result?.ocrText || '',
          };
        } catch (error) {
          return {
            success: false,
            error: error.message || 'Screen capture failed',
          };
        }
      }

    case 'getLastCaptureDataUrl':
      return {
        success: true,
        dataUrl: lastCaptureDataUrl,
      };

    case 'enableBot':
      runtimeSettings.botEnabled = true;
      if (request.mode) runtimeSettings.mode = request.mode;
      showStatus('Bot enabled', 'success');
      return { success: true, botEnabled: true };

    case 'disableBot':
      runtimeSettings.botEnabled = false;
      showStatus('Bot disabled', 'info');
      return { success: true, botEnabled: false };

    case 'setVoiceNarration':
      runtimeSettings.voiceEnabled = !!request.enabled;
      return { success: true, voiceEnabled: runtimeSettings.voiceEnabled };

    case 'setAutoAnswer':
      runtimeSettings.autoAnswer = !!request.enabled;
      return { success: true, autoAnswer: runtimeSettings.autoAnswer };

    case 'setHumanMouseMovement':
      runtimeSettings.humanMouseMovement = !!request.enabled;
      return { success: true, humanMouseMovement: runtimeSettings.humanMouseMovement };

    case 'setMode':
      runtimeSettings.mode = request.mode || runtimeSettings.mode;
      return { success: true, mode: runtimeSettings.mode };

    case 'getStatus':
      if (!automationSystem) {
        return {
          success: true,
          initialized: false,
          ...runtimeSettings,
        };
      }
      return {
        success: true,
        ...automationSystem.getStatus(),
        ...runtimeSettings,
      };

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

    if (!automationSystem) {
      throw new Error('Automation system not initialized');
    }

    const result = await automationSystem.receiveAnswer({
      body: messageData.body,
      messageId: messageData.messageId,
      senderType: 'bot',
      answers: Array.isArray(messageData.answers) ? messageData.answers : []
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
    const applied = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    uiStats.answered += (applied + failed);
    uiStats.correct += applied;
    persistAndBroadcastStats();

    return {
      success: true,
      applied,
      failed,
      stats: uiStats,
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
