#!/usr/bin/env python3
import os, sys

os.chdir(os.path.dirname(os.path.abspath(__file__)))

# Mark this process so app.py can safely start the WhatsApp bridge
os.environ['RUN_SERVER'] = '1'

# Load .env before reading PORT
try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))
except ImportError:
    pass

port_preview = os.environ.get('PORT', '5000')  # default 5000 matches .env and extension
print("Starting MCQ Automation Bot Server...")
print("=" * 50)
print(f"Backend URL : http://localhost:{port_preview}")
print(f"WhatsApp QR : http://localhost:{port_preview}/whatsapp")
print("=" * 50)

# Check required packages
missing = []
for pkg in ["flask", "flask_cors", "flask_sock", "cv2", "pytesseract", "openai", "PIL", "dotenv"]:
    try:
        __import__(pkg)
    except ImportError:
        missing.append(pkg)

if missing:
    print(f"[ERROR] Missing packages: {', '.join(missing)}")
    print("Run: pip install -r requirements.txt")
    sys.exit(1)

print("[OK] All packages found")

# Check port availability
import socket
port = int(os.environ.get("PORT", 5000))  # must match .env PORT and extension API_BASE
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(("0.0.0.0", port))
    except OSError:
        print(f"[ERROR] Port {port} is already in use.")
        print(f"  Kill it with:  for /f \"tokens=5\" %a in ('netstat -ano ^| findstr \":{port} \"') do taskkill /PID %a /F")
        print(f"  Or change PORT in backend/.env")
        sys.exit(1)

print(f"[OK] Port {port} is free")

# Start server
try:
    from app import app
    print(f"[OK] App loaded — listening on http://0.0.0.0:{port}")
    print("     Press Ctrl+C to stop\n")
    # debug=False + use_reloader=False prevents WinError 10038 (Windows socket crash)
    # that kills the WebSocket thread and prevents the WhatsApp bridge from starting
    app.run(
        debug=False,
        use_reloader=False,
        host="0.0.0.0",
        port=port,
        threaded=True
    )
except KeyboardInterrupt:
    print("\nServer stopped.")
except Exception as e:
    import traceback
    print(f"[ERROR] Server failed to start:")
    traceback.print_exc()
    sys.exit(1)
