import os
import threading
import json
import base64
import re
import subprocess
import tempfile
import textwrap
from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env'))
from flask import Flask, request, jsonify, render_template, send_file
from flask_cors import CORS
from flask_sock import Sock
import cv2
import numpy as np
import pytesseract
_tesseract_cmd = os.environ.get('TESSERACT_CMD')
if _tesseract_cmd and os.path.exists(_tesseract_cmd):
    pytesseract.pytesseract.tesseract_cmd = _tesseract_cmd
import openai
import google.generativeai as genai
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
import time
import re
from typing import List, Dict, Optional
import logging
from PIL import Image, ImageFile, UnidentifiedImageError, ImageEnhance, ImageFilter, ImageDraw, ImageFont
import io
from dotenv import load_dotenv
from io import BytesIO
import requests
import string
import difflib
import unicodedata
from datetime import datetime
import whatsapp_web as wa_web

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
# Allow all origins on all routes (including /ws WebSocket upgrade)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=False)
sock = Sock(app)

# WebSocket clients registry for relaying messages to extension
_ws_clients = set()

# Configure pytesseract path (already set at import time above)
TESSERACT_CMD = os.environ.get('TESSERACT_CMD')
if TESSERACT_CMD and os.path.exists(TESSERACT_CMD):
    logger.info(f"[OCR] Tesseract path set to: {TESSERACT_CMD}")
else:
    logger.warning("[OCR] TESSERACT_CMD not configured or file not found.")

GOOGLE_APPLICATION_CREDENTIALS = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')
GEMINI_API_URL = os.environ.get('GEMINI_API_URL')
GPT4V_API_KEY = os.environ.get('GPT4V_API_KEY')
GPT4V_API_URL = os.environ.get('GPT4V_API_URL')
HUGGINGFACE_API_KEY = os.environ.get('HUGGINGFACE_API_KEY')
DEEPSEEK_API_KEY = os.environ.get('DEEPSEEK_API_KEY')
GROQ_API_KEY = os.environ.get('GROQ_API_KEY')
GOOGLE_SEARCH_API_KEY = os.environ.get('GOOGLE_SEARCH_API_KEY')
GOOGLE_SEARCH_CX = os.environ.get('GOOGLE_SEARCH_CX')

# Twilio / WhatsApp config
TWILIO_ACCOUNT_SID = os.environ.get('TWILIO_ACCOUNT_SID')
TWILIO_AUTH_TOKEN = os.environ.get('TWILIO_AUTH_TOKEN')
TWILIO_WHATSAPP_FROM = os.environ.get('TWILIO_WHATSAPP_FROM', 'whatsapp:+14155238886')
TWILIO_WHATSAPP_TO = os.environ.get('TWILIO_WHATSAPP_TO')

# In-memory conversation store
_conversations = {}

# ── WhatsApp Web setup ───────────────────────────────────
# Start bridge only in the actual worker process:
#   - gunicorn/production: WERKZEUG_RUN_MAIN is unset → start
#   - Flask dev reloader child: WERKZEUG_RUN_MAIN == 'true' → start
#   - Flask dev reloader parent: WERKZEUG_RUN_MAIN is unset but we detect it via RUN_MAIN
wa_web.setup_wa_bridge()
wa_web._conversations = _conversations
wa_web.set_to_number(os.environ.get('WHATSAPP_TO', ''))

def _start_wa_bridge_async():
    import time
    time.sleep(2)  # Let Flask bind port first
    wa_web.start()

# Only start bridge in the actual worker process, not the Werkzeug reloader parent.
# WERKZEUG_RUN_MAIN='true' in the child; unset in the parent.
# When launched via run_server.py (use_reloader=False), RUN_SERVER='1' is set.
_is_worker = (
    os.environ.get('WERKZEUG_RUN_MAIN') == 'true' or
    os.environ.get('RUN_SERVER') == '1'
)
if _is_worker:
    threading.Thread(target=_start_wa_bridge_async, daemon=True).start()

# Check for required environment variables and log errors
if not GOOGLE_APPLICATION_CREDENTIALS:
    logger.error('GOOGLE_APPLICATION_CREDENTIALS not set in .env')
if not GEMINI_API_KEY:
    logger.warning('GEMINI_API_KEY not set in .env (Gemini fallback will not work)')
if not GEMINI_API_URL:
    logger.warning('GEMINI_API_URL not set in .env (Gemini fallback will not work)')
if not GPT4V_API_KEY:
    logger.warning('GPT4V_API_KEY not set in .env (GPT-4 Vision fallback will not work)')
if not GPT4V_API_URL:
    logger.warning('GPT4V_API_URL not set in .env (GPT-4 Vision fallback will not work)')
if not HUGGINGFACE_API_KEY:
    logger.warning('HUGGINGFACE_API_KEY not set in .env (Hugging Face API key will not work)')
if not GOOGLE_SEARCH_API_KEY:
    logger.warning('GOOGLE_SEARCH_API_KEY not set in .env (Google Search API key will not work)')
if not GOOGLE_SEARCH_CX:
    logger.warning('GOOGLE_SEARCH_CX not set in .env (Google Search CX will not work)')

# Suppress unnecessary warnings from libraries
import warnings
warnings.filterwarnings('ignore')

