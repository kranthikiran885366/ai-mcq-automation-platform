"""
WhatsApp Web Integration (No Twilio needed)
Uses whatsapp-web.js via a Node.js bridge process.
- Scan QR once → stays logged in
- Sends images + text to any WhatsApp number
- Receives replies and relays to Chrome extension via WebSocket
"""

import os
import json
import re
import subprocess
import threading
import uuid
import logging
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

# ── paths ──────────────────────────────────────────────────
_BASE = Path(__file__).parent
_BRIDGE_JS = _BASE / 'wa_bridge' / 'index.js'
_SESSION_DIR = _BASE / 'wa_bridge' / '.wwebjs_auth'

# ── state ──────────────────────────────────────────────────
_proc: subprocess.Popen | None = None
_ready = threading.Event()
_qr_code: str | None = None          # latest QR string (for /api/whatsapp/qr)
_conversations: dict = {}             # shared with app.py
_ws_relay = None                      # injected by app.py: callable(payload)
_to_number: str | None = None         # injected by app.py
_pending_sends: dict[str, dict] = {}
_pending_lock = threading.Lock()


def set_relay(fn):
    global _ws_relay
    _ws_relay = fn


def set_to_number(number: str):
    global _to_number
    _to_number = number


def is_ready() -> bool:
    return _ready.is_set()


def get_qr() -> str | None:
    return _qr_code


# ── start bridge ───────────────────────────────────────────

def _kill_stale_lock():
    """Remove Chromium lock files so a crashed session doesn't block restart."""
    for lock_name in ('SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort'):
        for sub in ('session', 'session-1', 'Default'):
            lock = _SESSION_DIR / sub / lock_name
            try:
                lock.unlink(missing_ok=True)
            except Exception:
                pass


