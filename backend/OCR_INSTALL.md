# Installing Tesseract and OCR dependencies (Windows)

This guide explains how to install the Tesseract binary and optional Python OCR packages used by the backend.

1) Install Tesseract (system binary)

Option A — Winget (Windows 10/11):

  Open an elevated PowerShell and run:

  ```powershell
  winget install --id UB Mannheim.Tesseract -e --source winget
  ```

Option B — Chocolatey (if installed):

  ```powershell
  choco install tesseract -y
  ```

Option C — Manual installer (UB Mannheim builds, recommended for Windows):

  Visit: https://github.com/UB-Mannheim/tesseract/wiki and download the latest installer, then run it.

After installation, verify `tesseract` is in your PATH by running in PowerShell:

```powershell
tesseract --version
```

2) Install Python OCR packages (optional, CPU-only PyTorch recommended)

If you want the `easyocr` fallback (more robust in some cases), install the CPU-only PyTorch wheel and `easyocr`:

```powershell
# On Windows, install CPU-only PyTorch from the official index
python -m pip install --upgrade pip
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
python -m pip install easyocr
python -m pip install -r requirements-ocr.txt
```

If you don't need `easyocr`, the backend already uses `pytesseract` (Python wrapper) which only requires the Tesseract binary. Ensure `pytesseract` is installed:

```powershell
python -m pip install -r requirements.txt
```

3) Environment variables

If Tesseract is installed in a non-standard location, set `TESSERACT_CMD` in your `.env` or environment:

```
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
```

4) Optional: run the install script

The project includes `backend/install_dependencies.py`. To attempt automatic installs:

```powershell
# Normal install for base deps
python backend\\install_dependencies.py
# To also install OCR extras (torch + easyocr) set the env var and run:
$env:INSTALL_OCR='1'; python backend\\install_dependencies.py
```
