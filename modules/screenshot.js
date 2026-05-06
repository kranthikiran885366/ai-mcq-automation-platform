/**
 * Screenshot Capture Module
 * Captures MCQ questions and sends them via WhatsApp
 */

class ScreenshotManager {
  constructor(config = {}) {
    this.maxFileSize = config.maxFileSize || 16 * 1024 * 1024; // 16MB for WhatsApp
    this.quality = config.quality || 0.85;
    this.format = config.format || 'image/jpeg';
    this.scale = config.scale || 2; // 2x scale for better quality
  }

  /**
   * Capture visible MCQ area
   */
  async captureScreenshot(element = null) {
    try {
      const targetElement = element || document.body;
      
      // Create canvas using html2canvas or native canvas API
      const canvas = await this.createCanvasFromElement(targetElement);
      
      const dataUrl = canvas.toDataURL(this.format, this.quality);
      
      // Get file size
      const size = this.estimateSize(dataUrl);

      // If too large, reduce quality
      let finalDataUrl = dataUrl;
      let finalSize = size;

      if (finalSize > this.maxFileSize) {
        finalDataUrl = await this.compressScreenshot(canvas, 0.7);
        finalSize = this.estimateSize(finalDataUrl);
      }

      return {
        id: this.generateUUID(),
        dataUrl: finalDataUrl,
        size: finalSize,
        width: canvas.width,
        height: canvas.height,
        timestamp: Date.now(),
        timestamp_readable: new Date().toLocaleString(),
        metadata: {
          url: window.location.href,
          title: document.title,
          userAgent: navigator.userAgent,
          captured_at: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('[Screenshot] Capture failed:', error);
      throw error;
    }
  }

  /**
   * Create canvas from DOM element
   */
  async createCanvasFromElement(element) {
    // Try using html2canvas if available, otherwise use native canvas
    if (typeof html2canvas !== 'undefined') {
      return html2canvas(element, {
        scale: this.scale,
        logging: false,
        useCORS: true,
        backgroundColor: '#ffffff'
      });
    } else {
      // Fallback: use native canvas API for visible area
      return this.nativeCanvasCapture(element);
    }
  }

  /**
   * Native canvas capture (for viewport only)
   */
  async nativeCanvasCapture(element) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const rect = element.getBoundingClientRect();
    canvas.width = rect.width * this.scale;
    canvas.height = rect.height * this.scale;

    ctx.scale(this.scale, this.scale);
    ctx.translate(-rect.left, -rect.top);

    // Draw element
    if (element === document.body) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width / this.scale, canvas.height / this.scale);
    }

    // This is a simplified version - for full DOM rendering, use html2canvas
    return canvas;
  }

  /**
   * Compress screenshot
   */
  async compressScreenshot(canvas, quality = 0.7) {
    // Reduce dimensions if needed
    const maxWidth = 1920;
    const maxHeight = 1440;

    let width = canvas.width;
    let height = canvas.height;

    if (width > maxWidth || height > maxHeight) {
      const ratio = Math.min(maxWidth / width, maxHeight / height);
      width = Math.floor(width * ratio);
      height = Math.floor(height * ratio);

      const newCanvas = document.createElement('canvas');
      newCanvas.width = width;
      newCanvas.height = height;
      const ctx = newCanvas.getContext('2d');
      ctx.drawImage(canvas, 0, 0, width, height);

      return newCanvas.toDataURL(this.format, quality);
    }

    return canvas.toDataURL(this.format, quality);
  }

  /**
   * Capture specific area (MCQ question area)
   */
  async captureArea(selector) {
    try {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }

      return await this.captureScreenshot(element);
    } catch (error) {
      console.error('[Screenshot] Area capture failed:', error);
      throw error;
    }
  }

  /**
   * Capture all visible MCQs (multiple questions)
   */
  async captureAllQuestions(questionSelector = '.mcq-question, .question, [data-question]') {
    try {
      const questions = document.querySelectorAll(questionSelector);
      
      if (questions.length === 0) {
        console.warn('[Screenshot] No questions found with selector:', questionSelector);
        return [];
      }

      const screenshots = [];

      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        const screenshot = await this.captureScreenshot(question);
        screenshot.questionIndex = i;
        screenshots.push(screenshot);
      }

      return screenshots;
    } catch (error) {
      console.error('[Screenshot] Multiple capture failed:', error);
      throw error;
    }
  }

  /**
   * Download screenshot (for user)
   */
  downloadScreenshot(dataUrl, filename = null) {
    try {
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = filename || `mcq-screenshot-${Date.now()}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return true;
    } catch (error) {
      console.error('[Screenshot] Download failed:', error);
      return false;
    }
  }

  /**
   * Share screenshot to clipboard
   */
  async copyToClipboard(dataUrl) {
    try {
      const blob = await this.dataUrlToBlob(dataUrl);
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      return true;
    } catch (error) {
      console.error('[Screenshot] Clipboard copy failed:', error);
      return false;
    }
  }

  /**
   * Convert data URL to Blob
   */
  async dataUrlToBlob(dataUrl) {
    const response = await fetch(dataUrl);
    return response.blob();
  }

  /**
   * Estimate data URL size (rough estimate)
   */
  estimateSize(dataUrl) {
    // Data URL: data:image/jpeg;base64,...
    // Remove prefix and calculate
    const base64 = dataUrl.split(',')[1];
    if (!base64) return 0;

    // Each base64 char = 6 bits, so 4 chars = 3 bytes
    const padding = (dataUrl.match(/=/g) || []).length;
    return Math.ceil((base64.length * 3) / 4) - padding;
  }

  /**
   * Format size for display
   */
  formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Detect MCQ area automatically
   */
  detectMCQArea() {
    const selectors = [
      '.mcq-container',
      '.quiz-container',
      '.question-container',
      '[data-mcq]',
      '.test-paper',
      '.exam-section'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
    }

    // Fallback to body
    return document.body;
  }

  /**
   * Extract question text and options
   */
  extractQuestionData(questionElement) {
    try {
      const questionText = questionElement.querySelector(
        '.question-text, .question, h3, [data-question-text]'
      )?.textContent?.trim() || '';

      const options = [];
      const optionElements = questionElement.querySelectorAll(
        '.option, .choice, label, [data-option]'
      );

      for (const optElement of optionElements) {
        const text = optElement.textContent.trim();
        const value = optElement.getAttribute('value') || optElement.getAttribute('data-value') || '';
        
        if (text) {
          options.push({
            text,
            value,
            element: optElement
          });
        }
      }

      return {
        questionText,
        options,
        optionCount: options.length
      };
    } catch (error) {
      console.error('[Screenshot] Question extraction failed:', error);
      return { questionText: '', options: [], optionCount: 0 };
    }
  }

  /**
   * Generate UUID
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Validate screenshot quality
   */
  validateScreenshot(screenshot) {
    const errors = [];

    if (screenshot.size === 0) {
      errors.push('Screenshot is empty');
    }

    if (screenshot.size > this.maxFileSize) {
      errors.push(`Screenshot exceeds max size (${this.formatSize(this.maxFileSize)})`);
    }

    if (screenshot.width < 100 || screenshot.height < 100) {
      errors.push('Screenshot dimensions too small');
    }

    if (!screenshot.dataUrl.startsWith('data:image')) {
      errors.push('Invalid screenshot format');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScreenshotManager;
}
