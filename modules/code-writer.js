/**
 * Code Writer Module
 * Detects coding questions on page, sends to AI, auto-types the answer into the editor.
 * Supports: plain textarea, CodeMirror, Monaco Editor, ACE Editor, contenteditable code blocks.
 */

// Register shared instance so AutoFixAgent can reach CodeWriter methods
globalThis._codeWriterInstance = null;

var CodeWriter = globalThis.CodeWriter || class CodeWriter {
  constructor(config = {}) {
    this.apiBase = config.apiBase || 'http://localhost:5050/api';
    this.typeDelay = config.typeDelay || 18;   // ms between keystrokes (human-like)
    this.humanLike = config.humanLike !== false;
    this._processedSignatures = new Set();
    this._evalAllowed = undefined;
    this._pipelineBusy = false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DETECTION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Detect all coding questions + their editor elements on the current page.
   * Returns array of { question, language, editorEl, editorType }
   */
  detectCodeQuestions() {
    const PC = globalThis.PlatformConfig;
    const seenEditors = new Set();

    if (PC) {
      for (const profile of PC.getMatchingProfiles()) {
        const detected = this._detectFromPlatformProfile(profile);
        if (detected) return [detected];
      }
    }

    const results = [];

    // Strategy 1: explicit coding containers (one editor per container)
    for (const qEl of this._findCodingQuestionElements()) {
      const editorInfo = this._findNearestEditor(qEl);
      if (!editorInfo || seenEditors.has(editorInfo.editorEl)) continue;
      if (!this._isVisible(editorInfo.editorEl)) continue;

      const question = this._extractQuestionFromContainer(qEl);
      if (!question || question.length < 20) continue;

      seenEditors.add(editorInfo.editorEl);
      const language = this._detectLanguage(qEl, editorInfo.editorEl);
      results.push(this._buildCodingQuestion({
        question, language, editorInfo, questionEl: qEl
      }));
    }

    // Strategy 2: standalone visible editors (deduped, max 3)
    if (results.length === 0) {
      for (const editorInfo of this._findStandaloneEditors()) {
        if (seenEditors.has(editorInfo.editorEl) || !this._isVisible(editorInfo.editorEl)) continue;
        const question = this._extractNearbyQuestion(editorInfo.editorEl);
        if (!question || question.length < 20) continue;
        seenEditors.add(editorInfo.editorEl);
        const language = this._detectLanguage(null, editorInfo.editorEl);
        results.push(this._buildCodingQuestion({
          question, language, editorInfo, questionEl: null
        }));
        if (results.length >= 3) break;
      }
    }

    return results;
  }

  _detectFromPlatformProfile(profile) {
    const PC = globalThis.PlatformConfig;
    if (!PC || !profile) return null;

    const editorEl = PC.firstVisible(profile.editorSelectors);
    if (!editorEl) return null;

    const title = PC.firstText(profile.titleSelectors);
    const body = PC.firstText(profile.questionSelectors);
    const question = [title, body].filter(Boolean).join('\n\n').substring(0, 4000);
    if (question.length < 15) return null;

    const monacoInfo = (profile.editorType === 'monaco' || editorEl.classList?.contains('monaco-editor'))
      ? this._exportMonacoInfo() : null;
    const pageData = profile.id === 'assessment' ? this._exportPageProblemData() : null;
    const starterCode = monacoInfo?.code || editorEl.value || '';

    const language = this._detectLanguage(null, editorEl, {
      monacoInfo, starterCode, profile, pageData
    });

    const fnName = pageData?.fnName
      || editorEl.getAttribute?.('data-fn-name')
      || PC.extractFunctionName(starterCode, language)
      || this._extractFunctionNameFromText(question, starterCode, language);

    const questionEl = PC.firstVisible(profile.questionSelectors) || document.body;
    const editorType = this._resolveEditorType(profile.editorType, editorEl);
    const testCases = pageData?.cases?.length
      ? pageData.cases
      : this._extractTestCases(questionEl, question, starterCode, language);

    return {
      question,
      language,
      editorEl,
      editorType,
      questionEl,
      testCases,
      fnName,
      sortResult: !!pageData?.sortResult,
      platform: profile,
      platformId: profile.id,
      assessmentMode: profile.id === 'assessment',
      platformOnly: !PC.supportsBackendTests(language) && !PC.supportsBrowserEval(language),
      hasRunButton: !!PC.firstVisible(profile.runSelectors),
    };
  }

  _resolveEditorType(preferred, editorEl) {
    if (preferred && preferred !== 'auto') return preferred;
    const cls = (editorEl.className || '').toString().toLowerCase();
    if (cls.includes('monaco') || editorEl.hasAttribute('data-mode-id')) return 'monaco';
    if (cls.includes('codemirror') || cls.includes('cm-editor')) return 'codemirror';
    if (cls.includes('ace_editor')) return 'ace';
    if (editorEl.tagName === 'TEXTAREA') return 'textarea';
    if (editorEl.contentEditable === 'true') return 'contenteditable';
    return 'textarea';
  }

  _buildCodingQuestion({ question, language, editorInfo, questionEl }) {
    const pageData = this._exportPageProblemData();
    const PC = globalThis.PlatformConfig;
    const lang = pageData?.language || language;
    const starterCode = editorInfo.editorEl?.value || '';
    const fnName = pageData?.fnName
      || PC?.extractFunctionName(starterCode, lang)
      || this._extractFunctionNameFromText(question, starterCode, lang);
    const testCases = pageData?.cases?.length
      ? pageData.cases
      : this._extractTestCases(questionEl, question, starterCode, lang);
    const profile = PC?.getProfile('generic-editor');
    return {
      question,
      language: lang,
      editorEl: editorInfo.editorEl,
      editorType: editorInfo.type,
      questionEl,
      testCases,
      fnName,
      sortResult: !!pageData?.sortResult,
      platform: profile,
      platformId: profile?.id || 'generic',
      assessmentMode: !!document.querySelector('#code-area, #prob-desc'),
      platformOnly: PC ? !PC.supportsBackendTests(lang) && !PC.supportsBrowserEval(lang) : false,
      hasRunButton: !!(PC?.firstVisible(profile?.runSelectors) || document.querySelector('#btn-run, button[id*="run"]'))
    };
  }

  _exportMonacoInfo() {
    try {
      const holderId = 'bot-monaco-export-' + Date.now();
      const holder = document.createElement('div');
      holder.id = holderId;
      holder.style.display = 'none';
      document.documentElement.appendChild(holder);

      const script = document.createElement('script');
      script.textContent = `(function(){
        try {
          var el = document.getElementById('${holderId}');
          if (!el || !window.monaco || !window.monaco.editor) return;
          var eds = window.monaco.editor.getEditors();
          if (!eds || !eds.length) return;
          var ed = eds[0];
          var model = ed.getModel && ed.getModel();
          if (!model) return;
          el.setAttribute('data-export', JSON.stringify({
            language: model.getLanguageId ? model.getLanguageId() : '',
            code: model.getValue ? model.getValue().substring(0, 3000) : ''
          }));
        } catch(e) {}
      })();`;
      document.documentElement.appendChild(script);
      script.remove();

      const raw = holder.getAttribute('data-export');
      holder.remove();
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  _exportPageProblemData() {
    const editor = document.querySelector('#code-area, textarea[data-coding-name], textarea[data-fn-name]');
    if (editor) {
      const fnAttr = editor.getAttribute('data-fn-name');
      const casesAttr = editor.getAttribute('data-test-cases');
      const langAttr = editor.getAttribute('data-language')
        || document.querySelector('#lang-sel, select[id*="lang"]')?.value;
      if (fnAttr || casesAttr) {
        let cases = [];
        if (casesAttr) {
          try { cases = JSON.parse(casesAttr); } catch (_) {}
        }
        return {
          fnName: fnAttr || null,
          language: langAttr || null,
          sortResult: editor.getAttribute('data-sort-result') === 'true',
          cases: Array.isArray(cases) ? cases : [],
        };
      }
    }

    try {
      const holderId = 'bot-problem-export-' + Date.now();
      const holder = document.createElement('div');
      holder.id = holderId;
      holder.style.display = 'none';
      document.documentElement.appendChild(holder);

      const script = document.createElement('script');
      script.textContent = `(function(){
        try {
          var el = document.getElementById('${holderId}');
          if (!el || typeof PROBLEMS === 'undefined' || typeof curQ === 'undefined') return;
          var p = PROBLEMS[curQ];
          var lang = document.getElementById('lang-sel')?.value || 'java';
          var fn = (p.fnName && (p.fnName[lang] || p.fnName.javascript)) || null;
          var cases = [].concat(p.visibleCases || [], p.hiddenCases || [])
            .filter(function(c) { return c.exp !== null && c.exp !== undefined; })
            .map(function(c) {
              return { inputs: c.args, expected: c.exp, label: c.label || '' };
            });
          el.setAttribute('data-export', JSON.stringify({
            fnName: fn, language: lang, sortResult: !!p.sortResult, cases: cases
          }));
        } catch(e) {}
      })();`;
      document.documentElement.appendChild(script);
      script.remove();

      const raw = holder.getAttribute('data-export');
      holder.remove();
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  _extractQuestionFromContainer(qEl) {
    const title = qEl.querySelector?.('#prob-title, .prob-title, h3, h4')?.textContent?.trim();
    const body = qEl.querySelector?.('#prob-desc, .prob-desc, .problem-statement')?.innerText?.trim()
      || qEl.innerText?.trim();
    const combined = [title, body].filter(Boolean).join('\n\n');
    return (combined || qEl.textContent?.trim() || '').substring(0, 2000);
  }

  _isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  _findCodingQuestionElements() {
    const candidates = [];
    const selectors = [
      '.coding-question', '.code-question', '.programming-question',
      '.platform-card', '.hackerrank-wrap', '.leetcode-wrap',
      '.challenge-description', '.problem-statement', '.question-description',
      '.challenge-body-html', '.content__u3I1', '.question-content',
      '.problem-description', '.statement-body',
      '.quiz-question', '.exam-question', '.test-question',
      '#left', '#q-card',
    ];

    for (const sel of selectors) {
      try {
        document.querySelectorAll(sel).forEach(el => {
          if (el.closest('#prob-examples, .ex-box, #console, #console-body')) return;
          candidates.push(el);
        });
      } catch (_) {}
    }

    return [...new Set(candidates)];
  }

  _looksLikeCodingPrompt(text) {
    const keywords = [
      /\bwrite\s+a\s+(function|program|code|method|class|script)\b/i,
      /\bimplement\s+(a|the|an)?\s*(function|class|algorithm|method)\b/i,
      /\bcreate\s+a\s+(function|program|class|script)\b/i,
      /\bdefine\s+(a|the)?\s*(function|class|method)\b/i,
      /\bprint\s+(all|the|a|each)?\s*(numbers?|strings?|output)\b/i,
      /\breturn\s+(the|a|all)?\s*(sum|count|list|array|value)/i,
      /\bfind\s+(the|a|all)?\s*(maximum|minimum|sum|count|length)/i,
      /\b(input|output)\s*:/i,
      /\bexample\s*:/i,
      /function\s+\w+\s*\(/,
      /def\s+\w+\s*\(/,
      /class\s+\w+/,
    ];
    return keywords.some(r => r.test(text));
  }

  _findNearestEditor(questionEl) {
    // 1. Check INSIDE the question element first (textarea/editor is a child)
    const selfEditor = this._getEditorInContainer(questionEl);
    if (selfEditor) return selfEditor;

    // 2. Search forward siblings
    let sibling = questionEl.nextElementSibling;
    for (let i = 0; sibling && i < 8; i++, sibling = sibling.nextElementSibling) {
      const editorInfo = this._getEditorInContainer(sibling);
      if (editorInfo) return editorInfo;
    }

    // 3. Walk UP through ancestors and search each for an editor
    let node = questionEl.parentElement;
    for (let depth = 0; depth < 6; depth++) {
      if (!node) break;
      const editorInfo = this._getEditorInContainer(node);
      if (editorInfo && editorInfo.editorEl !== questionEl) return editorInfo;
      node = node.parentElement;
    }

    return null;
  }

  _findStandaloneEditors() {
    const results = [];
    const seen = new Set();

    const editorSelectors = [
      'textarea.code-answer', 'textarea[data-coding]', 'textarea[data-coding-name]',
      'textarea.hr-editor', 'textarea.lc-editor', 'textarea.cw-editor', 'textarea.replit-editor', 'textarea.cs-editor',
      '#code-area',
      '.CodeMirror', '.cm-editor',
      '.monaco-editor', '.monaco-editor-sim',
      '.ace_editor',
      '[class*="code-editor"]', '[class*="editor-container"]',
      '[data-mode-id]',
      'pre[contenteditable="true"]', 'div[contenteditable="true"]', '.ce-code',
    ];

    for (const sel of editorSelectors) {
      try {
        document.querySelectorAll(sel).forEach(el => {
          if (seen.has(el)) return;
          seen.add(el);
          const info = this._classifyEditor(el);
          if (info) results.push(info);
        });
      } catch (_) {}
    }

    return results;
  }

  _getEditorInContainer(container) {
    if (!container) return null;
    const types = [
      { sel: '.CodeMirror, .cm-editor', type: 'codemirror' },
      { sel: '.monaco-editor, [data-mode-id]', type: 'monaco' },
      { sel: '.ace_editor', type: 'ace' },
      { sel: 'textarea.code-answer, textarea[data-coding], textarea[data-coding-name], textarea[class*="editor"]', type: 'textarea' },
      { sel: 'textarea', type: 'textarea' },
      { sel: 'pre[contenteditable="true"], div[contenteditable="true"], .ce-code', type: 'contenteditable' },
    ];
    for (const { sel, type } of types) {
      const el = container.querySelector(sel);
      if (el) return { editorEl: el, type };
    }
    return null;
  }

  _classifyEditor(el) {
    const tag = el.tagName;
    const cls = (el.className || '').toLowerCase();
    if (tag === 'TEXTAREA') return { editorEl: el, type: 'textarea' };
    if (cls.includes('codemirror') || cls.includes('cm-editor')) return { editorEl: el, type: 'codemirror' };
    if (cls.includes('monaco') || el.hasAttribute('data-mode-id')) return { editorEl: el, type: 'monaco' };
    if (cls.includes('ace_editor')) return { editorEl: el, type: 'ace' };
    if (el.contentEditable === 'true') return { editorEl: el, type: 'contenteditable' };
    return null;
  }

  _extractNearbyQuestion(editorEl) {
    // Look for question text in previous siblings or parent heading
    let node = editorEl;
    for (let i = 0; i < 8; i++) {
      const prev = node.previousElementSibling || node.parentElement;
      if (!prev) break;
      const t = prev.textContent.trim();
      if (t.length > 20 && this._looksLikeCodingPrompt(t)) return t.substring(0, 500);
      node = prev;
    }
    return null;
  }

  _detectLanguage(questionEl, editorEl, ctx = {}) {
    const PC = globalThis.PlatformConfig;
    const hints = [];
    const addHint = (val, weight = 1) => {
      if (val) hints.push({ lang: String(val).trim(), weight });
    };

    // 1. Monaco language ID — highest confidence (set by the platform)
    const monacoInfo = ctx.monacoInfo || this._exportMonacoInfo();
    if (monacoInfo?.language) addHint(monacoInfo.language, 20);

    // 2. Detect from actual code in editor — very high confidence
    const editorCode = PC ? PC.unescapeHtml(monacoInfo?.code || ctx.starterCode || '') : '';
    if (editorCode && editorCode.trim().length > 10 && PC) {
      const fromCode = PC.detectLanguageFromCode(editorCode);
      if (fromCode) addHint(fromCode, 18);
    }

    // 3. Page data language attribute
    if (ctx.pageData?.language) addHint(ctx.pageData.language, 15);

    // 4. Language selector dropdown — reliable
    const langSelectors = ctx.profile?.langSelectors || [
      '#lang-sel', 'select[id*="lang"]', 'select[class*="lang"]', '.ant-select-selection-item'
    ];
    for (const sel of langSelectors) {
      try {
        document.querySelectorAll(sel).forEach(el => {
          if (el.tagName === 'SELECT') {
            addHint(el.value, 12);
            if (el.selectedOptions?.[0]) addHint(el.selectedOptions[0].textContent, 12);
          } else {
            const t = (el.textContent || '').trim();
            if (t.length > 0 && t.length < 20) addHint(t, 10);
          }
        });
      } catch (_) {}
    }

    // 5. Editor element attributes
    if (editorEl) {
      for (const attr of ['data-language', 'data-lang', 'data-mode', 'lang', 'mode']) {
        addHint(editorEl.getAttribute(attr), 8);
      }
    }

    // 6. Question element data attributes
    if (questionEl) {
      addHint(questionEl.getAttribute?.('data-language'), 6);
      const starter = questionEl.querySelector?.('.code-starter, .starter-pre, pre')?.textContent || '';
      if (starter && PC) {
        const fromStarter = PC.detectLanguageFromCode(PC.unescapeHtml(starter));
        if (fromStarter) addHint(fromStarter, 8);
      }
    }

    if (PC) {
      const lang = PC.normalizeLanguage(hints);
      if (lang) return lang;
    }
    return PC?.PIPELINE_CONFIG?.fallbackLanguage || 'python';
  }

  _normalizeLanguage(hints) {
    const PC = globalThis.PlatformConfig;
    if (PC) {
      const lang = PC.normalizeLanguage(hints);
      if (lang) return lang;
    }
    return PC?.PIPELINE_CONFIG?.fallbackLanguage || 'python';
  }

  _refineLanguageFromCode(code, language) {
    const PC = globalThis.PlatformConfig;
    return PC ? PC.refineLanguageFromCode(code, language) : language;
  }

  _buildApiMeta(language, cq) {
    const PC = globalThis.PlatformConfig;
    if (!PC) return {};
    const fnName = cq?.fnName || null;
    return {
      lang_hint: PC.getAiPromptHint(language, cq?.platformId),
      dedup_config: PC.buildDedupConfig(language, fnName),
      platform_id: cq?.platformId || null,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AI CODE GENERATION
  // ─────────────────────────────────────────────────────────────────────────

  async getCodeFromAI(question, language, provider, errorContext = null, fnName = null, mode = 'new', testCases = null, cq = null) {
    try {
      const res = await fetch(`${this.apiBase}/get-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: (question || '').substring(0, 6000),
          language, provider, mode,
          error_context: this._sanitizeErrorContext(errorContext),
          fn_name: fnName || undefined,
          test_cases: testCases || undefined,
          ...this._buildApiMeta(language, cq || { fnName })
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data.error || `Backend error: ${res.status}`;
        // Surface 429 explicitly so the pipeline can detect and handle it
        const err = new Error(res.status === 429 ? `Groq error: 429 — rate limited` : msg);
        err.status = res.status;
        throw err;
      }
      if (!data.success) throw new Error(data.error || 'AI returned no code');
      return data.code;
    } catch (e) {
      console.error('[CodeWriter] AI request failed:', e.message);
      throw e;
    }
  }

  async getFixedCodeFromAI(existingCode, question, language, provider, errorContext, fnName = null, testCases = null, cq = null) {
    try {
      const res = await fetch(`${this.apiBase}/get-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: (question || '').substring(0, 6000),
          language, provider,
          mode: 'fix',
          existing_code: (existingCode || '').substring(0, 8000),
          error_context: this._sanitizeErrorContext(errorContext),
          fn_name: fnName || undefined,
          test_cases: testCases || undefined,
          ...this._buildApiMeta(language, cq || { fnName })
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data.error || `Backend error: ${res.status}`;
        const err = new Error(res.status === 429 ? `Groq error: 429 — rate limited` : msg);
        err.status = res.status;
        throw err;
      }
      if (!data.success) throw new Error(data.error || 'AI returned no fixed code');
      return data.code;
    } catch (e) {
      console.error('[CodeWriter] AI fix request failed:', e.message);
      throw e;
    }
  }

  async _readCodeFromEditor(editorEl, editorType) {
    if (!editorEl) return '';

    if (editorType === 'monaco' || editorEl.classList?.contains?.('monaco-editor')) {
      const info = this._exportMonacoInfo();
      if (info?.code) return info.code;
    }

    if (editorType === 'codemirror') {
      const cm = editorEl.CodeMirror || editorEl.querySelector?.('.CodeMirror')?.CodeMirror;
      if (cm) return cm.getValue() || '';
    }

    if (editorType === 'ace' || editorEl.classList?.contains?.('ace_editor')) {
      try {
        const aceEd = typeof ace !== 'undefined' ? ace.edit(editorEl) : null;
        if (aceEd) return aceEd.getValue() || '';
      } catch (_) {}
    }

    const ta = editorType === 'textarea' || editorEl.tagName === 'TEXTAREA'
      ? editorEl
      : editorEl.querySelector?.('textarea');
    if (ta) return ta.value || '';

    return editorEl.textContent || '';
  }

  _isStarterOnly(code, cq) {
    if (!code || code.trim().length < 10) return true;
    const stripped = code.replace(/\/\/.*|#.*/g, '').replace(/\s+/g, ' ').trim();
    if (/pass\s*$|TODO|NotImplemented|your code here|Write your solution/i.test(stripped)) return true;
    if (cq?.fnName && !/\breturn\b/.test(code) && code.length < 200) return true;
    return false;
  }

  _shouldRetryAfterFailure(fixFailures, newCodePhase, newCodeAttempts, maxFix, maxNew, attempt, maxTotal) {
    if (attempt >= maxTotal) return false;
    if (newCodePhase) return newCodeAttempts < maxNew;
    return fixFailures < maxFix;
  }

  _bumpFailureState(fixFailures, newCodePhase, lastError, maxFix, notify) {
    if (!newCodePhase) {
      fixFailures += 1;
      if (fixFailures >= maxFix) {
        newCodePhase = true;
        fixFailures = 0;
        lastError = (lastError || '') +
          '\n\n4 fix attempts on existing code failed. Write a completely NEW solution from scratch.';
        if (notify) notify('⚠️ 4 fix attempts failed — writing new code...', 'info');
      }
    }
    return { fixFailures, newCodePhase, lastError };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WRITING INTO EDITOR
  // ─────────────────────────────────────────────────────────────────────────

  async _clearEditor(editorEl, editorType) {
    try {
      switch (editorType) {
        case 'monaco': {
          // Try injection first
          const injected = await this._setMonacoValueViaInjection('');
          if (injected) return;
          // Try direct monaco API
          try {
            const ed = window.monaco?.editor?.getEditors()?.[0];
            if (ed) { ed.setValue(''); return; }
          } catch (_) {}
          // Guaranteed fallback: select-all + delete via textarea inside Monaco
          const ta = editorEl.querySelector('textarea.inputarea, textarea');
          if (ta) {
            ta.focus();
            ta.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 65, ctrlKey: true, bubbles: true }));
            await this._delay(30);
            ta.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 46, bubbles: true }));
            await this._delay(30);
          }
          break;
        }
        case 'codemirror': {
          const cm = editorEl.CodeMirror || editorEl.querySelector?.('.CodeMirror')?.CodeMirror;
          if (cm) { cm.setValue(''); return; }
          if (window.cm6Instance || editorEl._cm6) {
            const view = window.cm6Instance || editorEl._cm6;
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } });
            return;
          }
          // Fallback: editable content area
          const cmContent = editorEl.querySelector('.cm-content, .CodeMirror-code');
          if (cmContent) {
            cmContent.focus();
            document.execCommand('selectAll');
            document.execCommand('delete');
          }
          break;
        }
        case 'ace':
          try {
            const aceEd = ace.edit(editorEl);
            if (aceEd) { aceEd.setValue('', -1); return; }
          } catch (_) {}
          break;
        default: {
          const ta = editorEl.tagName === 'TEXTAREA' ? editorEl : editorEl.querySelector('textarea');
          if (ta) {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
            if (nativeSetter) nativeSetter.call(ta, ''); else ta.value = '';
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      }
    } catch (_) {}
    await this._delay(50);
  }

  async writeCode(editorEl, editorType, code) {
    editorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this._delay(200);

    const prevHumanLike = this.humanLike;
    this.humanLike = false;

    switch (editorType) {
      case 'textarea':
        await this._writeToTextarea(editorEl, code);
        break;
      case 'codemirror':
        await this._writeToCodeMirror(editorEl, code);
        break;
      case 'monaco':
        await this._writeToMonaco(editorEl, code);
        break;
      case 'ace':
        await this._writeToAce(editorEl, code);
        break;
      case 'contenteditable':
        await this._writeToContentEditable(editorEl, code);
        break;
      default:
        await this._writeToTextarea(editorEl, code);
    }

    this.humanLike = prevHumanLike;
    this._highlight(editorEl, true);
    await this._delay(600);
    this._highlight(editorEl, false);
  }

  async _writeToTextarea(el, code) {
    el.focus();
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this._delay(80);

    // Use the native value setter so React/Vue onChange fires correctly
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(el, '');
    } else {
      el.value = '';
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));

    if (this.humanLike) {
      // Write in chunks of ~30 chars instead of char-by-char for speed
      await this._typeInChunks(el, code);
    } else {
      if (nativeSetter) {
        nativeSetter.call(el, code);
      } else {
        el.value = code;
      }
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  async _typeInChunks(el, text) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;
    const chunkSize = 30;
    let written = '';
    for (let i = 0; i < text.length; i += chunkSize) {
      written += text.substring(i, i + chunkSize);
      if (nativeSetter) {
        nativeSetter.call(el, written);
      } else {
        el.value = written;
      }
      el.selectionStart = el.selectionEnd = written.length;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await this._delay(12 + Math.random() * 8);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async _writeToCodeMirror(editorEl, code) {
    // CodeMirror 5
    if (editorEl.CodeMirror) {
      editorEl.CodeMirror.setValue(code);
      return;
    }
    // CodeMirror 5 via class lookup
    const cm5 = editorEl.querySelector('.CodeMirror')?.CodeMirror;
    if (cm5) { cm5.setValue(code); return; }

    // CodeMirror 6 — dispatch a transaction
    if (window.cm6Instance || editorEl._cm6) {
      const view = window.cm6Instance || editorEl._cm6;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
      return;
    }

    // Fallback: find the editable div inside CM and type
    const cmContent = editorEl.querySelector('.cm-content, .CodeMirror-code');
    if (cmContent) {
      cmContent.focus();
      document.execCommand('selectAll');
      document.execCommand('insertText', false, code);
      return;
    }

    // Last resort: textarea inside
    const ta = editorEl.querySelector('textarea');
    if (ta) await this._writeToTextarea(ta, code);
  }

  async _writeToMonaco(editorEl, code) {
    if (await this._setMonacoValueViaInjection(code)) return;

    try {
      const monacoEditor =
        window.monaco?.editor.getEditors()?.[0] ||
        window.__monacoEditorInstance ||
        editorEl._monacoEditor;
      if (monacoEditor) {
        monacoEditor.setValue(code);
        return;
      }
    } catch (_) {}

    const ta = editorEl.querySelector('textarea');
    if (ta) {
      await this._writeToTextarea(ta, code);
      return;
    }

    console.warn('[CodeWriter] Monaco injection failed — could not replace editor content');
  }

  _setMonacoValueViaInjection(code) {
    return new Promise((resolve) => {
      try {
        const holderId = 'bot-monaco-set-' + Date.now();
        const holder = document.createElement('div');
        holder.id = holderId;
        holder.style.display = 'none';
        document.documentElement.appendChild(holder);

        const script = document.createElement('script');
        script.textContent = `(function(){
          try {
            var el = document.getElementById('${holderId}');
            if (!el || !window.monaco || !window.monaco.editor) return;
            var eds = window.monaco.editor.getEditors();
            if (!eds || !eds.length) return;
            eds[0].setValue(${JSON.stringify(code)});
            el.setAttribute('data-ok', '1');
          } catch(e) {}
        })();`;
        document.documentElement.appendChild(script);
        script.remove();

        const ok = holder.getAttribute('data-ok') === '1';
        holder.remove();
        resolve(ok);
      } catch (_) {
        resolve(false);
      }
    });
  }

  async _writeToAce(editorEl, code) {
    // ACE stores instance on element
    try {
      const aceEditor = ace.edit(editorEl) || window.aceEditorInstance;
      if (aceEditor) { aceEditor.setValue(code, -1); return; }
    } catch (_) {}

    const aceText = editorEl.querySelector('.ace_text-input');
    if (aceText) await this._writeToTextarea(aceText, code);
  }

  async _writeToContentEditable(el, code) {
    el.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, code);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FULL PIPELINE: detect → AI → auto-fix → write → test → retry
  // ─────────────────────────────────────────────────────────────────────────

  async runPipeline(provider = 'groq', onStatus = null) {
    if (this._pipelineBusy) {
      console.log('[CodeWriter] Pipeline already running — skipped');
      if (onStatus) onStatus('⏳ Coding pipeline already running...', 'info');
      return [];
    }
    this._pipelineBusy = true;
    // Register self so AutoFixAgent can call our methods
    globalThis._codeWriterInstance = this;

    const notify = (msg, type = 'info') => {
      console.log(`[CodeWriter] ${msg}`);
      if (onStatus) onStatus(msg, type);
    };

    try {
    provider = await this._resolveProvider(provider);
    notify(`🤖 Using AI provider: ${provider}`, 'info');
    this._providerStatus = this._providerStatus || await this._fetchProviderStatus();

    const codeQuestions = this.detectCodeQuestions();
    if (codeQuestions.length === 0) {
      notify('No coding questions detected on this page', 'info');
      return [];
    }

    notify(`🔍 Detected ${codeQuestions.length} coding question(s)`, 'info');
    const results = [];
    const PC = globalThis.PlatformConfig;
    const pipeCfg = PC?.getPipelineConfig?.() || {};
    const MAX_FIX_ATTEMPTS = pipeCfg.maxFixAttempts || 4;
    const MAX_NEW_ATTEMPTS = pipeCfg.maxNewAttempts || 4;
    const MAX_TOTAL = MAX_FIX_ATTEMPTS + MAX_NEW_ATTEMPTS + (pipeCfg.maxTotalExtra || 2);

    for (let i = 0; i < codeQuestions.length; i++) {
      const cq = codeQuestions[i];
      let { question, language, editorEl, editorType, questionEl } = cq;
      const sig = question.substring(0, 60);

      if (this._processedSignatures.has(sig)) {
        notify(`Q${i + 1} already processed, skipping`, 'info');
        continue;
      }

      notify(`🌐 Detected language: ${language}`, 'info');

      const promptTestCases = this._getTestCasesForPrompt(cq, question, questionEl, null);
      if (promptTestCases.length > 0) {
        notify(`📋 ${promptTestCases.length} test case(s) loaded for AI`, 'info');
      }

      // ── Use AutoFixAgent if available (autonomous self-healing loop) ──
      const agent = globalThis.AutoFixAgent ? new globalThis.AutoFixAgent({ apiBase: this.apiBase }) : null;
      if (agent) {
        const agentResult = await agent.run(
          { ...cq, testCases: promptTestCases },
          provider,
          (msg, type) => notify(msg, type)
        );
        const finalResult = {
          questionIndex: i,
          success: agentResult.success,
          language,
          code: agentResult.code ? agentResult.code.substring(0, 120) + '...' : null,
          cycles: agentResult.cycles,
          error: agentResult.error || null,
          submitted: false,
        };
        // If agent succeeded, try to submit
        if (agentResult.success) {
          this._processedSignatures.add(sig);
          const submitted = await this._autoSubmit(editorEl, questionEl, cq.platform);
          finalResult.submitted = submitted;
          notify(submitted ? `🎉 Q${i + 1} submitted!` : `⚠️ Submit button not found`, submitted ? 'success' : 'error');
        }
        results.push(finalResult);
        if (i < codeQuestions.length - 1) await this._delay(500);
        continue;  // next question
      }

      // ── Fallback: manual fix loop (if AutoFixAgent not loaded) ──
      let code = null;
      let lastWrittenCode = null;
      let lastError = this._buildInitialPrompt(cq, promptTestCases);
      let finalResult = null;
      let fixFailures = 0;
      let newCodePhase = false;
      let newCodeAttempts = 0;

      // Read starter code ONCE before any writes happen
      const starterCode = await this._readCodeFromEditor(editorEl, editorType);
      const hasStarter = (starterCode || '').trim().length > 25 && !this._isStarterOnly(starterCode, cq);

      for (let attempt = 0; attempt <= MAX_TOTAL; attempt++) {
        try {
          const lockedLanguage = language;
          // Always use lastWrittenCode (what AI returned) for fix context, NOT the editor contents
          const codeForFix = lastWrittenCode || (hasStarter ? starterCode : null);
          const hasExisting = !!(codeForFix && codeForFix.trim().length > 25);

          if (newCodePhase) {
            notify(
              `🆕 Q${i + 1} new solution ${newCodeAttempts + 1}/${MAX_NEW_ATTEMPTS} (${lockedLanguage})...`,
              'info'
            );
            code = await this.getCodeFromAI(
              question, lockedLanguage, provider, lastError, cq.fnName, 'new', promptTestCases, cq
            );
            newCodeAttempts++;
          } else if (lastError && hasExisting && fixFailures < MAX_FIX_ATTEMPTS) {
            notify(
              `🔧 Fixing existing code ${fixFailures + 1}/${MAX_FIX_ATTEMPTS} (must pass all tests)...`,
              'info'
            );
            // Try surgical (line-level) fix first — like Cursor/Copilot agent
            const surgicalResult = await this.trySurgicalFix(
              codeForFix, question, lockedLanguage, provider, lastError, cq.fnName, promptTestCases, cq
            );
            if (surgicalResult) {
              notify('🩹 Surgical edit applied (changed only broken lines)', 'info');
              code = surgicalResult;
            } else {
              // Fall back to full-file fix
              code = await this.getFixedCodeFromAI(
                codeForFix, question, lockedLanguage, provider, lastError, cq.fnName, promptTestCases, cq
              );
            }
          } else if (fixFailures === 0 && attempt === 0 && hasStarter) {
            notify('📝 Completing existing code to pass all tests...', 'info');
            code = await this.getFixedCodeFromAI(
              starterCode, question, lockedLanguage, provider,
              lastError || 'Complete the implementation. Must pass ALL test cases.', cq.fnName, promptTestCases, cq
            );
          } else {
            notify(`✨ Generating full solution (${lockedLanguage})...`, 'info');
            code = await this.getCodeFromAI(
              question, lockedLanguage, provider, lastError, cq.fnName, 'new', promptTestCases, cq
            );
          }

          code = this._sanitizeAICode(code, lockedLanguage, cq);
          language = this._refineLanguageFromCode(code, lockedLanguage);

          if (!this._isCompleteSolution(code, language, cq)) {
            notify('⚠️ AI returned incomplete code — requesting full solution...', 'info');
            lastError = this._buildErrorContext(null, {
              errors: ['Response was incomplete — missing return statement or too short. Provide COMPLETE full working code that passes ALL test cases.']
            }, null, code, cq, promptTestCases);
            if (this._shouldRetryAfterFailure(fixFailures, newCodePhase, newCodeAttempts, MAX_FIX_ATTEMPTS, MAX_NEW_ATTEMPTS, attempt, MAX_TOTAL)) {
              ({ fixFailures, newCodePhase, lastError } = this._bumpFailureState(
                fixFailures, newCodePhase, lastError, MAX_FIX_ATTEMPTS, notify
              ));
              continue;
            }
          }

          // 2) Pre-compile validation before writing
          const validation = this._validateCode(code, language, cq);
          if (validation.errors.length > 0) {
            lastError = this._buildErrorContext(null, validation, validation.errors, code, cq, promptTestCases);
            const visErrs = validation.errors.filter(e => !this._isCspEvalError(e));
            notify(`🔧 Compile check: ${(visErrs.length ? visErrs : validation.errors).join('; ')}`, 'info');
            if (this._shouldRetryAfterFailure(fixFailures, newCodePhase, newCodeAttempts, MAX_FIX_ATTEMPTS, MAX_NEW_ATTEMPTS, attempt, MAX_TOTAL)) {
              ({ fixFailures, newCodePhase, lastError } = this._bumpFailureState(
                fixFailures, newCodePhase, lastError, MAX_FIX_ATTEMPTS, notify
              ));
              continue;
            }
            finalResult = {
              questionIndex: i, success: false, language,
              error: lastError, submitted: false
            };
            break;
          }

          // 3) Write full working code into editor — always clear first to prevent double content
          notify(`✍️ Writing full working ${language} code to editor...`, 'info');
          await this._clearEditor(editorEl, editorType);
          await this._delay(200);
          await this.writeCode(editorEl, editorType, code);
          // Verify write — if editor has >1.5x expected length, it has old content still: force clear+rewrite
          const verifyRead = await this._readCodeFromEditor(editorEl, editorType);
          if (verifyRead && verifyRead.length > code.length * 1.5) {
            notify('⚠️ Editor has duplicate content — force-clearing and rewriting...', 'info');
            await this._clearEditor(editorEl, editorType);
            await this._delay(300);
            await this.writeCode(editorEl, editorType, code);
          }
          lastWrittenCode = code;
          this._dispatchEditorEvents(editorEl, editorType);

          // 4) Compile + run tests — verify ALL test cases pass
          notify('🧪 Running tests — checking all cases pass...', 'info');
          const cycle = await this._runCompileAndTestCycle(
            code, language, question, questionEl, editorEl, cq, notify
          );

          if (cycle.compileErrors.length > 0) {
            cycle.compileErrors.forEach(err => notify(`  ❌ ${err}`, 'error'));
            // Use Cursor/Copilot agent-style fix prompt with line numbers
            lastError = this._buildAgentErrorContext(
              cycle.compileErrors.join('\n'), code, cq, promptTestCases
            ) || this._buildErrorContext(cycle.combined, validation, cycle.compileErrors, code, cq, promptTestCases);
            notify('🔄 Compile error — AI fixing to pass all tests...', 'info');
            if (this._shouldRetryAfterFailure(fixFailures, newCodePhase, newCodeAttempts, MAX_FIX_ATTEMPTS, MAX_NEW_ATTEMPTS, attempt, MAX_TOTAL)) {
              ({ fixFailures, newCodePhase, lastError } = this._bumpFailureState(
                fixFailures, newCodePhase, lastError, MAX_FIX_ATTEMPTS, notify
              ));
              continue;
            }
            finalResult = {
              questionIndex: i, success: false, language,
              testResults: cycle.combined, error: lastError, submitted: false
            };
            break;
          }

          cycle.combined.details.forEach(d =>
            notify(`  ${d.pass ? '✅' : '❌'} ${d.label}`, d.pass ? 'success' : 'error')
          );

          const needsTests = cycle.clickedRun || cq.hasRunButton
            || (cq.testCases?.length > 0) || cq.platformOnly;
          const allRunPassed = cycle.combined.total > 0 && cycle.combined.failed === 0;
          const runOk = allRunPassed
            || (!needsTests && cycle.combined.total === 0 && cycle.compileErrors.length === 0);

          if (needsTests && cycle.combined.total === 0) {
            notify('⚠️ No test results yet — retrying...', 'info');
          }

          if (!runOk) {
            const failedLabels = (cycle.combined.details || []).filter(d => !d.pass).map(d => d.label).join('\n');
            lastError = this._buildAgentErrorContext(
              failedLabels, code, cq, promptTestCases
            ) || this._buildErrorContext(cycle.combined, validation, null, code, cq, promptTestCases);
            notify(
              `🔄 ${cycle.combined.failed || 'Some'} test(s) failed — AI fixing to pass ALL cases...`,
              'info'
            );
            if (this._shouldRetryAfterFailure(fixFailures, newCodePhase, newCodeAttempts, MAX_FIX_ATTEMPTS, MAX_NEW_ATTEMPTS, attempt, MAX_TOTAL)) {
              ({ fixFailures, newCodePhase, lastError } = this._bumpFailureState(
                fixFailures, newCodePhase, lastError, MAX_FIX_ATTEMPTS, notify
              ));
              continue;
            }
            notify(`❌ Q${i + 1}: could not pass all tests`, 'error');
            finalResult = {
              questionIndex: i, success: false, language,
              testResults: cycle.combined, error: lastError, submitted: false
            };
            break;
          }

          // 5) All run-time tests passed — click Submit
          notify(`✅ Run tests passed (${cycle.combined.passed}/${cycle.combined.total}) — submitting...`, 'success');
          const submitted = await this._autoSubmit(editorEl, questionEl, cq.platform);
          if (!submitted) {
            notify('⚠️ Submit button not found', 'error');
            finalResult = {
              questionIndex: i, success: true, language,
              testResults: cycle.combined, submitted: false,
              code: code.substring(0, 120) + '...'
            };
            break;
          }

          // 6) Verify submit results (hidden test cases)
          notify('🔍 Verifying submit results...', 'info');
          const submitCheck = await this._waitForSubmitResults(editorEl, pipeCfg.submitWaitMs || 12000);
          submitCheck.details.forEach(d =>
            notify(`  ${d.pass ? '✅' : '❌'} ${d.label}`, d.pass ? 'success' : 'error')
          );

          if (!submitCheck.accepted) {
            const submitErrs = this._readPlatformCompileErrors(editorEl);
            if (submitCheck.submitResult) submitErrs.push(submitCheck.submitResult);
            lastError = this._buildErrorContext(submitCheck, validation, submitErrs, code, cq, promptTestCases);
            notify('🔄 Submit failed — AI fixing to pass all tests...', 'info');
            if (this._shouldRetryAfterFailure(fixFailures, newCodePhase, newCodeAttempts, MAX_FIX_ATTEMPTS, MAX_NEW_ATTEMPTS, attempt, MAX_TOTAL)) {
              ({ fixFailures, newCodePhase, lastError } = this._bumpFailureState(
                fixFailures, newCodePhase, lastError, MAX_FIX_ATTEMPTS, notify
              ));
              continue;
            }
            finalResult = {
              questionIndex: i, success: false, language,
              testResults: submitCheck, error: lastError, submitted: true
            };
            break;
          }

          // 7) Complete — all tests passed including submit
          this._processedSignatures.add(sig);
          notify(`🎉 Q${i + 1} complete — ${submitCheck.passed}/${submitCheck.total} all cases passed!`, 'success');
          finalResult = {
            questionIndex: i,
            success: true,
            language,
            testResults: submitCheck.total > 0 ? submitCheck : cycle.combined,
            code: code.substring(0, 120) + '...',
            submitted: true
          };
          break;

        } catch (e) {
          lastError = `Runtime error: ${e.message}`;
          const is429 = /429|rate.?limit|too many request/i.test(e.message);
          const isAuth = /401|403|not set|not configured/i.test(e.message);
          if (is429 || isAuth) {
            const prev = provider;
            provider = await this._resolveProvider(this._rotateFallbackProvider(provider));
            const waitMs = is429 ? Math.min(2000 * Math.pow(2, attempt), 16000) : 500;
            const reason = isAuth ? 'auth failed' : 'rate limited';
            notify(`⚠️ ${prev} ${reason} — switching to ${provider}, waiting ${waitMs / 1000}s...`, 'info');
            await this._delay(waitMs);
          } else {
            notify(`🔧 Error: ${e.message} — retrying...`, 'info');
          }
          if (!this._shouldRetryAfterFailure(fixFailures, newCodePhase, newCodeAttempts, MAX_FIX_ATTEMPTS, MAX_NEW_ATTEMPTS, attempt, MAX_TOTAL)) {
            notify(`❌ Q${i + 1} failed: ${e.message}`, 'error');
            finalResult = { questionIndex: i, success: false, error: e.message, submitted: false };
          } else {
            ({ fixFailures, newCodePhase, lastError } = this._bumpFailureState(
              fixFailures, newCodePhase, lastError, MAX_FIX_ATTEMPTS, notify
            ));
          }
        }
      }

      if (finalResult) results.push(finalResult);
      if (i < codeQuestions.length - 1) await this._delay(500);
    }

    return results;
    } finally {
      this._pipelineBusy = false;
    }
  }

  async _runCompileAndTestCycle(code, language, question, questionEl, editorEl, cq, notify) {
    const PC = globalThis.PlatformConfig;
    const clickedRun = await this._triggerPlatformRunButton(editorEl, cq.platform);
    const pipeCfg = PC?.getPipelineConfig?.() || {};
    if (clickedRun) notify('▶ Compiling & running tests...', 'info');
    await this._delay(clickedRun ? (pipeCfg.postRunDelayMs || 900) : 300);

    let compileErrors = this._readPlatformCompileErrors(editorEl);
    const syntaxErr = this._checkSyntax(code, language);
    if (syntaxErr && !this._isCspEvalError(syntaxErr) &&
        !compileErrors.some(e => e.includes(syntaxErr))) {
      compileErrors.push(syntaxErr);
    }

    const canBackend = PC?.supportsBackendTests(language);
    const canBrowser = PC?.supportsBrowserEval(language) && this._canEvalInPage();
    const skipLocalTests = !canBackend && !canBrowser;
    const testResults = skipLocalTests
      ? { total: 0, passed: 0, failed: 0, details: [] }
      : await this._runTestCases(code, language, question, questionEl, editorEl, cq);
    const platformResults = clickedRun
      ? await this._waitForPlatformTestResults(editorEl, pipeCfg.platformRunWaitMs || 10000)
      : { total: 0, passed: 0, failed: 0, details: [] };

    const postCompile = this._readPlatformCompileErrors(editorEl);
    compileErrors = [...new Set([...compileErrors, ...postCompile])];

    // Backend/browser failures that look like compile/runtime errors
    const runtimeFails = (testResults.details || []).filter(d =>
      !d.pass && /compile|syntax|not a function|SyntaxError/i.test(d.label)
    );
    runtimeFails.forEach(d => compileErrors.push(d.label));

    let combined;
    if (compileErrors.length > 0) {
      combined = this._mergeTestResults(testResults, platformResults);
    } else if (cq.platform && clickedRun && platformResults.total > 0 && !canBackend) {
      combined = platformResults;
    } else if (cq.assessmentMode && clickedRun && platformResults.total > 0) {
      combined = platformResults;
    } else {
      combined = this._mergeTestResults(testResults, platformResults);
    }

    return { compileErrors, testResults, platformResults, combined, clickedRun };
  }

  async _waitForSubmitResults(editorEl, maxWait = 12000) {
    const start = Date.now();
    let last = { accepted: false, submitResult: '', total: 0, passed: 0, failed: 0, details: [] };

    while (Date.now() - start < maxWait) {
      const submitText = document.querySelector('#submit-result')?.textContent?.trim() || '';
      const platformResults = this._readPlatformTestOutput(editorEl);
      const consoleText = document.querySelector('#console-body')?.textContent || '';

      const lcResult = document.querySelector('[data-e2e-locator="console-result"]')?.textContent || '';
      const hasVerdict = /Accepted|Wrong Answer|Compile Error|Runtime Error/i.test(submitText)
        || /Accepted|Wrong Answer|🎉/i.test(consoleText)
        || /Accepted|Wrong Answer|Compile Error/i.test(lcResult);

      if (hasVerdict) {
        const accepted = (/Accepted|🎉/i.test(submitText) || /Accepted|🎉/i.test(consoleText) || /Accepted/i.test(lcResult))
          && !/Wrong Answer|Compile Error|Runtime Error/i.test(submitText + consoleText + lcResult)
          && platformResults.failed === 0
          && (platformResults.total === 0 || platformResults.passed === platformResults.total);

        return {
          accepted,
          submitResult: submitText || consoleText.match(/(Accepted|Wrong Answer)[^\n]*/i)?.[0] || '',
          ...platformResults
        };
      }

      if (platformResults.total > last.total) last = { ...last, ...platformResults };
      await this._delay(500);
    }

    return last;
  }

  _readPlatformCompileErrors(editorEl) {
    const errors = [];
    const seen = new Set();
    const add = (msg) => {
      const t = (msg || '').trim().replace(/\s+/g, ' ');
      if (!t || t.length < 4 || seen.has(t)) return;
      seen.add(t);
      errors.push(t.substring(0, 500));
    };

    const root = document.querySelector('#console-body')
      || editorEl?.closest('#console, #right') || document.body;

    root.querySelectorAll('div').forEach(el => {
      const t = el.textContent?.trim() || '';
      const style = el.getAttribute('style') || '';
      if ((style.includes('f38ba8') || /^❌/.test(t)) &&
          /syntax|compile|error|not found|runtime/i.test(t)) {
        add(t);
      }
    });

    const bodyText = root.textContent || '';
    const patterns = [
      /❌\s*Syntax Error:\s*[^\n]+/i,
      /❌\s*Compile Error[^\n]*/i,
      /Function\s+[`<]?\w+[`>]?\s+not found[^\n]*/i,
      /Runtime\s*[—\-:]\s*[^\n]+/i,
    ];
    for (const re of patterns) {
      const m = bodyText.match(re);
      if (m) add(m[0]);
    }

    const runStatus = document.querySelector('#run-status')?.textContent?.trim();
    if (runStatus && /compile|error|fail/i.test(runStatus)) add(runStatus);

    const submitText = document.querySelector('#submit-result')?.textContent?.trim();
    if (submitText && /Compile Error|Syntax/i.test(submitText)) add(submitText);

    return errors;
  }

  _validateCode(code, language, cq) {
    const errors = [];
    const warnings = [];
    const PC = globalThis.PlatformConfig;
    const lang = PC ? PC.normalizeToken(language) || language : (language || '').toLowerCase();
    const langCfg = PC?.getLangConfig(lang);

    if (!code || code.trim().length < 8) errors.push('Code is empty or too short');

    // Only validate fnName if it was explicitly set on cq (from editor data-fn-name or PROBLEMS),
    // NOT if it was guessed from question text — prevents false "Missing function" on MCQ pages
    const fnName = cq?.fnName && cq.editorEl ? cq.fnName : null;
    if (fnName && !code.includes(fnName)) errors.push(`Missing function "${fnName}"`);

    const detectedLang = this._detectSourceLanguage(code);
    const expectedLang = PC ? PC.normalizeToken(lang) : lang;
    if (detectedLang && expectedLang && PC &&
        !PC.languagesMatch(expectedLang, detectedLang) &&
        detectedLang !== 'javascript') {
      errors.push(`Wrong language: generated ${detectedLang} but editor requires ${expectedLang}`);
    }

    const dupCount = fnName ? this._countFunctionDefinitions(code, fnName, lang) : 0;
    if (dupCount > 1) {
      errors.push(`Function "${fnName}" is defined ${dupCount} times — must be exactly once`);
    }

    const syntaxErr = this._checkSyntax(code, lang);
    if (syntaxErr && !this._isCspEvalError(syntaxErr)) errors.push(syntaxErr);

    const starter = cq?.questionEl?.querySelector?.('.code-starter, .starter-pre, pre')?.textContent || '';
    if (starter) {
      const clean = (s) => s.replace(/\/\/.*|#.*/g, '').replace(/\s+/g, '').trim();
      if (clean(code) === clean(starter)) errors.push('Code unchanged from starter template');
    }

    if (langCfg?.requiresReturn && !/return\s/.test(code) && !(langCfg.voidPattern && langCfg.voidPattern.test(code))) {
      warnings.push('No return statement found');
    }

    return { errors, warnings, fnName };
  }

  _isCspEvalError(msg) {
    return /content security policy|unsafe-eval|evaluating a string as javascript/i.test(msg || '');
  }

  _canEvalInPage() {
    if (this._evalAllowed !== undefined) return this._evalAllowed;
    try {
      // eslint-disable-next-line no-new-func
      new Function('return 1')();
      this._evalAllowed = true;
    } catch (e) {
      this._evalAllowed = !this._isCspEvalError(e.message);
    }
    return this._evalAllowed;
  }

  _sanitizeErrorContext(text) {
    if (!text) return null;
    return text
      .replace(/Content Security Policy[^\n]*/gi, '')
      .replace(/unsafe-eval[^\n]*/gi, '')
      .replace(/chrome-extension:\/\/[^\s"']*/gi, '')
      .replace(/script-src[^\n]*/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .substring(0, 3500) || null;
  }

  _buildInitialPrompt(cq, testCases) {
    const parts = [
      'Write COMPLETE full working code that passes ALL test cases below.',
      'Must compile and run correctly. No partial code. No TODO stubs.'
    ];
    if (cq?.fnName) {
      parts.push(`Function/method name: "${cq.fnName}" in ${cq.language || 'selected language'}.`);
    }
    const casesText = this._formatTestCasesForPrompt(testCases);
    if (casesText) {
      parts.push('TEST CASES (must pass ALL):\n' + casesText);
    }
    return parts.join('\n\n');
  }

  _getTestCasesForPrompt(cq, question, questionEl, code) {
    let cases = cq?.testCases || [];
    if (cases.length === 0 && question) {
      cases = this._extractTestCases(questionEl, question, code, cq?.language);
    }
    return cases.slice(0, 12).map(tc => ({
      inputs: tc.inputs,
      expected: tc.expected,
      label: tc.label || tc.inputStr || ''
    }));
  }

  _formatTestCasesForPrompt(testCases) {
    if (!testCases?.length) return '';
    return testCases.map((tc, i) => {
      const inp = JSON.stringify(tc.inputs);
      const exp = JSON.stringify(tc.expected);
      return `  Test ${i + 1}${tc.label ? ` (${tc.label})` : ''}: input=${inp} → expected=${exp}`;
    }).join('\n');
  }

  /**
   * SURGICAL FIX — Cursor/Copilot agent model.
   * Sends existing code + error to AI asking for a SEARCH/REPLACE diff only.
   * Applies only the changed lines without replacing the whole editor content.
   * Returns the patched code string, or null if surgical edit failed/didn’t apply.
   */
  async trySurgicalFix(existingCode, question, language, provider, errorContext, fnName, testCases, cq) {
    const EH = globalThis.ErrorHandler ? new (globalThis.ErrorHandler)() : null;
    if (!EH || !existingCode || !errorContext) return null;

    try {
      const prompt = EH.buildSurgicalEditPrompt(existingCode, language, errorContext, fnName, testCases);
      const res = await fetch(`${this.apiBase}/get-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: prompt,  // the surgical prompt IS the full instruction
          language, provider,
          mode: 'fix',
          existing_code: existingCode,
          fn_name: fnName || undefined,
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success || !data.code) return null;

      const diffs = EH.parseSurgicalDiff(data.code);
      if (!diffs || !diffs.length) return null;

      const { code: patched, applied, failed } = EH.applySurgicalDiffs(existingCode, diffs);
      if (applied === 0) return null;

      console.log(`[CodeWriter] Surgical edit: ${applied} patch(es) applied, ${failed} failed`);
      // Sanitize after patching to catch any remaining issues
      return this._sanitizeAICode(patched, language, cq);
    } catch (e) {
      console.warn('[CodeWriter] Surgical fix failed:', e.message);
      return null;
    }
  }

  _buildAgentErrorContext(rawError, code, cq, testCases) {
    // Use ErrorHandler's Cursor/Copilot-style diagnostic parser if available
    const EH = globalThis.ErrorHandler ? new (globalThis.ErrorHandler)() : null;
    if (EH) {
      const diagnostics = EH.parseErrorDiagnostics(rawError, code);
      const formatted = EH.formatDiagnosticsForAI(diagnostics);
      // If we got structured diagnostics, use agent-style prompt
      if (formatted) {
        return EH.buildAgentFixPrompt(
          code,
          cq?.language || 'javascript',
          formatted,
          cq?.fnName,
          testCases
        );
      }
    }
    // Fallback to existing _buildErrorContext
    return null;
  }

  _buildErrorContext(testResults, validation, compileErrors, code, cq, testCases = null) {
    const parts = [];

    parts.push(
      'TASK: Fix the existing solution so it PASSES ALL test cases below.\n' +
      'Return the COMPLETE full working code file — not a diff, not a snippet, not partial.\n' +
      'The code must compile, run, and pass every test case (100% pass rate).'
    );

    if (cq?.fnName) {
      parts.push(`REQUIRED: function/method must be named "${cq.fnName}" in ${cq.language || 'the selected language'}.`);
    }

    const cases = testCases || cq?.testCases || [];
    const casesText = this._formatTestCasesForPrompt(cases);
    if (casesText) {
      parts.push('ALL TEST CASES (solution MUST pass every one):\n' + casesText);
    }

    const compiles = (compileErrors || []).filter(e => !this._isCspEvalError(e));
    if (compiles.length) {
      parts.push('COMPILE / RUNTIME ERRORS:\n' + compiles.map(e => `- ${e}`).join('\n'));
    }

    if (validation?.errors?.length) {
      parts.push('VALIDATION ERRORS:\n' + validation.errors.map(e => `- ${e}`).join('\n'));
    }

    if (validation?.warnings?.length) {
      parts.push('WARNINGS:\n' + validation.warnings.map(w => `- ${w}`).join('\n'));
    }

    if (testResults?.details?.length) {
      const failed = testResults.details.filter(d => !d.pass);
      if (failed.length) {
        parts.push('FAILED TEST CASES (fix these):\n' + failed.map(d => `- ${d.label}`).join('\n'));
      }
      const passed = testResults.details.filter(d => d.pass).length;
      parts.push(`Current score: ${passed}/${testResults.details.length} passed — need ALL to pass.`);
    }

    if (testResults?.submitResult) {
      parts.push('SUBMIT RESULT: ' + testResults.submitResult);
    }

    parts.push(
      'OUTPUT RULES:\n' +
      '- Return ONE complete ' + (cq?.language || 'solution') + ' file\n' +
      '- Full working code with all imports/class/def included\n' +
      '- No markdown, no explanation, no duplicate functions\n' +
      '- Must pass ALL test cases listed above'
    );

    return parts.join('\n\n') || 'Fix the code to pass all test cases. Return complete working code only.';
  }

  _isCompleteSolution(code, language, cq) {
    const PC = globalThis.PlatformConfig;
    if (PC) return PC.isCompleteSolution(code, language, cq?.fnName);
    return !!(code && code.trim().length >= 30);
  }

  _mergeTestResults(a, b) {
    const details = [...(a?.details || []), ...(b?.details || [])];
    return {
      total: details.length,
      passed: details.filter(d => d.pass).length,
      failed: details.filter(d => !d.pass).length,
      details
    };
  }

  async _waitForPlatformTestResults(editorEl, maxWait = 6000) {
    const start = Date.now();
    let last = { total: 0, passed: 0, failed: 0, details: [] };
    while (Date.now() - start < maxWait) {
      const r = this._readPlatformTestOutput(editorEl);
      if (r.total > 0) {
        if (r.total === last.total && r.passed === last.passed) return r;
        last = r;
        if (r.failed === 0) return r;
      }
      await this._delay(500);
    }
    return last;
  }

  async _autoSubmit(editorEl, questionEl, platform) {
    await this._delay(300);
    if (await this._triggerPlatformSubmitButton(editorEl, questionEl, platform)) return true;
    return this._triggerPageNavSubmit();
  }

  async _triggerPlatformSubmitButton(editorEl, questionEl, platform) {
    const PC = globalThis.PlatformConfig;
    const submitSelectors = platform?.submitSelectors || [
      '[data-e2e-locator="console-submit-button"]', '#btn-submit',
      'button[id*="submit"]', 'button[class*="submit"]', '[data-testid*="submit"]',
    ];
    const btn = PC?.firstVisible(submitSelectors);
    if (btn && !btn.disabled) {
      btn.click();
      await this._delay(PC?.getPostRunDelay(platform?.id) || 500);
      return true;
    }

    const submitBtn = document.querySelector('#btn-submit');
    if (submitBtn && !submitBtn.disabled && this._isVisible(submitBtn)) {
      submitBtn.click();
      await this._delay(500);
      return true;
    }

    const roots = [
      editorEl?.closest('.platform-card, .hackerrank-wrap, .leetcode-wrap, .cw-wrap, .replit-wrap, .cs-wrap, .code-question, .card-body, #q-card, #console, [class*="challenge"]'),
      questionEl?.closest?.('#q-card, .platform-card, form'),
      document
    ].filter(Boolean);

    const submitRe = /\b(submit|save solution|save & submit|hand in|turn in|finish|complete|confirm)\b/i;
    const excludeRe = /\b(run|test|execute|check|reset|clear|cancel|debug|compile)\b/i;

    for (const root of roots) {
      const candidates = root.querySelectorAll(
        'button, input[type="submit"], a.btn, a.button, [role="button"], .nav-btn'
      );
      for (const btn of candidates) {
        if (btn.disabled || btn.offsetParent === null) continue;
        const txt = [
          btn.textContent, btn.value, btn.getAttribute('aria-label'),
          btn.getAttribute('title'), btn.id, btn.className
        ].filter(Boolean).join(' ');
        if (submitRe.test(txt) && !excludeRe.test(txt)) {
          btn.click();
          await this._delay(400);
          return true;
        }
      }
    }
    return false;
  }

  _triggerPageNavSubmit() {
    const navBtns = document.querySelectorAll('#btn-submit, #btn-next, button.nav-btn, .nav-btn');
    for (const btn of navBtns) {
      const style = window.getComputedStyle(btn);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const txt = (btn.textContent || '').toLowerCase();
      if (/submit|next|continue|finish|save/.test(txt) && !/prev|back|cancel/.test(txt)) {
        btn.click();
        return true;
      }
    }
    const form = document.querySelector('form');
    if (form) {
      try { form.requestSubmit?.() || form.submit(); return true; } catch (_) {}
    }
    return false;
  }

  _dispatchEditorEvents(editorEl, editorType) {
    const el = editorType === 'textarea' ? editorEl : editorEl.querySelector('textarea') || editorEl;
    if (el && el.tagName === 'TEXTAREA') {
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    }
    if (editorType === 'contenteditable') {
      editorEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  _checkSyntax(code, language) {
    const PC = globalThis.PlatformConfig;
    const lang = PC ? PC.normalizeToken(language) || language : (language || '').toLowerCase();
    const basic = PC?.checkBasicSyntax(code, lang);
    if (basic) return basic;

    const langCfg = PC?.getLangConfig(lang);
    if (langCfg?.browserEval) {
      if (!this._canEvalInPage()) return null;
      try {
        // eslint-disable-next-line no-new-func
        new Function(code);
        return null;
      } catch (e) {
        if (this._isCspEvalError(e.message)) return null;
        return `SyntaxError: ${e.message}`;
      }
    }
    return null;
  }

  async _triggerPlatformRunButton(editorEl, platform) {
    const PC = globalThis.PlatformConfig;
    const runSelectors = platform?.runSelectors || [
      '[data-e2e-locator="console-run-button"]', '#btn-run', 'button[id*="run"]',
      'button[class*="run"]', '[data-testid*="run"]', 'button[aria-label*="Run"]',
    ];
    const btn = PC?.firstVisible(runSelectors);
    if (btn && !btn.disabled) {
      btn.click();
      await this._delay(PC?.getPostRunDelay(platform?.id) || 400);
      return true;
    }

    const globalRun = document.querySelector('#btn-run');
    if (globalRun && !globalRun.disabled && this._isVisible(globalRun)) {
      globalRun.click();
      await this._delay(400);
      return true;
    }

    const root = editorEl.closest(
      '.platform-card, .hackerrank-wrap, .leetcode-wrap, .cw-wrap, .replit-wrap, .cs-wrap, .code-question, [class*="challenge"], [class*="editor"], #right'
    ) || editorEl.parentElement?.parentElement;
    if (!root) return false;

    const runRe = /\b(run|run code|run test|run tests|test code|execute|check solution|validate)\b/i;
    const excludeRe = /\b(submit|save|reset|clear|cancel|debug)\b/i;

    const selectors = [
      '#btn-run', '.hr-run-btn', '.cw-btn', 'button[class*="run"]', '[data-testid*="run"]',
      'button[id*="run"]', 'button[aria-label*="Run"]', 'button[title*="Run"]', 'button'
    ];
    for (const sel of selectors) {
      try {
        for (const btn of root.querySelectorAll(sel)) {
          if (btn.disabled || !this._isVisible(btn)) continue;
          const txt = (btn.textContent || btn.getAttribute('aria-label') || btn.id || '').trim();
          if (runRe.test(txt) && !excludeRe.test(txt)) {
            btn.click();
            await this._delay(400);
            return true;
          }
        }
      } catch (_) {}
    }
    return false;
  }

  _readPlatformTestOutput(editorEl) {
    const consoleBody = document.querySelector('#console-body');
    const root = consoleBody
      || editorEl.closest('.platform-card, .card-body, #q-card, #console, [class*="challenge"]')
      || document.body;
    const details = [];
    const seen = new Set();

    const add = (pass, label) => {
      const key = (pass ? 'P:' : 'F:') + label;
      if (!label || seen.has(key)) return;
      seen.add(key);
      details.push({ pass, label: label.substring(0, 150) });
    };

    root.querySelectorAll('.tc.pass, .tc-pass, .test-case.pass, [class*="test-pass"], .vi-pass').forEach(el => {
      const lbl = el.querySelector('.tc-lbl')?.textContent?.trim() || el.textContent.trim();
      add(true, lbl);
    });
    root.querySelectorAll('.tc.fail, .tc-fail, .test-case.fail, [class*="test-fail"], .vi-fail, .err-panel').forEach(el => {
      const lbl = el.querySelector('.tc-lbl')?.textContent?.trim() || el.textContent.trim();
      add(false, lbl);
    });

    root.querySelectorAll('.tc, .test-case, .val-item, [class*="test-result"]').forEach(el => {
      if (el.classList.contains('run')) return;
      const t = el.querySelector('.tc-lbl')?.textContent?.trim() || el.textContent.trim();
      if (!t) return;
      const pass = el.classList.contains('pass') || el.classList.contains('tc-pass') || el.classList.contains('vi-pass')
        || /✅/.test(t);
      const fail = el.classList.contains('fail') || el.classList.contains('tc-fail') || el.classList.contains('vi-fail')
        || /❌/.test(t);
      if (pass) add(true, t);
      else if (fail) add(false, t);
    });

    const lcResult = document.querySelector(
      '[data-e2e-locator="console-result"], [data-e2e-locator*="result"], .result-state'
    );
    if (lcResult) {
      const lt = lcResult.textContent?.trim() || '';
      if (/accepted/i.test(lt)) add(true, 'Accepted');
      else if (/wrong answer/i.test(lt)) add(false, 'Wrong Answer');
      else if (/compile error|runtime error|time limit/i.test(lt)) add(false, lt.substring(0, 120));
    }

    const bodyText = root.textContent || '';
    if (/accepted/i.test(bodyText) && !details.some(d => d.pass)) add(true, 'Accepted');
    if (/wrong answer/i.test(bodyText) && !details.some(d => !d.pass)) add(false, 'Wrong Answer');

    const passMatch = bodyText.match(/(\d+)\s*\/\s*(\d+)\s*(?:visible\s+)?cases?\s+passed/i)
      || bodyText.match(/(\d+)\s*\/\s*(\d+)\s*tests?\s*pass/i);
    if (passMatch && details.length === 0) {
      const passed = parseInt(passMatch[1], 10);
      const total = parseInt(passMatch[2], 10);
      for (let i = 0; i < total; i++) {
        add(i < passed, `Test ${i + 1}`);
      }
    }

    return {
      total: details.length,
      passed: details.filter(d => d.pass).length,
      failed: details.filter(d => !d.pass).length,
      details
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATIC AUTO-FIX (no API call — runs before every write)
  // ─────────────────────────────────────────────────────────────────────────

  _sanitizeAICode(code, language, cq) {
    const PC = globalThis.PlatformConfig;
    if (PC) {
      return PC.sanitizeCode(code, language, {
        fnName: cq?.fnName || PC.extractFunctionName(code, language),
        platformId: cq?.platformId,
      });
    }
    return (code || '').trim();
  }

  _detectSourceLanguage(code) {
    const PC = globalThis.PlatformConfig;
    return PC ? PC.detectLanguageFromCode(code) : null;
  }

  _countFunctionDefinitions(code, fnName, language) {
    const PC = globalThis.PlatformConfig;
    return PC ? PC.countDefinitions(code, fnName, language) : 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DYNAMIC TEST CASE EXTRACTION + RUNNER (no hardcoded per-problem tests)
  // ─────────────────────────────────────────────────────────────────────────

  _extractFunctionNameFromText(questionText, code, language) {
    const PC = globalThis.PlatformConfig;
    if (PC) return PC.extractFunctionNameFromText(questionText, code, language);
    return this._extractFunctionName(code, language);
  }

  _extractFunctionName(code, language) {
    const PC = globalThis.PlatformConfig;
    return PC ? PC.extractFunctionName(code, language) : null;
  }

  _extractTestCases(questionEl, questionText, code, language) {
    const cases = [];
    const seen = new Set();
    const add = (inputs, expected, label) => {
      if (expected === undefined) return;
      const inputArr = Array.isArray(inputs) ? inputs : [inputs];
      const key = JSON.stringify({ inputs: inputArr, expected });
      if (seen.has(key)) return;
      seen.add(key);
      cases.push({
        inputs: inputArr,
        expected,
        inputStr: label || inputArr.map(v => JSON.stringify(v)).join(', '),
        label: label || `case_${cases.length + 1}`
      });
    };

    const roots = new Set();
    if (questionEl) {
      roots.add(questionEl);
      const card = questionEl.closest('.code-question, .platform-card, .card-body, [data-coding], [data-coding-name]');
      if (card) roots.add(card);
    }
    document.querySelectorAll(
      '#code-area[data-test-cases], textarea[data-test-cases], [data-test-cases], [data-testcases], script[type="application/json"][id*="test"]'
    ).forEach(el => {
      if (!questionEl || questionEl.contains(el) || el.closest('.platform-card, .code-question') === questionEl?.closest('.platform-card, .code-question')) {
        roots.add(el);
      }
    });

    for (const root of roots) {
      if (!root) continue;
      for (const attr of ['data-test-cases', 'data-testcases', 'data-tests']) {
        const raw = root.getAttribute?.(attr);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          (Array.isArray(parsed) ? parsed : [parsed]).forEach(tc => {
            add(tc.inputs ?? tc.input, tc.expected, tc.label);
          });
        } catch (_) {}
      }
      if (root.tagName === 'SCRIPT') {
        try {
          const parsed = JSON.parse(root.textContent.trim());
          (Array.isArray(parsed) ? parsed : [parsed]).forEach(tc => {
            add(tc.inputs ?? tc.input, tc.expected, tc.label);
          });
        } catch (_) {}
      }
    }

    document.querySelectorAll('[data-test-input][data-test-expected]').forEach(row => {
      const scope = questionEl ? (questionEl.contains(row) || questionEl.closest('.platform-card')?.contains(row)) : true;
      if (!scope) return;
      try {
        const inputs = JSON.parse(row.getAttribute('data-test-input'));
        const expected = JSON.parse(row.getAttribute('data-test-expected'));
        add(inputs, expected, row.textContent?.trim()?.substring(0, 40));
      } catch (_) {}
    });

    const fnName = this._extractFunctionNameFromText(questionText, code, language);
    if (fnName && questionText) {
      this._parseExamplesFromText(questionText, fnName).forEach(tc => add(tc.inputs, tc.expected, tc.inputStr));
    }

    return cases.slice(0, 12);
  }

  async _runTestCases(code, language, questionText, questionEl, editorEl, cqMeta) {
    const empty = { total: 0, passed: 0, failed: 0, details: [] };
    const fnName = this._extractFunctionName(code, language)
      || cqMeta?.fnName
      || this._extractFunctionNameFromText(questionText, code, language);
    if (!fnName) return empty;

    let cases = this._extractTestCases(questionEl, questionText, code, language);
    if (cases.length === 0 && cqMeta?.testCases?.length) cases = cqMeta.testCases;
    if (cases.length === 0) return empty;

    const PC = globalThis.PlatformConfig;
    const lang = PC
      ? (PC.getBackendRunner(language) || PC.normalizeToken(language))
      : (language || '').toLowerCase().replace('typescript', 'javascript').replace('python3', 'python');

    const sortResult = !!cqMeta?.sortResult;

    if (PC?.supportsBrowserEval(language) && this._canEvalInPage()) {
      const browser = this._runTestCasesInBrowser(code, fnName, cases, sortResult);
      if (browser.total > 0) return browser;
    }

    if (!PC?.supportsBackendTests(language)) {
      return empty;
    }

    return await this._runTestCasesViaBackend(code, lang, fnName, cases, sortResult);
  }

  _runTestCasesInBrowser(code, fnName, cases, sortResult = false) {
    if (!this._canEvalInPage()) {
      return { total: 0, passed: 0, failed: 0, details: [] };
    }

    const details = [];
    let fn;
    try {
      // eslint-disable-next-line no-new-func
      fn = new Function(code + `\nreturn typeof ${fnName} !== 'undefined' ? ${fnName} : undefined;`)();
    } catch (e) {
      if (this._isCspEvalError(e.message)) {
        return { total: 0, passed: 0, failed: 0, details: [] };
      }
      return { total: cases.length, passed: 0, failed: cases.length,
        details: cases.map(tc => ({ pass: false, label: `Compile error: ${e.message}` })) };
    }
    if (typeof fn !== 'function') {
      return { total: cases.length, passed: 0, failed: cases.length,
        details: [{ pass: false, label: `"${fnName}" is not a function` }] };
    }
    for (const tc of cases) {
      try {
        const got = fn(...tc.inputs);
        const gotN = sortResult && Array.isArray(got) ? [...got].sort((a, b) => a - b) : got;
        const expN = sortResult && Array.isArray(tc.expected) ? [...tc.expected].sort((a, b) => a - b) : tc.expected;
        const pass = JSON.stringify(gotN) === JSON.stringify(expN);
        details.push({
          pass,
          label: `${fnName}(${tc.inputStr}) → got ${JSON.stringify(gotN)}, expected ${JSON.stringify(expN)}`
        });
      } catch (e) {
        details.push({ pass: false, label: `${fnName}(${tc.inputStr}) → ${e.message}` });
      }
    }
    return {
      total: details.length,
      passed: details.filter(d => d.pass).length,
      failed: details.filter(d => !d.pass).length,
      details
    };
  }

  async _runTestCasesViaBackend(code, language, fnName, cases, sortResult = false) {
    const empty = { total: 0, passed: 0, failed: 0, details: [] };
    try {
      const payload = {
        code,
        language,
        fn_name: fnName,
        sort_result: sortResult,
        test_cases: cases.map(tc => ({ inputs: tc.inputs, expected: tc.expected, label: tc.label }))
      };
      const res = await fetch(`${this.apiBase}/run-code-tests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.results) {
        return { total: cases.length, passed: 0, failed: cases.length,
          details: [{ pass: false, label: data.error || `Backend test error (${res.status})` }] };
      }
      const details = (data.results || []).map(r => ({
        pass: !!r.pass,
        label: r.pass
          ? `${fnName}(${(r.input || r.inputs || []).join?.(', ') || ''}) ✓`
          : `${fnName} → got ${JSON.stringify(r.got)}, expected ${JSON.stringify(r.expected)}${r.error ? ' — ' + r.error : ''}`
      }));
      return {
        total: details.length,
        passed: data.passed ?? details.filter(d => d.pass).length,
        failed: data.failed ?? details.filter(d => !d.pass).length,
        details
      };
    } catch (e) {
      console.warn('[CodeWriter] Backend test run failed:', e.message);
      return empty;
    }
  }

  _parseExamplesFromText(text, fnName) {
    const cases = [];
    const seen  = new Set();
    const tryAdd = (inputStr, expRaw) => {
      const key = `${inputStr}|${expRaw}`;
      if (seen.has(key)) return;
      seen.add(key);
      try {
        let inputs, expected;
        if (this._canEvalInPage()) {
          // eslint-disable-next-line no-new-func
          inputs = new Function(`return [${inputStr}]`)();
          // eslint-disable-next-line no-new-func
          expected = new Function(`return ${expRaw}`)();
        } else {
          inputs = JSON.parse(`[${inputStr}]`);
          expected = JSON.parse(expRaw.match(/^[\[{"]/) ? expRaw : `"${expRaw}"`);
        }
        cases.push({ inputs, expected, inputStr });
      } catch (_) {
        try {
          const inputs = [inputStr.replace(/^["']|["']$/g, '')];
          const expected = expRaw.replace(/^["']|["']$/g, '');
          cases.push({ inputs, expected, inputStr: JSON.stringify(inputs[0]) });
        } catch (_2) {}
      }
    };

    const esc = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const patterns = [
      new RegExp(esc + '\\(([^)]{0,120})\\)\\s*(?:[→\u2192]|->|=>|=|returns?|should return)\\s*("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|[^,\\n;]{1,80})', 'gi'),
      /input[:\s]+([^\n,;]{1,80})[,;\n\s]+output[:\s]+([^\n,;]{1,80})/gi,
      /assert\s+(?:\w+\.)?equal\w*\s*\(\s*\w+\(([^)]*)\)\s*,\s*([^)]+)\)/gi,
      /expect\(\s*\w+\(([^)]*)\)\s*\)\.to(?:Equal|Be)\(\s*([^)]+)\)/gi,
      /example[:\s]+[^\n]*\(([^)]*)\)\s*(?:[→\u2192]|->|=|returns?)\s*([^\n,]{1,60})/gi,
    ];

    let m;
    for (const re of patterns) {
      while ((m = re.exec(text)) !== null) {
        const inputStr = m[1].trim();
        const expRaw   = m[2].trim().replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
        tryAdd(inputStr, expRaw);
      }
    }

    return cases.slice(0, 8);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  _highlight(el, on) {
    if (on) {
      el.style.outline = '3px solid #4CAF50';
      el.style.outlineOffset = '2px';
    } else {
      el.style.outline = '';
      el.style.outlineOffset = '';
    }
  }

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  async _fetchProviderStatus() {
    try {
      const res = await fetch(`${this.apiBase}/provider-status`);
      if (res.ok) return await res.json();
    } catch (_) {}
    return { groq: true };
  }

  async _resolveProvider(requested) {
    const status = await this._fetchProviderStatus();
    this._providerStatus = status;
    if (status.groq) return 'groq';
    const order = ['deepseek', 'openai', 'gemini'];
    const req = (requested || 'groq').toLowerCase();
    if (status[req]) return req;
    for (const p of order) {
      if (status[p]) return p;
    }
    return 'groq';
  }

  _rotateFallbackProvider(current) {
    const status = this._providerStatus || {};
    const order = ['groq', 'deepseek', 'openai', 'gemini'].filter(p => status[p] !== false);
    if (!order.length) return 'groq';
    const idx = order.indexOf((current || 'groq').toLowerCase());
    return order[(idx + 1) % order.length] || 'groq';
  }
};

globalThis.CodeWriter = CodeWriter;

if (typeof module !== 'undefined' && module.exports) module.exports = CodeWriter;
