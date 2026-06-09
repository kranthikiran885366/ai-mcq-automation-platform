import importlib
import sys
import subprocess

print('--- TESSERACT (system) ---')
try:
    res = subprocess.run(['tesseract','--version'], capture_output=True, text=True, check=True)
    print(res.stdout.splitlines()[0])
except Exception as e:
    print('tesseract: not found or error:', e)

print('\n--- PYTHON OCR PACKAGE CHECKS ---')
checks = [
    ('pytesseract', 'pytesseract'),
    ('easyocr', 'easyocr'),
    ('torch', 'torch'),
    ('google-cloud-vision', 'google.cloud.vision'),
]
for name, mod in checks:
    try:
        m = importlib.import_module(mod)
        ver = getattr(m, '__version__', repr(m))
        print(f"{name}: OK - {ver}")
    except Exception as e:
        print(f"{name}: ERROR - {e}")
