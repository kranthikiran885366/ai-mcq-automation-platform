# FIXES APPLIED - Backend Server Issue

## Root Cause
The Flask server appeared to start (showed "Running on 0.0.0.0:5000") but wasn't accepting connections because `wa_web.start()` was blocking the main thread during module import. The Node.js/Puppeteer bridge takes 10-30 seconds to initialize, preventing Flask from binding the port.

## Fix Applied
Moved `wa_web.start()` into a background thread so Flask binds the port immediately:

**File: backend/app.py**
- Added `import threading` at top
- Wrapped `wa_web.start()` in `_start_wa_bridge_async()` function
- Launched in daemon thread with 2-second delay to let Flask bind first

## How to Start Server

**Option 1: Run directly**
```cmd
cd backend
python run_server.py
```

**Option 2: Use batch file**
```cmd
start_backend.bat
```

**Option 3: Use PowerShell**
```powershell
.\start_backend.ps1
```

## Expected Output
```
Starting MCQ Automation Bot Server...
==================================================
Backend URL : http://localhost:5000
WhatsApp QR : http://localhost:5000/whatsapp
==================================================
[OK] All packages found
[OK] Port 5000 is free
[OK] App loaded — listening on http://0.0.0.0:5000
     Press Ctrl+C to stop

 * Serving Flask app 'app'
 * Running on http://127.0.0.1:5000
```

## Test Server is Working
Open browser: **http://localhost:5000/api/health**
Should return: `{"ok":true}`

## Connect WhatsApp
1. Open: **http://localhost:5000/whatsapp**
2. Scan QR code with WhatsApp on your phone
3. Wait for "✅ WhatsApp Connected!"
4. Extension screenshot button will now work

## Extension Setup
1. Open Chrome → `chrome://extensions`
2. Click **Reload** on "Advanced AI MCQ Bot"
3. Open test page: `file:///C:/Users/krant/Downloads/b_lfJWY8zj8u2/test-mcq-page.html`
4. Click "📸 Take Screenshot" button
5. Screenshot will be sent to WhatsApp

## Troubleshooting

**Port still blocked?**
```cmd
netstat -ano | findstr ":5000"
taskkill /PID <PID> /F
```

**Server not responding?**
- Check firewall isn't blocking port 5000
- Try different port: edit `backend/.env` → `PORT=5050`
- Update all files: `localhost:5000` → `localhost:5050`

**WhatsApp bridge not starting?**
```cmd
cd backend/wa_bridge
npm install
```

**Node.js not found?**
Download from: https://nodejs.org
