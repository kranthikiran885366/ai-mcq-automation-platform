/**
 * Advanced MCQ Detection Engine
 * Detects MCQs on 1000+ website types with 100+ selector patterns
 */

var MCQDetector = class MCQDetector {
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
        '[class*="mcq"]', '[class*="question"]', 'fieldset',
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
        // Grid/custom radio containers
        '.grid2col-wrap', '[data-question]',
        
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

    // Strategy 1: native radio/checkbox input groups (most reliable)
    const groupedMCQs = this.detectMCQsFromInputGroups();
    detected.push(...groupedMCQs);

    // Strategy 2: button/role-radio/select/grid2col custom UIs
    const customMCQs = this.detectMCQsFromCustomUI();
    detected.push(...customMCQs);

    // Strategy 3: selector sweep — skip elements whose EXACT ref is already captured
    // NOTE: do NOT skip by containment here — a child container may be the real MCQ
    const coveredEls = new Set(detected.map(m => m.element));
    for (const selector of this.patterns.selectors) {
      try {
        for (const el of document.querySelectorAll(selector)) {
          if (coveredEls.has(el)) continue;
          const mcq = this.analyzeMCQ(el);
          if (mcq && mcq.confidence >= this.config.minConfidence) {
            detected.push(mcq);
            coveredEls.add(el);
          }
        }
      } catch (_) { continue; }
    }

    this.detectedQuestions = this.deduplicateMCQs(detected);

    // Strategy 4: visible single-question card (paginated exams — Q6 role-radio, Q7 buttons)
    if (this.detectedQuestions.length === 0) {
      const cardMcqs = this.detectMCQsFromVisibleCard();
      if (cardMcqs.length > 0) this.detectedQuestions = cardMcqs;
    }

    if (this.config.debugMode) {
      console.log('[MCQDetector] Found', this.detectedQuestions.length, 'MCQs');
    }

    return this.detectedQuestions;
  }

  /**
   * Last-resort detector for single-question pages (#q-card) with custom UI formats.
   */
  detectMCQsFromVisibleCard() {
    const card = document.querySelector('#q-card, .q-card, .question-card, [class*="question-card"]');
    if (!card) return [];

    const qText = (card.querySelector('#q-text, .q-text, .question-text, [class*="question-text"]')?.textContent || '').trim();
    const results = [];

    const roleEls = Array.from(card.querySelectorAll('[role="radio"], [role="option"]'))
      .filter(r => !r.querySelector('input[type="radio"], input[type="checkbox"]'));
    if (roleEls.length >= 2) {
      const container = roleEls[0].closest('[role="radiogroup"]') || card;
      const options = roleEls.map((el, i) => ({
        element: el, text: el.textContent.trim(), index: i, letter: String.fromCharCode(65 + i)
      }));
      results.push({
        element: container,
        text: qText || this.extractQuestionTextFromContainer(container),
        options,
        confidence: 0.95,
        selector: this.getElementSelector(container),
        type: 'role-radio',
        index: 0
      });
      return results;
    }

    const btnSel = '.btn-opt, button.option, button.choice, button.answer, button[data-val], button[data-option], button[data-answer]';
    let btnEls = Array.from(card.querySelectorAll(btnSel));
    if (btnEls.length < 2) {
      btnEls = Array.from(card.querySelectorAll('button')).filter(b => (b.textContent || '').trim().length > 0);
    }
    if (btnEls.length >= 2) {
      const container = btnEls[0].closest('#q-btn-group, .btn-group, [class*="btn-group"]') || card;
      const options = btnEls.map((el, i) => ({
        element: el, text: el.textContent.trim(), index: i, letter: String.fromCharCode(65 + i)
      }));
      results.push({
        element: container,
        text: qText || this.extractQuestionTextFromContainer(container),
        options,
        confidence: 0.95,
        selector: this.getElementSelector(container),
        type: 'button',
        index: 0
      });
    }

    return results;
  }

  /**
   * Fallback detector for button-based and role=radio custom UIs.
   * Walks up from .btn-opt / [role=radio] elements to find their container.
   */
  detectMCQsFromCustomUI() {
    const results = [];
    const seenContainers = new Set();

    // ── Button options (Q7: .btn-opt, plain <button> groups) ────────────────
    const btnSel = '.btn-opt, button.option, button.choice, button.answer, button[data-val], button[data-option], button[data-answer]';
    const pushButtonContainer = (node, btnEls) => {
      if (!node || seenContainers.has(node)) return;
      const opts = [];
      btnEls.forEach(el => {
        const text = el.textContent.trim();
        if (text) opts.push({ element: el, text, index: opts.length, letter: String.fromCharCode(65 + opts.length) });
      });
      if (opts.length < 2) return;
      seenContainers.add(node);
      results.push({
        element: node,
        text: this.extractQuestionTextFromContainer(node),
        options: opts,
        confidence: 0.95,
        selector: this.getElementSelector(node),
        type: 'button',
        index: this.detectedQuestions.length + results.length
      });
    };

    for (const btn of document.querySelectorAll(btnSel)) {
      let node = btn.parentElement;
      while (node) {
        const found = node.querySelectorAll(btnSel);
        if (found.length >= 2) {
          pushButtonContainer(node, found);
          break;
        }
        const childBtns = Array.from(node.children).filter(c => c.tagName === 'BUTTON');
        if (childBtns.length >= 2) {
          pushButtonContainer(node, childBtns);
          break;
        }
        if (node === document.body) break;
        node = node.parentElement;
      }
    }

    // Known button-group wrappers (e.g. test page #q-btn-group)
    for (const wrap of document.querySelectorAll('#q-btn-group, .btn-group, [class*="btn-group"], [class*="option-group"]')) {
      const btns = wrap.querySelectorAll(btnSel);
      const els = btns.length >= 2 ? btns : Array.from(wrap.children).filter(c => c.tagName === 'BUTTON');
      if (els.length >= 2) pushButtonContainer(wrap, els);
    }

    // ── role=radiogroup containers (Q6 direct) ─────────────────────────────
    for (const group of document.querySelectorAll('[role="radiogroup"]')) {
      if (seenContainers.has(group)) continue;
      const roleEls = Array.from(group.querySelectorAll('[role="radio"], [role="option"]'))
        .filter(r => !r.querySelector('input[type="radio"], input[type="checkbox"]'));
      if (roleEls.length < 2) continue;
      const opts = [];
      roleEls.forEach(r => {
        const text = r.textContent.trim();
        if (text) opts.push({ element: r, text, index: opts.length, letter: String.fromCharCode(65 + opts.length) });
      });
      if (opts.length < 2) continue;
      seenContainers.add(group);
      results.push({
        element: group,
        text: this.extractQuestionTextFromContainer(group),
        options: opts,
        confidence: 0.95,
        selector: this.getElementSelector(group),
        type: 'role-radio',
        index: this.detectedQuestions.length + results.length
      });
    }

    // ── role=radio / role=option containers (walk-up fallback) ───────────
    const roleSel = '[role="radio"], [role="option"]';
    for (const el of document.querySelectorAll(roleSel)) {
      // skip role elements that merely wrap a native input
      if (el.querySelector('input[type="radio"], input[type="checkbox"]')) continue;
      // Start from the element's OWN parent — check it first, then walk up
      let node = el.parentElement;
      while (node) {
        if (node.querySelectorAll(roleSel).length >= 2) {
          if (!seenContainers.has(node)) {
            seenContainers.add(node);
            const opts = [];
            node.querySelectorAll(roleSel).forEach(r => {
              // skip if it contains a native input (already handled by input group)
              if (r.querySelector('input[type="radio"], input[type="checkbox"]')) return;
              const text = r.textContent.trim();
              if (text) opts.push({ element: r, text, index: opts.length, letter: String.fromCharCode(65 + opts.length) });
            });
            if (opts.length >= 2) {
              results.push({
                element: node,
                text: this.extractQuestionTextFromContainer(node),
                options: opts,
                confidence: 0.95,
                selector: this.getElementSelector(node),
                type: 'role-radio',
                index: this.detectedQuestions.length + results.length
              });
            }
          }
          break;
        }
        if (node === document.body) break;
        node = node.parentElement;
      }
    }

    // ── select dropdowns ───────────────────────────────────────────────────
    for (const sel of document.querySelectorAll('select')) {
      const opts = Array.from(sel.options).filter(o => o.value);
      if (opts.length < 2) continue;
      const container = sel.closest('form, fieldset, .question, [class*="question"]') || sel.parentElement;
      if (seenContainers.has(container)) continue;
      seenContainers.add(container);
      results.push({
        element: container,
        text: this.extractQuestionTextFromContainer(container),
        options: opts.map((o, i) => ({ element: sel, text: o.text.trim(), index: i, letter: String.fromCharCode(65 + i) })),
        confidence: 0.95,
        selector: this.getElementSelector(container),
        type: 'select',
        index: this.detectedQuestions.length + results.length
      });
    }

    return results;
  }

  /**
   * Fallback detector for pages that use plain radio/checkbox markup.
   */
  detectMCQsFromInputGroups() {
    const groups = new Map();
    const inputs = document.querySelectorAll('input[type="radio"], input[type="checkbox"]');

    for (const input of inputs) {
      const type = input.type || 'radio';
      const name = input.name && input.name.trim() ? input.name.trim() : `__anon_${type}`;
      const container = this.findQuestionContainer(input);
      const containerKey = container ? this.getElementSelector(container) : this.getElementSelector(input.parentElement || input);
      const groupKey = `${type}|${name}|${containerKey}`;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, { type, name, container, inputs: [] });
      }

      groups.get(groupKey).inputs.push(input);
    }

    const results = [];
    for (const group of groups.values()) {
      if (group.inputs.length < 2) continue;

      const options = this.extractOptionsFromInputs(group.inputs);
      if (options.length < 2) continue;

      const host = group.container || group.inputs[0].parentElement;
      const questionText = this.extractQuestionTextFromContainer(host);

      results.push({
        element: host,
        text: questionText || 'Question',
        options,
        confidence: 0.9,
        selector: host ? this.getElementSelector(host) : 'input-group',
        type: group.type,
        index: this.detectedQuestions.length + results.length,
      });
    }

    return results;
  }

  findQuestionContainer(input) {
    let node = input.parentElement;
    for (let depth = 0; node && depth < 10; depth++) {
      const tag = node.tagName;
      const cls = (node.className || '').toString().toLowerCase();
      const hasMultipleInputs = node.querySelectorAll('input[type="radio"], input[type="checkbox"]').length >= 2;
      if (
        tag === 'FIELDSET' ||
        tag === 'FORM' ||
        cls.includes('question') ||
        cls.includes('mcq') ||
        cls.includes('quiz') ||
        cls.includes('item') ||
        cls.includes('card') ||
        hasMultipleInputs
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return input.parentElement;
  }

  extractOptionsFromInputs(inputs) {
    const options = [];
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      let text = '';

      // Associated <label for="id">
      if (input.id) {
        const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (label) text = label.textContent.trim();
      }

      // Wrapping <label>
      if (!text) {
        const wrappingLabel = input.closest('label');
        if (wrappingLabel) text = wrappingLabel.textContent.trim();
      }

      // Next sibling text node
      if (!text && input.nextSibling && input.nextSibling.textContent) {
        text = input.nextSibling.textContent.trim();
      }

      // Next element sibling (span/div)
      if (!text && input.nextElementSibling) {
        text = input.nextElementSibling.textContent.trim();
      }

      // Parent element text minus value
      if (!text && input.parentElement) {
        text = input.parentElement.textContent.replace(input.value || '', '').trim();
      }

      // value fallback
      if (!text && input.value) text = input.value.trim();

      text = text
        .replace(/^[A-E]\s*[\.\)]\s*/, '')
        .replace(/^[\u2460-\u2465]\s*/, '')
        .trim();

      if (text.length > 0) {
        options.push({
          element: input,
          text,
          index: options.length,
          letter: String.fromCharCode(65 + options.length),
        });
      }
    }
    return options;
  }

  extractQuestionTextFromContainer(container) {
    if (!container) return '';

    // 0. Common question-text nodes in card/single-question layouts
    const cardRoot = container.closest('#q-card, .q-card, .question-card, [class*="question-card"]') || container.parentElement;
    if (cardRoot) {
      const qTextEl = cardRoot.querySelector('#q-text, .q-text, .question-text, [class*="question-text"], [id*="question-text"]');
      if (qTextEl) {
        const t = (qTextEl.textContent || '').trim();
        if (t.length >= 4) return t.substring(0, 300);
      }
    }

    // 1. Look at previous siblings first (question text often precedes the options container)
    let sib = container.previousElementSibling;
    for (let i = 0; sib && i < 4; i++, sib = sib.previousElementSibling) {
      if (sib.querySelector('input, select, button.btn-opt, [role="radio"]')) break;
      const t = (sib.textContent || '').trim();
      if (t.length >= 4) return t.substring(0, 300);
    }

    // 2. Parent element's own direct text (not from nested inputs)
    if (container.parentElement) {
      const parent = container.parentElement;
      // Check parent's previous sibling
      let psib = parent.previousElementSibling;
      for (let i = 0; psib && i < 3; i++, psib = psib.previousElementSibling) {
        const t = (psib.textContent || '').trim();
        if (t.length >= 4 && !psib.querySelector('input, select')) return t.substring(0, 300);
      }
    }

    // 3. Headings/paragraphs inside container that have no inputs
    const questionCandidates = container.querySelectorAll('h1,h2,h3,h4,h5,h6,p,.question,[class*="question"]');
    for (const node of questionCandidates) {
      if (node.querySelector('input, button')) continue;
      const t = (node.textContent || '').trim();
      if (t.length >= 4) return t.substring(0, 300);
    }

    // 4. Bold/strong text
    const strong = container.querySelector('b, strong');
    if (strong) {
      const t = strong.textContent.trim();
      if (t.length >= 4) return t.substring(0, 300);
    }

    // 5. First non-empty text line in the container
    const raw = (container.textContent || '').trim();
    const firstLine = raw.split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
    return firstLine.substring(0, 300);
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

      // Check for role=radio/checkbox (Q6 format)
      if (element.querySelector('[role="radio"], [role="checkbox"], [role="option"]')) {
        confidence += 0.25;
      }

      // Check for button options (Q7 format)
      const btnOpts = element.querySelectorAll('button.btn-opt, button.option, button.choice, button.answer, .btn-opt, button[data-val], button[data-option]');
      if (btnOpts.length >= 2) {
        confidence += 0.25;
      }

      // Plain sibling <button> groups (no special class)
      const plainBtns = Array.from(element.children).filter(c => c.tagName === 'BUTTON');
      if (plainBtns.length >= 2) {
        confidence += 0.25;
      }

      // Check for labels
      if (element.querySelectorAll('label').length > 0) {
        confidence += 0.15;
      }

      // Extract options early — role-radio / button UIs should pass even with low text confidence
      const options = this.extractOptions(element);
      if (options.length < 2) {
        return null;
      }

      const mcqType = this.detectMCQType(element);
      if (mcqType === 'role-radio' || mcqType === 'button') {
        confidence = Math.max(confidence, 0.9);
      }

      if (confidence < this.config.minConfidence) {
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
    // 1. role=radio/checkbox custom UI
    const roleEls = element.querySelectorAll('[role="radio"], [role="checkbox"], [role="option"]');
    if (roleEls.length >= 2) {
      const opts = [];
      roleEls.forEach((el, i) => {
        const text = el.textContent.trim().replace(/^[A-E]\s*[.)\s]\s*/, '').replace(/^[①②③④⑤]\s*/, '').trim();
        if (text) opts.push({ element: el, text, index: opts.length, letter: String.fromCharCode(65 + opts.length) });
      });
      if (opts.length >= 2) return opts;
    }

    // 2. Button UI
    const btnEls = element.querySelectorAll('.btn-opt, button.option, button.choice, button.answer, button[data-val], button[data-option], button[data-answer]');
    if (btnEls.length >= 2) {
      const opts = [];
      btnEls.forEach(el => {
        const text = el.textContent.trim().replace(/^[A-E]\s*[.)\s]\s*/, '').replace(/^[①②③④⑤]\s*/, '').trim();
        if (text) opts.push({ element: el, text, index: opts.length, letter: String.fromCharCode(65 + opts.length) });
      });
      if (opts.length >= 2) return opts;
    }

    // 2b. Plain <button> siblings (no .btn-opt class)
    const plainBtns = Array.from(element.children).filter(c => c.tagName === 'BUTTON');
    if (plainBtns.length >= 2) {
      const opts = [];
      plainBtns.forEach(el => {
        const text = el.textContent.trim().replace(/^[A-E]\s*[.)\s]\s*/, '').replace(/^[①②③④⑤]\s*/, '').trim();
        if (text) opts.push({ element: el, text, index: opts.length, letter: String.fromCharCode(65 + opts.length) });
      });
      if (opts.length >= 2) return opts;
    }

    // 3. Native radio/checkbox — MUST use label text, not input.textContent (inputs have no text)
    const inputs = Array.from(element.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
    if (inputs.length >= 2) {
      return this.extractOptionsFromInputs(inputs);
    }

    // 4. data-attr options, labels, list items
    const fallbackSelectors = [
      '[data-option], [data-choice], [data-answer]',
      'label',
      'li.option, li.choice, .answer-option, .choice-item',
      '.option, .choice, .answer-item'
    ];
    for (const selector of fallbackSelectors) {
      let els;
      try { els = element.querySelectorAll(selector); } catch(_) { continue; }
      if (els.length < 2) continue;
      const opts = [];
      const seen = new Set();
      for (const el of els) {
        if (seen.has(el) || el.tagName === 'INPUT') continue;
        seen.add(el);
        const text = el.textContent.trim().replace(/^[A-E]\s*[.)\s]\s*/, '').replace(/^[①②③④⑤]\s*/, '').trim();
        if (text) opts.push({ element: el, text, index: opts.length, letter: String.fromCharCode(65 + opts.length) });
      }
      if (opts.length >= 2) return opts;
    }

    return [];
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
    if (element.querySelector('[role="radio"], [role="checkbox"]')) return 'role-radio';
    if (element.querySelectorAll('.btn-opt, button.option, button.choice, button[data-val]').length >= 2) return 'button';
    if (element.querySelector('input[type="radio"]'))    return 'radio';
    if (element.querySelector('input[type="checkbox"]')) return 'checkbox';
    if (element.querySelector('select'))                 return 'select';
    if (element.querySelectorAll('button').length >= 2)  return 'button';
    if (element.querySelectorAll('label').length > 0)    return 'label';
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
    const typePriority = { 'button': 0, 'role-radio': 0, 'select': 1, 'radio': 2, 'checkbox': 2, 'label': 3, 'unknown': 9 };

    const sorted = [...mcqs].sort((a, b) => {
      const p = (typePriority[a.type] ?? 5) - (typePriority[b.type] ?? 5);
      if (p !== 0) return p;
      // Prefer smaller (more specific) containers when types tie
      const aDesc = a.element ? a.element.querySelectorAll('*').length : 9999;
      const bDesc = b.element ? b.element.querySelectorAll('*').length : 9999;
      return aDesc - bDesc;
    });

    const unique = [];
    for (const mcq of sorted) {
      if (!mcq.element) continue;

      // Drop if a better MCQ already covers the same options inside a nested container
      const dominated = unique.some(kept => {
        if (!kept.element) return false;
        if (kept.element === mcq.element) return true;
        if (kept.element.contains(mcq.element)) return true;
        if (mcq.element.contains(kept.element)) {
          // Replace outer wrapper with inner specific container
          const idx = unique.indexOf(kept);
          if (idx >= 0) unique.splice(idx, 1);
          return false;
        }
        const optKey = (m) => m.options.slice(0, 4).map(o => o.text.substring(0, 20)).join('|');
        return kept.type === mcq.type && optKey(kept) === optKey(mcq);
      });
      if (dominated) continue;

      unique.push(mcq);
    }

    // Restore original DOM order
    unique.sort((a, b) => {
      if (!a.element || !b.element) return 0;
      const pos = a.element.compareDocumentPosition(b.element);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

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

globalThis.MCQDetector = MCQDetector;

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MCQDetector;
}
