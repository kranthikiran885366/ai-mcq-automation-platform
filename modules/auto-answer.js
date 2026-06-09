/**
 * Auto-Answer Selection Module
 * Supports: radio, checkbox (multi), role=radio, buttons, select, table, bare inputs
 */

var AutoAnswerManager = class AutoAnswerManager {
  constructor(config = {}) {
    this.selectionDelay    = config.selectionDelay    || 300;
    this.animationDuration = config.animationDuration || 200;
    this.verifySelection   = config.verifySelection   !== false;
    this.humanLike         = config.humanLike         !== false;
  }

  // ─── PUBLIC API ───────────────────────────────────────────────────────────

  async applyAnswers(answers, conversationId) {
    const results = [];
    answers = this._normalizeAnswerIndices(answers);

    // Group by questionIndex so multi-select checkboxes are handled together
    const grouped = new Map();
    for (const answer of answers) {
      const qi = answer.questionIndex;
      if (!grouped.has(qi)) grouped.set(qi, []);
      grouped.get(qi).push(answer.answer);
    }

    for (const [questionIndex, answerList] of grouped) {
      for (const answerText of answerList) {
        try {
          const result = await this.selectAnswer({ questionIndex, answer: answerText }, conversationId);
          results.push(result);
          if (this.humanLike) await this._randomDelay(this.selectionDelay);
        } catch (err) {
          console.error('[AutoAnswer] Failed to apply answer:', err);
          results.push({ questionIndex, success: false, error: err.message, answer: answerText });
        }
      }
    }
    return results;
  }

  async selectAnswer(answer, conversationId) {
    const { questionIndex, answer: answerText } = answer;

    const qEl = this._findQuestionContainer(questionIndex);
    if (!qEl) {
      console.warn(`[AutoAnswer] Q${questionIndex + 1} container not found — skipping`);
      return { questionIndex, success: false, answer: answerText, error: 'Question container not found' };
    }

    const option = this._resolveOption(qEl, answerText, questionIndex);
    if (!option || !option.element) {
      console.warn(`[AutoAnswer] Option "${answerText}" not found for Q${questionIndex + 1}`);
      return { questionIndex, success: false, answer: answerText, error: 'Option element not found' };
    }

    const inputType = this._inputType(option.element);
    try {
      await this._click(option.element, inputType, option);
    } catch (clickErr) {
      console.warn(`[AutoAnswer] Click failed for Q${questionIndex + 1}:`, clickErr.message);
      return { questionIndex, success: false, answer: answerText, error: clickErr.message };
    }

    const verified = !this.verifySelection || await this._verify(option.element, inputType, option);
    return {
      questionIndex, success: verified, answer: answerText, inputType,
      element: option.element,
      selectorInfo: { text: option.text, inputType, selector: this._selector(option.element) }
    };
  }

  // ─── QUESTION CONTAINER RESOLUTION ───────────────────────────────────────

  _findQuestionContainer(index) {
    // 0. Single visible MCQ (paginated exam pages: Q6/Q7 show one card at a time)
    const single = this._getSingleVisibleMCQ();
    if (single) return single;

    // 1. Detector cache (most reliable)
    const cached = this._getCachedMCQ(index);
    if (cached && cached.element && document.contains(cached.element)) return cached.element;

    // 2. data-question-index / data-q attribute
    const byAttr = document.querySelector(
      `[data-question-index="${index}"], [data-q="${index}"],` +
      `[data-question-index="${index+1}"], [data-q="${index+1}"]`
    );
    if (byAttr) return byAttr;

    // 3. Collect ALL container types, merge by position, pick by index
    const all = this._allContainersByType();
    if (index < all.length) return all[index];

    // 4. Input groups by name
    const groups = this._inputGroups();
    if (index < groups.length) return groups[index].container;

    // 5. Any card/question-like container visible on screen (single-question pages)
    const card = document.querySelector('#q-card, .q-card, .question-card, [id*="question"], [class*="question"]');
    if (card) return card;

    return null;
  }

  // Returns all detectable question containers across ALL formats, ordered by DOM position
  _isGenericQuestionWrapper(el) {
    if (!el) return false;
    const id = (el.id || '').toLowerCase();
    const cls = (el.className || '').toString().toLowerCase();
    return id === 'q-card' || id === 'q-options' || cls.includes('q-card') ||
      cls.includes('question-card') || cls.includes('exam-shell');
  }

  _allContainersByType() {
    const seen = new Set();
    const results = [];

    const add = (el) => {
      if (!el || seen.has(el)) return;
      for (const existing of [...seen]) {
        if (existing === el) return;
        // Prefer specific inner container over generic outer card (#q-card)
        if (existing.contains(el)) {
          if (this._isGenericQuestionWrapper(existing)) {
            const idx = results.indexOf(existing);
            if (idx >= 0) { results.splice(idx, 1); seen.delete(existing); }
          } else {
            return;
          }
        } else if (el.contains(existing) && this._isGenericQuestionWrapper(el)) {
          return;
        }
      }
      seen.add(el);
      results.push(el);
    };

    // Native radio/checkbox containers
    for (const el of this._allQuestionContainers()) add(el);

    // role=radio/checkbox containers
    for (const el of this._roleOptionContainers()) add(el);

    // Button option containers
    for (const el of this._buttonOptionContainers()) add(el);

    // Sort by DOM order
    results.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    return results;
  }

  _getCachedMCQ(index) {
    try {
      const detector = globalThis.__mcqDetectorInstance || null;
      const all = detector?.detectedQuestions || [];
      if (all.length === 1 && all[0]?.element && document.contains(all[0].element)) {
        return all[0];
      }
      if (detector && all[index]?.element && document.contains(all[index].element)) {
        return all[index];
      }
    } catch (_) {}
    return null;
  }

  _normalizeAnswerIndices(answers) {
    if (!Array.isArray(answers) || answers.length === 0) return answers;
    try {
      const detector = globalThis.__mcqDetectorInstance || null;
      const detected = (detector?.detectedQuestions || []).filter(m => m?.element && document.contains(m.element));
      if (detected.length === 1) {
        return answers.map(a => ({ ...a, questionIndex: 0 }));
      }
    } catch (_) {}
    return answers;
  }

  _getSingleVisibleMCQ() {
    try {
      const detector = globalThis.__mcqDetectorInstance || null;
      const all = (detector?.detectedQuestions || []).filter(m => m?.element && document.contains(m.element));
      if (all.length === 1) return all[0].element;

      // Visible card with role-radio or button options but detector not refreshed yet
      const card = document.querySelector('#q-card, .q-card, .question-card');
      if (!card) return null;
      const roleCount = card.querySelectorAll('[role="radio"], [role="option"]').length;
      const btnCount = card.querySelectorAll('.btn-opt, button.option, button.choice, button.answer, button[data-val]').length;
      const plainBtnCount = Array.from(card.children).filter(c => c.tagName === 'BUTTON').length;
      if (roleCount >= 2 || btnCount >= 2 || plainBtnCount >= 2) return card;
    } catch (_) {}
    return null;
  }

  _allQuestionContainers() {
    const selectors = [
      'fieldset', '.question', '.mcq', '.mcq-question', '.exam-question', '.quiz-question',
      '.test-question', '.survey-question', '[class*="question"]', '[data-question]', '[data-question-id]'
    ];
    const seen = new Set();
    const results = [];
    for (const sel of selectors) {
      try {
        for (const el of document.querySelectorAll(sel)) {
          const inputs = el.querySelectorAll('input[type="radio"], input[type="checkbox"]');
          if (inputs.length >= 2 && !seen.has(el)) { seen.add(el); results.push(el); }
        }
      } catch (_) {}
    }
    if (results.length === 0) {
      const nameMap = new Map();
      for (const inp of document.querySelectorAll('input[type="radio"], input[type="checkbox"]')) {
        const key = inp.name && inp.name.trim() ? inp.name.trim()
          : `__pos_${inp.getBoundingClientRect().top.toFixed(0)}`;
        if (!nameMap.has(key)) nameMap.set(key, []);
        nameMap.get(key).push(inp);
      }
      for (const [, inputs] of nameMap) {
        if (inputs.length < 2) continue;
        const c = this._walkUpToContainer(inputs[0]);
        if (!seen.has(c)) { seen.add(c); results.push(c); }
      }
    }
    return results.filter(el => !results.some(o => o !== el && o.contains(el)));
  }

  _roleOptionContainers() {
    const seen = new Set();
    const results = [];
    for (const group of document.querySelectorAll('[role="radiogroup"]')) {
      const count = group.querySelectorAll('[role="radio"], [role="option"]').length;
      if (count >= 2 && !seen.has(group)) { seen.add(group); results.push(group); }
    }
    for (const el of document.querySelectorAll('[role="radio"], [role="checkbox"], [role="option"]')) {
      // Skip if this role element is inside a native input container
      if (el.querySelector('input[type="radio"], input[type="checkbox"]')) continue;
      let node = el.parentElement;
      for (let d = 0; node && d < 6; d++) {
        const count = node.querySelectorAll('[role="radio"],[role="checkbox"],[role="option"]').length;
        if (count >= 2 && !seen.has(node)) { seen.add(node); results.push(node); break; }
        node = node.parentElement;
      }
    }
    return results;
  }

  _buttonOptionContainers() {
    const seen = new Set();
    const results = [];
    const sel = '.btn-opt, button.option, button.choice, button.answer, button[data-val], button[data-option], button[data-answer]';
    for (const wrap of document.querySelectorAll('#q-btn-group, .btn-group, [class*="btn-group"], [class*="option-group"]')) {
      const btns = wrap.querySelectorAll(sel);
      const els = btns.length >= 2 ? btns : Array.from(wrap.children).filter(c => c.tagName === 'BUTTON');
      if (els.length >= 2 && !seen.has(wrap)) { seen.add(wrap); results.push(wrap); }
    }
    for (const el of document.querySelectorAll(sel)) {
      let node = el.parentElement;
      for (let d = 0; node && d < 8; d++) {
        const found = node.querySelectorAll(sel);
        if (found.length >= 2 && !seen.has(node)) {
          seen.add(node); results.push(node); break;
        }
        const childBtns = Array.from(node.children).filter(c => c.tagName === 'BUTTON');
        if (childBtns.length >= 2 && !seen.has(node)) {
          seen.add(node); results.push(node); break;
        }
        node = node.parentElement;
      }
    }
    // Also pick up grid2col-wrap containers
    for (const el of document.querySelectorAll('.grid2col-wrap, [data-question]')) {
      if (!seen.has(el) && el.querySelectorAll('input[type="radio"]').length >= 2) {
        seen.add(el); results.push(el);
      }
    }
    return results;
  }

  _inputGroups() {
    const map = new Map();
    for (const input of document.querySelectorAll('input[type="radio"], input[type="checkbox"]')) {
      const key = input.name && input.name.trim() ? input.name.trim()
        : `__${input.type}_${input.closest('form')?.id || 'root'}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(input);
    }
    const groups = [];
    for (const [, inputs] of map) {
      if (inputs.length < 2) continue;
      groups.push({ inputs, container: this._walkUpToContainer(inputs[0]) });
    }
    return groups;
  }

  _walkUpToContainer(input) {
    let node = input.parentElement;
    for (let d = 0; node && d < 8; d++) {
      if (node.tagName === 'FIELDSET' ||
          node.querySelectorAll('input[type="radio"], input[type="checkbox"]').length >= 2)
        return node;
      node = node.parentElement;
    }
    return input.parentElement;
  }

  // ─── OPTION RESOLUTION ───────────────────────────────────────────────────

  _resolveOption(questionEl, answerText, questionIndex) {
    let ans = (answerText || '').trim();
    if (!ans) return null;

    // Normalise common prefixes
    ans = ans
      .replace(/^answer[:\s]*/i, '')
      .replace(/^option[:\s]*/i, '')
      .replace(/^\(([A-Ea-e])\)$/, '$1')       // (A) → A
      .replace(/^([A-Ea-e])[.)\s](.+)$/, '$2') // A) Paris → Paris
      .trim();

    // A. Select dropdown
    const selEl = questionEl.querySelector('select');
    if (selEl) {
      const opt = this._matchSelectOption(selEl, ans);
      if (opt) return opt;
    }

    // Build live options once for numeric check
    const liveOptions = this._buildLiveOptions(questionEl);
    const roleOptions = this._buildRoleOptions(questionEl);
    const btnOptions  = this._buildButtonOptions(questionEl);

    // All available option texts for numeric check
    const allOpts = liveOptions.length >= 2 ? liveOptions
      : roleOptions.length >= 2 ? roleOptions
      : btnOptions;
    const optionTextsAreNumeric = allOpts.length >= 2 &&
      allOpts.every(o => /^-?\d+([.,]\d+)?$/.test(o.text.trim()));

    // Only convert digit→letter when options are NOT numeric values themselves
    if (!optionTextsAreNumeric && /^[1-5]$/.test(ans)) {
      ans = String.fromCharCode(64 + parseInt(ans)); // '1'→'A'
    }

    // B. Cached options from detector
    const cached = this._getCachedMCQ(questionIndex);
    if (cached && cached.options && cached.options.length >= 2) {
      const opt = this._matchInOptions(cached.options, ans);
      if (opt) return opt;
    }

    // C. Live radio/checkbox inputs
    if (liveOptions.length >= 2) {
      const opt = this._matchInOptions(liveOptions, ans);
      if (opt) return opt;
    }

    // D. role=radio / role=checkbox elements
    if (roleOptions.length >= 2) {
      const opt = this._matchInOptions(roleOptions, ans);
      if (opt) return opt;
    }

    // E. Button options
    if (btnOptions.length >= 2) {
      const opt = this._matchInOptions(btnOptions, ans);
      if (opt) return opt;
    }

    // F. Generic clickable divs/spans with data-val or data-option
    const genericOptions = this._buildGenericOptions(questionEl);
    if (genericOptions.length >= 2) {
      const opt = this._matchInOptions(genericOptions, ans);
      if (opt) return opt;
    }

    // G. Letter → nth element fallback (inputs → role → button → generic)
    if (/^[A-Ea-e]$/.test(ans)) {
      const idx = ans.toUpperCase().charCodeAt(0) - 65;
      const inputs = Array.from(questionEl.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
      if (idx < inputs.length)       return { element: inputs[idx],      text: inputs[idx].value || ans };
      if (idx < roleOptions.length)  return roleOptions[idx];
      if (idx < btnOptions.length)   return btnOptions[idx];
      if (idx < genericOptions.length) return genericOptions[idx];
    }

    return null;
  }

  // Select dropdown option matching
  _matchSelectOption(selEl, ans) {
    const ansClean = this._normalise(ans);
    const ansUp    = ans.toUpperCase();
    const isLetter = /^[A-E]$/.test(ansUp);
    const opts     = Array.from(selEl.options).filter(o => o.value !== '');

    // Letter → index
    if (isLetter) {
      const idx = ansUp.charCodeAt(0) - 65;
      if (idx < opts.length) return { element: selEl, text: opts[idx].text, selectValue: opts[idx].value, _selectEl: selEl, _optionEl: opts[idx] };
    }
    // Text match
    for (const o of opts) {
      const t = this._normalise(o.text.replace(/^[A-Ea-e]\s*[.)\s]\s*/, ''));
      if (t === ansClean || t.includes(ansClean) || ansClean.includes(t)) {
        return { element: selEl, text: o.text, selectValue: o.value, _selectEl: selEl, _optionEl: o };
      }
    }
    return null;
  }

  _buildLiveOptions(questionEl) {
    const options = [];
    const inputs = Array.from(questionEl.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
    if (inputs.length >= 2) {
      for (let i = 0; i < inputs.length; i++) {
        const inp = inputs[i];
        let text = '';
        if (inp.id) {
          try {
            const lbl = document.querySelector(`label[for="${CSS.escape(inp.id)}"]`);
            if (lbl) text = lbl.textContent.trim();
          } catch(_) {}
        }
        if (!text) { const w = inp.closest('label'); if (w) text = w.textContent.trim(); }
        if (!text && inp.nextSibling)        text = (inp.nextSibling.textContent || '').trim();
        if (!text && inp.nextElementSibling) text = inp.nextElementSibling.textContent.trim();
        if (!text && inp.parentElement)      text = inp.parentElement.textContent.replace(inp.value || '', '').trim();
        if (!text) text = inp.value || '';
        text = this._cleanOptionText(text);
        if (text) options.push({ element: inp, text, letter: String.fromCharCode(65 + i), index: i });
      }
    }
    return options;
  }

  // Q6: role=radio divs
  _buildRoleOptions(questionEl) {
    const options = [];
    const els = Array.from(questionEl.querySelectorAll('[role="radio"], [role="checkbox"], [role="option"]'));
    for (let i = 0; i < els.length; i++) {
      const text = this._cleanOptionText(els[i].textContent.trim());
      if (text) options.push({ element: els[i], text, letter: String.fromCharCode(65 + i), index: i });
    }
    return options;
  }

  // Q7: button options — buttons or .btn-opt, never bare [data-val]
  _buildButtonOptions(questionEl) {
    const options = [];
    const sel = '.btn-opt, button.option, button.choice, button.answer, button[data-option], button[data-val], button[data-answer]';
    let els = Array.from(questionEl.querySelectorAll(sel));
    if (els.length < 2) {
      els = Array.from(questionEl.children).filter(c => c.tagName === 'BUTTON');
    }
    const seen = new Set();
    for (const el of els) {
      if (seen.has(el)) continue;
      seen.add(el);
      const text = this._cleanOptionText(el.textContent.trim());
      if (text) options.push({ element: el, text, letter: String.fromCharCode(65 + options.length), index: options.length });
    }
    return options;
  }

  // Generic clickable option elements (div/span/li with data-option, data-choice, data-answer, or role=option)
  _buildGenericOptions(questionEl) {
    const options = [];
    const seen = new Set();
    const sels = [
      '[data-option]', '[data-choice]', '[data-answer]',
      '[role="option"]', 'li.option', 'li.choice',
      '.answer-option', '.choice-item', '.option-item'
    ];
    for (const sel of sels) {
      try {
        for (const el of questionEl.querySelectorAll(sel)) {
          if (seen.has(el) || el.tagName === 'INPUT') continue;
          seen.add(el);
          const text = this._cleanOptionText(el.textContent.trim());
          if (text) options.push({ element: el, text, letter: String.fromCharCode(65 + options.length), index: options.length });
        }
      } catch (_) {}
    }
    return options;
  }

  _matchInOptions(options, answerText) {
    let ans = answerText.trim();
    // Strip letter prefix only if there's content after it
    ans = ans
      .replace(/^\(([A-Ea-e1-5])\)$/, '$1')
      .replace(/^([A-Ea-e])[.)]\s+(.+)$/, '$2') // "A) Paris" → "Paris"
      .trim();
    const ansUp = ans.toUpperCase();
    const isLetter = /^[A-E]$/.test(ansUp);

    // Strategy 1: letter → index (A=0, B=1…)
    if (isLetter) {
      const idx = ansUp.charCodeAt(0) - 65;
      if (idx < options.length) return options[idx];
    }

    const ansClean = this._normalise(ans);

    // Strategy 2: exact text match
    for (const opt of options) {
      if (this._normalise(opt.text) === ansClean) return opt;
    }

    // Strategy 3: answer contained in option text
    for (const opt of options) {
      if (ansClean.length > 1 && this._normalise(opt.text).includes(ansClean)) return opt;
    }

    // Strategy 4: option text contained in answer text
    for (const opt of options) {
      const n = this._normalise(opt.text);
      if (n.length > 1 && ansClean.includes(n)) return opt;
    }

    // Strategy 5: keyword overlap ≥70%
    const ansWords = ansClean.split(/\s+/).filter(w => w.length > 1);
    if (ansWords.length > 0) {
      let best = null, bestScore = 0;
      for (const opt of options) {
        const ow = this._normalise(opt.text).split(/\s+/).filter(w => w.length > 1);
        const hits = ansWords.filter(w => ow.includes(w)).length;
        const score = hits / ansWords.length;
        if (score >= 0.7 && score > bestScore) { bestScore = score; best = opt; }
      }
      if (best) return best;
    }

    // Strategy 6: fuzzy similarity ≥0.65
    let bestFuzzy = null, bestFuzzyScore = 0;
    for (const opt of options) {
      const score = this._similarity(ansClean, this._normalise(opt.text));
      if (score >= 0.65 && score > bestFuzzyScore) { bestFuzzyScore = score; bestFuzzy = opt; }
    }
    if (bestFuzzy) return bestFuzzy;

    // Strategy 7: letter prefix in option text
    if (isLetter) {
      for (const opt of options) {
        const t = opt.text.toUpperCase().trimStart();
        if (t.startsWith(ansUp + '.') || t.startsWith(ansUp + ')') ||
            t.startsWith(ansUp + ' ') || t === ansUp) return opt;
      }
    }

    return null;
  }

  // ─── CLICKING ─────────────────────────────────────────────────────────────

  _inputType(elem) {
    if (!elem) return 'click';
    const tag = elem.tagName;
    if (tag === 'INPUT')  return elem.type;
    if (tag === 'BUTTON') return 'button';
    if (tag === 'LABEL')  { const i = elem.querySelector('input'); return i ? i.type : 'label'; }
    if (tag === 'SELECT') return 'select';
    const role = (elem.getAttribute('role') || '').toLowerCase();
    if (role === 'radio')    return 'role-radio';
    if (role === 'checkbox') return 'role-checkbox';
    if (role === 'option')   return 'click';
    if (elem.classList.contains('btn-opt')) return 'button';
    return 'click';
  }

  async _click(elem, inputType, optionMeta) {
    if (!elem) return;
    elem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this._delay(100);
    this._highlight(elem, true);

    // Select dropdown — special handling
    if (inputType === 'select' || (optionMeta && optionMeta._selectEl)) {
      const selEl  = optionMeta?._selectEl || elem;
      const optEl  = optionMeta?._optionEl;
      if (optEl) selEl.value = optEl.value;
      selEl.dispatchEvent(new Event('change', { bubbles: true }));
      selEl.dispatchEvent(new Event('input',  { bubbles: true }));

    } else if (inputType === 'radio') {
      elem.checked = true;
      elem.dispatchEvent(new Event('change', { bubbles: true }));
      elem.dispatchEvent(new Event('input',  { bubbles: true }));
      elem.click();

    } else if (inputType === 'checkbox') {
      // Multi-select: only check, never uncheck
      // Do NOT call elem.click() — it toggles the checkbox OFF if already checked
      if (!elem.checked) {
        elem.checked = true;
        elem.dispatchEvent(new Event('change', { bubbles: true }));
        elem.dispatchEvent(new Event('input',  { bubbles: true }));
      }

    } else if (inputType === 'label') {
      const inp = elem.querySelector('input');
      if (inp) {
        if (inp.type === 'checkbox' && inp.checked) {
          // already checked — skip to avoid toggling off
        } else {
          inp.checked = true;
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          elem.click();
        }
      } else {
        elem.click();
      }

    } else if (inputType === 'role-radio') {
      // Deselect siblings, select this one
      const group = elem.closest('[role="radiogroup"]') || elem.parentElement;
      if (group) {
        group.querySelectorAll('[role="radio"]').forEach(r => {
          r.setAttribute('aria-checked', 'false');
          r.classList.remove('selected');
        });
      }
      elem.setAttribute('aria-checked', 'true');
      elem.classList.add('selected');
      elem.click();
      elem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      elem.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));

    } else if (inputType === 'role-checkbox') {
      elem.setAttribute('aria-checked', 'true');
      elem.classList.add('selected');
      elem.click();

    } else {
      // button / div / span
      elem.click();
      elem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      elem.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
    }

    elem.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    elem.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true }));

    await this._delay(this.animationDuration);
    this._highlight(elem, false);
  }

  async _verify(elem, inputType, optionMeta) {
    if (!elem) return false;
    await this._delay(100);
    if (inputType === 'select' || (optionMeta && optionMeta._selectEl)) {
      const selEl = optionMeta?._selectEl || elem;
      const optEl = optionMeta?._optionEl;
      return optEl ? selEl.value === optEl.value : selEl.value !== '';
    }
    if (inputType === 'radio' || inputType === 'checkbox') return elem.checked;
    if (inputType === 'label') {
      const inp = elem.querySelector('input'); return inp ? inp.checked : elem.classList.contains('selected');
    }
    if (inputType === 'role-radio' || inputType === 'role-checkbox') {
      return elem.getAttribute('aria-checked') === 'true';
    }
    return (
      elem.classList.contains('selected') || elem.classList.contains('checked') ||
      elem.classList.contains('active')   ||
      elem.getAttribute('aria-selected') === 'true' ||
      elem.getAttribute('aria-checked')  === 'true'
    );
  }

  // ─── HIGHLIGHT ────────────────────────────────────────────────────────────

  _highlight(elem, on) {
    if (!elem) return;
    if (on) {
      elem.style.outline = '2px solid #4CAF50'; elem.style.outlineOffset = '2px';
      elem.classList.add('mcq-auto-selected');
    } else {
      elem.style.outline = ''; elem.style.outlineOffset = '';
      elem.classList.remove('mcq-auto-selected');
    }
  }

  highlightAppliedAnswers(results) {
    for (const r of results) {
      if (!r.success || !r.element) continue;
      r.element.style.backgroundColor = 'rgba(76,175,80,0.25)';
      r.element.style.outline = '2px solid #4CAF50';
      r.element.classList.add('mcq-answer-applied');
    }
  }

  clearHighlights() {
    document.querySelectorAll('.mcq-answer-applied, .mcq-auto-selected').forEach(el => {
      el.style.backgroundColor = ''; el.style.outline = '';
      el.classList.remove('mcq-answer-applied', 'mcq-auto-selected');
    });
  }

  // ─── UTILITIES ────────────────────────────────────────────────────────────

  _cleanOptionText(text) {
    return text
      .replace(/^[A-Ea-e]\s*[.)]\s*/, '')   // strip "A) " or "A. "
      .replace(/^[①②③④⑤⑥]\s*/, '')
      .trim();
  }

  _normalise(str) {
    return str.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  _similarity(a, b) {
    const longer = a.length >= b.length ? a : b;
    const shorter = a.length >= b.length ? b : a;
    if (!longer.length) return 1;
    return (longer.length - this._editDistance(longer, shorter)) / longer.length;
  }

  _editDistance(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
    for (let j = 1; j <= b.length; j++) {
      let prev = j;
      for (let i = 1; i <= a.length; i++) {
        const val = a[i-1] === b[j-1] ? dp[i-1] : 1 + Math.min(dp[i-1], dp[i], prev);
        dp[i-1] = prev; prev = val;
      }
      dp[a.length] = prev;
    }
    return dp[a.length];
  }

  _selector(elem) {
    if (!elem) return 'unknown';
    if (elem.id)   return `#${elem.id}`;
    if (elem.name) return `[name="${elem.name}"]`;
    return (elem.tagName || 'unknown').toLowerCase();
  }

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  async _randomDelay(base) {
    const jitter = base * 0.3;
    return this._delay(Math.max(80, base + (Math.random() * jitter - jitter / 2)));
  }

  // ─── COMPAT STUBS ─────────────────────────────────────────────────────────

  getAllSelectedAnswers() {
    const out = [];
    this._allQuestionContainers().forEach((q, i) => {
      const checked = q.querySelector('input:checked');
      if (checked) {
        const lbl = checked.id ? document.querySelector(`label[for="${CSS.escape(checked.id)}"]`) : null;
        out.push({ questionIndex: i, selectedValue: checked.value,
          selectedText: lbl ? lbl.textContent.trim() : checked.value, inputType: checked.type });
      }
    });
    return out;
  }

  resetAllSelections() {
    document.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked')
      .forEach(inp => { inp.checked = false; inp.dispatchEvent(new Event('change', { bubbles: true })); });
    this.clearHighlights();
  }

  getSelectionReport(answers) {
    const r = { totalAnswers: answers.length, successful: 0, failed: 0, byType: {}, errors: [], successRate: 0 };
    for (const a of answers) {
      if (a.success) { r.successful++; r.byType[a.inputType] = (r.byType[a.inputType] || 0) + 1; }
      else { r.failed++; r.errors.push({ questionIndex: a.questionIndex, error: a.error }); }
    }
    r.successRate = r.totalAnswers ? (r.successful / r.totalAnswers) * 100 : 0;
    return r;
  }

  async applyAnswersWithProgress(answers, conversationId, onProgress) {
    const results = [];
    for (let i = 0; i < answers.length; i++) {
      try { results.push(await this.selectAnswer(answers[i], conversationId)); }
      catch (err) { results.push({ questionIndex: answers[i].questionIndex, success: false, error: err.message }); }
      if (onProgress) onProgress({ current: i+1, total: answers.length, percentage: Math.round((i+1)/answers.length*100) });
      if (this.humanLike) await this._randomDelay(this.selectionDelay);
    }
    return results;
  }
}

globalThis.AutoAnswerManager = AutoAnswerManager;
if (typeof module !== 'undefined' && module.exports) module.exports = AutoAnswerManager;
