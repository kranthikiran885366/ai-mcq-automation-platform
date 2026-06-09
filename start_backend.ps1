# Kill any process on port 5000
Write-Host "Checking port 5000..." -ForegroundColor Cyan
$connections = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
if ($connections) {
    foreach ($conn in $connections) {
        Write-Host "Killing process $($conn.OwningProcess) on port 5000" -ForegroundColor Yellow
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
}

# Navigate to backend directory
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location "$scriptPath\backend"

Write-Host "`nStarting MCQ Bot Backend Server..." -ForegroundColor Green
Write-Host "=================================" -ForegroundColor Green
Write-Host "Backend URL : http://localhost:5000" -ForegroundColor Cyan
Write-Host "WhatsApp QR : http://localhost:5000/whatsapp" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Green
Write-Host "`nPress Ctrl+C to stop the server`n" -ForegroundColor Yellow

# Start the server on port 5000
$env:PORT = '5000'
python run_server.py

# Keep window open on error
if ($LASTEXITCODE -ne 0) {
    Write-Host "`nServer stopped with error code: $LASTEXITCODE" -ForegroundColor Red
    Read-Host "Press Enter to exit"
}
