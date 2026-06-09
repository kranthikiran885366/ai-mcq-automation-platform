# 🔌 Chrome Extension Modules Integration Guide

This guide explains how to integrate the new modules into your Chrome extension.

## 📦 Available Modules

### 1. **ScreenshotManager** (`screenshot-manager.js`)
Handles screenshot capture, compression, storage, and export.

### 2. **ErrorHandler** (`error-handler.js`)
Manages error handling, logging, retry logic, and recovery strategies.

### 3. **NotificationManager** (`notification-manager.js`)
Handles all notifications (Chrome, desktop, sound alerts).

---

## 🚀 Quick Start

### Step 1: Update manifest.json

Add `storage` and `notifications` permissions (already present):
```json
{
  "permissions": [
    "activeTab",
    "storage",
    "scripting",
    "tabs",
    "webNavigation",
    "tabCapture",
    "declarativeNetRequest",
    "notifications"  // Already included
  ]
}
```

### Step 2: Load Modules in Service Worker (background.js)

```javascript
// At the top of background.js

// Import modules (for module-type service worker)
import ScreenshotManager from './modules/screenshot-manager.js';
import ErrorHandler from './modules/error-handler.js';
import NotificationManager from './modules/notification-manager.js';

// Initialize managers
const screenshotManager = new ScreenshotManager();
const errorHandler = new ErrorHandler({
  maxRetries: 3,
  logToBackend: true,
  backendUrl: 'https://mcq-bot-backend.railway.app/api'
});
const notificationManager = new NotificationManager({
  enableNotifications: true,
  enableSound: true,
  soundVolume: 0.7
});

// Make them globally accessible
globalThis.screenshotManager = screenshotManager;
globalThis.errorHandler = errorHandler;
globalThis.notificationManager = notificationManager;
```

### Step 3: Use in Message Handlers

```javascript
// In background.js message listener

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "captureScreenshot") {
    // Use the ScreenshotManager
    screenshotManager.captureWithMetadata({
      url: message.url,
      questionNumber: message.questionNumber,
      questionText: message.questionText,
      selectedAnswer: message.selectedAnswer,
      accuracy: message.accuracy,
      ai_provider: message.ai_provider,
      sessionId: message.sessionId
    }).then(result => {
      sendResponse(result);
      
      // Show notification
      notificationManager.showSuccess(
        'Screenshot Saved',
        `Screenshot saved successfully`,
        { timeout: 3000 }
      );
    }).catch(error => {
      // Handle error with retry logic
      const errorInfo = errorHandler.logError({
        message: error.message,
        context: 'Screenshot capture',
        timestamp: new Date().toISOString()
      });

      notificationManager.showError(
        'Screenshot Failed',
        error.message,
        { timeout: 5000 }
      );

      sendResponse({ success: false, error: error.message });
    });

    return true; // async
  }

  if (message.action === "performOCR") {
    // Use error handler with retry
    errorHandler.retryWithBackoff(
      async () => {
        // Your OCR logic here
        const response = await fetch(API_URL + '/ocr-detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_data: message.imageData })
        });

        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`);
          error.status = response.status;
          throw error;
        }

        return await response.json();
      },
      { context: 'OCR Processing', timeout: 30000 }
    ).then(result => {
      notificationManager.showSuccess(
        'OCR Complete',
        `Found ${result.mcqs_found || 0} MCQs`,
        { timeout: 3000 }
      );
      sendResponse(result);
    }).catch(error => {
      const recovery = errorHandler.getRecoverySuggestion(error);
      
      notificationManager.showError(
        'OCR Failed',
        recovery.suggestion,
        { timeout: 5000 }
      );

      errorHandler.logError({
        message: error.message,
        context: 'OCR Processing',
        recovery: recovery.type,
        timestamp: new Date().toISOString()
      });

      sendResponse({ success: false, error: error.message });
    });

    return true; // async
  }

  if (message.action === "predictAnswer") {
    // Use error handler with fallback providers
    errorHandler.retryWithFallback(
      async () => {
        // Primary provider
        return await predictAnswerOpenAI(message);
      },
      [
        async () => predictAnswerGemini(message),
        async () => predictAnswerDeepSeek(message),
        async () => predictAnswerSearch(message)
      ]
    ).then(result => {
      // Show progress notification
      notificationManager.showProgress(
        'mcq_progress',
        'Processing MCQs',
        message.currentCount,
        message.totalCount
      );

      sendResponse(result);
    }).catch(error => {
      const recovery = errorHandler.getRecoverySuggestion(error);

      notificationManager.showWarning(
        'AI Provider Failed',
        recovery.suggestion,
        { timeout: 5000 }
      );

      sendResponse({ success: false, error: error.message });
    });

    return true; // async
  }
});
```

---

## 🎯 Use Cases

### Screenshot Capture Example

```javascript
// In content.js
chrome.runtime.sendMessage({
  action: 'captureScreenshot',
  url: window.location.href,
  questionNumber: 5,
  questionText: 'What is the capital of France?',
  selectedAnswer: 'A',
  accuracy: 95.5,
  ai_provider: 'openai',
  sessionId: 'session_123'
});
```

### Error Handling Example

```javascript
// Automatic retry with exponential backoff
try {
  const result = await errorHandler.retryWithBackoff(
    async () => {
      return await fetch(apiUrl).then(r => r.json());
    },
    {
      context: 'Fetch API data',
      maxRetries: 3,
      timeout: 20000
    }
  );
} catch (error) {
  const suggestion = errorHandler.getRecoverySuggestion(error);
  console.error(suggestion.suggestion);
  // Take action based on suggestion.action
}
```

### Notification Examples

```javascript
// Success notification
notificationManager.showSuccess(
  'Quiz Complete!',
  'All 15 questions answered with 95% accuracy'
);

