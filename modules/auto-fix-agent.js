/**
 * AutoFixAgent - Fully autonomous self-healing code agent.
 *
 * Fix strategy priority (cheapest first):
 *   surgical   -> patch only the broken lines (1 API call, diff only)
 *   fix        -> full file rewrite fixing errors (1 API call)
 *   generate_new -> brand new solution from scratch (last resort)
 *
 * KEY RULE: never run sanitizeCode/dedup on surgical strategy output -
 * that would erase the patched lines and cause "Missing function" loops.
 */

var AutoFixAgent = globalThis.AutoFixAgent || class AutoFixAgent {
  constructor(config = {}) {
    this.apiBase   = config.apiBase   || 'http://localhost:5050/api';
    this.maxCycles = config.maxCycles || 8;
    this.typeDelay = config.typeDelay || 18;
    this._busy     = false;
    this._stopped  = false;
  }

  stop() {
    this._stopped = true;
  }

  // --- PUBLIC ENTRY POINT --------------------------------------------------

  async run(cq, provider, notify = () => {}) {
    if (this._busy) { notify('Agent already running', 'info'); return { success: false }; }
    this._busy    = true;
    this._stopped = false;
    globalThis._activeAgent = this;   // register so content.js stopAgent can reach us
    try {
      return await this._agentLoop(cq, provider, notify);
    } finally {
      this._busy    = false;
      this._stopped = false;
      if (globalThis._activeAgent === this) globalThis._activeAgent = null;
    }
  }

  // --- MAIN LOOP -----------------------------------------------------------

  async _agentLoop(cq, provider, notify) {
    const CW = globalThis._codeWriterInstance;
    if (!CW) return { success: false, error: 'CodeWriter not initialised' };

    const { question, language: _initLang, editorEl, editorType, fnName, testCases: rawCases } = cq;
    const PC = globalThis.PlatformConfig;

    // Lock the platform language — it was set from Monaco model / lang selector
    // with weight 20. NEVER override it from weak code-scanner signals.
    const platformLang = (PC ? PC.normalizeToken(_initLang) : null) || _initLang || 'python';
    let language = platformLang;

    const testCases = (rawCases || []).slice(0, 12);
    let code        = null;
    let lastError   = null;
    let cycles      = 0;
    let strategy    = 'generate';

    const starter    = await CW._readCodeFromEditor(editorEl, editorType);
    const hasStarter = starter && starter.trim().length > 25 && !CW._isStarterOnly(starter, cq);

    notify('AutoFix Agent started (lang=' + language + ') - max ' + this.maxCycles + ' cycles', 'info');

    while (cycles < this.maxCycles) {
      // Check stop flag before every cycle
      if (this._stopped) {
        notify('Bot stopped by user', 'info');
        return { success: false, code, cycles, error: 'Stopped by user' };
      }

      cycles++;
      notify('Cycle ' + cycles + '/' + this.maxCycles + ' - strategy: ' + strategy, 'info');

      try {
        // STEP 1: produce code
        code = await this._produce(strategy, code, question, language, provider,
                                   lastError, fnName, testCases, cq, hasStarter ? starter : null, notify);
        if (!code) { lastError = 'AI returned empty code'; strategy = 'generate'; continue; }

        // STEP 2: minimal safe cleanup — never run sanitizeCode/dedup here.
        // Language is locked to platformLang — do NOT re-detect from generated
        // code because weak signals (e.g. `return`, `null`) score JS points even
        // inside Python code, which flips language and breaks all syntax checks.

        // Surgical: only HTML-decode + strip markdown fences.
        // Non-surgical: safe structural fixes (brace balance, tab->spaces).
        // NEVER call sanitizeCode or extractSingleSolution here — they strip functions.
        if (strategy === 'surgical') {
          code = PC ? PC.unescapeHtml(code) : code;
          code = code.replace(/^```[\w]*\n?/gm, '').replace(/```\s*$/gm, '').trim();
        } else {
          code = this._localFix(code, language, cq, notify);
        }

        // STEP 3: static validation
        const staticErr = this._staticCheck(code, language, cq);
        if (staticErr) {
          notify('Static: ' + staticErr, 'info');
          lastError = staticErr;
          strategy  = this._pickStrategy(staticErr, code, language, cycles);
          continue;
        }

        // STEP 4: write to editor (clear + write full code)
        notify('Writing code to editor...', 'info');
        await CW._clearEditor(editorEl, editorType);
        await CW.writeCode(editorEl, editorType, code);
        CW._dispatchEditorEvents(editorEl, editorType);

        // STEP 5: run + test
        notify('Running tests...', 'info');
        const result = await this._runAndCollect(code, language, question, null,
                                                  editorEl, cq, notify);

        if (result.compileErrors.length > 0) {
          const errMsg = result.compileErrors.join('\n');
          notify('Compile error: ' + errMsg, 'error');
          lastError = errMsg;
          strategy  = this._pickStrategy(errMsg, code, language, cycles);
          continue;
        }

        result.details.forEach(d =>
          notify('  ' + (d.pass ? 'PASS' : 'FAIL') + ' ' + d.label, d.pass ? 'success' : 'error')
        );

        const allPassed = result.tests.total > 0 && result.tests.failed === 0;
        if (allPassed) {
          notify('All ' + result.tests.passed + '/' + result.tests.total + ' tests passed!', 'success');
          // All tests passed — stop immediately, never regenerate
          return { success: true, code, cycles };
        }

        if (result.tests.total === 0 && result.compileErrors.length === 0) {
          if (CW._isCompleteSolution(code, language, cq)) {
            notify('Code written (no test runner available)', 'success');
            return { success: true, code, cycles };
          }
        }

        // Still failing — check stop flag before preparing next cycle
        if (this._stopped) {
          notify('Bot stopped by user', 'info');
          return { success: false, code, cycles, error: 'Stopped by user' };
        }

        const failedLabels = result.tests.details.filter(d => !d.pass).map(d => d.label);
        lastError = this._buildFixContext(code, language, fnName, testCases,
                                          result.compileErrors, failedLabels);
        strategy  = this._pickStrategy(lastError, code, language, cycles);
        notify(result.tests.failed + ' test(s) failed - next: ' + strategy, 'info');

      } catch (e) {
        lastError = e.message;
        const is429 = /429|rate.?limit/i.test(e.message);
        if (is429) {
          const wait = Math.min(2000 * cycles, 16000);
          notify('Rate limited - waiting ' + (wait / 1000) + 's', 'info');
          await this._delay(wait);
        }
        strategy = 'fix';
        notify('Error: ' + e.message, 'error');
      }
    }

    notify('Agent stopped after ' + cycles + ' cycles', 'error');
    return { success: false, code, cycles, error: lastError };
  }

  // --- PRODUCE CODE --------------------------------------------------------

  async _produce(strategy, existingCode, question, language, provider,
                  errorCtx, fnName, testCases, cq, starter, notify) {
    const CW = globalThis._codeWriterInstance;

    switch (strategy) {
      case 'generate':
        notify('Generating ' + language + ' solution...', 'info');
        return await CW.getCodeFromAI(question, language, provider, errorCtx,
                                       fnName, 'new', testCases, cq);

      case 'surgical': {
        notify('Surgical patch (changing only broken lines)...', 'info');
        const base = existingCode || starter;
        if (!base) break;
        const patched = await CW.trySurgicalFix(base, question, language, provider,
                                                  errorCtx, fnName, testCases, cq);
        if (patched) return patched;
        notify('Surgical patch failed - falling back to full fix', 'info');
        // fall through to fix
      }
      // eslint-disable-next-line no-fallthrough
      case 'fix': {
        const base = existingCode || starter;
        if (base && base.trim().length > 25) {
          notify('Full fix of existing code...', 'info');
          return await CW.getFixedCodeFromAI(base, question, language, provider,
                                              errorCtx, fnName, testCases, cq);
        }
        break;
      }

      case 'generate_new': {
        notify('Generating completely new solution...', 'info');
        // Include fnName explicitly in the prompt so AI never returns a different function name
        const fnHint = fnName ? `\n\nIMPORTANT: The function MUST be named exactly "${fnName}". Do not rename it.` : '';
        return await CW.getCodeFromAI(question, language, provider,
          (errorCtx || '') + '\n\nWrite a completely NEW solution from scratch.' + fnHint,
          fnName, 'new', testCases, cq);
      }
    }

    return await CW.getCodeFromAI(question, language, provider, errorCtx,
                                   fnName, 'new', testCases, cq);
  }

  // --- LOCAL FIXES (zero API calls) ----------------------------------------
  // Only runs for non-surgical strategies.
  // Uses autoFixCode (safe: brace balance, tab->spaces, etc.)
  // Does NOT run sanitizeCode/extractSingleSolution which can strip functions.

  _localFix(code, language, cq, notify) {
    const PC = globalThis.PlatformConfig;
    if (!PC) return code;

    // 1. HTML entity decode
    const decoded = PC.unescapeHtml(code);
    if (decoded !== code) {
      notify('Local fix: decoded HTML entities', 'info');
      code = decoded;
    }

    // 2. Strip markdown fences
    code = code.replace(/^```[\w]*\n?/gm, '').replace(/```\s*$/gm, '').trim();

    // 3. Safe structural fixes only (brace balance, indent, tab->spaces, etc.)
    //    Do NOT call sanitizeCode - it runs extractSingleSolution which strips
    //    Python def blocks when language was wrong, causing Missing function loops.
    const fixed = PC.autoFixCode(code, language);
    if (fixed && fixed !== code) {
      notify('Local fix: sanitized code (dedup/braces/indent)', 'info');
      code = fixed;
    }

    return code;
  }

  // --- STATIC CHECK --------------------------------------------------------

  _staticCheck(code, language, cq) {
    const PC = globalThis.PlatformConfig;
    if (!code || code.trim().length < 10) return 'Code is empty or too short';

    const fnName = cq?.fnName || null;
    if (fnName && !code.includes(fnName)) return 'Missing function "' + fnName + '"';

    if (PC) {
      // Always check syntax against the platform language — never let
      // detectLanguageFromCode override it here, that causes false positives
      // (e.g. Python code detected as JS → brace-balance check fires).
      const langToCheck = PC.normalizeToken(language) || language;

      const syntaxErr = PC.checkBasicSyntax(code, langToCheck);
      if (syntaxErr && !/html entities/i.test(syntaxErr)) return syntaxErr;

      const count = fnName ? PC.countDefinitions(code, fnName, langToCheck) : 0;
      if (count > 1) return 'Function "' + fnName + '" defined ' + count + ' times';
    }
    return null;
  }

  // --- ERROR CLASSIFIER -> STRATEGY ----------------------------------------

  _pickStrategy(errorMsg, code, language, cycle) {
    const e = (errorMsg || '').toLowerCase();

    // Wrong language -> regenerate (only valid fix)
    if (/wrong language|generated .* but editor/i.test(errorMsg)) return 'generate_new';

    // Missing function name -> the AI returned wrong name: surgical rename, not full rewrite
    // After 2 surgical attempts escalate to fix so prompt can re-anchor the name
    if (/missing function/i.test(errorMsg))
      return cycle <= 2 ? 'surgical' : 'fix';

    // Duplicate function -> full fix (local dedup already tried and failed)
    if (/defined \d+ times|duplicate|already defined/i.test(errorMsg)) return 'fix';

    // Unbalanced braces/parens -> surgical: fix only that specific line
    if (/unbalanced brace|unbalanced paren/i.test(errorMsg)) return 'surgical';

    // Syntax/compile error on a specific line -> surgical first (change only broken line)
    if (/syntaxerror|syntax error|unexpected token|unexpected end|parse error/i.test(e))
      return cycle <= 4 ? 'surgical' : 'fix';

    if (/compile|cannot find symbol|undefined|not defined|undeclared/i.test(e))
      return cycle <= 3 ? 'surgical' : 'fix';

    // Runtime errors (logic is broken, not just one line) -> full fix
    if (/runtime|typeerror|nameerror|indexerror|nullpointer/i.test(e)) return 'fix';

    // Test failures -> surgical first (fix only the wrong-output lines), then fix
    if (/test|expected|got|wrong answer|failed/i.test(e))
      return cycle <= 2 ? 'surgical' : 'fix';

    // generate_new only on the very last cycle — never earlier
    if (cycle >= this.maxCycles - 1) return 'generate_new';

    // Default rotation: surgical -> fix -> surgical -> fix ...
    return cycle % 2 === 1 ? 'surgical' : 'fix';
  }

  // --- RUN TESTS -----------------------------------------------------------

  async _runAndCollect(code, language, question, questionEl, editorEl, cq, notify) {
    const CW = globalThis._codeWriterInstance;
    const result = await CW._runCompileAndTestCycle(
      code, language, question, questionEl, editorEl, cq, notify
    );
    const combined = result.combined || { total: 0, passed: 0, failed: 0, details: [] };
    return {
      compileErrors: result.compileErrors || [],
      tests: combined,
      details: combined.details || [],
    };
  }

  // --- BUILD FIX CONTEXT ---------------------------------------------------

  _buildFixContext(code, language, fnName, testCases, compileErrors, failedLabels) {
    const EH = globalThis.ErrorHandler ? new (globalThis.ErrorHandler)() : null;
    const parts = [
      'Fix the code so it passes ALL test cases.',
      'Language: ' + language + '.',
      fnName ? 'Function name must be: ' + fnName : '',
    ].filter(Boolean);

    if (EH && compileErrors.length) {
      const diags = EH.parseErrorDiagnostics(compileErrors.join('\n'), code);
      const fmt   = EH.formatDiagnosticsForAI(diags);
      parts.push('ERRORS:\n' + (fmt || compileErrors.join('\n')));
    } else if (compileErrors.length) {
      parts.push('ERRORS:\n' + compileErrors.join('\n'));
    }

    if (failedLabels.length) {
      parts.push('FAILED TESTS:\n' + failedLabels.map(l => '- ' + l).join('\n'));
    }

    if (testCases && testCases.length) {
      const tcText = testCases.slice(0, 8).map((tc, i) =>
        '  Test ' + (i + 1) + ': input=' + JSON.stringify(tc.inputs) + ' -> expected=' + JSON.stringify(tc.expected)
      ).join('\n');
      parts.push('ALL TEST CASES (must pass ALL):\n' + tcText);
    }

    parts.push(
      'Return COMPLETE fixed code only.',
      'No markdown. No explanation. No duplicate functions.',
      'All braces balanced. No HTML entities.'
    );

    return parts.join('\n\n');
  }

  // --- HELPERS -------------------------------------------------------------

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
};

globalThis.AutoFixAgent = AutoFixAgent;
if (typeof module !== 'undefined' && module.exports) module.exports = AutoFixAgent;
