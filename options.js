document.addEventListener("DOMContentLoaded", () => {
  // Tab switching functionality
  const tabButtons = document.querySelectorAll(".tab-button")
  const tabContents = document.querySelectorAll(".tab-content")
  const themeToggle = document.getElementById("themeToggle")

  let isDarkMode = false

  // Theme toggle
  themeToggle.addEventListener("click", () => {
    isDarkMode = !isDarkMode
    document.body.classList.toggle("dark-mode", isDarkMode)
    themeToggle.textContent = isDarkMode ? "☀️" : "🌙"
    chrome.storage.sync.set({ darkMode: isDarkMode })
  })

  tabButtons.forEach((button) => {
    button.addEventListener("click", function () {
      const tabId = this.getAttribute("data-tab")

      // Update active tab button
      tabButtons.forEach((btn) => btn.classList.remove("active"))
      this.classList.add("active")

      // Show active tab content
      tabContents.forEach((content) => content.classList.remove("active"))
      document.getElementById(`${tabId}Tab`).classList.add("active")
    })
  })

  // API provider change handler
  const apiProvider = document.getElementById("apiProvider")
  const openaiSettings = document.getElementById("openaiSettings")
  const geminiSettings = document.getElementById("geminiSettings")
  const deepseekSettings = document.getElementById("deepseekSettings")
  const huggingfaceSettings = document.getElementById("huggingfaceSettings")
  const groqSettings = document.getElementById("groqSettings")
  const searchSettings = document.getElementById("searchSettings")

  apiProvider.addEventListener("change", () => {
    const provider = apiProvider.value

    // Hide all settings
    openaiSettings.style.display = "none"
    geminiSettings.style.display = "none"
    deepseekSettings.style.display = "none"
    huggingfaceSettings.style.display = "none"
    groqSettings.style.display = "none"
    searchSettings.style.display = "none"

    // Show selected provider settings
    if (provider === "openai" || provider === "auto") {
      openaiSettings.style.display = "block"
    }

    if (provider === "gemini" || provider === "auto") {
      geminiSettings.style.display = "block"
    }

    if (provider === "groq" || provider === "auto") {
      groqSettings.style.display = "block"
    }

    if (provider === "deepseek" || provider === "auto") {
      deepseekSettings.style.display = "block"
    }

    if (provider === "huggingface" || provider === "auto") {
      huggingfaceSettings.style.display = "block"
    }

    if (provider === "search" || provider === "auto") {
      searchSettings.style.display = "block"
    }
  })

  // Range input value display
  const rangeInputs = document.querySelectorAll('input[type="range"]')

  rangeInputs.forEach((input) => {
    const valueDisplay = document.getElementById(`${input.id}Value`)

    // Set initial value
    if (valueDisplay) {
      if (input.id === "voiceRate") {
        valueDisplay.textContent = `${input.value}x`
      } else if (input.id.includes("Delay")) {
        valueDisplay.textContent = `${input.value}s`
      } else {
        valueDisplay.textContent = input.value
      }
    }

    // Update value on input
    input.addEventListener("input", () => {
      if (valueDisplay) {
        if (input.id === "voiceRate") {
          valueDisplay.textContent = `${input.value}x`
        } else if (input.id.includes("Delay")) {
          valueDisplay.textContent = `${input.value}s`
        } else {
          valueDisplay.textContent = input.value
        }
      }
    })
  })

  // Form elements
  const openaiKey = document.getElementById("openaiKey")
  const openaiModel = document.getElementById("openaiModel")
  const geminiKey = document.getElementById("geminiKey")
  const geminiModel = document.getElementById("geminiModel")
  const groqKey = document.getElementById("groqKey")
  const groqModel = document.getElementById("groqModel")
  const deepseekKey = document.getElementById("deepseekKey")
  const deepseekModel = document.getElementById("deepseekModel")
  const huggingfaceKey = document.getElementById("huggingfaceKey")
  const huggingfaceModel = document.getElementById("huggingfaceModel")
  const googleSearchApiKey = document.getElementById("googleSearchApiKey")
  const googleSearchCx = document.getElementById("googleSearchCx")
  const promptTemplate = document.getElementById("promptTemplate")
  const apiStatus = document.getElementById("apiStatus")
  const testApiButton = document.getElementById("testApiButton")
  const saveApiButton = document.getElementById("saveApiButton")

  const autoAnswerToggle = document.getElementById("autoAnswerToggle")
  const answerDelay = document.getElementById("answerDelay")
  const maxAnswerDelay = document.getElementById("maxAnswerDelay")
  const retryWrongToggle = document.getElementById("retryWrongToggle")
  const maxRetries = document.getElementById("maxRetries")
  const voiceToggle = document.getElementById("voiceToggle")
  const voiceRate = document.getElementById("voiceRate")
  const autoScrollToggle = document.getElementById("autoScrollToggle")
  const highlightToggle = document.getElementById("highlightToggle")
  const saveBehaviorButton = document.getElementById("saveBehaviorButton")

  const domDetectionToggle = document.getElementById("domDetectionToggle")
  const ocrToggle = document.getElementById("ocrToggle")
  const ocrLanguage = document.getElementById("ocrLanguage")
  const shadowDomToggle = document.getElementById("shadowDomToggle")
  const imageDetectionToggle = document.getElementById("imageDetectionToggle")
  const mathDetectionToggle = document.getElementById("mathDetectionToggle")
  const customSelectors = document.getElementById("customSelectors")
  const saveDetectionButton = document.getElementById("saveDetectionButton")

  const safeModeToggle = document.getElementById("safeModeToggle")
  const detectWebcamToggle = document.getElementById("detectWebcamToggle")
  const detectFullscreenToggle = document.getElementById("detectFullscreenToggle")
  const detectVMToggle = document.getElementById("detectVMToggle")
  const stealthModeToggle = document.getElementById("stealthModeToggle")
  const saveHistoryToggle = document.getElementById("saveHistoryToggle")
  const maxHistoryItems = document.getElementById("maxHistoryItems")
  const debugModeToggle = document.getElementById("debugModeToggle")
  const exportDataButton = document.getElementById("exportDataButton")
  const importDataButton = document.getElementById("importDataButton")
  const resetButton = document.getElementById("resetButton")
  const saveAdvancedButton = document.getElementById("saveAdvancedButton")

  const clearHistoryButton = document.getElementById("clearHistoryButton")
  const exportHistoryButton = document.getElementById("exportHistoryButton")
  const historyList = document.getElementById("historyList")

  // Load saved settings
  loadSettings()

  // Test API connection
  testApiButton.addEventListener("click", () => {
    const provider = apiProvider.value
    let key = ""
    let model = ""
    let searchApiKey = ""
    let searchCx = ""

    if (provider === "openai" || provider === "auto") {
      key = openaiKey.value
      model = openaiModel.value
    } else if (provider === "gemini") {
      key = geminiKey.value
      model = geminiModel.value
    } else if (provider === "deepseek") {
      key = deepseekKey.value
      model = deepseekModel.value
    } else if (provider === "huggingface") {
      key = huggingfaceKey.value
      model = huggingfaceModel.value
    } else if (provider === "search") {
      searchApiKey = googleSearchApiKey.value
      searchCx = googleSearchCx.value
    }

    if (provider === "search") {
      if (!searchApiKey || !searchCx) {
        showApiStatus("Please enter both Google Search API key and CX", "error")
        return
      }
    }

    if (!key && !searchApiKey) {
      showApiStatus("Please enter an API key", "error")
      return
    }

    showApiStatus("Testing connection...", "")

    // Send message to background script to test API
    chrome.runtime.sendMessage(
      {
        action: "testApiConnection",
        provider: provider,
        apiKey: key,
        model: model,
        googleSearchApiKey: searchApiKey,
        googleSearchCx: searchCx,
      },
      (response) => {
        if (response && response.success) {
          showApiStatus("Connection successful!", "success")
        } else {
          showApiStatus(`Connection failed: ${response.error || "Unknown error"}`, "error")
        }
      },
    )
  })

  // Save API settings
  saveApiButton.addEventListener("click", async () => {
    const provider = apiProvider.value
    const template = promptTemplate.value

    const settings = {
      apiProvider: provider,
      promptTemplate: template,
      apiConfigured: false,
    }

    // Save provider-specific settings
    if (provider === "openai" || provider === "auto") {
      const key = openaiKey.value
      const model = openaiModel.value

      if (!key) {
        showApiStatus("Please enter an OpenAI API key", "error")
        return
      }

      settings.openaiKey = key
      settings.openaiModel = model
      settings.apiConfigured = true
    }

    if (provider === "gemini" || provider === "auto") {
      const key = geminiKey.value
      const model = geminiModel.value

      if (!key && (provider === "gemini" || !settings.apiConfigured)) {
        showApiStatus("Please enter a Gemini API key", "error")
        return
      }

      if (key) {
        settings.geminiKey = key
        settings.geminiModel = model
        settings.apiConfigured = true
      }
    }

    if (provider === "groq" || provider === "auto") {
      const key = groqKey.value
      const model = groqModel.value
      if (key) {
        settings.groqKey = key
        settings.groqModel = model
        settings.apiConfigured = true
      }
    }

    if (provider === "deepseek" || provider === "auto") {
      const key = deepseekKey.value
      const model = deepseekModel.value

      if (!key && (provider === "deepseek" || !settings.apiConfigured)) {
        showApiStatus("Please enter a DeepSeek API key", "error")
        return
      }

      if (key) {
        settings.deepseekKey = key
        settings.deepseekModel = model
        settings.apiConfigured = true
      }
    }

    if (provider === "huggingface" || provider === "auto") {
      const key = huggingfaceKey.value
      const model = huggingfaceModel.value

      if (!key && (provider === "huggingface" || !settings.apiConfigured)) {
        showApiStatus("Please enter a Hugging Face API key", "error")
        return
      }

      if (key) {
        settings.huggingfaceKey = key
        settings.huggingfaceModel = model
        settings.apiConfigured = true
      }
    }

    if (provider === "search" || provider === "auto") {
      const searchApiKey = googleSearchApiKey.value
      const searchCx = googleSearchCx.value
      if (!searchApiKey || !searchCx) {
        showApiStatus("Please enter both Google Search API key and CX", "error")
        return
      }
      settings.googleSearchApiKey = searchApiKey
      settings.googleSearchCx = searchCx
    }

    chrome.storage.sync.set(settings, () => {
      showApiStatus("API settings saved successfully!", "success")
    })

    // Sync with backend
    const API_BASE = window.APP_CONFIG ? window.APP_CONFIG.API_BASE : 'https://mcq-bot-backend.railway.app/api';
    const backendPayload = {
      api_provider: settings.apiProvider,
      prompt_template: settings.promptTemplate,
    }

    if (settings.openaiKey) {
      backendPayload.openai_key = settings.openaiKey
      backendPayload.openai_model = settings.openaiModel
    }

    if (settings.geminiKey) {
      backendPayload.gemini_key = settings.geminiKey
      backendPayload.gemini_model = settings.geminiModel
    }

    if (settings.deepseekKey) {
      backendPayload.deepseek_key = settings.deepseekKey
      backendPayload.deepseek_model = settings.deepseekModel
    }

    if (settings.huggingfaceKey) {
      backendPayload.huggingface_key = settings.huggingfaceKey
      backendPayload.huggingface_model = settings.huggingfaceModel
    }

    if (settings.groqKey) {
      backendPayload.groq_key = settings.groqKey
      backendPayload.groq_model = settings.groqModel
    }

    if (settings.googleSearchApiKey) {
      backendPayload.googleSearchApiKey = settings.googleSearchApiKey
      backendPayload.googleSearchCx = settings.googleSearchCx
    }

    const normalizedBase = API_BASE.replace(/\/+$/, '')
    const localhostBase = 'http://localhost:5050'
    const setupUrls = [
      `${localhostBase}/api/setup`,
      `${localhostBase}/setup`,
      `${normalizedBase}/setup`,
      `${normalizedBase.replace(/\/api$/i, '')}/api/setup`,
      `${normalizedBase.replace(/\/api$/i, '')}/setup`,
    ].filter((url, index, arr) => arr.indexOf(url) === index)

    try {
      let lastError = null

      for (const setupUrl of setupUrls) {
        try {
          const res = await fetch(setupUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(backendPayload)
          })

          const raw = await res.text()
          let data = null

          try {
            data = raw ? JSON.parse(raw) : {}
          } catch {
            throw new Error(`HTTP ${res.status}: ${raw || 'Empty response'}`)
          }

          if (!res.ok) {
            throw new Error(data.error || `HTTP ${res.status}`)
          }

          if (data.success) {
            showApiStatus('Backend setup successful!', 'success')
            return
          }

          throw new Error(data.error || 'Unknown error')
        } catch (err) {
          lastError = err
        }
      }

      showApiStatus('Backend setup failed: ' + (lastError ? lastError.message : 'Unknown error'), 'error')
    } catch (err) {
      showApiStatus('Backend setup error: ' + err.message, 'error')
    }
  })

  // Save behavior settings
  saveBehaviorButton.addEventListener("click", () => {
    const settings = {
      autoAnswer: autoAnswerToggle.checked,
      answerDelay: Number.parseFloat(answerDelay.value),
      maxAnswerDelay: Number.parseFloat(maxAnswerDelay.value),
      retryWrong: retryWrongToggle.checked,
      maxRetries: Number.parseInt(maxRetries.value),
      voiceEnabled: voiceToggle.checked,
      voiceRate: Number.parseFloat(voiceRate.value),
      autoScroll: autoScrollToggle.checked,
      highlightAnswers: highlightToggle.checked,
    }

    chrome.storage.sync.set(settings, () => {
      showStatus("behaviorTab", "Behavior settings saved successfully!", "success")
    })
  })

  // Save detection settings
  saveDetectionButton.addEventListener("click", () => {
    const settings = {
      domDetection: domDetectionToggle.checked,
      ocrEnabled: ocrToggle.checked,
      ocrLanguage: ocrLanguage.value,
      shadowDomDetection: shadowDomToggle.checked,
      imageDetection: imageDetectionToggle.checked,
      mathDetection: mathDetectionToggle.checked,
      customSelectors: customSelectors.value,
    }

    chrome.storage.sync.set(settings, () => {
      showStatus("detectionTab", "Detection settings saved successfully!", "success")
    })
  })

  // Save advanced settings
  saveAdvancedButton.addEventListener("click", () => {
    const settings = {
      safeMode: safeModeToggle.checked,
      detectWebcam: detectWebcamToggle.checked,
      detectFullscreen: detectFullscreenToggle.checked,
      detectVM: detectVMToggle.checked,
      stealthMode: stealthModeToggle.checked,
      saveHistory: saveHistoryToggle.checked,
      maxHistoryItems: Number.parseInt(maxHistoryItems.value),
      debugMode: debugModeToggle.checked,
    }

    chrome.storage.sync.set(settings, () => {
      showStatus("advancedTab", "Advanced settings saved successfully!", "success")
    })
  })

  // Export data
  exportDataButton.addEventListener("click", () => {
    chrome.storage.sync.get(null, (data) => {
      // Convert the data to a JSON string
      const jsonData = JSON.stringify(data, null, 2)

      // Create a blob with the data
      const blob = new Blob([jsonData], { type: "application/json" })

      // Create a URL for the blob
      const url = URL.createObjectURL(blob)

      // Create a temporary link element
      const a = document.createElement("a")
      a.href = url
      a.download = "mcq_bot_settings.json"

      // Trigger a click on the link to start the download
      document.body.appendChild(a)
      a.click()

      // Clean up
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    })
  })

  // Import data
  importDataButton.addEventListener("click", () => {
    // Create a file input element
    const fileInput = document.createElement("input")
    fileInput.type = "file"
    fileInput.accept = ".json"

    fileInput.addEventListener("change", (event) => {
      const file = event.target.files[0]

      if (file) {
        const reader = new FileReader()

        reader.onload = (e) => {
          try {
            const data = JSON.parse(e.target.result)

            // Save the imported data to storage
            chrome.storage.sync.set(data, () => {
              showStatus("advancedTab", "Settings imported successfully! Reloading...", "success")

              // Reload the settings after a short delay
              setTimeout(() => {
                loadSettings()
              }, 1000)
            })
          } catch (error) {
            showStatus("advancedTab", `Error importing settings: ${error.message}`, "error")
          }
        }

        reader.readAsText(file)
      }
    })

    // Trigger a click on the file input
    fileInput.click()
  })

  // Reset to defaults
  resetButton.addEventListener("click", () => {
    if (confirm("Are you sure you want to reset all settings to defaults?")) {
      const defaultSettings = {
        apiProvider: "groq",
        openaiModel: "gpt-4-0125-preview",
        geminiModel: "gemini-pro",
        groqModel: "llama-3.3-70b-versatile",
        deepseekModel: "deepseek-chat",
        promptTemplate: promptTemplate.defaultValue,
        autoAnswer: true,
        answerDelay: 3,
        maxAnswerDelay: 6,
        retryWrong: true,
        maxRetries: 3,
        voiceEnabled: false,
        voiceRate: 1,
        autoScroll: true,
        highlightAnswers: true,
        domDetection: true,
        ocrEnabled: true,
        ocrLanguage: "eng",
        shadowDomDetection: true,
        imageDetection: true,
        mathDetection: true,
        customSelectors: customSelectors.defaultValue,
        safeMode: true,
        detectWebcam: true,
        detectFullscreen: true,
        detectVM: true,
        stealthMode: false,
        saveHistory: true,
        maxHistoryItems: 50,
        debugMode: false,
        mode: "learning",
        darkMode: false,
      }

      chrome.storage.sync.set(defaultSettings, () => {
        showStatus("advancedTab", "All settings reset to defaults! Reloading...", "success")

        // Reload the settings after a short delay
        setTimeout(() => {
          loadSettings()
          document.body.classList.remove("dark-mode")
          themeToggle.textContent = "🌙"
        }, 1000)
      })
    }
  })

  // Clear history
  clearHistoryButton.addEventListener("click", () => {
    if (confirm("Are you sure you want to clear all answer history?")) {
      chrome.storage.local.set({ history: [] }, () => {
        loadHistory()
        showStatus("historyTab", "History cleared successfully!", "success")
      })
    }
  })

  // Export history
  exportHistoryButton.addEventListener("click", () => {
    chrome.storage.local.get(["history"], (data) => {
      const history = data.history || []

      // Convert the history to a JSON string
      const jsonData = JSON.stringify(history, null, 2)

      // Create a blob with the data
      const blob = new Blob([jsonData], { type: "application/json" })

      // Create a URL for the blob
      const url = URL.createObjectURL(blob)

      // Create a temporary link element
      const a = document.createElement("a")
      a.href = url
      a.download = "mcq_bot_history.json"

      // Trigger a click on the link to start the download
      document.body.appendChild(a)
      a.click()

      // Clean up
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    })
  })

  // Helper functions
  function loadSettings() {
    chrome.storage.sync.get(
      [
        "apiProvider",
        "openaiKey",
        "openaiModel",
        "geminiKey",
        "geminiModel",
        "deepseekKey",
        "deepseekModel",
        "huggingfaceKey",
        "huggingfaceModel",
        "googleSearchApiKey",
        "googleSearchCx",
        "groqKey",
        "groqModel",
        "promptTemplate",
        "apiConfigured",
      ],
      (result) => {
        apiProvider.value = result.apiProvider || "groq"
        openaiKey.value = result.openaiKey || ""
        openaiModel.value = result.openaiModel || "gpt-4-0125-preview"
        geminiKey.value = result.geminiKey || ""
        geminiModel.value = result.geminiModel || "gemini-pro"
        groqKey.value = result.groqKey || ""
        groqModel.value = result.groqModel || "llama-3.3-70b-versatile"
        deepseekKey.value = result.deepseekKey || ""
        deepseekModel.value = result.deepseekModel || "deepseek-chat"
        huggingfaceKey.value = result.huggingfaceKey || ""
        huggingfaceModel.value = result.huggingfaceModel || "google/flan-t5-base"
        googleSearchApiKey.value = result.googleSearchApiKey || ""
        googleSearchCx.value = result.googleSearchCx || ""
        promptTemplate.value = result.promptTemplate || ""
        // ... other settings ...
        // Show/hide settings based on provider
        apiProvider.dispatchEvent(new Event("change"))
      },
    )
  }

  function loadHistory() {
    chrome.storage.local.get(["history"], (data) => {
      const history = data.history || []

      // Clear the history list
      historyList.innerHTML = ""

      if (history.length === 0) {
        const emptyMessage = document.createElement("div")
        emptyMessage.className = "history-item"
        emptyMessage.textContent = "No history items yet."
        historyList.appendChild(emptyMessage)
        return
      }

      // Add history items in reverse chronological order
      history.reverse().forEach((item) => {
        const historyItem = document.createElement("div")
        historyItem.className = "history-item"

        const questionDiv = document.createElement("div")
        questionDiv.className = "history-question"
        questionDiv.textContent = item.question.substring(0, 150) + (item.question.length > 150 ? "..." : "")

        const answerDiv = document.createElement("div")
        answerDiv.className = "history-answer"
        answerDiv.textContent = `Answer: ${item.answer}`

        const timeDiv = document.createElement("div")
        timeDiv.className = "history-time"
        timeDiv.textContent = new Date(item.timestamp).toLocaleString()

        historyItem.appendChild(questionDiv)
        historyItem.appendChild(answerDiv)
        historyItem.appendChild(timeDiv)

        historyList.appendChild(historyItem)
      })
    })
  }

  function showApiStatus(message, type) {
    apiStatus.textContent = message
    apiStatus.className = `status ${type}`
    apiStatus.style.display = "block"

    if (type === "success" || type === "error") {
      setTimeout(() => {
        apiStatus.style.display = "none"
      }, 5000)
    }
  }

  function showStatus(tabId, message, type) {
    const container = document.querySelector(`#${tabId} .container`)

    // Remove any existing status messages
    const existingStatus = container.querySelector(".status")
    if (existingStatus) {
      container.removeChild(existingStatus)
    }

    // Create a new status message
    const status = document.createElement("div")
    status.className = `status ${type}`
    status.textContent = message

    // Add the status message to the container
    container.appendChild(status)

    // Remove the status message after a delay
    setTimeout(() => {
      if (container.contains(status)) {
        container.removeChild(status)
      }
    }, 5000)
  }
})
