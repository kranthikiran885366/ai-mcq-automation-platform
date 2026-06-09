@echo off
echo Killing any process on port 5000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000 " ^| findstr "LISTENING" 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 1 >nul

echo Starting backend server on port 5000...
cd /d "%~dp0backend"
set PORT=5000
python run_server.py
pause
pause
