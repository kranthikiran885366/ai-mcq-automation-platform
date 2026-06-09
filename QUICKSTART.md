# Quick Start

## Start Backend Server

**Windows:**
```
start_backend.bat
```

**Manual:**
```
cd backend
python run_server.py
```

Server will start on: **http://localhost:5001**

## Connect WhatsApp

1. Open: **http://localhost:5001/whatsapp**
2. Scan QR code with WhatsApp on your phone
3. Once connected, the extension can send screenshots

## Troubleshooting

**Port already in use:**
```
netstat -ano | findstr ":5001"
taskkill /PID <PID> /F
```

**Backend not starting:**
- Check Python packages: `pip install -r backend/requirements.txt`
- Check Node.js installed: `node --version`
- Install wa_bridge packages: `cd backend/wa_bridge && npm install`
