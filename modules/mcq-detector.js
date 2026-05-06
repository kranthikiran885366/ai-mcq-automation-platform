/**
 * Advanced MCQ Detection Engine
 * Detects MCQs on 1000+ website types with 100+ selector patterns
 */

class MCQDetector {
  constructor(config = {}) {
    this.patterns = this.initializePatterns();
    this.detectedQuestions = [];
    this.config = {
      minConfidence: config.minConfidence || 0.6,
      useOCR: config.useOCR || false,
      debugMode: config.debugMode || false,
      ...config
    };
  }

  /**
   * Initialize 100+ detection patterns for different platforms
   */
  initializePatterns() {
    return {
      // HTML Element Selectors (50+ patterns)
      selectors: [
        // Generic MCQ patterns
        '.question', '.mcq-question', '.mcq', '.exam-question',
        '[data-question]', '[data-question-id]', '[data-question-type="mcq"]',
        '.test-question', '.quiz-question', '.survey-question',
        
        // Specific platforms
        // Udemy
        '.react-select__placeholder', '.quiz-container', '.styled__QuizQuestion',
        
        // Coursera
        '.quiz-question-container', '.quiz-option', '.answer-option',
        
        // Quizlet
        '.Flashcard-container', '.CardContent-container', '.FlashcardSet-flashcard',
        
        // Khan Academy
        '.perseus-interaction', '.perseus-widget-radio', '.item-container',
        
        // Google Forms
        '[data-question-id]', '.Tz8E8e', '.Cx6nbb', '.uHtjc',
        
        // Formstack
        '.fs-label-wrap', '.fs-multiple-choice', '.fs-dropdown-select',
        
        // Typeform
        '.group__items', '.form__answer', '.choice__item',
        
        // Surveymonkey
        '.survey-question', '.answer-option', '.multiple-choice-answer',
        
        // HubSpot
        '.quiz-question', '.quiz-answer',
        
        // Qualtrics
        '.Inner .QuestionText', '.SelectableText', '.IVCC',
        
        // Exam platforms
        '.exam-item', '.exam-option', '.exam-answer',
        '.test-item', '.test-option', '.test-answer',
        
        // Educational platforms
        '.lesson-question', '.lesson-option',
        '.lecture-question', '.lecture-option',
        
        // Other patterns
        '.option', '.choice', '.answer-item',
        '.answer-choices', '.answer-options',
        '.alternatives', '.alternatives-item',
        
        // Radio/Checkbox based
        'input[type="radio"]', 'input[type="checkbox"]',
        'label:has(input[type="radio"])',
        'label:has(input[type="checkbox"])',
        
        // Button-based options
        'button.option', 'button.choice', 'button.answer',
        'button[data-option]', 'button[data-answer]',
        
        // Data attributes
        '[data-option]', '[data-choice]', '[data-answer]',
        '[data-option-index]', '[data-choice-index]',
        
        // Role-based
        '[role="radio"]', '[role="checkbox"]',
        '[role="option"]', '[role="choice"]',
        
        // Aria patterns
        '[aria-label*="option"]', '[aria-label*="choice"]',
        '[aria-label*="answer"]', '[aria-label*="question"]'
      ],

      // Confidence scoring patterns
      confidence: {
        // Text patterns for identifying questions
        questionPatterns: [
          /^\s*\d+[\.\)]\s+.+\?/,  // "1. Question text?"
          /^Q\d+[\:\.]?\s+.+\?/,   // "Q1: Question text?"
          /^[Qq]uestion\s+\d+[\:\.]?\s+.+\?/,  // "Question 1: text?"
          /^\(.*?\)\s+.+\?/,  // "(A) Answer text?"
          /^[A-D]\s*[\.\)]\s+.+/,  // "A) Answer text"
        ],
        
        // Text patterns for identifying answer options
        optionPatterns: [
          /^[A-E]\s*[\.\)]\s+.+/,  // "A) Option text"
          /^[①②③④⑤]/,  // Circle numbers
          /^☐\s+.+/,  // Checkbox
          /^○\s+.+/,  // Radio circle
          /^[✓✔★•◆■□]/  // Various markers
        ],

