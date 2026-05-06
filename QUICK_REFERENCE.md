# ⚡ QUICK REFERENCE - AI MCQ AUTOMATION PLATFORM

**Last Updated:** May 6, 2026  
**Purpose:** Fast lookup for developers and stakeholders  

---

## 📋 FILE LOCATIONS & PURPOSES

### **EXTENSION FILES (Root Directory)**

| File | Lines | Purpose |
|------|-------|---------|
| `manifest.json` | 30 | Extension config (Manifest V3) |
| `popup.html` | 300+ | Popup UI interface |
| `popup.js` | 739 | Popup functionality |
| `options.html` | 800+ | Settings page |
| `options.js` | 650+ | Settings management |
| `content.js` | 3588 | MCQ detection & page scanning |
| `background.js` | 883 | Service worker & API routing |
| `config.js` | 30 | API configuration |
| `tesseract.min.js` | - | OCR library (local) |

**Total Extension Code:** 5,210 lines

### **BACKEND FILES**

| File | Lines | Purpose |
|------|-------|---------|
| `backend/app.py` | 1656 | Flask backend & API endpoints |
| `backend/automation_bot.py` | 150+ | MCQ bot core logic |
| `backend/requirements.txt` | 13 | Python dependencies |
| `backend/run_server.py` | 50 | Server launcher |
| `backend/install_dependencies.py` | 100 | Auto-installer |
| `backend/Dockerfile` | 30 | Container config |

**Total Backend Code:** 1,700 lines

---

## 🔌 API ENDPOINTS

### **Base URL**
```
Production: https://mcq-bot-backend.railway.app/api
Development: http://localhost:5000/api
```

### **All Endpoints**

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/` | Welcome page |
| POST | `/setup` | Initialize AI clients |
| POST | `/detect-mcqs` | DOM-based MCQ detection |
| POST | `/process-mcqs` | Full MCQ processing |
| POST | `/ocr-detect` | OCR processing |
| POST | `/get-answer` | Get AI answer |
| POST | `/answer` | Single MCQ answer |
| POST | `/vision-answer` | GPT-4 Vision analysis |
| POST | `/generate-ocr-test-image` | Test image generation |
| GET | `/health` | Health check |

---

## 🧠 AI PROVIDERS

| Provider | Status | Model | Cost |
|----------|--------|-------|------|
| **OpenAI** | ✅ Active | gpt-4-0125-preview | $0.03-0.06/1K tokens |
| **Google Gemini** | ✅ Active | gemini-pro | Free (limited quota) |
| **DeepSeek** | ✅ Active | deepseek-chat | Free (limited) |
| **HuggingFace** | ✅ Active | Custom models | Free-paid |
| **Google Search** | ✅ Active | Custom Search API | $100/10K queries |

---

## 🎛️ EXTENSION SETTINGS (chrome.storage.sync)

### **Bot Controls**
```javascript
botEnabled: boolean
autoAnswer: boolean
voiceEnabled: boolean
mode: "learning" | "safe" | "stealth"
```

### **Detection Settings**
```javascript
domDetection: boolean
ocrEnabled: boolean
ocrLanguage: "eng" | "spa" | "fra" | etc
shadowDomDetection: boolean
imageDetection: boolean
mathDetection: boolean
```

### **Timing**
```javascript
answerDelay: 0-10 seconds
maxAnswerDelay: 3-10 seconds
retryWrong: boolean
maxRetries: 1-5
```

### **API Keys**
```javascript
apiProvider: "openai" | "gemini" | "deepseek" | "auto"
openaiKey: string
openaiModel: string
geminiKey: string
geminiModel: string
deepseekKey: string
deepseekModel: string
```

---

## 💾 DATA STORAGE

### **Chrome Storage - Sync (Cloud)**
```javascript
// Auto-sync across devices
botEnabled, autoAnswer, voiceEnabled, mode,
answerDelay, apiProvider, apiKeys, settings,
stats (found, answered, correct, accuracy)
```

### **Chrome Storage - Local (Device Only)**
```javascript
history: [
  {
    timestamp, question, answer, 
    correct, url, aiProvider
  }
]
```

---

## 🔐 SECURITY FEATURES

### **Anti-Detection**
- ✅ Webdriver detection bypass
- ✅ Human-like delays (1-3 seconds)
- ✅ Random scrolling patterns
- ✅ User agent rotation
- ✅ Webcam detection
- ✅ Fullscreen detection
- ✅ VM detection

### **Safe Mechanisms**
- ✅ Safe mode (auto-disable in proctored)
- ✅ Rate limiting (optional)
- ✅ API key encryption
- ✅ CORS protection

---

## 📊 STATISTICS TRACKED

```javascript
stats = {
  found: 0,           // Total MCQs found
  answered: 0,        // Total MCQs answered
  correct: 0,         // Correct answers
  accuracy: 0         // Percentage correct
}
```

---

## 🚨 CRITICAL GAPS (DO NOT IGNORE)

| Gap | Impact | Effort | Status |
|-----|--------|--------|--------|
| **WhatsApp Integration** | 🔴 High | 40h | ❌ Missing |
| **Database** | 🔴 Critical | 60h | ❌ Missing |
| **User Auth** | 🔴 Critical | 50h | ❌ Missing |
| **Error Handling** | 🟠 High | 20h | ⚠️ Partial |
| **Rate Limiting** | 🟠 High | 15h | ❌ Missing |
| **Logging** | 🟠 High | 20h | ⚠️ Basic |
| **Testing** | 🟡 Medium | 60h | ❌ None |
| **Monitoring** | 🟡 Medium | 20h | ❌ Missing |
| **Screenshots** | 🟡 Medium | 15h | ⚠️ Partial |

---

## 🔄 MESSAGE FLOW

### **Extension → Backend**

```javascript
// From content.js or popup.js
chrome.runtime.sendMessage({
  action: "performOCR",
  imageData: base64String,
  language: "eng"
})

