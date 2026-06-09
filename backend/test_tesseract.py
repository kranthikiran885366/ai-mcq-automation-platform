import os
from dotenv import load_dotenv

# Load .env file to get TESSERACT_CMD
load_dotenv('backend/.env')

tesseract_cmd = os.getenv('TESSERACT_CMD')
if tesseract_cmd:
    print(f'TESSERACT_CMD from .env: {tesseract_cmd}')
    # Set the pytesseract path
    import pytesseract
    pytesseract.pytesseract.pytesseract_cmd = tesseract_cmd
    
    try:
        version = pytesseract.get_tesseract_version()
        print(f'✓ Tesseract found and accessible via pytesseract')
        print(f'  Version: {version}')
    except Exception as e:
        print(f'✗ pytesseract error: {e}')
else:
    print('✗ TESSERACT_CMD not set in .env')