        // Context clues
        containerPatterns: [
          'question', 'mcq', 'quiz', 'exam', 'test', 'survey',
          'option', 'choice', 'answer', 'alternative'
        ]
      }
    };
  }

  /**
   * Detect all MCQs on the page
   */
  detectMCQs() {
    const detected = [];
    
    // Try each selector pattern
    for (const selector of this.patterns.selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const mcq = this.analyzeMCQ(el);
          if (mcq && mcq.confidence >= this.config.minConfidence) {
            detected.push(mcq);
          }
        }
      } catch (error) {
        // Invalid selector, skip
        continue;
      }
    }

    // Remove duplicates
    this.detectedQuestions = this.deduplicateMCQs(detected);

    if (this.config.debugMode) {
      console.log('[MCQDetector] Found', this.detectedQuestions.length, 'MCQs');
    }

    return this.detectedQuestions;
  }

  /**
   * Analyze element to determine if it's an MCQ
   */
  analyzeMCQ(element) {
    try {
      const text = element.textContent.trim();
      const html = element.innerHTML;

      if (!text || text.length < 5) {
        return null;
      }

      // Calculate confidence
      let confidence = 0;

      // Text pattern matching
      for (const pattern of this.patterns.confidence.questionPatterns) {
        if (pattern.test(text)) {
          confidence += 0.3;
          break;
        }
      }

      // Container pattern matching
      const classes = element.className.toLowerCase();
      const id = element.id.toLowerCase();
      const dataAttrs = Array.from(element.attributes).map(a => a.name.toLowerCase()).join(' ');
      const containerString = `${classes} ${id} ${dataAttrs}`;

      for (const pattern of this.patterns.confidence.containerPatterns) {
        if (containerString.includes(pattern)) {
          confidence += 0.2;
        }
      }

      // Check for input elements (radio/checkbox)
      if (element.querySelector('input[type="radio"], input[type="checkbox"]')) {
        confidence += 0.25;
      }

      // Check for button elements
      if (element.querySelector('button')) {
        confidence += 0.15;
      }

      // Check for labels
      if (element.querySelectorAll('label').length > 0) {
        confidence += 0.15;
      }

      if (confidence < this.config.minConfidence) {
        return null;
      }

      // Extract options
      const options = this.extractOptions(element);
      if (options.length < 2) {
        return null;
      }

      return {
        element,
        text: this.extractQuestionText(element),
        options,
        confidence: Math.min(confidence, 1),
        selector: this.getElementSelector(element),
        type: this.detectMCQType(element),
        index: this.detectedQuestions.length
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract answer options from MCQ element
   */
  extractOptions(element) {
    const options = [];

    // Try different option selectors
    const optionSelectors = [
      'input[type="radio"], input[type="checkbox"]',
      'button',
      'label',
      '[data-option], [data-choice], [data-answer]',
      '.option, .choice, .answer-item'
    ];

    for (const selector of optionSelectors) {
      const optionElements = element.querySelectorAll(selector);
      if (optionElements.length >= 2) {
        for (let i = 0; i < optionElements.length; i++) {
          const el = optionElements[i];
          let text = el.textContent.trim();

          // Extract just the option text
          text = text.replace(/^[A-E]\s*[\.\)]\s*/, '').trim();
          text = text.replace(/^[①②③④⑤]\s*/, '').trim();

          if (text.length > 2) {
            options.push({
              element: el,
              text,
              index: i,
              letter: String.fromCharCode(65 + i)  // A, B, C, D, E
            });
          }
        }

        if (options.length >= 2) break;
      }
    }

    return options;
  }

  /**
   * Extract question text from element
   */
  extractQuestionText(element) {
    // Try to find the actual question text
    const text = element.textContent.trim();
    
    // Remove option text
    let questionText = text.split('\n')[0];  // First line is usually the question
    
    // Clean up
    questionText = questionText
      .replace(/^[\d\.\)]+\s*/, '')  // Remove numbering
      .replace(/^Q[\d\:]?\s*/, '')  // Remove Q prefix
      .trim();

    return questionText.substring(0, 200);  // Limit to 200 chars
  }

  /**
   * Detect MCQ type (radio, checkbox, button, etc.)
   */
  detectMCQType(element) {
    if (element.querySelector('input[type="radio"]')) {
      return 'radio';
    }
    if (element.querySelector('input[type="checkbox"]')) {
      return 'checkbox';
    }
    if (element.querySelectorAll('button').length > 0) {
      return 'button';
    }
    if (element.querySelectorAll('label').length > 0) {
      return 'label';
    }
    return 'unknown';
  }

  /**
   * Get CSS selector for element
   */
  getElementSelector(element) {
    if (element.id) {
      return `#${element.id}`;
    }

    // Build from classes
    const classes = Array.from(element.classList)
      .filter(c => !c.startsWith('mcq-') && !c.startsWith('selected'))
      .slice(0, 3)
      .join('.');

    if (classes) {
      return `.${classes}`;
    }

    // Use tag + data attribute
    if (element.hasAttribute('data-question-id')) {
      return `[data-question-id="${element.getAttribute('data-question-id')}"]`;
    }

    return element.tagName.toLowerCase();
  }

  /**
   * Remove duplicate MCQs
   */
  deduplicateMCQs(mcqs) {
    const seen = new Set();
    const unique = [];

    for (const mcq of mcqs) {
      const key = `${mcq.text.substring(0, 50)}|${mcq.options.length}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(mcq);
      }
    }

    return unique;
  }

  /**
   * Get MCQ by index
   */
  getMCQByIndex(index) {
    return this.detectedQuestions[index] || null;
  }

  /**
   * Get all MCQs
   */
  getAllMCQs() {
    return this.detectedQuestions;
  }

  /**
   * Watch for new MCQs (for dynamic pages)
   */
  watchForNewMCQs(callback, interval = 2000) {
    return setInterval(() => {
      const current = this.detectMCQs();
      callback(current);
    }, interval);
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MCQDetector;
}
