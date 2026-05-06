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