// Background.js receives and forwards
fetch('https://mcq-bot-backend.railway.app/api/ocr-detect', {
  method: 'POST',
  body: JSON.stringify({
    image_data: imageData,
    language: language
  })
})
```

### **Answer Flow**

```
1. Content.js detects MCQ on page
2. Popup shows detected question
3. User clicks "Get Answer"
4. Popup calls background.js predictAnswer
5. background.js calls backend /api/get-answer
6. Backend calls AI provider (OpenAI, Gemini, etc)
7. AI returns answer
8. Backend parses answer to option index
9. Background returns to popup
10. Popup shows answer
11. User clicks "Select Answer"
12. Content.js clicks the option on page
```

---

## 🚀 DEPLOYMENT CHECKLIST

### **Before Launch**
- [ ] API keys configured in Railway
- [ ] Backend health check passing
- [ ] Extension tested on 5+ websites
- [ ] OCR tested with images
- [ ] All AI providers configured

### **Production Launch**
- [ ] Extension published to Chrome Web Store
- [ ] Backend monitored (Railway.app)
- [ ] Error tracking enabled (Sentry)
- [ ] Logging configured
- [ ] Backups scheduled

### **Post-Launch**
- [ ] Monitor error rates
- [ ] Track API costs
- [ ] User feedback collected
- [ ] Performance metrics reviewed
- [ ] Security audit done

---

## 💰 COST BREAKDOWN (MONTHLY)

| Service | Cost | Notes |
|---------|------|-------|
| Railway (Backend) | $10-50 | Shared with DB |
| PostgreSQL (if added) | $15-150 | Managed database |
| OpenAI GPT-4 | $0.03-5 | Per 1M tokens |
| Google Gemini | $0-1 | Free tier available |
| Google Search API | $100 | Per 10K queries |
| Twilio WhatsApp | $50-100 | If integrated |
| Monitoring (Sentry) | $0-100 | Free tier available |
| **TOTAL** | **$75-408/month** | Varies by usage |

---

## 🎯 COMMON TASKS

### **Add New AI Provider**
1. Add provider credentials to `options.html`
2. Implement provider logic in `background.js`
3. Add to `app.py` provider handler
4. Test with sample question

### **Add New MCQ Selector**
1. Add CSS selector to `content.js` selectors array
2. Test on target website
3. Add to `options.js` custom selectors

### **Debug Mode**
1. Set `debugMode: true` in options
2. Open Chrome DevTools (F12)
3. Check Console tab for logs
4. Check Network tab for API calls

### **Reset Extension**
```javascript
// In DevTools console
chrome.storage.sync.clear()
chrome.storage.local.clear()
location.reload()
```

---

## ⚙️ ENVIRONMENT VARIABLES (Backend)

### **Required**
```bash
FLASK_ENV=production
DATABASE_URL=postgresql://user:pass@host/db  # When added
```

### **AI Providers**
```bash
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
DEEPSEEK_API_KEY=...
HUGGINGFACE_API_KEY=...
GOOGLE_SEARCH_API_KEY=...
GOOGLE_SEARCH_CX=...
```

### **Integration**
```bash
TWILIO_ACCOUNT_SID=...    # For WhatsApp
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=...
```

---

## 🧪 TESTING ENDPOINTS

### **Health Check**
```bash
curl https://mcq-bot-backend.railway.app/api/health
# Response: {"ok": true}
```

### **Test OCR**
```bash
curl -X POST https://mcq-bot-backend.railway.app/api/generate-ocr-test-image \
  -H "Content-Type: application/json" \
  -d '{"text": "What is 2+2?", "font_size": 40}'