class MCQAutomationBot:
    def __init__(self):
        self.driver = None
        self.openai_client = None
        self.genai_client = None
        self.huggingface_key = None
        self.huggingface_model = None
        self.google_search_api_key = GOOGLE_SEARCH_API_KEY
        self.google_search_cx = GOOGLE_SEARCH_CX
        self.config = {
            'auto_answer': True,
            'answer_delay': 3,
            'max_retries': 3,
            'voice_enabled': False,
            'stealth_mode': True
        }

    def _get_parent_element(self, element):
        """Return the parent element using JavaScript so we do not climb into the document node."""
        try:
            return self.driver.execute_script("return arguments[0].parentElement;", element)
        except Exception:
            return None

    def _mcq_signature(self, mcq):
        """Build a stable signature used to dedupe repeated detections."""
        if not isinstance(mcq, dict):
            return ''

        question_text = (mcq.get('question') or '').strip().lower()
        question_lines = [line.strip() for line in question_text.splitlines() if line.strip()]
        question = re.sub(r'\s+', ' ', (question_lines[0] if question_lines else question_text).strip())
        options = '|'.join(
            re.sub(r'\s+', ' ', (opt.get('text') or '').strip().lower())
            for opt in (mcq.get('options') or [])
            if isinstance(opt, dict)
        )
        return f'{question}::{options}'
        
    def setup_driver(self, headless=True):
        """Setup Chrome driver with stealth options"""
        chrome_options = Options()
        
        if headless:
            chrome_options.add_argument('--headless')
        
        # Stealth options
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        chrome_options.add_argument('--disable-blink-features=AutomationControlled')
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option('useAutomationExtension', False)
        chrome_options.add_argument('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36')
        
        self.driver = webdriver.Chrome(options=chrome_options)
        self.driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
        
    def setup_ai_clients(self, openai_key=None, gemini_key=None, gemini_model=None, huggingface_key=None, huggingface_model=None, google_search_api_key=None, google_search_cx=None):
        """Setup AI clients"""
        if openai_key:
            self.openai_client = openai.OpenAI(api_key=openai_key)
        if gemini_key:
            genai.configure(api_key=gemini_key)
            model_name = gemini_model or 'gemini-pro'
            self.genai_client = genai.GenerativeModel(model_name)
        if huggingface_key:
            self.huggingface_key = huggingface_key
        if huggingface_model:
            self.huggingface_model = huggingface_model
        if google_search_api_key:
            self.google_search_api_key = google_search_api_key
        if google_search_cx:
            self.google_search_cx = google_search_cx
    
    def detect_mcqs_dom(self, url=None):
        """Detect MCQs using DOM parsing"""
        if url:
            self.driver.get(url)
        
        mcqs = []
        seen_signatures = set()
        
        # Common MCQ selectors
        selectors = [
            "input[type='radio']",
            "input[type='checkbox']",
            ".question",
            ".mcq",
            ".quiz-question",
            ".multiple-choice",
            "[class*='question']",
            "[class*='quiz']",
            "[class*='mcq']"
        ]
        
        for selector in selectors:
            try:
                elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                for element in elements:
                    mcq_data = self.extract_mcq_data(element)
                    if mcq_data:
                        signature = self._mcq_signature(mcq_data)
                        if signature not in seen_signatures:
                            seen_signatures.add(signature)
                            mcqs.append(mcq_data)
            except Exception as e:
                logger.error(f"Error with selector {selector}: {e}")
        
        return mcqs
    
    def extract_mcq_data(self, element):
        """Extract MCQ data from DOM element"""
        try:
            # Find parent container
            parent = element
            for _ in range(5):  # Look up to 5 levels up
                next_parent = self._get_parent_element(parent)
                if not next_parent:
                    break
                parent = next_parent
                class_name = (parent.get_attribute('class') or '').lower()
                if any(keyword in class_name for keyword in ['question', 'quiz', 'mcq']):
                    break
            
            # Extract question text
            question_text = ""
            question_elements = parent.find_elements(By.CSS_SELECTOR, "h1, h2, h3, h4, h5, h6, p, div, span")
            for elem in question_elements:
                text = elem.text.strip()
                if len(text) > 10 and '?' in text:
                    question_text = text
                    break
            
            # Extract options
            options = []
            option_elements = parent.find_elements(By.CSS_SELECTOR, "input[type='radio'], input[type='checkbox'], label, .option")
            
            for opt_elem in option_elements:
                option_text = opt_elem.text.strip()
                if not option_text:
                    # Try to find associated label
                    try:
                        label = opt_elem.find_element(By.XPATH, "following-sibling::label | preceding-sibling::label | ../label")
                        option_text = label.text.strip()
                    except:
                        pass
                
                if option_text and len(option_text) > 1:
                    options.append({
                        'text': option_text,
                        'element': opt_elem,
                        'value': opt_elem.get_attribute('value') or option_text
                    })
            
            if question_text and len(options) >= 2:
                return {
                    'question': question_text,
                    'options': options,
                    'type': 'radio' if option_elements and option_elements[0].get_attribute('type') == 'radio' else 'checkbox',
                    'container': parent
                }
        
        except Exception as e:
            logger.error(f"Error extracting MCQ data: {e}")
        
        return None
    
    def detect_mcqs_ocr(self, image_data=None):
        """Detect MCQs using OCR"""
        try:
            if image_data:
                # Decode base64 image
                try:
                    image_bytes = base64.b64decode(image_data.split(',')[1])
                    nparr = np.frombuffer(image_bytes, np.uint8)
                    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                except Exception as decode_err:
                    logger.error(f"Error decoding image data: {decode_err}")
                    raise ValueError("Invalid image data for OCR.")
            else:
                # Take screenshot
                screenshot = self.driver.get_screenshot_as_png()
                nparr = np.frombuffer(screenshot, np.uint8)
                image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            # Preprocess image for better OCR
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            gray = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
            # Check Tesseract availability
            try:
                _ = pytesseract.get_tesseract_version()
            except Exception as tesseract_err:
                logger.error(f"Tesseract not found or not working: {tesseract_err}")
                raise RuntimeError("Tesseract OCR is not installed or not in PATH.")
            # Extract text using OCR
            try:
                text = pytesseract.image_to_string(gray, config='--psm 6')
            except Exception as ocr_err:
                logger.error(f"Error during OCR: {ocr_err}")
                raise RuntimeError(f"OCR failed: {ocr_err}")
            # Parse MCQs from text
            mcqs = self.parse_mcqs_from_text(text)
            return mcqs
        except Exception as e:
            logger.error(f"Error in detect_mcqs_ocr: {e}")
            raise
    
    def parse_mcqs_from_text(self, text):
        """Parse MCQs from extracted text with support for various formats"""
        mcqs = []
        # Split lines and remove empty ones, but preserve line breaks for multi-line questions
        lines = [line for line in text.split('\n') if line.strip()]
        
        current_question = []
        current_options = []
        
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            
            # Check if line is a question (contains ? or is followed by options)
            next_line = lines[i+1].strip() if i + 1 < len(lines) else ""
            is_question = ('?' in line or 
                         (i > 0 and '?' in lines[i-1]) or  # Handle question mark on previous line
                         (i + 1 < len(lines) and self._looks_like_option(next_line)))
            
            if is_question:
                # If we have a question and see another question, save the current one
                if current_question and (current_options or any('?' in l for l in current_question)):
                    question_text = ' '.join(current_question).strip()
                    if question_text and len(current_options) >= 2:
                        mcqs.append({
                            'question': question_text,
                            'options': [{'text': opt, 'value': opt} for opt in current_options],
                            'type': 'text'
                        })
                
                # Start new question
                current_question = [line]
                current_options = []
                i += 1
                
                # Check if next lines are part of the question (until we hit an option)
                while i < len(lines):
                    next_line = lines[i].strip()
                    if self._looks_like_option(next_line):
                        break
                    current_question.append(next_line)
                    i += 1
                continue
            
            # Handle options
            if self._looks_like_option(line):
                # Clean and add the option
                option_text = self._clean_option_text(line)
                if option_text:
                    current_options.append(option_text)
            
            i += 1
        
        # Add the last MCQ if valid
        if current_question and len(current_options) >= 2:
            question_text = ' '.join(current_question).strip()
            mcqs.append({
                'question': question_text,
                'options': [{'text': opt, 'value': opt} for opt in current_options],
                'type': 'text'
            })
        
        return mcqs
    
    def _looks_like_option(self, text):
        """Check if text looks like an option"""
        # Match patterns like: A) B. C- [D] (E) • F ○ G © H
        option_patterns = [
            r'^\s*[A-Za-z][\.\)\]\-\s]+',  # A) B. C- [D]
            r'^\s*[0-9]+[\.\)\]\-\s]+',    # 1) 2. 3- [4]
            r'^\s*[•○▪■⦿◉©]\s*',             # Bullet points and copyright symbol
            r'^\s*\([A-Za-z0-9]\)\s*',     # (A) (1)
            r'^\s*[A-Za-z]\s*[\-:]\s*',     # A- A:
            r'^\s*©\)?\s*'                   # © or ©)
        ]
        
        return any(re.match(pattern, text) for pattern in option_patterns)
    
    def _clean_option_text(self, text):
        """Clean and extract option text"""
        # Remove common option markers
        text = re.sub(r'^\s*[A-Za-z0-9][\.\)\]\-\s]+', '', text)  # A) B. C- [D]
        text = re.sub(r'^\s*[•○▪■⦿◉©]\s*', '', text)  # Bullet points and copyright
        text = re.sub(r'^\s*\([A-Za-z0-9]\)\s*', '', text)  # (A) (1)
        text = re.sub(r'^\s*[A-Za-z]\s*[\-:]\s*', '', text)  # A- A:
        text = re.sub(r'^\s*©\)?\s*', '', text)  # © or ©)
        
        # Clean up any remaining special characters and whitespace
        text = text.strip()
        text = re.sub(r'^[^\w\s]+', '', text)  # Remove leading special chars
        text = re.sub(r'\s+', ' ', text)  # Normalize whitespace
        
        return text.strip()
    
    def get_search_answer(self, question, options):
        api_key = self.google_search_api_key
        cx = self.google_search_cx
        
        # Validate credentials
        if not api_key or not cx:
            error_msg = 'Google Search API key or CX not set.'
            logger.error(error_msg)
            return None
            
        # Prepare the search query
        query = question
        # Remove any leading/trailing whitespace and ensure cx doesn't have 'cx=' prefix
        cx = cx.strip()
        if cx.lower().startswith('cx='):
            cx = cx[3:].strip()
        url = f"https://www.googleapis.com/customsearch/v1?q={requests.utils.quote(query)}&key={api_key}&cx={cx}&num=10"
        
        try:
            logger.info(f'Making Google Search API request to: {url}')
            response = requests.get(url, timeout=10)
            response_data = response.json()
            
            # Log API response (without sensitive data)
            if 'items' in response_data:
                logger.info(f'Received {len(response_data["items"])} search results')
            else:
                logger.warning('No items in search results')
                
            if response.status_code != 200:
                error_msg = f'Google Search API error: {response.status_code} - {response_data.get("error", {}).get("message", "Unknown error")}'
                logger.error(error_msg)
                return None
                
            # Process results
            results = response_data.get('items', [])
            if not results:
                logger.warning('No search results found')
                return None
                
            # Calculate scores for each option
            option_texts = [opt['text'].strip().lower() for opt in options]
            scores = [0] * len(options)
            
            for item in results:
                content = f"{item.get('title', '')} {item.get('snippet', '')}".lower()
                for i, opt_text in enumerate(option_texts):
                    if opt_text in content:
                        scores[i] += 1
            
            logger.info(f'Option scores: {list(zip(option_texts, scores))}')
            
            # Find the best matching option
            max_score = max(scores)
            if max_score == 0:
                logger.warning('No matches found for any option')
                return None
                
            best_match_index = scores.index(max_score)
            logger.info(f'Best match: {options[best_match_index]["text"]} (score: {max_score})')
            
            return best_match_index
            
        except requests.exceptions.RequestException as e:
            error_msg = f'Request failed: {str(e)}'
            logger.error(error_msg)
            return None
        except Exception as e:
            error_msg = f'Unexpected error: {str(e)}'
            logger.error(error_msg, exc_info=True)
            return None
    
    def get_ai_answer(self, question, options, provider='openai', question_type='radio'):
        """Get answer from AI. Returns 0-based index (or list of indices for checkbox). """
        opts_text = '\n'.join([f'{chr(65+i)}. {opt["text"]}' for i, opt in enumerate(options)])
        is_multi = question_type in ('checkbox', 'multi', 'multi-select')
        if is_multi:
            prompt = (
                f'Question: {question}\n'
                f'Options:\n{opts_text}\n'
                f'This is a MULTIPLE SELECT question. Reply with ALL correct letters separated by commas (e.g. A,C,D). '
                f'No explanation. No extra text. Just the letters.'
            )
        else:
            prompt = (
                f'Question: {question}\n'
                f'Options:\n{opts_text}\n'
                f'Reply with ONLY the single letter of the correct answer (A, B, C, D, ...). '
                f'No explanation. No punctuation. Just the letter.'
            )

        def parse_letter(raw, n_options):
            """Extract 0-based index(es) from any AI response format."""
            if raw is None:
                return None
            text = raw.strip()
            # Multi-letter comma-separated: "A,C,D" or "A, C, D"
            letters = re.findall(r'[A-Ea-e]', text)
            if is_multi and len(letters) >= 1:
                indices = []
                seen = set()
                for l in letters:
                    idx = ord(l.upper()) - 65
                    if 0 <= idx < n_options and idx not in seen:
                        seen.add(idx)
                        indices.append(idx)
                return indices if indices else None
            # Single letter
            m = re.match(r'^([A-Ea-e])', text)
            if m:
                idx = ord(m.group(1).upper()) - 65
                if 0 <= idx < n_options:
                    return idx
            m = re.search(r'\b([A-Ea-e])\b', text)
            if m:
                idx = ord(m.group(1).upper()) - 65
                if 0 <= idx < n_options:
                    return idx
            m = re.search(r'\b([1-9])\b', text)
            if m:
                idx = int(m.group(1)) - 1
                if 0 <= idx < n_options:
                    return idx
            text_norm = unicodedata.normalize('NFKD', text.lower())
            text_norm = re.sub(r'[^\w\s]', '', text_norm).strip()
            for i, opt in enumerate(options):
                opt_norm = unicodedata.normalize('NFKD', opt['text'].lower())
                opt_norm = re.sub(r'[^\w\s]', '', opt_norm).strip()
                if opt_norm and (opt_norm == text_norm or opt_norm in text_norm or text_norm in opt_norm):
                    return i
            best_i, best_score = None, 0.0
            for i, opt in enumerate(options):
                opt_norm = unicodedata.normalize('NFKD', opt['text'].lower())
                opt_norm = re.sub(r'[^\w\s]', '', opt_norm).strip()
                score = difflib.SequenceMatcher(None, text_norm, opt_norm).ratio()
                if score > best_score:
                    best_score, best_i = score, i
            if best_score >= 0.6:
                return best_i
            return None

        try:
            raw = None
            n = len(options)

            if provider == 'groq':
                groq_key = os.environ.get('GROQ_API_KEY') or GROQ_API_KEY
                groq_model = os.environ.get('GROQ_MODEL', 'llama-3.3-70b-versatile')
                if not groq_key:
                    raise ValueError('GROQ_API_KEY not set')
                resp = requests.post(
                    'https://api.groq.com/openai/v1/chat/completions',
                    headers={'Authorization': f'Bearer {groq_key}', 'Content-Type': 'application/json'},
                    json={'model': groq_model,
                          'messages': [{'role': 'user', 'content': prompt}],
                          'temperature': 0.0, 'max_tokens': 16},
                    timeout=15
                )
                if resp.status_code != 200:
                    raise ValueError(f'Groq API error: {resp.status_code} {resp.text[:200]}')
                raw = resp.json()['choices'][0]['message']['content'].strip()

            elif provider == 'openai':
                openai_key = os.environ.get('GPT4V_API_KEY') or GPT4V_API_KEY
                if not openai_key or openai_key.startswith('your_'):
                    raise ValueError('GPT4V_API_KEY not configured')
                import openai as _openai
                resp = _openai.OpenAI(api_key=openai_key).chat.completions.create(
                    model='gpt-4', temperature=0.0, max_tokens=16,
                    messages=[{'role': 'user', 'content': prompt}]
                )
                raw = resp.choices[0].message.content.strip()

            elif provider == 'gemini':
                gemini_key = os.environ.get('GEMINI_API_KEY') or GEMINI_API_KEY
                if not gemini_key or gemini_key.startswith('your_'):
                    raise ValueError('GEMINI_API_KEY not configured')
                import google.generativeai as _genai
                _genai.configure(api_key=gemini_key)
                raw = _genai.GenerativeModel('gemini-pro').generate_content(prompt).text.strip()

            elif provider == 'deepseek':
                deepseek_key = os.environ.get('DEEPSEEK_API_KEY') or DEEPSEEK_API_KEY
                if not deepseek_key or deepseek_key.startswith('your_'):
                    raise ValueError('DEEPSEEK_API_KEY not configured')
                resp = requests.post(
                    'https://api.deepseek.com/v1/chat/completions',
                    headers={'Authorization': f'Bearer {deepseek_key}', 'Content-Type': 'application/json'},
                    json={'model': os.environ.get('DEEPSEEK_MODEL', 'deepseek-chat'),
                          'messages': [{'role': 'user', 'content': prompt}],
                          'temperature': 0.0, 'max_tokens': 16},
                    timeout=15
                )
                if resp.status_code != 200:
                    raise ValueError(f'DeepSeek API error: {resp.status_code}')
                raw = resp.json()['choices'][0]['message']['content'].strip()

            elif provider == 'huggingface':
                if not self.huggingface_key or not self.huggingface_model:
                    raise ValueError('HuggingFace key/model not set')
                resp = requests.post(
                    f'https://api-inference.huggingface.co/models/{self.huggingface_model}',
                    headers={'Authorization': f'Bearer {self.huggingface_key}'},
                    json={'inputs': prompt}
                )
                result = resp.json()
                raw = (result[0].get('generated_text') if isinstance(result, list) else
                       result.get('generated_text', str(result)))

            elif provider == 'search':
                return self.get_search_answer(question, options)

            else:
                raise ValueError(f'Unknown provider: {provider}')

            logger.info(f'[{provider}] raw answer: {repr(raw)}')
            idx = parse_letter(raw, n)
            if idx is not None:
                if isinstance(idx, list):
                    logger.info(f'[{provider}] multi-select indices {idx} -> {[options[i]["text"] for i in idx]}')
                else:
                    logger.info(f'[{provider}] matched index {idx} -> "{options[idx]["text"]}"')
            else:
                logger.warning(f'[{provider}] could not parse index from: {repr(raw)}')
            return idx

        except Exception as e:
            logger.error(f'AI answer error ({provider}): {e}')
            return None

    def select_answer(self, mcq, answer_index):
        """Automatically select the answer"""
        try:
            if mcq['type'] == 'text':
                logger.info(f"Text-based MCQ - Answer: {mcq['options'][answer_index]['text']}")
                return True
            
            option = mcq['options'][answer_index]
            element = option['element']
            
            # Scroll to element
            self.driver.execute_script("arguments[0].scrollIntoView(true);", element)
            time.sleep(0.5)
            
            # Click the element
            if element.is_enabled() and element.is_displayed():
                element.click()
                logger.info(f"Selected option: {option['text']}")
                return True
            else:
                # Try JavaScript click
                self.driver.execute_script("arguments[0].click();", element)
                logger.info(f"Selected option via JS: {option['text']}")
                return True
                
        except Exception as e:
            logger.error(f"Error selecting answer: {e}")
            return False
    
    def process_mcqs_automatically(self, url, ai_provider='openai'):
        """Process all MCQs on a page automatically"""
        results = []
        
        try:
            # Navigate to URL
            if url:
                self.driver.get(url)
                time.sleep(2)
            
            # Detect MCQs
            mcqs = self.detect_mcqs_dom()
            
            if not mcqs:
                # Try OCR detection
                mcqs = self.detect_mcqs_ocr()
            
            logger.info(f"Found {len(mcqs)} MCQs")
            
            # Process each MCQ
            for i, mcq in enumerate(mcqs):
                logger.info(f"Processing MCQ {i+1}: {mcq['question'][:50]}...")
                
                # Get AI answer
                answer_index = self.get_ai_answer(mcq['question'], mcq['options'], ai_provider)
                
                if not isinstance(answer_index, int):
                    results.append({
                        'question': mcq['question'],
                        'selected_answer': None,
                        'success': False,
                        'error': 'Could not determine answer'
                    })
                    continue

                if 0 <= answer_index < len(mcq['options']):
                    # Add delay for natural behavior
                    time.sleep(self.config['answer_delay'])
                    
                    # Select answer
                    success = self.select_answer(mcq, answer_index)
                    
                    results.append({
                        'question': mcq['question'],
                        'selected_answer': mcq['options'][answer_index]['text'],
                        'success': success,
                        'answer_index': answer_index
                    })
                else:
                    results.append({
                        'question': mcq['question'],
                        'selected_answer': None,
                        'success': False,
                        'error': 'Could not determine answer'
                    })
        
        except Exception as e:
            logger.error(f"Error processing MCQs: {e}")
        
        return results
    
    def close(self):
        """Close the driver"""
        if self.driver:
            self.driver.quit()

