import os
import sys

print('Looking for Tesseract installation...')
paths_to_check = [
    r'C:\Program Files\Tesseract-OCR\tesseract.exe',
    r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
    r'C:\Users\{}\AppData\Local\Tesseract-OCR\tesseract.exe'.format(os.getenv('USERNAME')),
]

found_path = None
for path in paths_to_check:
    if os.path.exists(path):
        found_path = path
        print(f'✓ Found: {path}')
        break
    else:
        print(f'  Not found: {path}')

if found_path:
    print(f'\nTo enable Tesseract, add to backend/.env:\nTESSERACT_CMD={found_path}')
else:
    print('\n✗ Tesseract not found in common locations.')
    print('Please install from: https://github.com/UB-Mannheim/tesseract/wiki')