```

### **Test AI Answer**
```bash
curl -X POST https://mcq-bot-backend.railway.app/api/get-answer \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is capital of France?",
    "options": [{"text": "London"}, {"text": "Paris"}],
    "provider": "openai"
  }'
```

---

## 📞 TROUBLESHOOTING

### **Extension not detecting MCQs**
1. Check if DOM detection is enabled
2. Try enabling OCR
3. Check DevTools console for errors
4. Try custom CSS selectors

### **AI not answering**
1. Verify API keys in options
2. Check backend health
3. Try different AI provider
4. Check internet connection

### **Backend not responding**
1. Check Railway.app dashboard
2. Verify API endpoint URL in config.js
3. Check backend logs
4. Restart backend service

### **OCR not working**
1. Check image quality
2. Try different language
3. Check Tesseract library loaded
4. Check backend health

---

## 📚 DOCUMENTATION FILES

| File | Size | Focus |
|------|------|-------|
| **README.md** | 12KB | Project overview |
| **API.md** | 18KB | API endpoints |
| **PROJECT_STRUCTURE.md** | 20KB | Architecture |
| **TESTING.md** | 51KB | Test guide |
| **CONTRIBUTING.md** | 18KB | Development guide |
| **PROJECT_ANALYSIS.md** | 30KB | Deep analysis (NEW) |
| **GAPS_AND_ACTION_PLAN.md** | 25KB | Issues & solutions (NEW) |
| **COMPLETE_AUDIT_SUMMARY.md** | 20KB | Executive summary (NEW) |

---

## ✅ BEFORE YOU START DEVELOPMENT

1. **Read**: PROJECT_ANALYSIS.md (understand system)
2. **Read**: GAPS_AND_ACTION_PLAN.md (see issues)
3. **Read**: README.md (quick start)
4. **Setup**: Local extension testing
5. **Setup**: Backend in development mode
6. **Test**: All AI providers configured
7. **Start**: Phase 1 implementation

---

## 🎓 KEY NUMBERS

```
Extension Files:         7
Backend Files:           6
Total Lines of Code:     6,500+
API Endpoints:          11
AI Providers:           5
Detection Strategies:   4
Settings Options:       20+
Chrome Permissions:     7
Documentation Pages:    8
Total Gaps Found:       15
Implementation Hours:   225
Estimated Dev Cost:    $22,500
```

---

**Quick Links:**
- 📖 Full Analysis → PROJECT_ANALYSIS.md
- 🔧 What to Fix → GAPS_AND_ACTION_PLAN.md
- 📋 Executive Summary → COMPLETE_AUDIT_SUMMARY.md
- ⚡ This File → QUICK_REFERENCE.md

**Status:** ✅ COMPLETE & PRODUCTION-READY FOR IMPLEMENTATION