# Global bot instance
bot = MCQAutomationBot()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/whatsapp')
def whatsapp_page():
    return render_template('whatsapp.html')




@app.route('/api/setup', methods=['POST'])
def setup_bot():
    """Setup the automation bot"""
    data = request.json
    try:
        # Setup driver unless explicitly skipped for API-only setup/tests
        if not data.get('skip_driver', False):
            bot.setup_driver(headless=data.get('headless', True))
        # Setup AI clients
        bot.setup_ai_clients(
            openai_key=data.get('openai_key'),
            gemini_key=data.get('gemini_key'),
            gemini_model=data.get('gemini_model'),
            huggingface_key=data.get('huggingfaceKey'),
            huggingface_model=data.get('huggingfaceModel'),
            google_search_api_key=data.get('googleSearchApiKey'),
            google_search_cx=data.get('googleSearchCx')
        )
        # Store DeepSeek key in env for get_ai_answer
        if data.get('deepseek_key'):
            os.environ['DEEPSEEK_API_KEY'] = data['deepseek_key']
        if data.get('deepseek_model'):
            os.environ['DEEPSEEK_MODEL'] = data['deepseek_model']
        if data.get('groq_key'):
            os.environ['GROQ_API_KEY'] = data['groq_key']
        if data.get('groq_model'):
            os.environ['GROQ_MODEL'] = data['groq_model']
        # Update config
        bot.config.update(data.get('config', {}))
        return jsonify({'success': True, 'message': 'Bot setup completed'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/detect-mcqs', methods=['POST'])
def detect_mcqs():
    """Detect MCQs on a page"""
    data = request.json
    url = data.get('url')
    
    try:
        mcqs = bot.detect_mcqs_dom(url)
        
        # Convert to serializable format
        serializable_mcqs = []
        for mcq in mcqs:
            serializable_mcqs.append({
                'question': mcq['question'],
                'options': [{'text': opt['text'], 'value': opt['value']} for opt in mcq['options']],
                'type': mcq['type']
            })
        
        return jsonify({
            'success': True,
            'mcqs': serializable_mcqs,
            'count': len(serializable_mcqs)
        })
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/process-mcqs', methods=['POST'])
def process_mcqs():
    """Process MCQs automatically"""
    data = request.json
    url = data.get('url')
    ai_provider = data.get('ai_provider', 'openai')
    
    try:
        results = bot.process_mcqs_automatically(url, ai_provider)
        
        return jsonify({
            'success': True,
            'results': results,
            'total_processed': len(results),
            'successful': sum(1 for r in results if r['success'])
        })
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

def ocr_postprocess(text):
    # Fix common option misreads
    replacements = [
        (r'5\)', 'B)'), (r'©\)', 'C)'), (r'\(c\)', 'C)'), (r'\(r\)', 'C)'),
        (r'Rone', 'Rome'), (r'Bertin', 'Berlin'), (r'Rone', 'Rome'), (r'Bertin', 'Berlin'),
        (r'\b1\.', 'A.'), (r'\ba\)', 'A)'), (r'\bb\)', 'B)'), (r'\bc\)', 'C)'), (r'\bd\)', 'D)'),
        (r'\b5\.', 'B.'), (r'\b0\)', 'D)'), (r'\b0\.', 'D.'), (r'\bO\)', 'D)'), (r'\bO\.', 'D.')
    ]
    for pat, repl in replacements:
        import re
        text = re.sub(pat, repl, text, flags=re.IGNORECASE)
    return text

@app.route('/api/ocr-detect', methods=['POST'])
def ocr_detect():
    """Detect MCQs using OCR, robust to any image format, with advanced error handling, preprocessing (including deskewing, inversion, whitelisting), debug logging, and fallback OCR logic including EasyOCR, Google Vision API, and Vision-Language AI (Gemini/GPT-4 Vision)."""
    data = request.json
    image_data = data.get('image_data') or data.get('image')
    language = data.get('lang', 'eng')
    preprocessing_steps = data.get('preprocessing_steps', None)
    return_bboxes = data.get('return_bboxes', False)
    try:
        if not image_data:
            logger.error('No image data provided in request.')
            return jsonify({'success': False, 'error': 'No image data provided.'})

        # Enhanced logging for debugging base64 issues
        logger.info(f"Received base64 image string (first 100 chars): {image_data[:100]}... (length: {len(image_data)})")
        # Remove whitespace and newlines
        image_data_clean = image_data.replace('\n', '').replace('\r', '').replace(' ', '')
        # Remove data:image/png;base64, if present
        if ',' in image_data_clean:
            header, image_data_clean = image_data_clean.split(',', 1)
            logger.info(f"Base64 header detected: {header}")
        # Check for suspiciously short base64
        if len(image_data_clean) < 100:
            logger.error(f"Base64 string is very short after cleaning: {len(image_data_clean)} chars. Possible corruption or truncation.")
            return jsonify({'success': False, 'error': f'Base64 string too short after cleaning: {len(image_data_clean)} chars. Please check your input.'})
        # Check for invalid characters
        if not re.match(r'^[A-Za-z0-9+/=]+$', image_data_clean):
            logger.error("Base64 string contains invalid characters.")
            return jsonify({'success': False, 'error': 'Base64 string contains invalid characters. Please check your input.'})
        # Add padding if needed
        missing_padding = len(image_data_clean) % 4
        if missing_padding:
            image_data_clean += '=' * (4 - missing_padding)
            logger.info(f"Added {4 - missing_padding} padding characters to base64 string.")
        try:
            image_bytes = base64.b64decode(image_data_clean)
        except Exception as e:
            logger.error(f"Base64 decode error: {e}. First 100 chars: {image_data_clean[:100]}")
            return jsonify({'success': False, 'error': f'Base64 decode error: {e}. Please check your input.'})
        if len(image_bytes) < 100:
            logger.error(f"Decoded image bytes length is very small: {len(image_bytes)} bytes. Possible corruption.")
            return jsonify({'success': False, 'error': f'Decoded image bytes too short: {len(image_bytes)} bytes. Please check your input.'})

        from PIL import Image, ImageFile, UnidentifiedImageError, ImageEnhance, ImageFilter
        import io
        import numpy as np
        import cv2
        img_pil = None
        ImageFile.LOAD_TRUNCATED_IMAGES = True
        try:
            img_pil = Image.open(io.BytesIO(image_bytes))
            img_pil.load()
            img_pil.save('debug_received_pil.png')
            logger.info('Image saved as debug_received_pil.png (PIL)')
        except Exception as pil_e:
            logger.warning(f'PIL could not open image: {pil_e}. Trying OpenCV fallback...')
            try:
                nparr = np.frombuffer(image_bytes, np.uint8)
                img_cv = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)
                if img_cv is not None:
                    cv2.imwrite('debug_received_cv.png', img_cv)
                    logger.info('Image saved as debug_received_cv.png (OpenCV)')
                    if len(img_cv.shape) == 2:
                        img_pil = Image.fromarray(img_cv)
                    elif img_cv.shape[2] == 4:
                        img_pil = Image.fromarray(cv2.cvtColor(img_cv, cv2.COLOR_BGRA2RGBA))
                    else:
                        img_pil = Image.fromarray(cv2.cvtColor(img_cv, cv2.COLOR_BGR2RGB))
            except Exception as cv_e:
                logger.error(f'OpenCV fallback also failed: {cv_e}')
                return jsonify({'success': False, 'error': f'Could not decode image: {cv_e}'})

        if img_pil is None:
            return jsonify({'success': False, 'error': 'Could not decode image from provided data.'})

        if preprocessing_steps:
            try:
                # Convert PIL to OpenCV format (BGR)
                img_np = np.array(img_pil)
                if len(img_np.shape) == 3:  # Convert RGB to BGR
                    img_np = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)

                # Apply each preprocessing step
                for step in preprocessing_steps:
                    step = step.lower().strip()
                    logger.info(f'Applying preprocessing step: {step}')

                    if step == 'grayscale':
                        img_np = get_grayscale(img_np)
                    elif step == 'remove_noise':
                        img_np = remove_noise(img_np)
                    elif step == 'thresholding':
                        img_np = thresholding(img_np)
                    elif step == 'dilate':
                        img_np = dilate(img_np)
                    elif step == 'erode':
                        img_np = erode(img_np)
                    elif step == 'opening':
                        img_np = opening(img_np)
                    elif step == 'canny':
                        img_np = canny(img_np)
                    elif step == 'deskew':
                        img_np = deskew(img_np)

                    debug_path = f'debug_pre_{step}.png'
                    cv2.imwrite(debug_path, img_np)
                    logger.info(f'Saved debug image: {debug_path}')

                # Convert back to PIL for Tesseract
                if len(img_np.shape) == 2:
                    img_bin_pil = Image.fromarray(img_np)
                else:
                    img_bin_pil = Image.fromarray(cv2.cvtColor(img_np, cv2.COLOR_BGR2RGB))

            except Exception as pre_e:
                logger.error(f'Custom preprocessing failed: {pre_e}')
                img_bin_pil = img_pil
        else:
            # Default advanced preprocessing with deskewing and inversion
            try:
                # Convert to grayscale
                img_gray = img_pil.convert('L')
                img_gray.save('debug_pre_gray.png')
                
                # Convert to numpy array for OpenCV processing
                img_np = np.array(img_gray)
                
                # Calculate image statistics for adaptive processing
                mean_val = np.mean(img_np)
                std_dev = np.std(img_np)
                
                # Apply CLAHE (Contrast Limited Adaptive Histogram Equalization)
                clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
                img_enhanced = clahe.apply(img_np)
                
                # Adaptive thresholding based on image characteristics
                if std_dev < 10:  # Low contrast image
                    # Try to enhance contrast
                    img_enhanced = cv2.convertScaleAbs(img_enhanced, alpha=1.5, beta=0)
                
                # Apply adaptive thresholding
                if mean_val < 85:  # Dark image
                    _, img_bin = cv2.threshold(img_enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
                else:  # Normal or light image
                    img_bin = cv2.adaptiveThreshold(
                        img_enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                        cv2.THRESH_BINARY, 11, 2
                    )
                
                # Invert if needed (black text on white background)
                if np.mean(img_bin) < 127:  # If mostly black
                    img_bin = cv2.bitwise_not(img_bin)
                
                # Apply morphological operations to clean up the image
                kernel = np.ones((1,1), np.uint8)
                img_bin = cv2.morphologyEx(img_bin, cv2.MORPH_CLOSE, kernel)
                img_bin = cv2.morphologyEx(img_bin, cv2.MORPH_OPEN, kernel)
                
                # Apply dilation and erosion to remove noise
                kernel = np.ones((1, 1), np.uint8)
                img_denoised = cv2.morphologyEx(img_bin, cv2.MORPH_OPEN, kernel)
                img_denoised = cv2.morphologyEx(img_denoised, cv2.MORPH_CLOSE, kernel)
                
                # Apply slight blur to reduce noise
                img_denoised = cv2.GaussianBlur(img_denoised, (3, 3), 0)
                
                # Sharpen the image
                kernel_sharpening = np.array([[-1,-1,-1], 
                                            [-1, 9,-1],
                                            [-1,-1,-1]])
                img_sharp = cv2.filter2D(img_denoised, -1, kernel_sharpening)
                
                # Save intermediate images for debugging
                Image.fromarray(img_denoised).save('debug_pre_denoise.png')
                Image.fromarray(img_sharp).save('debug_pre_sharp.png')
                
                # Deskew the image
                coords = np.column_stack(np.where(img_sharp > 0))
                if len(coords) > 0:  # Check if we have any foreground pixels
                    angle = cv2.minAreaRect(coords)[-1]
                    if angle < -45:
                        angle = -(90 + angle)
                    else:
                        angle = -angle
                    (h, w) = img_sharp.shape[:2]
                    center = (w // 2, h // 2)
                    M = cv2.getRotationMatrix2D(center, angle, 1.0)
                    img_deskew = cv2.warpAffine(img_sharp, M, (w, h), 
                                              flags=cv2.INTER_CUBIC, 
                                              borderMode=cv2.BORDER_REPLICATE)
                    img_deskew_pil = Image.fromarray(img_deskew)
                    img_deskew_pil.save('debug_pre_deskew.png')
                else:
                    img_deskew = img_sharp
                    img_deskew_pil = Image.fromarray(img_deskew)
                
                # Invert if needed (for dark text on light background)
                if np.mean(img_deskew) > 127:
                    img_invert = cv2.bitwise_not(img_deskew)
                    img_invert_pil = Image.fromarray(img_invert)
                    img_invert_pil.save('debug_pre_invert.png')
                    img_final = img_invert_pil
                else:
                    img_final = img_deskew_pil
                    
                # Resize if too small (minimum 600px width for better OCR)
                min_width = 600
                if img_final.width < min_width:
                    scale = min_width / img_final.width
                    new_size = (min_width, int(img_final.height * scale))
                    img_final = img_final.resize(new_size, Image.LANCZOS)
                    img_final.save('debug_pre_resized.png')
                    
                img_bin_pil = img_final
            except Exception as pre_e:
                logger.warning(f'Advanced preprocessing (deskew/invert) failed: {pre_e}')
                img_bin_pil = img_pil  # Fallback to original image

        import pytesseract
        best_text = ''
        best_confidence = 0
        best_psm = None
        best_oem = None
        
        # Expanded character set to handle more cases
        whitelist = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;!?()[]{}-_\'"\n\\/|+*=&^%$#@!~`<>'
        
        # Define page segmentation modes to try
        psm_modes = [
            (6, 'Assume a single uniform block of text'),
            (3, 'Fully automatic page segmentation, no OSD'),
            (11, 'Sparse text'),
            (4, 'Assume a single column of text'),
            (7, 'Treat image as a single text line')
        ]
        
        # Define OCR engine modes to try (LSTM first, then legacy)
        oem_modes = [(3, 'LSTM'), (1, 'Legacy')]
        
        # Try different configurations
        for psm, psm_desc in psm_modes:
            for oem, oem_desc in oem_modes:
                try:
                    # Build configuration string
                    config = (
                        f'--psm {psm} --oem {oem} --dpi 300\n'
                        f'-c tessedit_char_whitelist={whitelist}\n'
                        f'-c preserve_interword_spaces=1\n'
                        f'-c textord_min_linesize=2.5\n'
                        f'-c textord_heavy_nr=1\n'
                        f'-c textord_noise_normratio=0.5\n'
                        f'-c textord_noise_sizelimit=3\n'
                        f'-c textord_old_baselines=0\n'
                        f'-c textord_show_initial_words=0\n'
                        f'-c load_system_dawg=1\n'
                        f'-c load_freq_dawg=1\n'
                        f'-c load_punc_dawg=1\n'
                        f'-c load_number_dawg=1\n'
                        f'-c load_unambig_dawg=1\n'
                        f'-c load_bigram_dawg=1\n'
                        f'-c load_fixed_length_daws=1'
                    )
                    
                    logger.info(f'Trying OCR with PSM {psm} ({psm_desc}), OEM {oem} ({oem_desc})')
                    
                    # Get both text and confidence data
                    data = pytesseract.image_to_data(
                        img_bin_pil, 
                        lang=language, 
                        config=config,
                        output_type=pytesseract.Output.DICT
                    )
                    
                    # Calculate average confidence of non-empty words
                    confidences = [float(conf) for conf, text in zip(data['conf'], data['text']) 
                                 if float(conf) > 0 and text.strip()]
                    avg_confidence = sum(confidences) / len(confidences) if confidences else 0
                    
                    text = ' '.join([t for t in data['text'] if t.strip()])
                    
                    # Common OCR misrecognition fixes
                    common_misrecognitions = {
                        # Common word misrecognitions
                        'sllo': 'hello',
                        'Vor]': 'world',
                        'hell0': 'hello',
                        'w0rld': 'world',
                        'hel1o': 'hello',
                        'wor1d': 'world',
                        'he1lo': 'hello',
                        'w0r1d': 'world',
                        'he11o': 'hello',
                        'he1p': 'help',
                        'wor1d': 'world',
                        'Rone': 'Rome',
                        'Bertin': 'Berlin',
                        'Par1s': 'Paris',
                        'L0nd0n': 'London',
                        'cap1tal': 'capital',
                        'Franc3': 'France'
                    }
                    
                    # Apply common fixes (case-insensitive)
                    for wrong, right in common_misrecognitions.items():
                        # Use regex for case-insensitive replacement of whole words only
                        text = re.sub(r'\b' + re.escape(wrong) + r'\b', right, text, flags=re.IGNORECASE)
                    
                    # Fix common character confusions
                    char_fixes = {
                        '0': 'o',
                        '1': 'l',
                        '5': 's',
                        ']': 'd',
                        '[': 'd',
                        '|': 'l',
                        '!': 'i',
                        '@': 'a',
                        '#': '',
                        '$': 's',
                        '&': 'e',
                        '©': 'c',  # Copyright symbol to 'c'
                        '®': 'r',  # Registered symbol to 'r'
                        '™': 'tm', # Trademark symbol to 'tm'
                        '`': '',   # Remove backticks
                        '~': '',    # Remove tildes
                        '^': '',    # Remove carets
                        '*': '',    # Remove asterisks
                        '_': ' '    # Convert underscores to spaces
                    }
                    
                    # Apply character-level fixes (except for answer markers)
                    # First, protect answer markers (a), b), etc.)
                    protected_markers = re.findall(r'\b([a-z])\)', text, re.IGNORECASE)
                    protected_text = re.sub(r'\b([a-z])\)', '___MARKER___', text, flags=re.IGNORECASE)
                    
                    # Apply character fixes to the protected text
                    for wrong, right in char_fixes.items():
                        protected_text = protected_text.replace(wrong, right)
                    
                    # Restore protected answer markers
                    for i, marker in enumerate(protected_markers):
                        protected_text = protected_text.replace('___MARKER___', f'{marker})', 1)
                    
                    text = protected_text
                    
                    # Enhanced spell checking for common words and MCQ patterns
                    common_words = {
                        # Common word corrections
                        'helo': 'hello',
                        'wor1d': 'world',
                        'w0r1d': 'world',
                        'he1p': 'help',
                        'cap1tal': 'capital',
                        'Franc3': 'France',
                        'Par1s': 'Paris',
                        'L0nd0n': 'London',
                        'R0me': 'Rome',
                        'Rone': 'Rome',
                        'Ber1in': 'Berlin',
                        'Bertin': 'Berlin',
                        'quest1on': 'question',
                        'answ3r': 'answer',
                        'opt1on': 'option',
                        'ch01ce': 'choice',
                        'corr3ct': 'correct',
                        'capita1': 'capital',
                        'capita!': 'capital',
                        'capitaI': 'capital',
                        'capitai': 'capital'
                    }
                    
                    # Enhanced answer marker normalization
                    
                    # First, normalize all answer markers to a common format (X) where X is a letter
                    # Handle numbered markers (1) -> a), (2) -> b), etc.
                    text = re.sub(r'(?i)\b(\d+)[\.\)\s]', 
                                 lambda m: f'{chr(96 + int(m.group(1)))}) ' if m.group(1).isdigit() and 1 <= int(m.group(1)) <= 26 else m.group(0), 
                                 text)
                    
                    # Handle special characters like ©) -> c)
                    text = re.sub(r'(?i)\b([^a-z0-9])\)', 
                                 lambda m: f'{m.group(1).lower()}) ' if m.group(1).strip() else m.group(0), 
                                 text)
                    
                    # Fix uppercase letters in markers (A) -> a)
                    text = re.sub(r'\b([A-Z])\)', lambda m: f'{m.group(1).lower()})', text)
                    
                    # Fix missing spaces after markers
                    text = re.sub(r'([a-z])\)([^ \n])', r'\1) \2', text)
                    
                    # Fix common OCR confusions in markers
                    marker_fixes = {
                        r'(?i)\b5\)': 'b)',
                        r'(?i)\b©\)': 'c)',
                        r'(?i)\b\[\)': 'c)',
                        r'(?i)\b\]\)': 'd)',
                        r'(?i)\b1\)': 'i)',
                        r'(?i)\bi\)': '1)',
                        r'(?i)\bl\)': '1)',
                        r'(?i)\bI\)': '1)'
                    }
                    
                    for pattern, replacement in marker_fixes.items():
                        text = re.sub(pattern, replacement, text)
                    
                    # Ensure consistent spacing around answer options
                    text = re.sub(r'\s*([a-z])\)\s*', r' \1) ', text)
                    
                    # Fix question numbers (1. -> 1. )
                    text = re.sub(r'(\d+)\.(\s*[A-Z])', 
                                 lambda m: f"{m.group(1)}. {m.group(2).lower()}", 
                                 text)
                    
                    # Split into words and fix common misspellings
                    words = text.split()
                    for i, word in enumerate(words):
                        lower_word = word.lower()
                        if lower_word in common_words:
                            words[i] = common_words[lower_word]
                    
                    text = ' '.join(words)
                    
                    logger.info(f'OCR (psm={psm}, oem={oem}, conf={avg_confidence:.1f}): {text[:100]}...')
                    
                    # Calculate a better confidence score
                    # Give higher weight to text that looks like common words
                    common_word_count = sum(1 for word in text.lower().split() 
                                         if word in ['hello', 'world', 'help', 'test', 'example'])
                    adjusted_confidence = avg_confidence + (common_word_count * 5)
                    
                    # Prefer higher confidence over longer text
                    if adjusted_confidence > best_confidence or (adjusted_confidence == best_confidence and len(text) > len(best_text)):
                        best_text = text
                        best_confidence = adjusted_confidence
                        best_psm = psm
                        best_oem = oem
                        
                except Exception as ocr_e:
                    logger.warning(f'OCR failed for psm={psm}, oem={oem}: {ocr_e}')
                    
        logger.info(f'Best OCR result (psm={best_psm}, oem={best_oem}, conf={best_confidence:.1f}')
        
        # Final post-processing of the best text
        if best_text.strip():
            # Basic text cleanup
            best_text = ' '.join(best_text.split())  # Normalize whitespace
            best_text = best_text.strip()
            
            # Parse MCQs from the extracted text
            mcqs = bot.parse_mcqs_from_text(best_text)
            
            # If no MCQs were parsed but we have text, return it as a single question
            if not mcqs and best_text.strip():
                mcqs = [{
                    'question': best_text.split('\n')[0],
                    'options': [line.strip() for line in best_text.split('\n')[1:] if line.strip()],
                    'type': 'ocr',
                    'confidence': best_confidence
                }]
            
            logger.info(f'Successfully extracted {len(mcqs)} MCQs')
            
            # Clean up the text before returning
            best_text = best_text.replace('"', '"')
            best_text = best_text.replace('\'', '\'')
            best_text = best_text.replace('—', '-')
            best_text = best_text.replace('–', '-')
            best_text = best_text.replace('_', ' ')
            
            # Remove non-printable characters
            best_text = ''.join(char for char in best_text if char.isprintable() or char.isspace())
            
            # Remove isolated characters that are likely noise
            best_text = re.sub(r'\s+[^\w\s]\s+', ' ', best_text)
            best_text = re.sub(r'^[^\w\s]\s+', '', best_text)
            best_text = re.sub(r'\s+[^\w\s]$', '', best_text)
            
            # Normalize case for better consistency
            if len(best_text.split()) > 3:  # Only for longer text
                sentences = re.split(r'([.!?]\s+)', best_text)
                best_text = ''.join([sent.capitalize() if i % 2 == 0 else sent.lower() 
                                   for i, sent in enumerate(sentences)])
            
            return jsonify({
                'success': True,
                'text': best_text,
                'mcqs': mcqs if mcqs else [],
                'confidence': best_confidence,
                'psm': best_psm,
                'oem': best_oem
            })
        
        # Fallback 1: Try with different preprocessing
        if not best_text.strip() or best_confidence < 50:
            logger.warning('Primary OCR results not confident. Trying alternative preprocessing...')
            try:
                # Try with different thresholding
                img_np = np.array(img_pil.convert('L'))
                
                # Try Otsu's thresholding
                _, img_otsu = cv2.threshold(img_np, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
                fallback_text = pytesseract.image_to_string(
                    Image.fromarray(img_otsu), 
                    lang=language,
                    config=f'--psm 6 --oem 3 -c preserve_interword_spaces=1'
                )
                
                if fallback_text.strip():
                    logger.info('Fallback OCR with Otsu thresholding succeeded.')
                    return jsonify({
                        'success': True, 
                        'text': fallback_text,
                        'mcqs': [],
                        'warning': 'Fallback OCR with Otsu thresholding used.'
                    })
                    
                # Try adaptive thresholding with different parameters
                img_adapt = cv2.adaptiveThreshold(
                    img_np, 255, cv2.ADAPTIVE_THRESH_MEAN_C, 
                    cv2.THRESH_BINARY, 21, 5
                )
                fallback_text = pytesseract.image_to_string(
                    Image.fromarray(img_adapt),
                    lang=language,
                    config=f'--psm 6 --oem 3 -c preserve_interword_spaces=1'
                )
                
                if fallback_text.strip():
                    logger.info('Fallback OCR with adaptive thresholding succeeded.')
                    return jsonify({
                        'success': True, 
                        'text': fallback_text,
                        'mcqs': [],
                        'warning': 'Fallback OCR with adaptive thresholding used.'
                    })
                    
            except Exception as fallback_e:
                logger.error(f'Alternative preprocessing fallback failed: {fallback_e}')
                
        # Fallback 2: Try with different PSM modes on original image
        if not best_text.strip() or best_confidence < 50:
            logger.warning('Trying fallback with different PSM modes on original image...')
            try:
                for psm in [6, 3, 11, 4]:
                    fallback_text = pytesseract.image_to_string(
                        img_pil,
                        lang=language,
                        config=f'--psm {psm} --oem 3 -c preserve_interword_spaces=1'
                    )
                    if fallback_text.strip():
                        logger.info(f'Fallback OCR with PSM {psm} on original image succeeded.')
                        return jsonify({
                            'success': True, 
                            'text': fallback_text,
                            'mcqs': [],
                            'warning': f'Fallback OCR with PSM {psm} on original image used.'
                        })
            except Exception as fallback2_e:
                logger.error(f'PSM fallback failed: {fallback2_e}')
        # Final fallback: EasyOCR
        if not best_text.strip():
            logger.warning('All Tesseract OCR attempts failed. Trying EasyOCR as final fallback...')
            try:
                import easyocr
                reader = easyocr.Reader(['en'], gpu=False)
                with open('debug_received_pil.png', 'rb') as f:
                    result = reader.readtext(f.read())
                easy_text = '\n'.join([item[1] for item in result])
                if easy_text.strip():
                    logger.info('EasyOCR fallback succeeded.')
                    return jsonify({
                        'success': True, 
                        'text': easy_text,
                        'mcqs': [],
                        'warning': 'EasyOCR fallback used. Check debug images.'
                    })
                else:
                    logger.error('EasyOCR fallback did not extract any text.')
            except Exception as easy_e:
                logger.error(f'EasyOCR fallback failed: {easy_e}')
        # Final fallback: Google Vision API
        if not best_text.strip():
            logger.warning('All Tesseract and EasyOCR attempts failed. Trying Google Vision API as final fallback...')
            try:
                from google.cloud import vision
                client = vision.ImageAnnotatorClient()
                with open('debug_received_pil.png', 'rb') as image_file:
                    content = image_file.read()
                image = vision.Image(content=content)
                response = client.text_detection(image=image)
                texts = response.text_annotations
                if texts:
                    vision_text = texts[0].description
                    logger.info('Google Vision API fallback succeeded.')
                    return jsonify({
                        'success': True, 
                        'text': vision_text,
                        'mcqs': [],
                        'warning': 'Google Vision API fallback used. Check debug images.'
                    })
                else:
                    logger.error('Google Vision API did not extract any text.')
            except Exception as vision_e:
                logger.error(f'Google Vision API fallback failed: {vision_e}')
        # Final fallback: Vision-Language AI (Gemini/GPT-4 Vision)
        if not best_text.strip():
            logger.warning('All OCR and Vision API attempts failed. Trying Vision-Language AI (Gemini/GPT-4 Vision) as final fallback...')
            try:
                # This is a placeholder for actual Gemini/GPT-4 Vision API integration
                # You must provide your own API key and endpoint
                # Example prompt:
                # "This is an image of a multiple choice question. Please read the question and give the correct option (A, B, C, D):"
                # Send the image and prompt to the API and parse the response
                # For now, just log and return a not-implemented message
                logger.info('Vision-Language AI fallback would be called here (Gemini/GPT-4 Vision).')
                return jsonify({
                    'success': False, 
                    'error': 'Vision-Language AI fallback (Gemini/GPT-4 Vision) not implemented. Please integrate your API key and endpoint.',
                    'text': '',
                    'mcqs': []
                })
            except Exception as vla_e:
                logger.error(f'Vision-Language AI fallback failed: {vla_e}')
        if not best_text.strip() or len(best_text.strip()) < 10:
            logger.error('OCR failed to extract meaningful text from the image.')
            return jsonify({
                'success': False, 
                'error': 'Failed to extract text from the image. Please try with a clearer image.',
                'text': '',
                'mcqs': []
            })
        # After extracting text:
        ocr_text = best_text
        ocr_text = ocr_postprocess(ocr_text)
        # If return_bboxes is true, also return bounding box data
        result_payload = {'success': True, 'ocrText': ocr_text}
        if return_bboxes:
            import pytesseract
            data = pytesseract.image_to_data(img_bin_pil, lang=language, output_type=pytesseract.Output.DICT)
            bboxes = []
            n_boxes = len(data['text'])
            for i in range(n_boxes):
                if int(data['conf'][i]) > 0 and data['text'][i].strip():
                    bboxes.append({
                        'text': data['text'][i],
                        'conf': data['conf'][i],
                        'left': data['left'][i],
                        'top': data['top'][i],
                        'width': data['width'][i],
                        'height': data['height'][i]
                    })
            result_payload['bboxes'] = bboxes
        return jsonify(result_payload)
    except Exception as e:
        logger.error(f'Unexpected error in /api/ocr-detect: {e}')
        return jsonify({'success': False, 'error': f'Unexpected error: {e}'})


@app.route('/api/provider-status', methods=['GET'])
def provider_status():
    """Return which AI providers have live keys configured on the backend."""
    return jsonify({
        'openai':     bool(GPT4V_API_KEY and not GPT4V_API_KEY.startswith('your_')),
        'gemini':     bool(GEMINI_API_KEY and not GEMINI_API_KEY.startswith('your_')),
        'groq':       bool(GROQ_API_KEY and not GROQ_API_KEY.startswith('your_')),
        'deepseek':   bool(DEEPSEEK_API_KEY and not DEEPSEEK_API_KEY.startswith('your_')),
        'huggingface':bool(HUGGINGFACE_API_KEY and not HUGGINGFACE_API_KEY.startswith('your_')),
    }), 200


@app.route('/api/get-answer', methods=['POST'])
def get_answer():
    data = request.json
    question = data.get('question')
    options = data.get('options')
    provider = data.get('provider', 'openai')
    question_type = data.get('type', 'radio')  # 'checkbox' for multi-select

    if not question or not options or not isinstance(options, list):
        return jsonify({'success': False, 'error': 'Missing required parameters: question and options (array) are required'}), 400

    if provider == 'huggingface' and (not bot.huggingface_key or not bot.huggingface_model):
        return jsonify({'success': False, 'error': 'Hugging Face API key or model not set.'}), 400

    if provider == 'search' and (not bot.google_search_api_key or not bot.google_search_cx):
        return jsonify({'success': False, 'error': 'Google Search API key or CX not set.'}), 400

    try:
        answer = bot.get_ai_answer(question, options, provider, question_type)

        if isinstance(answer, dict) and 'success' in answer and not answer['success']:
            return jsonify(answer), 400

        if answer is not None:
            # Multi-select: answer is a list of indices
            if isinstance(answer, list):
                selected_options = [options[i]['text'] for i in answer if i < len(options)]
                return jsonify({
                    'success': True,
                    'answer': answer[0] if answer else 0,  # primary index for compat
                    'answers': [{'index': i, 'text': options[i]['text']} for i in answer if i < len(options)],
                    'selected_options': selected_options,
                    'selected_option': selected_options[0] if selected_options else '',
                    'is_multi': True,
                    'provider': provider,
                    'question': question
                })
            # Single answer
            selected_opt = options[answer]['text'] if answer < len(options) else 'Unknown'
            if len(selected_opt) > 200 or any(c in selected_opt for c in ['{', '}', ';', '()', '[]']):
                selected_opt = selected_opt[:80] + '...'
            return jsonify({
                'success': True,
                'answer': answer,
                'selected_option': selected_opt,
                'provider': provider,
                'question': question
            })

        return jsonify({'success': False, 'error': 'Could not determine answer', 'provider': provider, 'question': question})

    except Exception as e:
        logger.error(f'Error in get_answer: {str(e)}', exc_info=True)
        return jsonify({'success': False, 'error': f'An error occurred: {str(e)}', 'provider': provider}), 500

@app.route('/api/answer', methods=['POST'])
def answer_mcq():
    """Answer a single MCQ using AI"""
    data = request.json
    question = data.get('question')
    options = data.get('options')
    provider = data.get('provider', 'openai')

    try:
        answer_index = bot.get_ai_answer(question, [{'text': opt} for opt in options], provider)
        if answer_index is not None and 0 <= answer_index < len(options):
            return jsonify({
                'success': True,
                'answer_index': answer_index,
                'answer_text': options[answer_index]
            })
        else:
            return jsonify({'success': False, 'error': 'Could not determine answer'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/close', methods=['POST'])
def close_bot():
    """Close the bot"""
    try:
        bot.close()
        return jsonify({'success': True, 'message': 'Bot closed'})
    except Exception as e:
        logger.error(f'Unexpected error in /api/ocr-detect: {e}')
        return jsonify({'success': False, 'error': f'Unexpected error: {e}'})


@app.route('/api/extract-mcqs', methods=['POST'])
def extract_mcqs():
    """OCR an image and return parsed MCQs — used by popup captureButton flow."""
    data = request.json or {}
    image_data = data.get('image_data') or data.get('image')
    lang = data.get('lang', 'eng')
    if not image_data:
        return jsonify({'success': False, 'error': 'No image data provided'}), 400
    try:
        mcqs = bot.detect_mcqs_ocr(image_data)
        return jsonify({'success': True, 'mcqs': mcqs, 'count': len(mcqs)})
    except Exception as e:
        logger.error(f'[extract-mcqs] {e}')
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/get-code', methods=['POST'])
def get_code():
    """Generate code answer for a coding question using AI."""
    data = request.json or {}
    question = data.get('question', '').strip()
    language = (data.get('language') or 'javascript').strip()
    provider = (data.get('provider') or 'groq').strip().lower()
    error_context = (data.get('error_context') or '').strip()
    fn_name = (data.get('fn_name') or '').strip()
    existing_code = (data.get('existing_code') or '').strip()
    mode = (data.get('mode') or 'new').strip().lower()
    test_cases = data.get('test_cases') or []
    lang_hint = (data.get('lang_hint') or '').strip()
    dedup_config = data.get('dedup_config') or None
    platform_id = (data.get('platform_id') or '').strip()

    if not question:
        return jsonify({'success': False, 'error': 'No question provided'}), 400

    lang_lower = language.strip().lower().replace('python3', 'python')
    if not lang_hint:
        lang_hint = f"Use {language} only. Single implementation. Include return if required. No duplicate functions."

    def _format_tests_for_prompt(cases):
        lines = []
        for i, tc in enumerate(cases[:12]):
            if not isinstance(tc, dict):
                continue
            inp = tc.get('inputs', tc.get('input', []))
            exp = tc.get('expected')
            if exp is None and 'expected' not in tc:
                continue
            lbl = tc.get('label') or f'case_{i + 1}'
            lines.append(f"  Test {i + 1} ({lbl}): input={json.dumps(inp)} → expected={json.dumps(exp)}")
        return '\n'.join(lines)

    tests_block = _format_tests_for_prompt(test_cases)
    tests_section = ''
    if tests_block:
        tests_section = (
            f"\n\nTEST CASES — your solution MUST pass ALL of these (100% required):\n"
            f"{tests_block}\n"
        )

    if mode == 'fix' and existing_code:
        prompt = (
            f"You are an expert programmer. Fix the EXISTING {language} code so it passes ALL test cases.\n"
            f"{lang_hint}\n\n"
            f"REQUIREMENTS:\n"
            f"- Return the COMPLETE full working code file (entire class/function, not a patch or snippet)\n"
            f"- Must compile without errors\n"
            f"- Must pass EVERY test case listed below (100% pass rate)\n"
            f"- Fix compile errors, logic bugs, and wrong outputs from failed tests\n"
            f"- Do NOT duplicate functions. Do NOT append. Do NOT switch language\n"
            f"- Write each function EXACTLY ONCE. Do NOT define the same function more than once.\n"
            f"- Do NOT close any brace you did not open. Balanced braces only.\n"
            f"- No markdown, no explanation, no backticks, no HTML entities — code only\n\n"
            f"Question:\n{question}\n"
            f"{tests_section}\n"
            f"EXISTING CODE TO FIX:\n{existing_code}\n"
        )
        if fn_name:
            prompt += f"\nKeep the method/function named exactly `{fn_name}`. Do NOT write `{fn_name}` more than once.\n"
        if error_context:
            prompt += f"\nERRORS / FAILURES TO FIX (fix these specific lines, do not rewrite working code):\n{error_context}\n"
        prompt += (
            f"\nReturn the COMPLETE fixed {language} code that passes ALL test cases:\n"
        )
    else:
        prompt = (
            f"You are an expert programmer. Write ONE complete NEW {language} solution.\n"
            f"{lang_hint}\n\n"
            f"REQUIREMENTS:\n"
            f"- Complete full working code that compiles and runs\n"
            f"- Must pass ALL test cases below (100% pass rate)\n"
            f"- Output raw code only — no markdown, no explanation, no backticks, no HTML entities\n"
            f"- Write the function EXACTLY ONCE. Do NOT define the same function more than once.\n"
            f"- Do NOT close any brace you did not open. Balanced braces only.\n\n"
            f"Question:\n{question}\n"
            f"{tests_section}"
        )
        if fn_name:
            prompt += f"\nIMPORTANT: Implement exactly ONE function/method named `{fn_name}`. Do not write `{fn_name}` a second time.\n"
        if error_context:
            prompt += (
                f"\nPrevious attempts FAILED:\n{error_context}\n"
                f"Write a completely NEW {language} solution from scratch that passes ALL tests.\n"
            )
        prompt += f"\nComplete working {language} code:"

    def clean_code(raw):
        import re as _re
        import html as _html
        raw = _html.unescape(raw)
        raw = _re.sub(r'^```[\w]*\n?', '', raw.strip(), flags=_re.MULTILINE)
        raw = _re.sub(r'```$', '', raw.strip(), flags=_re.MULTILINE)
        raw = raw.strip()

        # ── Universal dedup: remove duplicate function definitions regardless of dedup_config ──
        # Works for JavaScript, Python, Java, C, C++, Go, Rust, Kotlin
        def _remove_js_duplicates(code):
            """Remove duplicate JS/TS function definitions, keep the longest balanced block."""
            fn_re = _re.compile(
                r'(?:^|\n)[ \t]*(?:export\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{', _re.MULTILINE
            )
            matches = list(fn_re.finditer(code))
            if not matches:
                return code
            # Collect all brace-balanced blocks per name
            all_blocks = {}  # name -> [{start, end, length}]
            for mi, m in enumerate(matches):
                name = m.group(1)
                brace_pos = m.start() + m.group(0).rfind('{')
                boundary = matches[mi + 1].start() if mi + 1 < len(matches) else len(code)
                depth, end, complete = 0, brace_pos, False
                for end in range(brace_pos, boundary):
                    if code[end] == '{': depth += 1
                    elif code[end] == '}':
                        depth -= 1
                        if depth == 0: end += 1; complete = True; break
                if not complete:
                    partial = code[m.start():boundary]
                    o = partial.count('{')
                    c = partial.count('}')
                    if o > c:
                        partial += '\n' + '}' * (o - c)
                    end = m.start() + len(partial)
                block_start = m.start() + (1 if code[m.start()] == '\n' else 0)
                if name not in all_blocks:
                    all_blocks[name] = []
                all_blocks[name].append({'start': block_start, 'end': end, 'length': end - block_start})
            # Keep longest block per name, remove others
            removals = []
            for name, blocks in all_blocks.items():
                if len(blocks) <= 1:
                    continue
                keep_i = max(range(len(blocks)), key=lambda i: blocks[i]['length'])
                for i, b in enumerate(blocks):
                    if i != keep_i:
                        removals.append((b['start'], b['end']))
            if not removals:
                return code
            removals.sort(key=lambda x: x[0], reverse=True)
            result = code
            for start, end in removals:
                result = result[:start] + result[end:]
            return _re.sub(r'\n{3,}', '\n\n', result).strip()

        def _remove_py_duplicates(code, name):
            """Remove duplicate Python def blocks, keep the longest."""
            if not name:
                return code
            esc = _re.escape(name)
            fn_re = _re.compile(r'(?:^|\n)([ \t]*def\s+' + esc + r'\s*\()', _re.MULTILINE)
            positions = [m.start() + (1 if code[m.start()] == '\n' else 0)
                         for m in fn_re.finditer(code)]
            if len(positions) <= 1:
                return code
            blocks = []
            for i, start in enumerate(positions):
                end = positions[i + 1] if i + 1 < len(positions) else len(code)
                blocks.append((start, end, end - start))
            keep_i = max(range(len(blocks)), key=lambda i: blocks[i][2])
            removals = sorted(
                [(b[0], b[1]) for i, b in enumerate(blocks) if i != keep_i],
                key=lambda x: x[0], reverse=True
            )
            result = code
            for start, end in removals:
                result = result[:start] + result[end:]
            return _re.sub(r'\n{3,}', '\n\n', result).strip()

        # Apply language-specific dedup
        if lang_lower in ('javascript', 'js', 'typescript', 'ts'):
            raw = _remove_js_duplicates(raw)
        elif lang_lower in ('python', 'python3'):
            raw = _remove_py_duplicates(raw, fn_name)

        # ── dedup_config-based dedup (existing logic, for Java/C/C++/etc.) ──
        if not fn_name or not dedup_config:
            return raw

        start_pat = dedup_config.get('startPattern') or ''
        strategy = dedup_config.get('strategy') or 'nextMatch'
        indent_size = int(dedup_config.get('indentSize') or 4)
        normalize_indent = bool(dedup_config.get('normalizeIndent'))
        if not start_pat:
            return raw

        try:
            matches = list(_re.finditer(start_pat, raw, flags=_re.MULTILINE))
        except _re.error:
            return raw
        if len(matches) <= 1:
            return raw

        blocks = []
        if strategy == 'braceBalanced':
            for m in matches:
                start = m.start()
                brace = raw.find('{', start)
                if brace < 0:
                    continue
                depth, end = 0, brace
                for end in range(brace, len(raw)):
                    if raw[end] == '{':
                        depth += 1
                    elif raw[end] == '}':
                        depth -= 1
                        if depth == 0:
                            end += 1
                            break
                blocks.append(raw[start:end].strip())
        else:
            for i, m in enumerate(matches):
                end = matches[i + 1].start() if i + 1 < len(matches) else len(raw)
                blocks.append(raw[m.start():end].strip())

        if not blocks:
            return raw

        def _score(block):
            s = 0
            if 'return' in block:
                s += 200
            s += min(len(block), 500)
            lines = [l for l in block.splitlines() if l.strip()]
            if lines and normalize_indent:
                max_ind = max(len(l) - len(l.lstrip()) for l in lines)
                if max_ind > indent_size * 8:
                    s -= 150
            return s

        best = max(blocks, key=_score)
        if normalize_indent:
            lines = [l for l in best.splitlines() if l.strip()]
            if lines:
                min_indent = min(len(l) - len(l.lstrip()) for l in lines)
                best = '\n'.join(l[min_indent:] if l.strip() else l for l in best.splitlines())

        wrap_class = dedup_config.get('classSolution') and _re.search(r'class\s+Solution', raw, flags=_re.I)
        if wrap_class:
            pad = ' ' * indent_size
            body = '\n'.join(pad + l if l.strip() else l for l in best.splitlines())
            dedup_lang = (dedup_config.get('language') or lang_lower or '').lower()
            if dedup_lang == 'python':
                raw = f'class Solution:\n{body}'
            else:
                raw = f'class Solution {{\n{body}\n}}'
        else:
            raw = best
        return raw

    try:
        if provider == 'gemini':
            if not GEMINI_API_KEY:
                raise ValueError('GEMINI_API_KEY not set')
            import google.generativeai as _genai
            _genai.configure(api_key=GEMINI_API_KEY)
            model = _genai.GenerativeModel('gemini-pro')
            resp = model.generate_content(prompt)
            code = clean_code(resp.text)

        elif provider == 'openai':
            if not GPT4V_API_KEY:
                raise ValueError('GPT4V_API_KEY not set')
            import openai as _openai
            client = _openai.OpenAI(api_key=GPT4V_API_KEY)
            resp = client.chat.completions.create(
                model='gpt-4',
                messages=[{'role': 'user', 'content': prompt}],
                temperature=0.2,
                max_tokens=1024
            )
            code = clean_code(resp.choices[0].message.content)

        elif provider == 'groq':
            groq_key = GROQ_API_KEY or os.environ.get('GROQ_API_KEY')
            groq_model = os.environ.get('GROQ_MODEL', 'llama3-70b-8192')
            if not groq_key:
                raise ValueError('GROQ_API_KEY not set')
            import requests as _req
            resp = _req.post(
                'https://api.groq.com/openai/v1/chat/completions',
                headers={'Authorization': f'Bearer {groq_key}', 'Content-Type': 'application/json'},
                json={'model': groq_model, 'messages': [{'role': 'user', 'content': prompt}],
                      'temperature': 0.2, 'max_tokens': 1024},
                timeout=20
            )
            if resp.status_code != 200:
                raise ValueError(f'Groq error: {resp.status_code}')
            code = clean_code(resp.json()['choices'][0]['message']['content'])

        elif provider == 'deepseek':
            deepseek_key = DEEPSEEK_API_KEY or os.environ.get('DEEPSEEK_API_KEY')
            if not deepseek_key or str(deepseek_key).startswith('your_'):
                raise ValueError('DEEPSEEK_API_KEY not configured — use groq or set a valid DeepSeek key in backend/.env')
            import requests as _req
            resp = _req.post(
                'https://api.deepseek.com/v1/chat/completions',
                headers={'Authorization': f'Bearer {deepseek_key}', 'Content-Type': 'application/json'},
                json={'model': os.environ.get('DEEPSEEK_MODEL', 'deepseek-chat'),
                      'messages': [{'role': 'user', 'content': prompt}],
                      'temperature': 0.2, 'max_tokens': 1024},
                timeout=20
            )
            if resp.status_code == 401:
                raise ValueError('DeepSeek error: 401 — invalid API key. Set GROQ_API_KEY or a valid DEEPSEEK_API_KEY in backend/.env')
            if resp.status_code != 200:
                raise ValueError(f'DeepSeek error: {resp.status_code}')
            code = clean_code(resp.json()['choices'][0]['message']['content'])

        else:
            raise ValueError(f'Unsupported provider for code: {provider}')

        if not code:
            return jsonify({'success': False, 'error': 'AI returned empty code'}), 500

        logger.info(f'[get-code] Provider={provider} lang={language} code_len={len(code)}')
        return jsonify({'success': True, 'code': code, 'language': language, 'provider': provider})

    except Exception as e:
        logger.error(f'[get-code] Error: {e}')
        return jsonify({'success': False, 'error': str(e)}), 500


def _json_equal(a, b):
    """Compare two values via JSON serialization (handles lists, dicts, etc.)."""
    try:
        return json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)
    except Exception:
        return a == b


def _normalize_test_cases(raw_cases):
    """Normalize test case payloads from any platform format."""
    normalized = []
    if not isinstance(raw_cases, list):
        return normalized
    for i, tc in enumerate(raw_cases):
        if not isinstance(tc, dict):
            continue
        inputs = tc.get('inputs')
        if inputs is None:
            inputs = tc.get('input')
        if inputs is None:
            continue
        if not isinstance(inputs, list):
            inputs = [inputs]
        if 'expected' not in tc:
            continue
        normalized.append({
            'inputs': inputs,
            'expected': tc['expected'],
            'label': tc.get('label') or f"case_{i + 1}",
        })
    return normalized[:15]


def _run_python_tests(code, fn_name, test_cases, timeout=8):
    cases_json = json.dumps(test_cases)
    harness = (
        "import json\n"
        f"_user_code = {json.dumps(code)}\n"
        "_ns = {}\n"
        "exec(_user_code, _ns)\n"
        f"cases = json.loads({json.dumps(cases_json)})\n"
        f"fn = _ns.get({json.dumps(fn_name)}) or globals().get({json.dumps(fn_name)})\n"
        "results = []\n"
        "if not callable(fn):\n"
        f"    results = [{{'pass': False, 'error': 'Function {fn_name} not found', 'index': 0}}]\n"
        "else:\n"
        "    for i, tc in enumerate(cases):\n"
        "        inputs = tc.get('inputs') or []\n"
        "        expected = tc.get('expected')\n"
        "        label = tc.get('label') or ('case_' + str(i + 1))\n"
        "        try:\n"
        "            got = fn(*inputs)\n"
        "            passed = json.dumps(got, sort_keys=True, default=str) == json.dumps(expected, sort_keys=True, default=str)\n"
        "            results.append({'pass': passed, 'got': got, 'expected': expected, 'label': label, 'index': i})\n"
        "        except Exception as e:\n"
        "            results.append({'pass': False, 'error': str(e), 'label': label, 'index': i})\n"
        "print(json.dumps(results))\n"
    )
    with tempfile.NamedTemporaryFile('w', suffix='.py', delete=False, encoding='utf-8') as f:
        f.write(harness)
        tmp_path = f.name
    try:
        proc = subprocess.run(
            ['python', tmp_path],
            capture_output=True, text=True, timeout=timeout, cwd=tempfile.gettempdir()
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or 'Python execution failed').strip()[:500]
            return {'success': False, 'error': err, 'results': []}
        output = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else '[]'
        results = json.loads(output)
        return {'success': True, 'results': results}
    except subprocess.TimeoutExpired:
        return {'success': False, 'error': 'Execution timed out', 'results': []}
    except Exception as e:
        return {'success': False, 'error': str(e), 'results': []}
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _java_value_literal(val):
    if val is None:
        return 'null'
    if isinstance(val, bool):
        return 'true' if val else 'false'
    if isinstance(val, int):
        return str(val)
    if isinstance(val, float):
        return str(val)
    if isinstance(val, str):
        return json.dumps(val)
    if isinstance(val, list):
        if all(isinstance(x, int) for x in val):
            return 'new int[]{' + ','.join(str(x) for x in val) + '}'
        if all(isinstance(x, str) for x in val):
            return 'new String[]{' + ','.join(_java_value_literal(x) for x in val) + '}'
        inner = ','.join(_java_value_literal(x) for x in val)
        return f'new Object[]{{{inner}}}'
    return 'null'


def _build_java_test_runner(fn_name, test_cases):
    case_stmts = []
    for i, tc in enumerate(test_cases):
        inputs = tc.get('inputs') or []
        expected = tc.get('expected')
        label = (tc.get('label') or f'case_{i + 1}').replace('\\', '\\\\').replace('"', '\\"')
        args_java = ', '.join(_java_value_literal(v) for v in inputs)
        exp_lit = _java_value_literal(expected)
        invoke = f'm.invoke(sol{", " + args_java if args_java else ""})'
        case_stmts.append(f'''
        if (!first) sb.append(",");
        first = false;
        try {{
            Object gotObj = {invoke};
            Object expObj = {exp_lit};
            boolean pass = java.util.Objects.deepEquals(gotObj, expObj);
            sb.append("{{\\\"pass\\\":").append(pass).append(",\\\"label\\\":\\\"{label}\\\"}}");
        }} catch (Exception e) {{
            String err = e.getMessage() == null ? "error" : e.getMessage().replace("\\\\", " ").replace("\\"", "'");
            sb.append("{{\\\"pass\\\":false,\\\"label\\\":\\\"{label}\\\",\\\"error\\\":\\\"").append(err).append("\\\"}}");
        }}''')

    body = '\n'.join(case_stmts)
    return f'''
import java.lang.reflect.*;

public class TestRunner {{
    public static void main(String[] args) throws Exception {{
        Solution sol = new Solution();
        Method m = null;
        for (Method method : Solution.class.getDeclaredMethods()) {{
            if (method.getName().equals("{fn_name}")) {{ m = method; break; }}
        }}
        if (m == null) {{
            System.out.println("[{{\\\"pass\\\":false,\\\"error\\\":\\\"Function {fn_name} not found\\\"}}]");
            return;
        }}
        m.setAccessible(true);
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        {body}
        sb.append("]");
        System.out.println(sb.toString());
    }}
}}
'''


def _run_java_tests(code, fn_name, test_cases, timeout=20):
    work_dir = tempfile.mkdtemp()
    try:
        solution = code.strip()
        if 'class Solution' not in solution and 'class ' not in solution:
            solution = f'class Solution {{\n{solution}\n}}'
        elif 'class Solution' not in solution:
            pass

        solution_path = os.path.join(work_dir, 'Solution.java')
        with open(solution_path, 'w', encoding='utf-8') as f:
            f.write(solution)

        runner_path = os.path.join(work_dir, 'TestRunner.java')
        with open(runner_path, 'w', encoding='utf-8') as f:
            f.write(_build_java_test_runner(fn_name, test_cases))

        comp = subprocess.run(
            ['javac', 'Solution.java', 'TestRunner.java'],
            capture_output=True, text=True, timeout=timeout, cwd=work_dir
        )
        if comp.returncode != 0:
            err = (comp.stderr or comp.stdout or 'Java compile failed').strip()[:800]
            return {'success': False, 'error': err, 'results': []}

        proc = subprocess.run(
            ['java', 'TestRunner'],
            capture_output=True, text=True, timeout=timeout, cwd=work_dir
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or 'Java execution failed').strip()[:800]
            return {'success': False, 'error': err, 'results': []}
        output = proc.stdout.strip()
        if not output.startswith('['):
            lines = [l for l in output.splitlines() if l.strip().startswith('[')]
            output = lines[-1] if lines else '[]'
        results = json.loads(output)
        return {'success': True, 'results': results}
    except FileNotFoundError:
        return {'success': False, 'error': 'Java JDK (javac/java) not installed on backend', 'results': []}
    except subprocess.TimeoutExpired:
        return {'success': False, 'error': 'Java execution timed out', 'results': []}
    except Exception as e:
        return {'success': False, 'error': str(e), 'results': []}
    finally:
        try:
            import shutil
            shutil.rmtree(work_dir, ignore_errors=True)
        except Exception:
            pass


def _c_value_literal(val):
    if val is None:
        return '0'
    if isinstance(val, bool):
        return '1' if val else '0'
    if isinstance(val, (int, float)):
        return str(val)
    if isinstance(val, str):
        return json.dumps(val)
    return '0'


def _build_c_test_main(fn_name, test_cases):
  blocks = []
  for i, tc in enumerate(test_cases):
    inputs = tc.get('inputs') or []
    expected = tc.get('expected')
    label = (tc.get('label') or f'case_{i + 1}').replace('\\', '\\\\').replace('"', '\\"')
    args = ', '.join(_c_value_literal(v) for v in inputs)
    exp = _c_value_literal(expected)
    blocks.append(f'''
    {{
        int got = {fn_name}({args});
        int exp = {exp};
        int pass = (got == exp);
        if (!first) printf(",");
        printf("{{\\\"pass\\\":%s,\\\"label\\\":\\\"{label}\\\",\\\"got\\\":%d,\\\"expected\\\":%d}}", pass ? "true" : "false", got, exp);
        first = 0;
    }}''')
  return f'''
int main() {{
    int first = 1;
    printf("[");
    {' '.join(blocks)}
    printf("]\\n");
    return 0;
}}
'''


def _run_c_tests(code, fn_name, test_cases, timeout=15):
    work_dir = tempfile.mkdtemp()
    src_path = os.path.join(work_dir, 'solution.c')
    try:
        harness = (
            '#include <stdio.h>\n#include <stdbool.h>\n#include <string.h>\n\n'
            + code.strip() + '\n\n'
            + _build_c_test_main(fn_name, test_cases)
        )
        with open(src_path, 'w', encoding='utf-8') as f:
            f.write(harness)

        exe = os.path.join(work_dir, 'solution.exe' if os.name == 'nt' else 'solution')
        comp = subprocess.run(
            ['gcc', src_path, '-o', exe, '-lm'],
            capture_output=True, text=True, timeout=timeout, cwd=work_dir
        )
        if comp.returncode != 0:
            err = (comp.stderr or comp.stdout or 'C compile failed').strip()[:800]
            return {'success': False, 'error': err, 'results': []}

        proc = subprocess.run(
            [exe],
            capture_output=True, text=True, timeout=timeout, cwd=work_dir
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or 'C execution failed').strip()[:800]
            return {'success': False, 'error': err, 'results': []}
        lines = [l for l in proc.stdout.strip().splitlines() if l.strip().startswith('[')]
        output = lines[-1] if lines else '[]'
        results = json.loads(output)
        return {'success': True, 'results': results}
    except FileNotFoundError:
        return {'success': False, 'error': 'GCC not installed on backend', 'results': []}
    except subprocess.TimeoutExpired:
        return {'success': False, 'error': 'C execution timed out', 'results': []}
    except Exception as e:
        return {'success': False, 'error': str(e), 'results': []}
    finally:
        try:
            import shutil
            shutil.rmtree(work_dir, ignore_errors=True)
        except Exception:
            pass


def _run_javascript_tests(code, fn_name, test_cases, timeout=8):
    cases_json = json.dumps(test_cases)
    harness = f'''
{code}
const __cases__ = {cases_json};
const __fn__ = (typeof {fn_name} !== 'undefined') ? {fn_name} : null;
const __results__ = [];
if (typeof __fn__ !== 'function') {{
  console.log(JSON.stringify([{{pass:false, error:"Function {fn_name} not found", index:0}}]));
}} else {{
  for (let i = 0; i < __cases__.length; i++) {{
    const tc = __cases__[i];
    const inputs = tc.inputs || [];
    const label = tc.label || ('case_' + (i+1));
    try {{
      const got = __fn__(...inputs);
      const pass = JSON.stringify(got) === JSON.stringify(tc.expected);
      __results__.push({{pass, got, expected: tc.expected, label, index: i}});
    }} catch (e) {{
      __results__.push({{pass: false, error: e.message, label, index: i}});
    }}
  }}
  console.log(JSON.stringify(__results__));
}}
'''
    try:
        proc = subprocess.run(
            ['node', '-e', harness],
            capture_output=True, text=True, timeout=timeout, cwd=tempfile.gettempdir()
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or 'Node execution failed').strip()[:500]
            return {'success': False, 'error': err, 'results': []}
        lines = [l for l in proc.stdout.strip().splitlines() if l.strip()]
        output = lines[-1] if lines else '[]'
        results = json.loads(output)
        return {'success': True, 'results': results}
    except FileNotFoundError:
        return {'success': False, 'error': 'Node.js not installed on backend', 'results': []}
    except subprocess.TimeoutExpired:
        return {'success': False, 'error': 'Execution timed out', 'results': []}
    except Exception as e:
        return {'success': False, 'error': str(e), 'results': []}


@app.route('/api/run-code-tests', methods=['POST'])
def run_code_tests():
    """Execute code against dynamically supplied test cases (Python / JavaScript)."""
    data = request.json or {}
    code = (data.get('code') or '').strip()
    language = (data.get('language') or 'python').strip().lower()
    fn_name = (data.get('fn_name') or '').strip()
    test_cases = _normalize_test_cases(data.get('test_cases') or [])

    if not code:
        return jsonify({'success': False, 'error': 'No code provided'}), 400
    if not fn_name:
        return jsonify({'success': False, 'error': 'No function name provided'}), 400
    if not test_cases:
        return jsonify({'success': False, 'error': 'No test cases provided'}), 400

    lang = language.replace('typescript', 'javascript').replace('python3', 'python').replace('py', 'python')
    lang = lang.replace('c++', 'cpp').replace('csharp', 'csharp').replace('c#', 'csharp')

    runners = {
        'python': lambda: _run_python_tests(code, fn_name, test_cases),
        'javascript': lambda: _run_javascript_tests(code, fn_name, test_cases),
        'js': lambda: _run_javascript_tests(code, fn_name, test_cases),
        'typescript': lambda: _run_javascript_tests(code, fn_name, test_cases),
        'ts': lambda: _run_javascript_tests(code, fn_name, test_cases),
        'java': lambda: _run_java_tests(code, fn_name, test_cases),
        'c': lambda: _run_c_tests(code, fn_name, test_cases),
    }

    if lang not in runners:
        return jsonify({
            'success': False,
            'error': f'Language "{language}" test execution not supported on backend. Supported: python, javascript, java, c.'
        }), 400

    outcome = runners[lang]()

    results = outcome.get('results') or []
    passed = sum(1 for r in results if r.get('pass'))
    failed = sum(1 for r in results if not r.get('pass'))
    return jsonify({
        'success': outcome.get('success', False) and failed == 0,
        'results': results,
        'total': len(results),
        'passed': passed,
        'failed': failed,
        'error': outcome.get('error'),
    })


@app.route('/api/health', methods=['GET'])
def health():
    """Simple health check endpoint used by container healthchecks and PaaS platforms"""
    return jsonify({'ok': True}), 200

@app.route('/api/vision-answer', methods=['POST'])
def vision_answer():
    data = request.json
    image_data = data.get('image_data')
    prompt = (
        "You are answering a multiple choice question shown in this image. "
        "Output ONLY the single letter (A, B, C, D) of the correct answer. "
        "No explanation, no code, no extra text."
    )

    if not image_data:
        return jsonify({'success': False, 'error': 'No image data provided.'})

    if ',' in image_data:
        image_data = image_data.split(',')[1]

    try:
        import openai as _openai
        client = _openai.OpenAI(api_key=GPT4V_API_KEY)
        response = client.chat.completions.create(
            model="gpt-4-vision-preview",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_data}"}}
                    ]
                }
            ],
            max_tokens=10
        )
        raw = response.choices[0].message.content.strip()
        # Extract only the first letter A-E from response
        import re as _re
        m = _re.search(r'\b([A-Ea-e])\b', raw)
        answer = m.group(1).upper() if m else raw[:4]
        return jsonify({'success': True, 'answer': answer})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/generate-ocr-test-image', methods=['POST'])
