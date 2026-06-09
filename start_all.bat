@echo off
echo Killing old processes...
taskkill /F /IM python.exe 2>nul
taskkill /F /IM node.exe 2>nul
timeout /t 2 >nul

echo Starting Flask Backend...
start "Flask Backend" cmd /k "cd /d %~dp0backend && set PORT=5000 && python run_server.py"

timeout /t 3 >nul

echo Starting WhatsApp Bridge...
start "WA Bridge" cmd /k "cd /d %~dp0backend\wa_bridge && node index.js"

timeout /t 2 >nul

echo Starting Frontend...
start "Frontend" cmd /k "cd /d %~dp0frontend && python -m http.server 8080"

echo.
echo ============================================
echo  All services started!
echo  Backend  : http://localhost:5000
echo  Frontend : http://localhost:8080
echo  WhatsApp : Scan QR in WA Bridge window
echo ============================================
pause
