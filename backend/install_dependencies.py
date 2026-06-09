#!/usr/bin/env python3
"""
Dependency installer for MCQ Automation Bot
This script will install all required dependencies
"""

import subprocess
import sys
import os

def install_package(package):
    """Install a package using pip"""
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", package])
        return True
    except subprocess.CalledProcessError:
        return False

def install_chromedriver():
    """Install ChromeDriver using webdriver-manager"""
    try:
        from webdriver_manager.chrome import ChromeDriverManager
        from selenium import webdriver
        from selenium.webdriver.chrome.service import Service
        
        # Install ChromeDriver
        driver_path = ChromeDriverManager().install()
        print(f"✅ ChromeDriver installed at: {driver_path}")
        
        # Test ChromeDriver
        service = Service(driver_path)
        options = webdriver.ChromeOptions()
        options.add_argument('--headless')
        options.add_argument('--no-sandbox')
        
        driver = webdriver.Chrome(service=service, options=options)
        driver.quit()
        print("✅ ChromeDriver test successful")
        
        return True
    except Exception as e:
        print(f"❌ ChromeDriver installation failed: {e}")
        return False

def main():
    """Main installation function"""
    print("🚀 Installing MCQ Automation Bot Dependencies...")
    print("=" * 50)
    
    # Required packages
    packages = [
        "Flask==2.3.3",
        "Flask-CORS==4.0.0",
        "opencv-python==4.8.1.78",
        "pytesseract==0.3.10",
        "openai==1.3.5",
        "google-generativeai==0.3.1",
        "selenium==4.15.2",
        "webdriver-manager==4.0.1",
        "numpy==1.24.3",
        "Pillow==10.0.1",
        "requests==2.31.0",
        "python-dotenv==1.0.0"
    ]
    
    print("📦 Installing Python packages...")
    failed_packages = []
    
    for package in packages:
        print(f"Installing {package}...")
        if install_package(package):
            print(f"✅ {package} installed successfully")
        else:
            print(f"❌ Failed to install {package}")
            failed_packages.append(package)
    
    if failed_packages:
        print(f"\n❌ Failed to install: {', '.join(failed_packages)}")
        print("Please install them manually using:")
        for package in failed_packages:
            print(f"pip install {package}")
    else:
        print("\n✅ All Python packages installed successfully!")
    
    # Install ChromeDriver
    print("\n🌐 Installing ChromeDriver...")
    if install_chromedriver():
        print("✅ ChromeDriver installed successfully!")
    else:
        print("❌ ChromeDriver installation failed")
        print("Please install Chrome browser and ChromeDriver manually")
        print("Chrome: https://www.google.com/chrome/")
        print("ChromeDriver: https://chromedriver.chromium.org/")
    
    # Check Tesseract OCR
    print("\n👁️ Checking Tesseract OCR...")
    try:
        import pytesseract
        pytesseract.image_to_string("test")
    except pytesseract.TesseractNotFoundError:
        print("❌ Tesseract OCR not found")
        print("Please install Tesseract OCR:")
        print("Windows: https://github.com/UB-Mannheim/tesseract/wiki")
        print("macOS: brew install tesseract")
        print("Ubuntu: sudo apt install tesseract-ocr")
    except:
        print("✅ Tesseract OCR is available")

    # Optional: install OCR extras (easyocr + torch + google-cloud-vision)
    if os.environ.get("INSTALL_OCR") == "1":
        print("\n🔎 INSTALL_OCR=1 detected — installing OCR extras (easyocr, torch, google-cloud-vision)...")
        ocr_failed = []

        # Install CPU-only PyTorch wheel from official CPU index (best compatibility)
        try:
            print("Installing CPU-only torch via PyTorch index...")
            install_cmd = f"{sys.executable} -m pip install torch --index-url https://download.pytorch.org/whl/cpu"
            ret = subprocess.call(install_cmd, shell=True)
            if ret != 0:
                print("❌ Failed to install torch via the CPU index")
                ocr_failed.append("torch")
            else:
                print("✅ torch installed")
        except Exception as e:
            print(f"❌ Exception while installing torch: {e}")
            ocr_failed.append("torch")

        # Install easyocr
        if install_package("easyocr==1.6.2"):
            print("✅ easyocr installed")
        else:
            print("❌ easyocr install failed")
            ocr_failed.append("easyocr")

        # Install Google Vision client
        if install_package("google-cloud-vision==3.3.0"):
            print("✅ google-cloud-vision installed")
        else:
            print("❌ google-cloud-vision install failed")
            ocr_failed.append("google-cloud-vision")

        if ocr_failed:
            print(f"\n⚠️ Some OCR extras failed to install: {', '.join(ocr_failed)}")
            print("You can try installing them manually or check the README/OCR_INSTALL.md for guidance.")
        else:
            print("\n✅ All OCR extras installed successfully")
    
    print("\n🎉 Installation complete!")
    print("Run 'python run_server.py' to start the server")

if __name__ == "__main__":
    main()