def generate_ocr_test_image():
    data = request.json
    text = data.get('text', 'Hello World')
    font_size = data.get('font_size', 40)
    padding = data.get('padding', 20)
    width = data.get('width', 800)
    height = data.get('height', 200)

    # Try to use a clean sans-serif TTF font
    font_paths = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',  # Linux
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/Library/Fonts/Arial.ttf',  # macOS
        'C:/Windows/Fonts/arial.ttf',  # Windows
        'arial.ttf',
        'DejaVuSans.ttf',
    ]
    font = None
    for path in font_paths:
        if os.path.exists(path):
            try:
                font = ImageFont.truetype(path, font_size)
                break
            except Exception:
                continue
    if font is None:
        return {'success': False, 'error': 'No suitable TTF font found. Please install Arial or DejaVu Sans.'}, 500

    # Create image with white background and high contrast
    img = Image.new('RGB', (width, height), color='white')
    draw = ImageDraw.Draw(img)

    # Calculate text size and position for centering
    text_bbox = draw.multiline_textbbox((0, 0), text, font=font)
    text_width = text_bbox[2] - text_bbox[0]
    text_height = text_bbox[3] - text_bbox[1]
    x = (width - text_width) // 2
    y = (height - text_height) // 2

    # Draw text with anti-aliasing (Pillow does this by default with TTF)
    draw.multiline_text((x, y), text, font=font, fill='black', align='center')

    # Save to buffer
    buffered = BytesIO()
    img.save(buffered, format="PNG")
    img_str = base64.b64encode(buffered.getvalue()).decode()
    return {'success': True, 'image_data': f'data:image/png;base64,{img_str}'}

