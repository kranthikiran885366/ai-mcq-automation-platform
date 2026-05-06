/**
 * Auto-Answer Selection Module
 * Automatically selects answers in MCQ forms based on received responses
 */

class AutoAnswerManager {
  constructor(config = {}) {
    this.selectionDelay = config.selectionDelay || 300; // ms between selections
    this.animationDuration = config.animationDuration || 200;
    this.verifySelection = config.verifySelection !== false;
    this.humanLike = config.humanLike !== false;
  }

  /**
   * Apply answers to page automatically
   */
  async applyAnswers(answers, conversationId) {
    const results = [];

    for (const answer of answers) {
      try {
        const result = await this.selectAnswer(answer, conversationId);
        results.push(result);

        // Human-like delay between selections
        if (this.humanLike) {
          await this.randomDelay(this.selectionDelay);
        }
      } catch (error) {
        console.error('[AutoAnswer] Failed to apply answer:', error);
        results.push({
          questionIndex: answer.questionIndex,
          success: false,
          error: error.message,
          answer: answer.answer
        });
      }
    }

    return results;
  }

  /**
   * Select single answer
   */
  async selectAnswer(answer, conversationId) {
    try {
      const { questionIndex, answer: answerText } = answer;

      // Find the question element
      const questionElement = this.findQuestionByIndex(questionIndex);
      if (!questionElement) {
        throw new Error(`Question ${questionIndex} not found`);
      }

      // Find matching option
      const option = this.findMatchingOption(questionElement, answerText);
      if (!option) {
        throw new Error(`Answer option "${answerText}" not found for Q${questionIndex + 1}`);
      }

      // Determine input type
      const inputType = this.detectInputType(option);

      // Select the option
      await this.clickOption(option, inputType);

      // Verify selection
      let verified = true;
      if (this.verifySelection) {
        verified = await this.verifyAnswerSelected(option, inputType);
      }

      return {
        questionIndex,
        success: verified,
        answer: answerText,
        inputType,
        element: option.element,
        selectorInfo: {
          selector: this.getElementSelector(option.element),
          inputType,
          text: option.text,
          value: option.value
        }
      };
    } catch (error) {
      console.error('[AutoAnswer] Selection error:', error);
      throw error;
    }
  }

  /**
   * Find question element by index
   */
  findQuestionByIndex(index) {
    const questionSelectors = [
      `.question:nth-of-type(${index + 1})`,
      `[data-question-index="${index}"]`,
      `.mcq-question:nth-of-type(${index + 1})`,
      `[data-q="${index}"]`,
      `.exam-question:nth-of-type(${index + 1})`
    ];

    for (const selector of questionSelectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }

    // Fallback: Get all question-like containers
    const allQuestions = document.querySelectorAll(
      '.question, .mcq-question, [data-question], .exam-question'
    );

    if (index < allQuestions.length) {
      return allQuestions[index];
    }

    return null;
  }

  /**
   * Find matching option by text
   */
  findMatchingOption(questionElement, answerText) {
    const options = [];

    // Find all potential option elements
    const optionElements = questionElement.querySelectorAll(
      'input[type="radio"], input[type="checkbox"], button[data-option], label, .option, .choice'
    );

    for (const elem of optionElements) {
      let text = '';
      let value = '';

      // Extract text from different element types
      if (elem.tagName === 'INPUT') {
        const label = document.querySelector(`label[for="${elem.id}"]`);
        text = label ? label.textContent.trim() : elem.value;
        value = elem.value;
      } else if (elem.tagName === 'LABEL') {
        text = elem.textContent.trim();
        const input = elem.querySelector('input');
        value = input ? input.value : text;
      } else {
        text = elem.textContent.trim();
        value = elem.getAttribute('value') || elem.getAttribute('data-value') || text;
      }

      options.push({
        element: elem,
        text: text.toUpperCase().trim(),
        value,
        fullText: text
      });
    }

    // Match by single letter (A, B, C, D, etc.)
    const answerUpper = answerText.toUpperCase().trim();
    let exactMatch = null;
    let prefixMatch = null;

    for (const option of options) {
      // Check if answer is single letter
      if (/^[A-D]$/.test(answerUpper)) {
        // Check prefix match (A) in "A. Option text" or just "A"
        if (option.text.startsWith(answerUpper)) {
          exactMatch = option;
          break;
        }
      } else {
        // Full text match
        if (option.text.includes(answerUpper) || answerUpper.includes(option.text)) {
          exactMatch = option;
          break;
        }
      }
    }

    return exactMatch || prefixMatch || null;
  }

