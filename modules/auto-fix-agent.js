/**
 * AutoFixAgent — Fully autonomous self-healing code agent.
 *
 * Flow (mirrors Cursor/Copilot agent loop):
 *   1. Generate initial code
 *   2. Sanitize + validate (static checks)
 *   3. Write to editor
 *   4. Run tests / compile
 *   5. If errors → classify error type → pick fix strategy → patch code
 *   6. Re-write patched code → re-run tests
 *   7. Repeat until: all tests pass  OR  max attempts reached
 *
 * Error strategies (in priority order):
 *   DUPLICATE_FUNCTION  → strip duplicates locally (no API call)
 *   HTML_ENTITIES       → unescape locally (no API call)
 *   UNBALANCED_BRACES   → auto-close locally (no API call)
 *   SYNTAX_ERROR        → surgical patch (1 API call, diff only)
 *   LOGIC_ERROR         → full fix (1 API call, complete file)
 *   WRONG_LANGUAGE      → regenerate from scratch (1 API call)
 */

var AutoFixAgent = globalThis.AutoFixAgent || class AutoFixAgent {
  constructor(config = {}) {
    this.apiBase   = config.apiBase   || 'http://localhost:5050/api';
    this.maxCycles = config.maxCycles || 8;   // total fix attempts
    this.typeDelay = config.typeDelay || 18;
    this._busy     = false;
  }

  // ─── PUBLIC ENTRY POINT ──────────────────────────────────────────────────

  /**
   * Run the full autonomous agent loop for one coding question.
   * @param {object} cq       - coding question descriptor from CodeWriter
   * @param {string} provider - AI provider key
   * @param {function} notify - (msg, type) status callback
   * @returns {object} { success, code, cycles, error }
   */
  async run(cq, provider, notify = () => {}) {
    if (this._busy) { notify('⏳ Agent already running', 'info'); return { success: false }; }
    this._busy = true;
    try {
      return await this._agentLoop(cq, provider, notify);
    } finally {
      this._busy = false;
    }
  }

  // ─── MAIN LOOP ────────────────────────────────────────────────────────────

  async _agentLoop(cq, provider, notify) {
    const PC = globalThis.PlatformConfig;
    const CW = globalThis._codeWriterInstance;   // shared CodeWriter instance
    if (!CW) return { success: false, error: 'CodeWriter not initialised' };

    const { question, language, editorEl, editorType, fnName, testCases: rawCases } = cq;
    const testCases = (rawCases || []).slice(0, 12);
    let code        = null;
    let lastError   = null;
    let cycles      = 0;
    let strategy    = 'generate';   // first cycle always generates

    // Read starter once — never re-read from editor during the loop
    const starter   = await CW._readCodeFromEditor(editorEl, editorType);
    const hasStarter = starter && starter.trim().length > 25 && !CW._isStarterOnly(starter, cq);

    notify(`🤖 AutoFix Agent started — max ${this.maxCycles} cycles`, 'info');

    while (cycles < this.maxCycles) {
      cycles++;
      notify(`🔄 Cycle ${cycles}/${this.maxCycles} — strategy: ${strategy}`, 'info');

      try {
        // ── STEP 1: produce code ──────────────────────────────────────────
        code = await this._produce(strategy, code, question, language, provider,
                                   lastError, fnName, testCases, cq, hasStarter ? starter : null, notify);
        if (!code) { lastError = 'AI returned empty code'; strategy = 'generate'; continue; }

        // ── STEP 2: local fast-fixes (no API call) ────────────────────────
        code = this._localFix(code, language, cq, notify);

        // ── STEP 3: static validation ─────────────────────────────────────
        const staticErr = this._staticCheck(code, language, cq);
        if (staticErr) {
          notify(`⚠️ Static: ${staticErr}`, 'info');
          lastError = staticErr;
          strategy  = this._pickStrategy(staticErr, code, language, cycles);
          continue;
        }

        // ── STEP 4: write to editor ───────────────────────────────────────
        notify(`✍️ Writing code to editor...`, 'info');
        await CW._clearEditor(editorEl, editorType);
        await CW.writeCode(editorEl, editorType, code);
        CW._dispatchEditorEvents(editorEl, editorType);

        // ── STEP 5: run + test ────────────────────────────────────────────
        notify('🧪 Running tests...', 'info');
        const result = await this._runAndCollect(code, language, question, null,
                                                  editorEl, cq, notify);

        if (result.compileErrors.length > 0) {
          const errMsg = result.compileErrors.join('\n');
          notify(`❌ Compile error: ${errMsg}`, 'error');
          lastError = errMsg;
          strategy  = this._pickStrategy(errMsg, code, language, cycles);
          continue;
        }

        result.details.forEach(d =>
          notify(`  ${d.pass ? '✅' : '❌'} ${d.label}`, d.pass ? 'success' : 'error')
        );

        const allPassed = result.tests.total > 0 && result.tests.failed === 0;
        if (allPassed) {
          notify(`✅ All ${result.tests.passed}/${result.tests.total} tests passed!`, 'success');
          return { success: true, code, cycles };
        }

        if (result.tests.total === 0 && result.compileErrors.length === 0) {
          // No test runner available — treat as success if code looks complete
          if (CW._isCompleteSolution(code, language, cq)) {
            notify('✅ Code written (no test runner available)', 'success');
            return { success: true, code, cycles };
          }
        }

        // Some tests failed
        const failedLabels = result.tests.details.filter(d => !d.pass).map(d => d.label);
        lastError = this._buildFixContext(code, language, fnName, testCases,
                                          result.compileErrors, failedLabels);
        strategy  = this._pickStrategy(lastError, code, language, cycles);
        notify(`🔄 ${result.tests.failed} test(s) failed — next: ${strategy}`, 'info');

      } catch (e) {
        lastError = e.message;
        const is429 = /429|rate.?limit/i.test(e.message);
        if (is429) {
          const wait = Math.min(2000 * cycles, 16000);
          notify(`⚠️ Rate limited — waiting ${wait / 1000}s`, 'info');
          await this._delay(wait);
        }
        strategy = 'fix';
        notify(`⚠️ Error: ${e.message}`, 'error');
      }
    }

    notify(`❌ Agent stopped after ${cycles} cycles`, 'error');
    return { success: false, code, cycles, error: lastError };
  }

  // ─── PRODUCE CODE ─────────────────────────────────────────────────────────

  async _produce(strategy, existingCode, question, language, provider,
                  errorCtx, fnName, testCases, cq, starter, notify) {
    const CW = globalThis._codeWriterInstance;

    switch (strategy) {
      case 'generate':
        notify(`✨ Generating ${language} solution...`, 'info');
        return await CW.getCodeFromAI(question, language, provider, errorCtx,
                                       fnName, 'new', testCases, cq);

      case 'surgical': {
        notify(`🔬 Surgical patch (changing only broken lines)...`, 'info');
        const base = existingCode || starter;
        if (!base) break; // fall through to fix
        const patched = await CW.trySurgicalFix(base, question, language, provider,
                                                  errorCtx, fnName, testCases, cq);
        if (patched) return patched;
        notify('⚠️ Surgical patch failed — falling back to full fix', 'info');
        // fall through
      }
      // eslint-disable-next-line no-fallthrough
      case 'fix': {
        const base = existingCode || starter;
        if (base && base.trim().length > 25) {
          notify(`🔧 Full fix of existing code...`, 'info');
          return await CW.getFixedCodeFromAI(base, question, language, provider,
                                              errorCtx, fnName, testCases, cq);
        }
        // no existing code → generate
        break;
      }

      case 'generate_new':
        notify(`🆕 Generating completely new solution...`, 'info');
        return await CW.getCodeFromAI(question, language, provider,
          errorCtx + '\n\nWrite a completely NEW solution from scratch.', fnName, 'new', testCases, cq);
    }

    // fallback
    return await CW.getCodeFromAI(question, language, provider, errorCtx,
                                   fnName, 'new', testCases, cq);
  }

  // ─── LOCAL FIXES (zero API calls) ─────────────────────────────────────────

  _localFix(code, language, cq, notify) {
    const PC = globalThis.PlatformConfig;
    if (!PC) return code;

    // 1. HTML entity decode
    const decoded = PC.unescapeHtml(code);
    if (decoded !== code) {
      notify('🔧 Local fix: decoded HTML entities', 'info');
      code = decoded;
    }

    // 2. Full sanitize (dedup, brace balance, indent, stub removal)
    const sanitized = PC.sanitizeCode(code, language, {
      fnName: cq?.fnName,
      platformId: cq?.platformId,
    });
    if (sanitized && sanitized !== code) {
      notify('🔧 Local fix: sanitized code (dedup/braces/indent)', 'info');
      code = sanitized;
    }

    return code;
  }

  // ─── STATIC CHECK ─────────────────────────────────────────────────────────

  _staticCheck(code, language, cq) {
    const PC = globalThis.PlatformConfig;
    if (!code || code.trim().length < 10) return 'Code is empty or too short';

    const fnName = cq?.fnName;
    if (fnName && !code.includes(fnName)) return `Missing function "${fnName}"`;

    if (PC) {
      const syntaxErr = PC.checkBasicSyntax(code, language);
      // HTML entities warning is informational only — already decoded
      if (syntaxErr && !/html entities/i.test(syntaxErr)) return syntaxErr;

      const count = fnName ? PC.countDefinitions(code, fnName, language) : 0;
      if (count > 1) return `Function "${fnName}" defined ${count} times`;
    }
    return null;
  }

  // ─── ERROR CLASSIFIER → STRATEGY ─────────────────────────────────────────

  /**
   * Given an error message, pick the cheapest fix strategy.
   * Order: local (free) → surgical (1 diff call) → fix (1 full call) → generate_new
   */
  _pickStrategy(errorMsg, code, language, cycle) {
    const e = (errorMsg || '').toLowerCase();

    // After many cycles, try fresh generation
    if (cycle >= this.maxCycles - 2) return 'generate_new';

    // Duplicate function → local fix already tried, force full fix
    if (/defined \d+ times|duplicate|already defined/i.test(errorMsg)) return 'fix';

    // Unbalanced braces/parens → local fix already tried → surgical
    if (/unbalanced brace|unbalanced paren/i.test(errorMsg)) return 'surgical';

    // Wrong language
    if (/wrong language|generated .* but editor/i.test(errorMsg)) return 'generate_new';

    // Syntax error → surgical (just fix that line)
    if (/syntaxerror|syntax error|unexpected token|unexpected end|parse error/i.test(e))
      return 'surgical';

    // Compile error (Java/C) → surgical first, then fix
    if (/compile|cannot find symbol|undefined|not defined|undeclared/i.test(e))
      return cycle <= 2 ? 'surgical' : 'fix';

    // Test failures / logic errors → full fix
    if (/test|expected|got|wrong answer|failed/i.test(e)) return 'fix';

    // Runtime error → fix
    if (/runtime|typeerror|nameerror|indexerror|nullpointer/i.test(e)) return 'fix';

    // Default: alternate surgical → fix → generate_new
    const rotation = ['surgical', 'fix', 'fix', 'generate_new'];
    return rotation[Math.min(cycle - 1, rotation.length - 1)];
  }

  // ─── RUN TESTS ────────────────────────────────────────────────────────────

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

  // ─── BUILD FIX CONTEXT ────────────────────────────────────────────────────

  _buildFixContext(code, language, fnName, testCases, compileErrors, failedLabels) {
    const EH = globalThis.ErrorHandler ? new (globalThis.ErrorHandler)() : null;
    const parts = [
      'Fix the code so it passes ALL test cases.',
      `Language: ${language}.`,
      fnName ? `Function name must be: ${fnName}` : '',
    ].filter(Boolean);

    // Use structured diagnostics if available
    if (EH && compileErrors.length) {
      const diags = EH.parseErrorDiagnostics(compileErrors.join('\n'), code);
      const fmt   = EH.formatDiagnosticsForAI(diags);
      if (fmt) parts.push('ERRORS:\n' + fmt);
      else     parts.push('ERRORS:\n' + compileErrors.join('\n'));
    } else if (compileErrors.length) {
      parts.push('ERRORS:\n' + compileErrors.join('\n'));
    }

    if (failedLabels.length) {
      parts.push('FAILED TESTS:\n' + failedLabels.map(l => `- ${l}`).join('\n'));
    }

    if (testCases?.length) {
      const tcText = testCases.slice(0, 8).map((tc, i) =>
        `  Test ${i + 1}: input=${JSON.stringify(tc.inputs)} → expected=${JSON.stringify(tc.expected)}`
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

  // ─── HELPERS ─────────────────────────────────────────────────────────────

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
};

globalThis.AutoFixAgent = AutoFixAgent;
if (typeof module !== 'undefined' && module.exports) module.exports = AutoFixAgent;