def start():
    """Start the Node.js whatsapp-web.js bridge process."""
    global _proc
    if _proc and _proc.poll() is None:
        logger.info('[WAWeb] Bridge already running')
        return

    _kill_stale_lock()

    if not _BRIDGE_JS.exists():
        logger.error('[WAWeb] Bridge not found. Run setup_wa_bridge() first.')
        return

    # Auto-install node_modules if missing
    node_modules = _BRIDGE_JS.parent / 'node_modules' / 'whatsapp-web.js'
    if not node_modules.exists():
        logger.info('[WAWeb] node_modules missing — running npm install...')
        try:
            result = subprocess.run(
                ['npm', 'install'],
                cwd=str(_BRIDGE_JS.parent),
                capture_output=True, text=True, timeout=120
            )
            if result.returncode != 0:
                logger.error(f'[WAWeb] npm install failed:\n{result.stderr}')
                return
            logger.info('[WAWeb] npm install completed')
        except FileNotFoundError:
            logger.error('[WAWeb] npm not found. Install Node.js from https://nodejs.org')
            return
        except subprocess.TimeoutExpired:
            logger.error('[WAWeb] npm install timed out after 120s')
            return

    logger.info('[WAWeb] Starting WhatsApp Web bridge...')
    try:
        _proc = subprocess.Popen(
            ['node', str(_BRIDGE_JS)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            errors='replace',
            cwd=str(_BRIDGE_JS.parent)
        )
        threading.Thread(target=_read_bridge_output, daemon=True).start()
        threading.Thread(target=_read_bridge_stderr, daemon=True).start()
        threading.Thread(target=_watch_bridge, daemon=True).start()
        logger.info(f'[WAWeb] Bridge process started (pid={_proc.pid})')
    except FileNotFoundError:
        logger.error('[WAWeb] node not found in PATH. Install Node.js from https://nodejs.org')
    except Exception as e:
        logger.error(f'[WAWeb] Failed to start bridge: {e}')


def _watch_bridge():
    """Watch bridge process and auto-restart on crash."""
    global _proc
    if not _proc:
        return
    _proc.wait()
    exit_code = _proc.returncode
    _ready.clear()
    logger.warning(f'[WAWeb] Bridge exited with code {exit_code}, restarting in 5s...')
    import time
    time.sleep(5)
    start()


def stop():
    global _proc
    if _proc:
        _proc.terminate()
        try:
            _proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            _proc.kill()
            _proc.wait()
        _proc = None
        _ready.clear()
        _kill_stale_lock()
        logger.info('[WAWeb] Bridge stopped')


def _read_bridge_stderr():
    """Log stderr from the Node bridge (crash messages, module errors)."""
    if not _proc or not _proc.stderr:
        return
    for line in _proc.stderr:
        line = line.strip()
        if line:
            logger.error(f'[WAWeb] node stderr: {line}')


def _read_bridge_output():
    """Read JSON lines from the Node bridge and handle events."""
    global _qr_code
    if not _proc or not _proc.stdout:
        logger.error('[WAWeb] Bridge stdout is not available')
        return

    for line in _proc.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
            _handle_event(event)
        except json.JSONDecodeError:
            logger.debug(f'[WAWeb] bridge: {line}')

    # stdout EOF — bridge process has exited
    _ready.clear()
    logger.error('[WAWeb] Bridge stdout closed unexpectedly — bridge may have crashed')


def _handle_event(event: dict):
    global _qr_code
    etype = event.get('type')

    request_id = event.get('requestId')
    if request_id:
        with _pending_lock:
            pending = _pending_sends.get(request_id)
            if pending:
                pending['result'] = event   # set result BEFORE signalling
                pending['event'].set()

    if etype == 'qr':
        _qr_code = event.get('qr')
        logger.info('[WAWeb] QR code ready — scan with WhatsApp')

    elif etype == 'ready':
        _ready.set()
        _qr_code = None
        logger.info('[WAWeb] WhatsApp Web connected and ready')

    elif etype == 'message':
        _handle_incoming(event.get('data', {}))

    elif etype == 'disconnected':
        _ready.clear()
        logger.warning('[WAWeb] WhatsApp Web disconnected')

    elif etype == 'error':
        logger.error(f'[WAWeb] Bridge error: {event.get("error")}')


def _handle_incoming(msg: dict):
    """Process incoming WhatsApp message and relay to extension."""
    body = msg.get('body', '')
    from_number = msg.get('from', '').replace('@c.us', '')
    msg_id = msg.get('id', '')

    logger.info(f'[WAWeb] Message from {from_number}: {body[:80]}')

    answers = _parse_answers(body)

    # Store in conversation
    conv_id = _find_conversation(from_number)
    if conv_id:
        _conversations[conv_id].setdefault('messages', []).append({
            'timestamp': datetime.now().isoformat(),
            'from': from_number,
            'body': body,
            'id': msg_id,
            'answers': answers
        })

    # Relay to Chrome extension via WebSocket
    if _ws_relay:
        _ws_relay({
            'action': 'whatsappMessageReceived',
            'data': {
                'From': from_number,
                'Body': body,
                'MessageSid': msg_id,
                'conversationId': conv_id,
                'answers': answers,
                'timestamp': datetime.now().isoformat(),
                'senderType': 'user'
            }
        })

    # Send ack back
    if answers:
        send_message(from_number, f'✓ Received {len(answers)} answer(s). Applying now...')


# ── send ───────────────────────────────────────────────────

def send_message(to: str, text: str) -> bool:
    """Send a text message via the bridge."""
    return _send_to_bridge({'action': 'sendMessage', 'to': _normalize(to), 'text': text})


def send_image(to: str, image_base64: str, caption: str = '', mime_type: str = 'image/jpeg') -> bool:
    """Send a base64 image via the bridge."""
    return _send_to_bridge({
        'action': 'sendImage',
        'to': _normalize(to),
        'image': image_base64,
        'caption': caption,
        'mimeType': mime_type
    })


def _send_to_bridge(payload: dict) -> bool:
    if not _proc or _proc.poll() is not None:
        logger.error('[WAWeb] Bridge not running')
        return False
    if not _ready.is_set():
        logger.error('[WAWeb] Bridge not ready (WhatsApp not authenticated)')
        return False
    try:
        request_id = uuid.uuid4().hex
        payload['requestId'] = request_id
        pending = {'event': threading.Event(), 'result': None}
        with _pending_lock:
            _pending_sends[request_id] = pending
        line = json.dumps(payload) + '\n'
        _proc.stdin.write(line)
        _proc.stdin.flush()
        if not pending['event'].wait(timeout=60):
            logger.error(f'[WAWeb] Send timed out for request {request_id}')
            with _pending_lock:
                _pending_sends.pop(request_id, None)
            return False

        result = pending.get('result') or {}
        with _pending_lock:
            _pending_sends.pop(request_id, None)

        if result.get('type') == 'sent':
            return True

        logger.error(f"[WAWeb] Send failed for request {request_id}: {result.get('error', 'unknown error')}")
        return False
    except Exception as e:
        logger.error(f'[WAWeb] Send error: {e}')
        return False


# ── helpers ────────────────────────────────────────────────

def _normalize(number: str) -> str:
    """Convert +91XXXXXXXXXX → 91XXXXXXXXXX@c.us"""
    n = re.sub(r'[^\d]', '', number)
    return f'{n}@c.us'


def _parse_answers(text: str) -> list:
    answers = []
    for line in text.split('\n'):
        line = line.strip()
        if ':' not in line:
            continue
        parts = line.split(':', 1)
        q = re.search(r'\d+', parts[0])
        a = re.search(r'[A-Ea-e]', parts[1])
        if q and a:
            answers.append({
                'questionIndex': int(q.group()) - 1,
                'answer': a.group().upper(),
                'raw': line
            })
    return answers


def _find_conversation(from_number: str) -> str | None:
    for cid, c in _conversations.items():
        if c.get('to_number', '').replace('+', '') == from_number.replace('+', ''):
            return cid
    return None


# ── Node bridge setup ──────────────────────────────────────

def setup_wa_bridge():
    """
    Create the Node.js whatsapp-web.js bridge files.
    Call this once before start().
    """
    bridge_dir = _BRIDGE_JS.parent
    bridge_dir.mkdir(parents=True, exist_ok=True)

    pkg = bridge_dir / 'package.json'
    if not pkg.exists():
        pkg.write_text(json.dumps({
            'name': 'wa-bridge',
            'version': '1.0.0',
            'main': 'index.js',
            'dependencies': {
                'whatsapp-web.js': '^1.23.0',
                'qrcode-terminal': '^0.12.0'
            }
        }, indent=2))

    if not _BRIDGE_JS.exists():
        _BRIDGE_JS.write_text(r"""
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const readline = require('readline');

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

function emit(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    emit({ type: 'qr', qr });
});

client.on('ready', () => emit({ type: 'ready' }));

client.on('message', msg => {
    emit({ type: 'message', data: {
        id: msg.id._serialized,
        from: msg.from,
        body: msg.body,
        hasMedia: msg.hasMedia,
        timestamp: msg.timestamp
    }});
});

client.on('disconnected', reason => emit({ type: 'disconnected', reason }));

client.initialize();

// Read commands from stdin (JSON lines)
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async line => {
    let cmd;
    try {
        cmd = JSON.parse(line.trim());
        if (cmd.action === 'sendMessage') {
            await client.sendMessage(cmd.to, cmd.text);
            emit({ type: 'sent', requestId: cmd.requestId, action: cmd.action });
        } else if (cmd.action === 'sendImage') {
            const mimeType = cmd.mimeType || 'image/png';
            const fileName = mimeType === 'image/jpeg' ? 'screenshot.jpg' : 'screenshot.png';
            const media = new MessageMedia(mimeType, cmd.image, fileName);
            await client.sendMessage(cmd.to, media, { caption: cmd.caption || '' });
            emit({ type: 'sent', requestId: cmd.requestId, action: cmd.action });
        }
    } catch(e) {
        emit({ type: 'error', requestId: cmd && cmd.requestId ? cmd.requestId : undefined, error: e.message });
    }
});
""")

    logger.info(f'[WAWeb] Bridge files created at {bridge_dir}')
    logger.info('[WAWeb] Run: cd backend/wa_bridge && npm install')