  /**
   * Detect input type (radio, checkbox, button, etc.)
   */
  detectInputType(option) {
    const elem = option.element;

    if (elem.tagName === 'INPUT') {
      return elem.type; // 'radio' or 'checkbox'
    }

    if (elem.tagName === 'BUTTON' || elem.hasAttribute('data-option')) {
      return 'button';
    }

    if (elem.tagName === 'LABEL') {
      const input = elem.querySelector('input');
      if (input) {
        return input.type;
      }
      return 'label';
    }

    return 'click'; // Generic click
  }

  /**
   * Click option with human-like animation
   */
  async clickOption(option, inputType) {
    const elem = option.element;

    // Scroll into view
    elem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.delay(100);

    // Add visual feedback
    this.addSelectionAnimation(elem);

    // Click based on type
    if (inputType === 'radio' || inputType === 'checkbox') {
      elem.checked = true;
      elem.dispatchEvent(new Event('change', { bubbles: true }));
      elem.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (inputType === 'label') {
      // Click associated input
      const input = elem.querySelector('input');
      if (input) {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      elem.click();
    } else {
      // Generic click
      elem.click();
    }

    // Trigger any custom events
    elem.dispatchEvent(new Event('click', { bubbles: true }));
    elem.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    await this.delay(this.animationDuration);
    this.removeSelectionAnimation(elem);
  }

  /**
   * Verify answer was selected
   */
  async verifyAnswerSelected(option, inputType) {
    await this.delay(100);

    const elem = option.element;

    if (inputType === 'radio' || inputType === 'checkbox') {
      return elem.checked;
    }

    if (inputType === 'label') {
      const input = elem.querySelector('input');
      return input ? input.checked : elem.classList.contains('selected');
    }

    // Check for visual indicator
    return elem.classList.contains('selected') || 
           elem.classList.contains('checked') ||
           elem.getAttribute('aria-selected') === 'true';
  }

  /**
   * Add visual feedback animation
   */
  addSelectionAnimation(elem) {
    elem.style.transition = `all ${this.animationDuration}ms ease`;
    elem.style.backgroundColor = 'rgba(76, 175, 80, 0.2)';
    elem.style.borderColor = '#4CAF50';
    elem.style.borderWidth = '2px';
    elem.classList.add('mcq-auto-selected');
  }

  /**
   * Remove visual feedback animation
   */
  removeSelectionAnimation(elem) {
    elem.style.backgroundColor = '';
    elem.style.borderColor = '';
    elem.classList.remove('mcq-auto-selected');
  }

  /**
   * Get CSS selector for element
   */
  getElementSelector(elem) {
    if (elem.id) {
      return `#${elem.id}`;
    }

    if (elem.name) {
      return `input[name="${elem.name}"]`;
    }

    // Build selector from classes
    if (elem.className) {
      const classes = elem.className
        .split(' ')
        .filter(c => c && !c.startsWith('mcq-'))
        .join('.');
      if (classes) {
        return `.${classes}`;
      }
    }

    // Position-based selector
    let index = 0;
    let sibling = elem;
    while (sibling.previousElementSibling) {
      sibling = sibling.previousElementSibling;
      index++;
    }

    return `${elem.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
  }

  /**
   * Highlight applied answers on page
   */
  highlightAppliedAnswers(answersWithResults) {
    for (const result of answersWithResults) {
      if (result.success && result.element) {
        const elem = result.element;
        elem.style.backgroundColor = 'rgba(76, 175, 80, 0.3)';
        elem.classList.add('mcq-answer-applied');

        // Add checkmark indicator
        const checkmark = document.createElement('span');
        checkmark.innerHTML = '✓';
        checkmark.style.cssText = `
          position: absolute;
          right: 5px;
          color: #4CAF50;
          font-weight: bold;
          font-size: 16px;
        `;
        elem.style.position = 'relative';
        elem.appendChild(checkmark);
      }
    }
  }

  /**
   * Clear highlighted answers
   */
  clearHighlights() {
    document.querySelectorAll('.mcq-answer-applied').forEach(elem => {
      elem.classList.remove('mcq-answer-applied');
      elem.style.backgroundColor = '';
      
      // Remove checkmark
      const checkmark = elem.querySelector('span');
      if (checkmark && checkmark.textContent === '✓') {
        checkmark.remove();
      }
    });
  }

  /**
   * Get all selected answers from page
   */
  getAllSelectedAnswers() {
    const selected = [];
    const questions = document.querySelectorAll('.question, .mcq-question, [data-question]');

    questions.forEach((question, index) => {
      const checkedInput = question.querySelector('input:checked');
      if (checkedInput) {
        const label = document.querySelector(`label[for="${checkedInput.id}"]`);
        const text = label ? label.textContent.trim() : checkedInput.value;

        selected.push({
          questionIndex: index,
          selectedValue: checkedInput.value,
          selectedText: text,
          inputType: checkedInput.type
        });
      }
    });

    return selected;
  }

  /**
   * Reset all selections
   */
  resetAllSelections() {
    document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(input => {
      input.checked = false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    this.clearHighlights();
  }

  /**
   * Random delay (human-like)
   */
  async randomDelay(baseMs = this.selectionDelay) {
    const variance = baseMs * 0.3;
    const delay = baseMs + (Math.random() * variance - variance / 2);
    return this.delay(Math.max(100, delay));
  }

  /**
   * Simple delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Advanced selector finder with multiple fallback strategies
   */
  findAnswerOptionAdvanced(questionElement, answerText) {
    const strategies = [
      // Strategy 1: Exact letter match
      () => this.findByExactLetter(questionElement, answerText),
      // Strategy 2: Text content match
      () => this.findByTextContent(questionElement, answerText),
      // Strategy 3: Partial match
      () => this.findByPartialMatch(questionElement, answerText),
      // Strategy 4: Data attribute match
      () => this.findByDataAttribute(questionElement, answerText),
      // Strategy 5: Index-based (fallback)
      () => this.findByIndex(questionElement, answerText)
    ];

    for (const strategy of strategies) {
      try {
        const result = strategy();
        if (result) {
          console.log('[AutoAnswer] Found answer using strategy:', strategy.name);
          return result;
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  /**
   * Find by exact letter prefix (A, B, C, D)
   */
  findByExactLetter(questionElement, answerText) {
    const letter = answerText.toUpperCase().trim()[0];
    if (!/[A-E]/.test(letter)) return null;

    const elements = questionElement.querySelectorAll(
      'input[type="radio"], input[type="checkbox"], button, label, .option, .choice'
    );

    for (const elem of elements) {
      const text = elem.textContent.toUpperCase().trim();
      if (text.startsWith(letter + '.') || text.startsWith(letter + ')') || text === letter) {
        return { element: elem, text, confidence: 0.95 };
      }
    }

    return null;
  }

  /**
   * Find by text content similarity
   */
  findByTextContent(questionElement, answerText) {
    const answerUpper = answerText.toUpperCase().trim();
    const elements = questionElement.querySelectorAll(
      'input[type="radio"], input[type="checkbox"], button, label, .option, .choice'
    );

    let bestMatch = null;
    let bestScore = 0;

    for (const elem of elements) {
      const text = elem.textContent.toUpperCase().trim();
      
      // Calculate similarity score
      const score = this.stringSimilarity(answerUpper, text);
      
      if (score > bestScore && score > 0.6) {
        bestScore = score;
        bestMatch = { element: elem, text, confidence: score };
      }
    }

    return bestMatch;
  }

  /**
   * Find by partial text match
   */
  findByPartialMatch(questionElement, answerText) {
    const answerUpper = answerText.toUpperCase().trim();
    const keywords = answerUpper.split(/\s+/).slice(0, 3);  // First 3 words

    const elements = questionElement.querySelectorAll(
      'input[type="radio"], input[type="checkbox"], button, label, .option, .choice'
    );

    for (const elem of elements) {
      const text = elem.textContent.toUpperCase().trim();
      
      let matches = 0;
      for (const keyword of keywords) {
        if (text.includes(keyword)) matches++;
      }

      if (matches >= Math.ceil(keywords.length * 0.7)) {
        return { element: elem, text, confidence: 0.8 };
      }
    }

    return null;
  }

  /**
   * Find by data attributes
   */
  findByDataAttribute(questionElement, answerText) {
    const elements = questionElement.querySelectorAll('[data-value], [data-answer], [data-option]');

    for (const elem of elements) {
      const dataValue = elem.getAttribute('data-value')?.toUpperCase() || '';
      const dataAnswer = elem.getAttribute('data-answer')?.toUpperCase() || '';
      const dataOption = elem.getAttribute('data-option')?.toUpperCase() || '';

      if (dataValue.includes(answerText[0]) || dataAnswer.includes(answerText[0]) || dataOption.includes(answerText[0])) {
        return { element: elem, text: elem.textContent.trim(), confidence: 0.85 };
      }
    }

    return null;
  }

  /**
   * Find by index (A=0, B=1, C=2, D=3)
   */
  findByIndex(questionElement, answerText) {
    const letter = answerText.toUpperCase().trim()[0];
    if (!/[A-E]/.test(letter)) return null;

    const index = letter.charCodeAt(0) - 65;  // A=0, B=1, etc.
    const elements = questionElement.querySelectorAll(
      'input[type="radio"], input[type="checkbox"], button, label, .option, .choice'
    );

    if (index < elements.length) {
      const elem = elements[index];
      return { element: elem, text: elem.textContent.trim(), confidence: 0.5 };
    }

    return null;
  }

  /**
   * Calculate string similarity (0-1)
   */
  stringSimilarity(s1, s2) {
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;

    if (longer.length === 0) return 1;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  levenshteinDistance(s1, s2) {
    const costs = [];

    for (let i = 0; i <= s1.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= s2.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[s2.length] = lastValue;
    }

    return costs[s2.length];
  }

  /**
   * Batch apply multiple answers with progress callback
   */
  async applyAnswersWithProgress(answers, conversationId, onProgress) {
    const results = [];
    const total = answers.length;

    for (let i = 0; i < answers.length; i++) {
      try {
        const result = await this.selectAnswer(answers[i], conversationId);
        results.push(result);

        if (onProgress) {
          onProgress({
            current: i + 1,
            total,
            percentage: Math.round(((i + 1) / total) * 100),
            lastResult: result
          });
        }

        if (this.humanLike) {
          await this.randomDelay(this.selectionDelay);
        }
      } catch (error) {
        results.push({
          questionIndex: answers[i].questionIndex,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Undo last selection
   */
  async undoLastSelection() {
    // Find and uncheck the most recently checked element
    const allInputs = document.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked');
    if (allInputs.length > 0) {
      const lastInput = allInputs[allInputs.length - 1];
      lastInput.checked = false;
      lastInput.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  /**
   * Get detailed selection report
   */
  getSelectionReport(answers) {
    const report = {
      totalAnswers: answers.length,
      successful: 0,
      failed: 0,
      byType: {},
      errors: []
    };

    for (const answer of answers) {
      if (answer.success) {
        report.successful++;
        if (!report.byType[answer.inputType]) {
          report.byType[answer.inputType] = 0;
        }
        report.byType[answer.inputType]++;
      } else {
        report.failed++;
        report.errors.push({
          questionIndex: answer.questionIndex,
          error: answer.error
        });
      }
    }

    report.successRate = (report.successful / report.totalAnswers) * 100;
    return report;
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AutoAnswerManager;
}