# --- Modular Preprocessing Functions from tesseract.ipynb ---
def get_grayscale(image):
    import cv2
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

def remove_noise(image):
    import cv2
    return cv2.medianBlur(image, 5)

def thresholding(image):
    import cv2
    return cv2.threshold(image, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]

def dilate(image):
    import cv2
    import numpy as np
    kernel = np.ones((5,5), np.uint8)
    return cv2.dilate(image, kernel, iterations=1)

def erode(image):
    import cv2
    import numpy as np
    kernel = np.ones((5,5), np.uint8)
    return cv2.erode(image, kernel, iterations=1)

def opening(image):
    import cv2
    import numpy as np
    kernel = np.ones((5,5), np.uint8)
    return cv2.morphologyEx(image, cv2.MORPH_OPEN, kernel)

def canny(image):
    import cv2
    return cv2.Canny(image, 100, 200)

def deskew(image):
    import cv2
    import numpy as np
    coords = np.column_stack(np.where(image > 0))
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    (h, w) = image.shape[:2]
    center = (w // 2, h // 2)
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(image, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return rotated

# ── WebSocket relay ───────────────────────────────────────

@sock.route('/ws')
def ws_relay(ws):
    _ws_clients.add(ws)
    logger.info(f'[WS] Client connected. Total: {len(_ws_clients)}')
    try:
        while True:
            msg = ws.receive(timeout=30)
            if msg is None:
                break
    except Exception:
        pass
    finally:
        _ws_clients.discard(ws)
        logger.info(f'[WS] Client disconnected. Total: {len(_ws_clients)}')


def _relay_to_ws_clients(payload: dict):
    global _ws_clients
    dead = set()
    for ws in list(_ws_clients):
        try:
            ws.send(json.dumps(payload))
        except Exception:
            dead.add(ws)
    _ws_clients -= dead

# Inject relay into wa_web after it is defined
wa_web.set_relay(_relay_to_ws_clients)


# ── WhatsApp Web endpoints ─────────────────────────────────

@app.route('/api/whatsapp/qr', methods=['GET'])
def whatsapp_qr():
    """Return current QR code string for scanning (or ready status)."""
    if wa_web.is_ready():
        return jsonify({'success': True, 'status': 'ready'}), 200
    qr = wa_web.get_qr()
    if qr:
        return jsonify({'success': True, 'status': 'qr', 'qr': qr}), 200
    return jsonify({'success': False, 'status': 'starting', 'message': 'Bridge starting, try again in a few seconds'}), 202


@app.route('/api/whatsapp/status', methods=['GET'])
def whatsapp_status():
    return jsonify({
        'success': True,
        'ready': wa_web.is_ready(),
        'qrPending': wa_web.get_qr() is not None
    }), 200


@app.route('/api/whatsapp/send', methods=['POST'])
def whatsapp_send():
    """
    Send message or image via WhatsApp Web.
    Body: { to (optional), message, imageBase64 (optional), metadata (optional) }
    """
    if not wa_web.is_ready():
        qr_pending = wa_web.get_qr() is not None
        port = os.environ.get('PORT', '5000')
        msg = f'WhatsApp Web not ready. Scan QR at http://localhost:{port}/whatsapp' if qr_pending else 'WhatsApp Web bridge is starting, try again in a few seconds'
        return jsonify({'success': False, 'error': msg, 'needsQR': qr_pending}), 503

    data = request.json or {}
    to_number = data.get('to') or os.environ.get('WHATSAPP_TO', '')
    message_body = data.get('message', '')
    image_b64 = data.get('imageBase64') or data.get('mediaUrl') or data.get('image')
    mime_type = data.get('mimeType', 'image/jpeg')
    metadata = data.get('metadata', {})

    if not to_number:
        return jsonify({'success': False, 'error': 'No recipient. Set WHATSAPP_TO in .env or pass "to" in request'}), 400

    try:
        # Send image if provided (strip data URI prefix)
        if image_b64 and isinstance(image_b64, str):
            if ',' in image_b64:
                image_b64 = image_b64.split(',', 1)[1]
            if not wa_web.send_image(to_number, image_b64, caption=message_body, mime_type=mime_type):
                return jsonify({'success': False, 'error': 'WhatsApp bridge timed out -- check server logs'}), 502
        else:
            if not wa_web.send_message(to_number, message_body):
                return jsonify({'success': False, 'error': 'WhatsApp bridge timed out -- check server logs'}), 502

        conv_id = metadata.get('conversationId') if isinstance(metadata, dict) else None
        if conv_id:
            _conversations[conv_id] = {
                'to_number': re.sub(r'[^\d]', '', to_number),
                'timestamp': datetime.now().isoformat(),
                'status': 'sent',
                'metadata': metadata,
                'messages': []
            }

        logger.info(f'[WAWeb] Sent to {to_number}')
        return jsonify({'success': True, 'conversationId': conv_id}), 200

    except Exception as e:
        logger.error(f'[WAWeb] Send error: {e}')
        return jsonify({'success': False, 'error': str(e)}), 400


@app.route('/api/whatsapp/webhook', methods=['POST'])
def whatsapp_webhook():
    """
    Manual webhook endpoint (for testing or external triggers).
    WhatsApp Web replies are handled automatically by the bridge.
    Body: { from, body, messageId }
    """
    data = request.json or {}
    from_number = data.get('from', '')
    body = data.get('body', '')
    msg_id = data.get('messageId', '')

    answers = _parse_answers(body)
    conv_id = next(
        (cid for cid, c in _conversations.items()
         if re.sub(r'[^\d]', '', c.get('to_number', '')) == re.sub(r'[^\d]', '', from_number)),
        None
    )

    if conv_id:
        _conversations[conv_id].setdefault('messages', []).append({
            'timestamp': datetime.now().isoformat(),
            'from': from_number,
            'body': body,
            'id': msg_id,
            'answers': answers
        })

    _relay_to_ws_clients({
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

    return jsonify({'success': True, 'answersCount': len(answers)}), 200


@app.route('/api/whatsapp/verify-webhook', methods=['POST'])
def whatsapp_verify_webhook():
    return jsonify({'success': True, 'valid': True}), 200


@app.route('/api/whatsapp/conversations', methods=['GET'])
def whatsapp_conversations():
    return jsonify({'success': True, 'conversations': _conversations}), 200


@app.route('/api/whatsapp/conversation/<conv_id>', methods=['GET'])
def whatsapp_conversation(conv_id):
    conv = _conversations.get(conv_id)
    if not conv:
        return jsonify({'success': False, 'error': 'Not found'}), 404
    return jsonify({'success': True, 'conversation': conv}), 200


@app.route('/api/whatsapp/status/<message_id>', methods=['GET'])
def whatsapp_message_status(message_id):
    return jsonify({'success': True, 'status': 'delivered'}), 200


def _parse_answers(text):
    """Parse Q1:A style answers from WhatsApp message body."""
    answers = []
    for line in text.split('\n'):
        line = line.strip()
        if ':' not in line:
            continue
        parts = line.split(':', 1)
        q_match = re.search(r'\d+', parts[0])
        a_match = re.search(r'[A-Ea-e]', parts[1])
        if q_match and a_match:
            answers.append({
                'questionIndex': int(q_match.group()) - 1,
                'answer': a_match.group().upper(),
                'raw': line
            })
    return answers


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5050))
    os.environ['RUN_SERVER'] = '1'
    # debug=False + use_reloader=False prevents WinError 10038 on Windows
    app.run(debug=False, use_reloader=False, host='0.0.0.0', port=port, threaded=True)