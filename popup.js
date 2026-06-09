document.addEventListener("DOMContentLoaded", () => {
  const botToggle = document.getElementById("botToggle")
  const voiceToggle = document.getElementById("voiceToggle")
  const autoAnswerToggle = document.getElementById("autoAnswerToggle")
  const modeSelect = document.getElementById("modeSelect")
  const scanButton = document.getElementById("scanButton")
  const captureButton = document.getElementById("captureButton")
  const statusDot = document.getElementById("statusDot")
  const statusText = document.getElementById("statusText")
  const apiStatus = document.getElementById("apiStatus")
  const mcqInfo = document.getElementById("mcqInfo")
  const mcqsFoundEl = document.getElementById("mcqsFound")
  const mcqsAnsweredEl = document.getElementById("mcqsAnswered")
  const accuracyEl = document.getElementById("accuracy")
  const themeToggle = document.getElementById("themeToggle")
  const errorMessage = document.getElementById("errorMessage")
  const startAuto = document.getElementById("start-auto")
  const stopBot    = document.getElementById("stop-bot")
  const startAutoToggle = document.getElementById("startAutoToggle")
  const reOCR = document.getElementById("re-ocr")
  const langSelect = document.getElementById("lang-select")
  const preview = document.getElementById("preview")
  const ocrResult = document.getElementById("ocr-result")
  const statusDiv = document.getElementById("status")

  let isDarkMode = false
  let lastImage = null
  let lastLang = 'eng'

  function isRestrictedTabUrl(url) {
    if (!url) return true;
    return (
      url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('edge://') ||
      url.startsWith('about:')
    );
  }

  /**
   * Ping content script; if not alive, ask background to inject it, then retry once.
   */
  async function ensureContentScript(tabId) {
    const alive = await new Promise(resolve => {
      chrome.tabs.sendMessage(tabId, { action: 'ping' }, res => {
        resolve(!chrome.runtime.lastError && !!res?.success);
      });
    });
    if (alive) return true;

    // Ask background to inject scripts
    showStatus('Injecting scripts into tab…', 'info');
    await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'injectContentScripts', tabId }, () => resolve());
    });

    // Wait for init (content.js calls initializeAutomationSystem asynchronously)
    await new Promise(r => setTimeout(r, 1800));

    // Second ping
    return await new Promise(resolve => {
      chrome.tabs.sendMessage(tabId, { action: 'ping' }, res => {
        resolve(!chrome.runtime.lastError && !!res?.success);
      });
    });
  }

  async function getCapturableTab(actionLabel) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (activeTab && activeTab.id && !isRestrictedTabUrl(activeTab.url || '')) {
      return { tab: activeTab, switched: false };
    }

    const tabs = await chrome.tabs.query({ currentWindow: true });
    const fallbackTab = tabs.find((t) => t && t.id && !isRestrictedTabUrl(t.url || ''));

    if (!fallbackTab) {
      throw new Error(`Cannot ${actionLabel} on Chrome internal pages. Open a regular webpage and try again.`);
    }

    await chrome.tabs.update(fallbackTab.id, { active: true });
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { tab: fallbackTab, switched: true };
  }

  // Human mouse movement toggle
  const humanMouseToggle = document.getElementById('humanMouseMovementToggle')
  if (humanMouseToggle) {
    chrome.storage.sync.get(['humanMouseMovement'], (r) => {
      humanMouseToggle.checked = !!r.humanMouseMovement
    })
    humanMouseToggle.addEventListener('change', () => {
      chrome.storage.sync.set({ humanMouseMovement: humanMouseToggle.checked })
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'setHumanMouseMovement',
            enabled: humanMouseToggle.checked
          }, () => { if (chrome.runtime.lastError) {} })
        }
      })
    })
  }

  // Theme toggle
  themeToggle.addEventListener("click", () => {
    isDarkMode = !isDarkMode
    document.body.classList.toggle("dark-mode", isDarkMode)
    themeToggle.textContent = isDarkMode ? "☀️" : "🌙"
    chrome.storage.sync.set({ darkMode: isDarkMode })
  })

  // Load saved settings
  chrome.storage.sync.get(
    ["botEnabled", "voiceEnabled", "autoAnswer", "mode", "apiConfigured", "darkMode", "stats"],
    (result) => {
      botToggle.checked = result.botEnabled || false
      voiceToggle.checked = result.voiceEnabled || false
      autoAnswerToggle.checked = result.autoAnswer !== false // Default to true
      modeSelect.value = result.mode || "learning"
      isDarkMode = result.darkMode || false

      // Apply dark mode if enabled
      document.body.classList.toggle("dark-mode", isDarkMode)
      themeToggle.textContent = isDarkMode ? "☀️" : "🌙"

      updateStatusIndicator(result.botEnabled || false)

      // Update stats
      if (result.stats) {
        mcqsFoundEl.textContent = result.stats.found || 0
        mcqsAnsweredEl.textContent = result.stats.answered || 0
        accuracyEl.textContent = `${result.stats.accuracy || 0}%`
      }

      if (result.apiConfigured) {
        apiStatus.textContent = "API Status: Connected"
        apiStatus.className = "api-status connected"
      } else {
        apiStatus.textContent = "API Status: Not Configured (go to Settings)"
        apiStatus.className = "api-status disconnected"
      }
    },
  )

  // Start auto toggle functionality
  startAutoToggle.addEventListener('change', function() {
    const isActive = this.checked;
    
    if (isActive) {
      startAuto.classList.add('active');
      startAuto.textContent = 'Stop Auto Detection';
      stopBot.classList.add('visible');
      showStatus('Auto detection enabled', 'success');
      
      // Enable the bot if not already enabled
      if (!botToggle.checked) {
        botToggle.checked = true;
        updateStatusIndicator(true);
        chrome.storage.sync.set({ botEnabled: true });
      }
    } else {
      startAuto.classList.remove('active');
      startAuto.textContent = 'Auto Detect & OCR';
      stopBot.classList.remove('visible');
      showStatus('Auto detection disabled', 'info');
    }
  });
  
  // Start auto detection button
  startAuto.addEventListener("click", async () => {
    console.log('Start Auto button clicked');
    
    // Toggle the auto detection state
    startAutoToggle.checked = !startAutoToggle.checked;
    startAutoToggle.dispatchEvent(new Event('change'));
    
    if (!startAutoToggle.checked) {
      return; // If we just disabled it, don't run the scan
    }
    
    try {
      // Disable button temporarily to prevent multiple clicks
      startAuto.disabled = true;
      const originalText = startAuto.textContent;
      startAuto.textContent = 'Scanning...';
      
      showStatus('Initializing scan...', 'info');
      
      const { tab, switched } = await getCapturableTab('scan');
      if (!tab || !tab.id) throw new Error('No active tab found');
      if (switched) {
        showStatus('Switched to a regular tab for scanning...', 'info');
      }
      
      // Content scripts are registered via manifest.json.
      // Auto-inject if not alive yet (e.g. extension reloaded while tab was open).
      const ready = await ensureContentScript(tab.id);
      if (!ready) {
        throw new Error('Could not inject content script. Try refreshing the page once.');
      }
      
      // Trigger the scan
      const response = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { action: 'scanForMCQs' }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response || { success: false, error: 'No response from content script' });
          }
        });
      });
      
      if (response.success) {
        showStatus(`Found ${response.count || 0} MCQs`, 'success');
        statusText.textContent = `Found ${response.count || 0} MCQs`;
        
        // Update stats
        if (response.stats) {
          mcqsFoundEl.textContent = response.stats.found || 0;
          mcqsAnsweredEl.textContent = response.stats.answered || 0;
          accuracyEl.textContent = `${response.stats.accuracy || 0}%`;
        }
        
        // Show MCQ info if available
        if (response.lastMCQ) {
          mcqInfo.style.display = 'block';
          const questionText = response.lastMCQ.question || '';
          const truncatedQuestion = questionText.length > 100 
            ? questionText.substring(0, 100) + '...' 
            : questionText;
          mcqInfo.querySelector('.mcq-question').textContent = `Question: ${truncatedQuestion}`;
          mcqInfo.querySelector('.mcq-answer').textContent = `Answer: ${response.lastMCQ.answer || 'Processing...'}`;
        }
      } else {
        const errorMsg = response.error || 'Failed to scan for MCQs';
        showStatus(errorMsg, 'error');
        statusText.textContent = 'Scan failed';
        
        // Disable the toggle on error
        startAutoToggle.checked = false;
        startAuto.classList.remove('active');
        startAuto.textContent = 'Auto Detect & OCR';
      }
    } catch (error) {
      console.error('Error in startAuto:', error);
      showStatus('Error: ' + error.message, 'error');
      statusText.textContent = 'Error occurred';
      
      // Disable the toggle on error
      startAutoToggle.checked = false;
      startAuto.classList.remove('active');
      startAuto.textContent = 'Auto Detect & OCR';
    } finally {
      startAuto.disabled = false;
      if (startAutoToggle.checked) {
        startAuto.textContent = 'Stop Auto Detection';
      }
    }
  });

  // Stop Bot button — immediately halts the running agent
  if (stopBot) {
    stopBot.addEventListener('click', async () => {
      stopBot.textContent = 'Stopping...';
      stopBot.disabled = true;

      // Tell content script to stop the agent
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { action: 'stopAgent' }, () => {
            if (chrome.runtime.lastError) {}
          });
        }
      } catch (_) {}

      // Reset UI
      startAutoToggle.checked = false;
      startAutoToggle.dispatchEvent(new Event('change'));
      stopBot.textContent = '\u23f9 Stop Bot';
      stopBot.disabled = false;
      showStatus('Bot stopped', 'info');
      updateStatusIndicator(false);
    });
  }
    const isEnabled = botToggle.checked

    chrome.storage.sync.set({ botEnabled: isEnabled })

    updateStatusIndicator(isEnabled)

    // Send message to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        console.warn('No active tab to notify about bot toggle')
        return
      }
      const tab = tabs[0]
      if (!tab || !tab.id) {
        console.warn('Active tab object invalid')
        return
      }
      try {
        chrome.tabs.sendMessage(tab.id, {
          action: isEnabled ? "enableBot" : "disableBot",
          mode: modeSelect.value,
        }, (resp) => {
          if (chrome.runtime.lastError) {
            // Content script might not be injected on this page - that's fine
            console.warn('Could not send enable/disable message to tab:', chrome.runtime.lastError.message)
          }
        })
      } catch (err) {
        console.error('Error sending enable/disable message:', err)
      }
    })
  })

  // Toggle voice narration
  voiceToggle.addEventListener("change", () => {
    const isEnabled = voiceToggle.checked

    chrome.storage.sync.set({ voiceEnabled: isEnabled })

    // Send message to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return
      const tab = tabs[0]
      if (!tab || !tab.id) return
      try {
        chrome.tabs.sendMessage(tab.id, {
          action: "setVoiceNarration",
          enabled: isEnabled,
        }, () => {
          if (chrome.runtime.lastError) console.warn('Voice toggle message failed:', chrome.runtime.lastError.message)
        })
      } catch (err) {
        console.error('Error sending voice toggle message:', err)
      }
    })
  })

  // Toggle auto-answer
  autoAnswerToggle.addEventListener("change", () => {
    const isEnabled = autoAnswerToggle.checked

    chrome.storage.sync.set({ autoAnswer: isEnabled })

    // Send message to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return
      const tab = tabs[0]
      if (!tab || !tab.id) return
      try {
        chrome.tabs.sendMessage(tab.id, {
          action: "setAutoAnswer",
          enabled: isEnabled,
        }, () => {
          if (chrome.runtime.lastError) console.warn('Auto-answer message failed:', chrome.runtime.lastError.message)
        })
      } catch (err) {
        console.error('Error sending auto-answer message:', err)
      }
    })
  })

  // Change mode
  modeSelect.addEventListener("change", () => {
    const mode = modeSelect.value

    chrome.storage.sync.set({ mode: mode })

    // Send message to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return
      const tab = tabs[0]
      if (!tab || !tab.id) return
      try {
        chrome.tabs.sendMessage(tab.id, {
          action: "setMode",
          mode: mode,
        }, () => {
          if (chrome.runtime.lastError) console.warn('Set mode message failed:', chrome.runtime.lastError.message)
        })
      } catch (err) {
        console.error('Error sending setMode message:', err)
      }
    })
  })

  // Scan for MCQs button
  scanButton.addEventListener("click", async () => {
    clearError();
    statusText.textContent = "Scanning for MCQs...";
    scanButton.disabled = true;

    try {
      const { tab, switched } = await getCapturableTab('scan');
      if (!tab || !tab.id) throw new Error('No active tab found');
      if (switched) {
        showStatus('Switched to a regular tab for scanning...', 'info');
      }

      const ready = await ensureContentScript(tab.id);
      if (!ready) {
        throw new Error('Could not inject content script. Try refreshing the page once.');
      }

      const response = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { action: 'scanForMCQs' }, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { success: false, error: 'No response' });
          }
        });
      });

      if (response.success) {
        statusText.textContent = `Found ${response.count || 0} MCQs`;
        mcqsFoundEl.textContent = response.count || 0;

        const { stats } = await chrome.storage.sync.get(['stats']);
        await chrome.storage.sync.set({ stats: { ...(stats || {}), found: response.count } });

        if (response.lastMCQ) {
          mcqInfo.style.display = 'block';
          const q = (response.lastMCQ.question || '').substring(0, 100);
          mcqInfo.querySelector('.mcq-question').textContent = `Question: ${q}`;
          mcqInfo.querySelector('.mcq-answer').textContent = `Answer: ${response.lastMCQ.answer || 'Processing...'}`;
        }
      } else {
        statusText.textContent = 'No MCQs found';
        if (response.error) showError(response.error);
      }
    } catch (error) {
      showError('Failed to scan: ' + error.message);
      statusText.textContent = 'Error scanning';
    } finally {
      scanButton.disabled = false;
    }
  });

  // Capture screen button
  captureButton.addEventListener("click", async () => {
    clearError();
    statusText.textContent = "Capturing & sending to WhatsApp...";
    captureButton.disabled = true;

    try {
      const { tab, switched } = await getCapturableTab('capture');
      if (!tab || !tab.id) throw new Error('No active tab found');
      if (switched) {
        showStatus('Switched to a regular tab for capture...', 'info');
      }

      // Capture + send to WhatsApp via background
      const resp = await new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          resolve({ success: false, error: 'Timed out waiting for background response' });
        }, 35000);

        chrome.runtime.sendMessage(
          { action: 'captureAndSendToWhatsApp', caption: '📸 MCQ Screenshot' },
          (r) => {
            clearTimeout(timeoutId);
            resolve(r || { success: false, error: chrome.runtime.lastError?.message || 'No response' });
          }
        );
      });

      // Show preview
      if (resp.dataUrl) {
        let imgPreview = document.getElementById('capturePreview');
        if (!imgPreview) {
          imgPreview = document.createElement('img');
          imgPreview.id = 'capturePreview';
          imgPreview.style.cssText = 'max-width:100%;max-height:200px;display:block;margin:10px auto;border-radius:8px;';
          statusText.parentNode.insertBefore(imgPreview, statusText.nextSibling);
        }
        imgPreview.src = resp.dataUrl;
        imgPreview.style.display = 'block';
      }

      if (resp.success) {
        statusText.textContent = '✅ Screenshot sent to WhatsApp!';
        showStatus('✅ Sent to WhatsApp successfully', 'success');
      } else if (resp.needsQR) {
        showStatus('📱 ' + (resp.error || 'Scan QR to connect WhatsApp'), 'error');
        statusText.textContent = 'WhatsApp: scan QR first';
        // Open the QR page automatically
        chrome.tabs.create({ url: 'http://localhost:5050/whatsapp' });
      } else {
        showStatus('⚠️ ' + (resp.error || 'WhatsApp not ready'), 'error');
        statusText.textContent = 'Captured (WhatsApp not ready)';
      }

      // Also run OCR + AI on the captured image
      if (resp.dataUrl) {
        try {
          const API_BASE = 'http://localhost:5050/api';

          const ocrRes = await fetch(`${API_BASE}/extract-mcqs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_data: resp.dataUrl, lang: 'eng' })
          });

          if (!ocrRes.ok) {
            const txt = await ocrRes.text().catch(() => '');
            console.warn('OCR endpoint returned non-OK status:', ocrRes.status, txt ? ('body: ' + txt.substring(0, 200)) : '');
            throw new Error('OCR endpoint error: ' + ocrRes.status);
          }

          const contentType = ocrRes.headers.get('content-type') || '';
          if (!contentType.includes('application/json')) {
            const txt = await ocrRes.text().catch(() => '');
            console.warn('OCR endpoint returned non-JSON response:', txt ? txt.substring(0, 200) : '<empty>');
            throw new Error('OCR endpoint did not return JSON');
          }

          const ocrData = await ocrRes.json();
          if (ocrData.success && ocrData.mcqs && ocrData.mcqs.length > 0) {
            const mcq = ocrData.mcqs[0];
            const settings = await chrome.storage.sync.get(['apiProvider']);
            const ansRes = await fetch(`${API_BASE}/get-answer`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                question: mcq.question,
                options: mcq.options,
                provider: settings.apiProvider || 'groq'
              })
            });

            if (!ansRes.ok) {
              console.warn('AI endpoint returned non-OK status:', ansRes.status);
              throw new Error('AI endpoint error');
            }

            const ansData = await ansRes.json().catch(() => null);
            if (ansData && ansData.success) {
              // Extract only the answer letter/text — strip any code or long output
              let displayAnswer = ansData.selected_option || String(ansData.answer);
              // If AI dumped code or long text, extract just the first letter A-E
              if (displayAnswer.length > 60 || /[{};=()\[\]]/.test(displayAnswer)) {
                const m = displayAnswer.match(/\b([A-E])\b/);
                displayAnswer = m ? m[1] : displayAnswer.substring(0, 60);
              }
              mcqInfo.style.display = 'block';
              mcqInfo.querySelector('.mcq-question').textContent = `Q: ${mcq.question.substring(0, 100)}`;
              mcqInfo.querySelector('.mcq-answer').textContent = `Answer: ${displayAnswer}`;
            }
          }
        } catch (apiErr) {
          console.warn('OCR/AI error (backend may be offline or returned HTML):', apiErr.message);
        }
      }

    } catch (error) {
      console.error('Capture error:', error);
      showError('Screen capture failed: ' + error.message);
      statusText.textContent = 'Capture failed';
    } finally {
      captureButton.disabled = false;
    }
  });

  // Listen for messages from content script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "updateStats") {
      mcqsFoundEl.textContent = message.stats.found
      mcqsAnsweredEl.textContent = message.stats.answered
      accuracyEl.textContent = `${message.stats.accuracy}%`
    }

    if (message.action === "updateLastMCQ") {
      mcqInfo.style.display = "block"
      mcqInfo.querySelector(".mcq-question").textContent =
        `Question: ${message.mcq.question.substring(0, 100)}${message.mcq.question.length > 100 ? "..." : ""}`
      mcqInfo.querySelector(".mcq-answer").textContent = `Answer: ${message.mcq.answer || "Pending..."}`
    }

    if (message.action === "ocrError" || message.action === "aiError") {
      showError(message.error || "Unknown error");
      // Enhanced: Log all errors to the console for debugging
      console.error("[MCQ-BOT] Error:", message.error);
      return;
    }
  })

  function updateStatusIndicator(isEnabled) {
    if (isEnabled) {
      statusDot.className = "status-dot active"
      statusText.textContent = "Bot is active"
    } else {
      statusDot.className = "status-dot inactive"
      statusText.textContent = "Bot is inactive"
    }
  }

  function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.style.display = "block";
    // Enhanced: Log error to console for debugging
    console.error("[MCQ-BOT] Popup error:", msg);
  }

  function clearError() {
    errorMessage.textContent = "";
    errorMessage.style.display = "none";
  }
  
  function showStatus(message, type = 'info') {
    if (statusDiv) {
      statusDiv.textContent = message;
      statusDiv.className = `status-message ${type}`;
      statusDiv.style.display = 'block';
      
      // Auto-hide after 5 seconds for success/error messages
      if (type === 'success' || type === 'error') {
        setTimeout(() => {
          statusDiv.style.display = 'none';
        }, 5000);
      }
    }
  }

  // Note: startAuto has a robust handler earlier (startAuto.addEventListener)
  // Remove duplicate onclick assignment to avoid conflicts.

  // Ensure re-ocr and lang select use addEventListener for consistency
  if (reOCR) {
    reOCR.addEventListener('click', () => {
      if (lastImage) {
        showStatus('Re-running OCR...', 'info');
        runOCR(lastImage, lastLang, 2);
      } else {
        showStatus('No image available for OCR', 'error');
      }
    });
  }

  if (langSelect) {
    langSelect.addEventListener('change', (e) => {
      lastLang = e.target.value;
      showStatus(`Language changed to ${e.target.options[e.target.selectedIndex].text}`, 'info');
      if (lastImage) {
        runOCR(lastImage, lastLang, 2);
      }
    });
  }

  // Enhanced image preprocessing for better OCR accuracy
  function preprocessImage(base64, callback) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Scale up small images for better OCR
      const minWidth = 800;
      const scale = Math.max(1, minWidth / img.width);
      
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      
      // Draw scaled image
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // Get image data for processing
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // Convert to grayscale and apply contrast enhancement
      for (let i = 0; i < data.length; i += 4) {
        // Calculate grayscale value
        const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        
        // Apply contrast enhancement
        const enhanced = gray < 128 ? Math.max(0, gray - 30) : Math.min(255, gray + 30);
        
        // Apply binary threshold
        const binary = enhanced > 128 ? 255 : 0;
        
        data[i] = binary;     // Red
        data[i + 1] = binary; // Green
        data[i + 2] = binary; // Blue
        // Alpha channel remains unchanged
      }
      
      // Put processed image data back
      ctx.putImageData(imageData, 0, 0);
      
      // Show preview if element exists
      if (preview) {
        preview.src = canvas.toDataURL('image/png');
        preview.style.display = 'block';
      }
      
      callback(canvas.toDataURL('image/png'));
    };
    
    img.onerror = function() {
      showStatus('Error loading image for preprocessing', 'error');
      callback(base64); // Fallback to original
    };
    
    img.src = base64;
  }

  // Tesseract.js is not bundled — OCR is handled by the backend only.

  function getErrorMessage(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'object' && 'message' in err) return err.message;
    if (typeof err === 'string') return err;
    try { return JSON.stringify(err); } catch { return 'Unserializable error'; }
  }

  function runOCR(image, lang, retries) {
    showStatus('Running backend OCR...', 'info');
    const API_BASE = 'http://localhost:5050/api';
    fetch(`${API_BASE}/ocr-detect`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({image_data: image, language: lang})
    })
    .then(r => r.json())
    .then(data => {
      if (data.success && data.text) {
        showStatus('OCR completed', 'success');
        if (ocrResult) ocrResult.textContent = data.text;
      } else {
        showStatus('No text found', 'error');
        if (ocrResult) ocrResult.textContent = 'No text detected';
      }
    })
    .catch(err => {
      showStatus('Backend OCR error: ' + getErrorMessage(err), 'error');
    });
  }
  
  // Simple MCQ parser for OCR text
  function parseMCQsFromText(text) {
    const mcqs = [];
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    let currentQuestion = '';
    let currentOptions = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check if line looks like a question (ends with ? or contains question words)
      if (line.endsWith('?') || /\b(what|which|who|when|where|why|how)\b/i.test(line)) {
        // Save previous MCQ if we have one
        if (currentQuestion && currentOptions.length >= 2) {
          mcqs.push({
            question: currentQuestion,
            options: currentOptions
          });
        }
        
        currentQuestion = line;
        currentOptions = [];
      }
      // Check if line looks like an option (starts with A), B), 1), etc.)
      else if (/^[A-D1-4][.)\s]/.test(line) || /^[a-d][.)\s]/.test(line)) {
        const optionText = line.replace(/^[A-Da-d1-4][.)\s]+/, '').trim();
        if (optionText) {
          currentOptions.push(optionText);
        }
      }
    }
    
    // Don't forget the last MCQ
    if (currentQuestion && currentOptions.length >= 2) {
      mcqs.push({
        question: currentQuestion,
        options: currentOptions
      });
    }
    
    return mcqs;
  }

  // Example function to answer MCQ using backend
  async function answerMCQWithBackend(question, options) {
    // Get provider from storage
    const settings = await new Promise((resolve) => {
      chrome.storage.sync.get(["apiProvider"], resolve)
    })
    const provider = settings.apiProvider || "openai"
    // POST to backend
    const API_BASE = 'http://localhost:5050/api';
    const response = await fetch(`${API_BASE}/get-answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: question,
        options: options.map(text => ({ text })),
        provider: provider
      })
    })
    const data = await response.json()
    if (data.success) {
      // Show answer in popup UI (implement as needed)
      statusText.textContent = `Answer: ${data.selected_option}`
    } else {
      statusText.textContent = `Error: ${data.error || 'No answer found'}`
    }
  }
})
