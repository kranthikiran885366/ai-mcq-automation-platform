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
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AutoAnswerManager;
}
