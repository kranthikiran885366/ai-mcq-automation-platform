/**
 * Error Handler Module
 * Manages error handling, logging, retry logic, and recovery strategies
 */

class ErrorHandler {
  constructor(config = {}) {
    this.config = {
      maxRetries: config.maxRetries || 3,
      initialDelay: config.initialDelay || 1000, // 1 second
      maxDelay: config.maxDelay || 30000, // 30 seconds
      backoffMultiplier: config.backoffMultiplier || 2,
      logToBackend: config.logToBackend || false,
      backendUrl: config.backendUrl || 'https://mcq-bot-backend.railway.app/api',
      enableSentry: config.enableSentry || false,
      sentryDSN: config.sentryDSN || '',
    };

    this.errorLog = [];
    this.maxLogSize = 1000;
    this.initializeSentry();
  }

  /**
   * Initialize Sentry error tracking (optional)
   */
  initializeSentry() {
    if (this.config.enableSentry && this.config.sentryDSN) {
      console.log('[ErrorHandler] Sentry initialized');
      // In production, load Sentry SDK here
    }
  }

  /**
   * Main retry function with exponential backoff
   */
  async retryWithBackoff(fn, options = {}) {
    const maxRetries = options.maxRetries || this.config.maxRetries;
    const context = options.context || 'Unknown operation';
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`[ErrorHandler] Attempt ${attempt + 1}/${maxRetries}: ${context}`);
        return await Promise.race([
          fn(),
          this.createTimeout(options.timeout || 30000)
        ]);
      } catch (error) {
        const isLastAttempt = attempt === maxRetries - 1;
        
        this.logError({
          message: error.message,
          context: context,
          attempt: attempt + 1,
          maxRetries: maxRetries,
          stack: error.stack,
          timestamp: new Date().toISOString()
        });

        if (isLastAttempt) {
          // Last attempt failed, throw error
          const finalError = new Error(
            `Failed after ${maxRetries} attempts: ${error.message}`
          );
          finalError.originalError = error;
          finalError.attempts = maxRetries;
          throw finalError;
        }

        // Calculate delay with exponential backoff
        const delay = this.calculateBackoffDelay(attempt);
        console.warn(
          `[ErrorHandler] Retry #${attempt + 1} failed. Waiting ${delay}ms before retry...`
        );
        await this.delay(delay);
      }
    }
  }

  /**
   * Retry with fallback providers
   */
  async retryWithFallback(fn, fallbacks = []) {
    const providers = [fn, ...fallbacks];

    for (let i = 0; i < providers.length; i++) {
      try {
        console.log(`[ErrorHandler] Attempting provider ${i + 1}/${providers.length}`);
        return await this.retryWithBackoff(providers[i], {
          context: `Provider attempt ${i + 1}`,
          maxRetries: 2
        });
      } catch (error) {
        const isLastProvider = i === providers.length - 1;

        if (isLastProvider) {
          this.logError({
            message: 'All providers failed',
            context: 'Fallback chain exhausted',
            providersAttempted: providers.length,
            timestamp: new Date().toISOString()
          });
          throw new Error(`All providers failed: ${error.message}`);
        }

        console.warn(`[ErrorHandler] Provider ${i + 1} failed, trying next fallback...`);
      }
    }
  }

  /**
   * Handle API errors with specific strategies
   */
  async handleAPIError(error, context = {}) {
    const errorInfo = {
      message: error.message,
      status: error.status || error.response?.status,
      statusText: error.statusText || error.response?.statusText,
      context: context,
      timestamp: new Date().toISOString(),
      url: context.url || 'unknown'
    };

    // Specific error handling strategies
    if (error.status === 429) {
      // Rate limited
      errorInfo.recovery = 'RATE_LIMITED';
      console.warn('[ErrorHandler] Rate limited. Implementing exponential backoff.');
      return { shouldRetry: true, delay: 5000, strategy: 'exponential_backoff' };
    }

    if (error.status === 401 || error.status === 403) {
      // Authentication failed
      errorInfo.recovery = 'AUTH_FAILED';
      console.error('[ErrorHandler] Authentication failed. Check API key.');
      return { shouldRetry: false, strategy: 'manual_auth_required' };
    }

    if (error.status === 500 || error.status === 502 || error.status === 503) {
      // Server error
      errorInfo.recovery = 'SERVER_ERROR';
      console.warn('[ErrorHandler] Server error. Will retry.');
      return { shouldRetry: true, delay: 3000, strategy: 'server_error_retry' };
    }

    if (error.status === 408 || error.message.includes('timeout')) {
      // Timeout
      errorInfo.recovery = 'TIMEOUT';
      console.warn('[ErrorHandler] Request timeout. Will retry.');
      return { shouldRetry: true, delay: 2000, strategy: 'timeout_retry' };
    }

    if (!error.status) {
      // Network error
      errorInfo.recovery = 'NETWORK_ERROR';
      console.warn('[ErrorHandler] Network error. Check connection.');
      return { shouldRetry: true, delay: 5000, strategy: 'network_error_retry' };
    }

    // Unknown error
    errorInfo.recovery = 'UNKNOWN_ERROR';
    console.error('[ErrorHandler] Unknown error:', error);
    return { shouldRetry: false, strategy: 'manual_intervention_required' };
  }

  /**
   * Log error with optional backend reporting
   */
  logError(errorInfo) {
    const logEntry = {
      ...errorInfo,
      timestamp: errorInfo.timestamp || new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href
    };

    // Store in local log
    this.errorLog.push(logEntry);
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog.shift(); // Remove oldest entry
    }

    // Save to Chrome storage
    chrome.storage.local.get('errorLog', (result) => {
      const log = result.errorLog || [];
      log.push(logEntry);
      if (log.length > this.maxLogSize) {
        log.shift();
      }
      chrome.storage.local.set({ errorLog: log });
    });

    // Log to backend if enabled
    if (this.config.logToBackend) {
      this.sendErrorToBackend(logEntry).catch(err => {
        console.error('[ErrorHandler] Failed to send error to backend:', err);
      });
    }

    // Log to console
    console.error('[Error Log]', logEntry);

    return logEntry;
  }

  /**
   * Send error to backend for monitoring
   */
  async sendErrorToBackend(errorInfo) {
    try {
      const response = await fetch(`${this.config.backendUrl}/log-error`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(errorInfo)
      });

      if (!response.ok) {
        console.error('[ErrorHandler] Backend error logging failed:', response.status);
      }
    } catch (error) {
      console.error('[ErrorHandler] Could not send error to backend:', error);
    }
  }

  /**
   * Get error recovery suggestion
   */
  getRecoverySuggestion(error) {
    const message = error.message.toLowerCase();

    if (message.includes('timeout')) {
      return {
        type: 'TIMEOUT',
        suggestion: 'The request took too long. Please try again or check your internet connection.',
        action: 'RETRY'
      };
    }

    if (message.includes('network') || message.includes('offline')) {
      return {
        type: 'NETWORK',
        suggestion: 'Check your internet connection and try again.',
        action: 'CHECK_CONNECTION'
      };
    }

    if (message.includes('api key') || message.includes('unauthorized')) {
      return {
        type: 'AUTH',
        suggestion: 'Your API key is invalid or expired. Please update it in settings.',
        action: 'UPDATE_SETTINGS'
      };
    }

    if (message.includes('rate limit')) {
      return {
        type: 'RATE_LIMIT',
        suggestion: 'Too many requests. Please wait a moment and try again.',
        action: 'WAIT_RETRY'
      };
    }

    return {
      type: 'UNKNOWN',
      suggestion: 'An unexpected error occurred. Please try again.',
      action: 'RETRY'
    };
  }

  /**
   * Create timeout promise
   */
  createTimeout(ms) {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timeout after ${ms}ms`)), ms)
    );
  }

  /**
   * Calculate exponential backoff delay
   */
  calculateBackoffDelay(attemptNumber) {
    const delay = this.config.initialDelay * Math.pow(this.config.backoffMultiplier, attemptNumber);
    const jitter = Math.random() * 1000; // Add random jitter to prevent thundering herd
    const finalDelay = Math.min(delay + jitter, this.config.maxDelay);
    return Math.floor(finalDelay);
  }

  /**
   * Simple delay utility
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get error log
   */
  getErrorLog() {
    return this.errorLog;
  }

  /**
   * Clear error log
   */
  clearErrorLog() {
    this.errorLog = [];
    chrome.storage.local.set({ errorLog: [] });
  }

  /**
   * Export error log for debugging
   */
  exportErrorLog() {
    const data = JSON.stringify(this.errorLog, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `error-log-${Date.now()}.json`;
    link.click();

    URL.revokeObjectURL(url);
  }

  /**
   * Cursor/Copilot-style agent: read full file → get error → send exact error with
   * line numbers → receive complete fixed file → replace editor content.
   * This is the exact model used by Cursor Agent and GitHub Copilot Autofix.
   */
  buildAgentFixPrompt(existingCode, language, errorContext, fnName, testCases) {
    const lines = (existingCode || '').split('\n');
    // Annotate code with line numbers so AI can pinpoint the exact error line
    const numberedCode = lines
      .map((l, i) => `${String(i + 1).padStart(3, ' ')} | ${l}`)
      .join('\n');

    // Parse error to extract line number if present
    const lineMatch = (errorContext || '').match(/line\s+(\d+)|:(\d+):/i);
    const errorLine = lineMatch ? (lineMatch[1] || lineMatch[2]) : null;
    const lineHint = errorLine
      ? `\nThe error is on or near line ${errorLine}. Fix that specific line and any related logic.`
      : '';

    const testBlock = (testCases || []).slice(0, 8).map((tc, i) =>
      `  Test ${i + 1}: input=${JSON.stringify(tc.inputs)} → expected=${JSON.stringify(tc.expected)}`
    ).join('\n');

    return [
      `You are a code repair agent (like Cursor or GitHub Copilot Autofix).`,
      `Your ONLY job: fix the ${language} code below so it compiles, runs, and passes ALL tests.`,
      ``,
      `RULES:`,
      `- Return the COMPLETE fixed file. Every function. Every line. Nothing omitted.`,
      `- Do NOT duplicate any function. Each function appears EXACTLY ONCE.`,
      `- Do NOT add markdown, backticks, or explanation. Raw code only.`,
      `- Do NOT change the function name${fnName ? ` — keep it as \`${fnName}\`` : ''}.`,
      `- Fix the error. Do not rewrite logic that already works.`,
      ``,
      `ERROR TO FIX:`,
      (errorContext || 'Fix all errors and make tests pass').trim() + lineHint,
      ``,
      testBlock ? `TEST CASES (must ALL pass):\n${testBlock}\n` : '',
      `CURRENT CODE (with line numbers):`,
      '```',
      numberedCode,
      '```',
      ``,
      `Return the complete fixed ${language} file:`,
    ].filter(l => l !== null).join('\n');
  }

  /**
   * Parse error output into structured format with line numbers.
   * Mirrors what Cursor's diagnostic parser does.
   */
  parseErrorDiagnostics(rawError, code) {
    const diagnostics = [];
    const lines = (rawError || '').split('\n');

    for (const line of lines) {
      // Node.js / Python / Java style: file.js:12:5 or line 12
      const locMatch = line.match(/(\w+\.\w+)?:(\d+)(?::(\d+))?\s*(.+)/);
      if (locMatch) {
        diagnostics.push({
          line: parseInt(locMatch[2], 10),
          col: locMatch[3] ? parseInt(locMatch[3], 10) : null,
          message: locMatch[4].trim(),
          raw: line.trim()
        });
        continue;
      }
      // "at line 12" or "Line 12:"
      const lineMatch = line.match(/(?:at\s+line|line)\s+(\d+)/i);
      if (lineMatch) {
        diagnostics.push({
          line: parseInt(lineMatch[1], 10),
          col: null,
          message: line.trim(),
          raw: line.trim()
        });
      }
    }

    // Attach source line context to each diagnostic
    const codeLines = (code || '').split('\n');
    for (const d of diagnostics) {
      if (d.line > 0 && d.line <= codeLines.length) {
        d.sourceLine = codeLines[d.line - 1]?.trim();
        d.context = codeLines.slice(Math.max(0, d.line - 2), d.line + 1)
          .map((l, i) => `${d.line - 1 + i}: ${l}`).join('\n');
      }
    }

    return diagnostics;
  }

  /**
   * Format diagnostics into a concise error context string
   * (same format Cursor sends to its AI).
   */
  formatDiagnosticsForAI(diagnostics, maxErrors = 5) {
    if (!diagnostics || !diagnostics.length) return null;
    return diagnostics.slice(0, maxErrors).map(d => {
      const loc = d.line ? `Line ${d.line}${d.col ? ':' + d.col : ''}` : '';
      const src = d.sourceLine ? `\n    Code: ${d.sourceLine}` : '';
      return `${loc ? loc + ' — ' : ''}${d.message}${src}`;
    }).join('\n');
  }

  /**
   * SURGICAL EDIT MODEL — Cursor/Copilot style
   * Instead of replacing the whole file, ask AI to return SEARCH/REPLACE diffs
   * and apply only those changed lines to the editor.
   */

  /**
   * Build a surgical-edit prompt.
   * AI must return ONLY a JSON array of {search, replace} pairs — no full file.
   */
  buildSurgicalEditPrompt(existingCode, language, errorContext, fnName, testCases) {
    const lines = (existingCode || '').split('\n');
    const numbered = lines.map((l, i) => `${String(i + 1).padStart(3)} | ${l}`).join('\n');
    const testBlock = (testCases || []).slice(0, 6).map((tc, i) =>
      `  Test ${i + 1}: input=${JSON.stringify(tc.inputs)} → expected=${JSON.stringify(tc.expected)}`
    ).join('\n');

    return [
      `You are a surgical code repair agent. Fix ONLY the broken lines.`,
      `Language: ${language}`,
      ``,
      `RULES:`,
      `- Return ONLY a JSON array of search/replace pairs.`,
      `- Each pair: {"search": "exact lines to find", "replace": "fixed lines"}`,
      `- "search" must match the existing code EXACTLY (whitespace included).`,
      `- Do NOT return the full file. Do NOT add explanation.`,
      `- Fix the minimum number of lines needed to make all tests pass.`,
      `- Each function must appear EXACTLY ONCE in the result.`,
      ``,
      `ERROR: ${(errorContext || '').trim()}`,
      ``,
      testBlock ? `TESTS (must all pass):\n${testBlock}\n` : '',
      `CURRENT CODE:\n\`\`\`\n${numbered}\n\`\`\``,
      ``,
      `Return JSON array only, example:`,
      `[{"search": "  let x = 1;", "replace": "  let x = 2;"}]`,
    ].filter(Boolean).join('\n');
  }

  /**
   * Parse AI response that contains a JSON search/replace diff array.
   * Returns [{search, replace}] or null if unparseable.
   */
  parseSurgicalDiff(aiResponse) {
    if (!aiResponse) return null;
    // Strip markdown fences
    let raw = aiResponse.replace(/^```[\w]*\n?/gm, '').replace(/```\s*$/gm, '').trim();
    // Find the JSON array
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start < 0 || end < 0) return null;
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (!Array.isArray(parsed)) return null;
      return parsed.filter(p => typeof p.search === 'string' && typeof p.replace === 'string');
    } catch (_) {
      return null;
    }
  }

  /**
   * Apply search/replace diffs to code string (pure string operation).
   * Returns { code, applied, failed } — applied = patches that matched,
   * failed = patches where search string wasn’t found.
   */
  applySurgicalDiffs(code, diffs) {
    if (!diffs || !diffs.length) return { code, applied: 0, failed: 0 };
    let result = code;
    let applied = 0;
    let failed = 0;

    for (const { search, replace } of diffs) {
      if (!search) continue;
      if (result.includes(search)) {
        // Replace only the FIRST occurrence to avoid double-patching
        result = result.replace(search, replace);
        applied++;
      } else {
        // Try trimmed match (handles minor whitespace differences)
        const trimmedSearch = search.trim();
        const lines = result.split('\n');
        let matchLine = -1;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim() === trimmedSearch) { matchLine = i; break; }
        }
        if (matchLine >= 0) {
          // Preserve original indentation
          const indent = lines[matchLine].match(/^(\s*)/)[1];
          const replaceLine = replace.trimStart();
          lines[matchLine] = indent + replaceLine;
          result = lines.join('\n');
          applied++;
        } else {
          console.warn('[SurgicalEdit] patch not applied — search not found:', search.substring(0, 60));
          failed++;
        }
      }
    }
    return { code: result, applied, failed };
  }

  /**
   * Apply surgical diffs directly into a live editor element.
   * Supports Monaco, CodeMirror, textarea.
   * Returns true if all patches applied cleanly.
   */
  async applySurgicalDiffsToEditor(editorEl, editorType, diffs, readFn, writeFn) {
    if (!diffs || !diffs.length) return false;
    // Read current code from editor
    const currentCode = await readFn(editorEl, editorType);
    const { code: patched, applied, failed } = this.applySurgicalDiffs(currentCode, diffs);
    if (applied === 0) return false;
    // Write patched code back
    await writeFn(editorEl, editorType, patched);
    console.log(`[SurgicalEdit] Applied ${applied}/${diffs.length} patches, ${failed} failed`);
    return failed === 0;
  }

  /**
   * Create error context for debugging
   */
  createErrorContext() {
    return {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      memory: performance.memory ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
      } : null
    };
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ErrorHandler;
}