// Error with actions
notificationManager.showError(
  'API Error',
  'Failed to get AI answer',
  {
    timeout: 0,
    persistent: true,
    actions: [
      {
        label: 'Retry',
        callback: () => retryAICall()
      },
      {
        label: 'View Logs',
        callback: () => showErrorLogs()
      }
    ]
  }
);

// Progress notification
for (let i = 1; i <= 10; i++) {
  notificationManager.showProgress(
    'processing',
    'Processing MCQs',
    i,
    10
  );
  await new Promise(r => setTimeout(r, 1000));
}

// MCQ result notification
notificationManager.showMCQResult({
  correct: 14,
  total: 15,
  accuracy: 93.33,
  ai_provider: 'openai'
});
```

---

## 🔧 Configuration Options

### ScreenshotManager

```javascript
const manager = new ScreenshotManager();

// Configuration through IndexedDB
manager.maxStorageSize = 50 * 1024 * 1024; // 50MB
manager.compressionQuality = 0.8; // 80%

// Methods
manager.captureWithMetadata({...});
manager.downloadScreenshot(id);
manager.deleteScreenshot(id);
manager.getAllScreenshots({sessionId: 'xxx'});
manager.getStorageUsage();
```

### ErrorHandler

```javascript
const handler = new ErrorHandler({
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  logToBackend: true,
  backendUrl: 'https://api.example.com',
  enableSentry: false
});

// Methods
handler.retryWithBackoff(fn, {context, timeout});
handler.retryWithFallback(fn, [fallback1, fallback2]);
handler.handleAPIError(error, {url});
handler.getErrorLog();
handler.exportErrorLog();
```

### NotificationManager

```javascript
const manager = new NotificationManager({
  enableNotifications: true,
  enableSound: true,
  soundVolume: 0.7,
  notificationTimeout: 5000,
  position: 'bottom-right'
});

// Methods
manager.showSuccess(title, message, options);
manager.showError(title, message, options);
manager.showWarning(title, message, options);
manager.showInfo(title, message, options);
manager.showProgress(id, title, progress, total);
manager.dismissNotification(id);
manager.getHistory({type, limit});
```

---

## 📊 Storage Structure

### IndexedDB (ScreenshotManager)

```javascript
{
  database: 'MCQBot',
  stores: {
    screenshots: [
      {
        id: 'ss_1234567890_abc123',
        dataUrl: 'data:image/png;base64,...',
        timestamp: '2024-05-06T10:30:00Z',
        url: 'https://example.com/quiz',
        questionNumber: 5,
        questionText: 'What is...?',
        selectedAnswer: 'A',
        accuracy: 95.5,
        ai_provider: 'openai',
        sessionId: 'session_123',
        compressed: false,
        size: 245632
      }
    ]
  }
}
```

### Chrome Storage (ErrorHandler)

```javascript
{
  storeName: 'local',
  errorLog: [
    {
      message: 'Network timeout',
      context: 'OCR Processing',
      attempt: 2,
      maxRetries: 3,
      stack: '...',
      timestamp: '2024-05-06T10:30:00Z'
    }
  ]
}
```

### Chrome Storage (NotificationManager)

```javascript
{
  // No persistent storage needed - notifications are ephemeral
  // But history is kept in memory during session
}
```

---

## 🧪 Testing

### Test Screenshot Capture

```javascript
// In browser console
const result = await screenshotManager.captureWithMetadata({
  url: 'https://example.com',
  questionNumber: 1,
  questionText: 'Test question?',
  selectedAnswer: 'A'
});
console.log(result);
```

### Test Error Handler

```javascript
// Test retry logic
const result = await errorHandler.retryWithBackoff(
  async () => Math.random() > 0.7 ? Promise.resolve('Success!') : Promise.reject(new Error('Failed')),
  { context: 'Test operation', maxRetries: 5 }
);
```

### Test Notifications

```javascript
// Test notifications
notificationManager.showSuccess('Test', 'Success notification');
notificationManager.showError('Test', 'Error notification');
notificationManager.showProgress('test', 'Processing', 50, 100);
```

---

## 🔗 Next Steps

1. **Update manifest.json** - Ensure all required permissions are present
2. **Integrate modules** - Add imports and initialization to background.js
3. **Update message handlers** - Use modules in chrome.runtime.onMessage listener
4. **Update content.js** - Send proper messages for screenshots and notifications
5. **Update options.html** - Add WhatsApp and notification settings
6. **Test thoroughly** - Test each module individually and in combination
7. **Deploy** - Push to Chrome Web Store

---

## 📚 Documentation

- **screenshot-manager.js** - 300 lines, 15+ methods
- **error-handler.js** - 352 lines, 18+ methods
- **notification-manager.js** - 393 lines, 20+ methods

**Total:** ~1,045 lines of production-ready code

---

## 🐛 Troubleshooting

### Screenshots not saving?
- Check IndexedDB is enabled
- Verify storage quota not exceeded
- Check browser console for errors

### Notifications not showing?
- Verify notifications permission granted
- Check if running in incognito mode (limited support)
- Try desktop notifications instead

### Errors not logging?
- Verify logToBackend is enabled
- Check backend endpoint is accessible
- Look at chrome.storage.local.errorLog

---

Generated: May 6, 2026  
Status: Ready for Integration
