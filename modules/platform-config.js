/**
 * Dynamic platform + language configuration.
 * Extend LANGUAGE_REGISTRY / PLATFORM_REGISTRY — pipeline reads everything from here.
 */
var PlatformConfig = globalThis.PlatformConfig || (function () {

  const PIPELINE_CONFIG = {
    maxFixAttempts: 4,
    maxNewAttempts: 4,
    maxTotalExtra: 2,
    platformTestWaitMs: 6000,
    platformRunWaitMs: 10000,
    submitWaitMs: 12000,
    postRunDelayMs: 900,
    postRunDelayByPlatform: { leetcode: 800 },
    defaultPostRunDelayMs: 400,
    fallbackLanguage: 'python',
  };

  const LANG_DEFAULTS = {
    indentSize: 2,
    braceBalance: false,
    normalizeIndent: false,
    requiresReturn: false,
    dedupStrategy: 'nextMatch',
    dedupStart: null,
    voidPattern: null,
    stubPatterns: [],
    aiPromptHint: null,
    compatibleWith: [],
    textFnPatterns: [],
    passReplacement: null,
  };

  const LANGUAGE_REGISTRY = {
    javascript: {
      aliases: ['js', 'node', 'nodejs', 'ecmascript'],
      monacoIds: ['javascript', 'js'],
      backendRunner: 'javascript',
      browserEval: true,
      braceBalance: true,
      normalizeIndent: true,
      indentSize: 2,
      requiresReturn: true,
      dedupStrategy: 'braceBalanced',
      dedupStart: 'function\\s+{{fn}}\\s*\\(|(?:const|let|var)\\s+{{fn}}\\s*=',
      collectHelpers: true,
      fnPatterns: [
        /function\s+(\w+)\s*\(/,
        /(?:const|let|var)\s+(\w+)\s*=\s*(?:function|\()/,
        /var\s+(\w+)\s*=\s*function/,
      ],
      codeHints: [/function\s+\w+\s*\(/, /const\s+\w+\s*=\s*\(/],
      textFnPatterns: [/function\s+(\w+)\s*\(/, /(?:const|let|var)\s+(\w+)\s*=/],
      // Explicit per-language format rules sent to AI
      aiPromptHint: [
        'Use JavaScript only.',
        'Write each function EXACTLY ONCE — main function + any helper functions.',
        'Use 2-space indentation.',
        'Include return statement.',
        'No console.log. No duplicate functions.',
        'All braces must be balanced { }.',
        'No HTML entities — use < > & \' " directly.',
      ].join(' '),
      compatibleWith: ['typescript'],
    },
    typescript: {
      aliases: ['ts'],
      monacoIds: ['typescript', 'ts'],
      backendRunner: 'javascript',
      browserEval: true,
      braceBalance: true,
      normalizeIndent: true,
      indentSize: 2,
      requiresReturn: true,
      dedupStrategy: 'braceBalanced',
      dedupStart: 'function\\s+{{fn}}\\s*\\(|(?:const|let)\\s+{{fn}}\\s*=',
      collectHelpers: true,
      fnPatterns: [/function\s+(\w+)\s*\(/, /(?:const|let)\s+(\w+)\s*=/],
      codeHints: [/:\s*\w+/, /interface\s+\w+/],
      textFnPatterns: [/function\s+(\w+)\s*\(/],
      aiPromptHint: [
        'Use TypeScript only.',
        'Typed function signature required (param: Type): ReturnType.',
        'Write each function EXACTLY ONCE.',
        'Use 2-space indentation.',
        'Include return. No duplicates.',
        'All braces balanced. No HTML entities.',
      ].join(' '),
      compatibleWith: ['javascript'],
    },
    python: {
      aliases: ['python3', 'py', 'python2'],
      monacoIds: ['python', 'py'],
      backendRunner: 'python',
      browserEval: false,
      indentSize: 4,
      normalizeIndent: true,
      requiresReturn: true,
      // Python uses indentation — no braces
      braceBalance: false,
      dedupStart: '^\\s*def\\s+{{fn}}\\s*\\(',
      fnPatterns: [/def\s+(\w+)\s*\(/, /class\s+(\w+)\s*[:(]/],
      codeHints: [/def\s+\w+\s*\(/, /^\s*import\s/m],
      textFnPatterns: [/def\s+(\w+)\s*\(/],
      stubPatterns: [
        '^\\s*def\\s+{{fn}}[^:\\n]*:\\s*$',
        'class\\s+Solution\\s*:\\s*\\n\\s*def\\s+\\w+[^:\\n]*:\\s*\\n(?=\\s*def\\s)',
      ],
      passReplacement: 'raise NotImplementedError()',
      aiPromptHint: [
        'Use Python 3 only.',
        'Use 4-space indentation — NO tabs.',
        'def function_name(params):',
        '    # body',
        '    return result',
        'Write def EXACTLY ONCE. No duplicate defs.',
        'No HTML entities — use < > & directly.',
        'No print() statements.',
      ].join(' '),
    },
    java: {
      aliases: ['java11', 'java8', 'java17'],
      monacoIds: ['java'],
      backendRunner: 'java',
      browserEval: false,
      braceBalance: true,
      indentSize: 4,
      normalizeIndent: true,
      dedupStrategy: 'braceBalanced',
      dedupStart: '(public|private|protected)[^{;]*\\b{{fn}}\\s*\\([^)]*\\)',
      requiresReturn: true,
      voidPattern: /void\s+/,
      fnPatterns: [
        /public\s+(?:static\s+)?(?:\w+(?:\[\])?\s+)+(\w+)\s*\(/,
        /(?:public|private|protected)\s+\w+(?:\[\])?\s+(\w+)\s*\(/,
      ],
      codeHints: [/public\s+class\s+\w+/, /class\s+Solution/],
      textFnPatterns: [/public\s+\w+\s+(\w+)\s*\(/],
      aiPromptHint: [
        'Use Java only.',
        'Format: class Solution { public ReturnType methodName(ParamType param) { ... } }',
        'Use 4-space indentation.',
        'All braces must be balanced.',
        'Write method EXACTLY ONCE. No duplicate methods.',
        'No System.out.println. No HTML entities.',
        'Include import statements if needed.',
      ].join(' '),
      structureWrapper: { detect: /public\s+/, className: 'Solution', brace: true },
    },
    c: {
      aliases: ['c99', 'c11'],
      monacoIds: ['c'],
      backendRunner: 'c',
      browserEval: false,
      braceBalance: true,
      indentSize: 4,
      dedupStart: '(?:int|long|float|double|char|bool|void|size_t)[^;\\n]*\\b{{fn}}\\s*\\(',
      fnPatterns: [
        /(?:int|long|float|double|char|bool|void|size_t)\s*\*?\s*(\w+)\s*\(/,
      ],
      codeHints: [/#include\s*</, /int\s+main\s*\(/],
      textFnPatterns: [/(?:int|void|char|long)\s+(\w+)\s*\(/],
      aiPromptHint: [
        'Use C only.',
        'Include required headers: #include <stdio.h> #include <stdlib.h> #include <string.h> etc.',
        'Use 4-space indentation.',
        'Function signature: ReturnType functionName(params) { }',
        'Write function EXACTLY ONCE. All braces balanced.',
        'No HTML entities — use < > & directly in code.',
        'No printf unless required by problem.',
      ].join(' '),
    },
    cpp: {
      aliases: ['c++', 'cplusplus', 'cpp11', 'cpp14', 'cpp17'],
      monacoIds: ['cpp', 'c++'],
      backendRunner: null,
      browserEval: false,
      braceBalance: true,
      indentSize: 4,
      dedupStart: '(?:int|long|bool|string|vector|void|auto)[^;\\n]*\\b{{fn}}\\s*\\(',
      fnPatterns: [
        /(?:int|long|bool|string|vector|void|auto)\s+(\w+)\s*\(/,
        /class\s+(\w+)\s*\{/,
      ],
      codeHints: [/#include\s*</, /using\s+namespace\s+std/],
      textFnPatterns: [/(?:int|bool|void|string|vector)\s+(\w+)\s*\(/],
      aiPromptHint: [
        'Use C++ only.',
        'Include required headers. Add: using namespace std;',
        'Use 4-space indentation.',
        'Write function/method EXACTLY ONCE. All braces balanced.',
        'No HTML entities — use < > & :: directly.',
        'vector<int> not vector&lt;int&gt;.',
      ].join(' '),
    },
    csharp: {
      aliases: ['c#', 'cs', 'dotnet'],
      monacoIds: ['csharp', 'cs'],
      backendRunner: null,
      browserEval: false,
      braceBalance: true,
      indentSize: 4,
      normalizeIndent: true,
      dedupStart: '(?:public|private|protected)[^{;]*\\b{{fn}}\\s*\\(',
      fnPatterns: [/public\s+\w+\s+(\w+)\s*\(/, /(?:public|private|protected)\s+\w+\s+(\w+)\s*\(/],
      codeHints: [/using\s+System/, /namespace\s+\w+/],
      textFnPatterns: [/public\s+\w+\s+(\w+)\s*\(/],
      aiPromptHint: [
        'Use C# only.',
        'Format: public class Solution { public ReturnType MethodName(params) { ... } }',
        'Use 4-space indentation.',
        'Write method EXACTLY ONCE. All braces balanced.',
        'No HTML entities. List<int> not List&lt;int&gt;.',
        'Include using directives if needed.',
      ].join(' '),
    },
    go: {
      aliases: ['golang'],
      monacoIds: ['go'],
      backendRunner: null,
      browserEval: false,
      braceBalance: true,
      indentSize: 1,   // Go uses tabs, but 1-tab = 1 unit
      dedupStart: 'func\\s+{{fn}}\\s*\\(',
      fnPatterns: [/func\s+(\w+)\s*\(/],
      codeHints: [/package\s+main/, /func\s+\w+/],
      textFnPatterns: [/func\s+(\w+)\s*\(/],
      aiPromptHint: [
        'Use Go only.',
        'Start with: package main',
        'import blocks if needed.',
        'func functionName(params) returnType { }',
        'Use tab indentation.',
        'Opening brace { must be on same line as func.',
        'Write func EXACTLY ONCE. All braces balanced.',
        'No HTML entities.',
      ].join(' '),
    },
    rust: {
      aliases: ['rs'],
      monacoIds: ['rust'],
      backendRunner: null,
      browserEval: false,
      braceBalance: true,
      indentSize: 4,
      dedupStart: 'fn\\s+{{fn}}\\s*\\(',
      fnPatterns: [/fn\s+(\w+)\s*\(/],
      codeHints: [/fn\s+\w+/, /use\s+\w+/],
      textFnPatterns: [/fn\s+(\w+)\s*\(/],
      aiPromptHint: [
        'Use Rust only.',
        'fn function_name(params: Type) -> ReturnType { }',
        'Use 4-space indentation.',
        'Write fn EXACTLY ONCE. All braces balanced.',
        'No HTML entities — use < > directly for generics: Vec<i32> not Vec&lt;i32&gt;.',
        'No println! unless required.',
      ].join(' '),
    },
    kotlin: {
      aliases: ['kt'],
      monacoIds: ['kotlin'],
      backendRunner: null,
      browserEval: false,
      braceBalance: true,
      indentSize: 4,
      dedupStart: 'fun\\s+{{fn}}\\s*\\(',
      fnPatterns: [/fun\s+(\w+)\s*\(/],
      codeHints: [/fun\s+\w+/, /class\s+Solution/],
      textFnPatterns: [/fun\s+(\w+)\s*\(/],
      aiPromptHint: [
        'Use Kotlin only.',
        'fun functionName(params: Type): ReturnType { }',
        'Use 4-space indentation.',
        'Write fun EXACTLY ONCE. All braces balanced.',
        'No HTML entities. List<Int> not List&lt;Int&gt;.',
        'No println unless required.',
      ].join(' '),
    },
    sql: {
      aliases: ['mysql', 'postgresql', 'sqlite'],
      monacoIds: ['sql'],
      backendRunner: null,
      browserEval: false,
      braceBalance: false,
      fnPatterns: [],
      codeHints: [/SELECT\s+/i, /CREATE\s+/i],
      aiPromptHint: [
        'Use SQL only.',
        'Keywords UPPERCASE: SELECT, FROM, WHERE, JOIN, GROUP BY, ORDER BY.',
        'No duplicate queries.',
        'End statement with semicolon.',
      ].join(' '),
    },
  };

  const PLATFORM_REGISTRY = [
    {
      id: 'leetcode',
      priority: 100,
      match: () =>
        !!document.querySelector('.monaco-editor, [data-mode-id]') &&
        !!document.querySelector(
          '.question-content, [data-track-load="description_content"], [class*="question-content"], [data-cy="question-title"]'
        ),
      titleSelectors: ['[data-cy="question-title"]', '.text-title-large', 'a[href*="/problems/"]'],
      questionSelectors: ['.question-content', '[data-track-load="description_content"]', '[class*="question-content"]'],
      editorSelectors: ['.monaco-editor', '[data-mode-id]'],
      editorType: 'monaco',
      langSelectors: ['[data-cy="lang-select"]', '.ant-select-selection-item', 'select[id*="lang"]'],
      runSelectors: [
        '[data-e2e-locator="console-run-button"]',
        'button[data-e2e-locator*="run"]',
        'button[aria-label*="Run"]',
      ],
      submitSelectors: [
        '[data-e2e-locator="console-submit-button"]',
        'button[data-e2e-locator*="submit"]',
        'button[aria-label*="Submit"]',
      ],
      resultSelectors: ['[data-e2e-locator="console-result"]', '[data-e2e-locator*="result"]', '.result-state'],
      containerSelectors: ['.leetcode-wrap', '[class*="challenge"]', '[class*="editor"]', '#right'],
      acceptedPatterns: [/accepted/i, /🎉/],
      failedPatterns: [/wrong answer/i, /compile error/i, /runtime error/i, /time limit/i],
      codeWrappers: {
        python: { detect: /^\s*def\s+/, className: 'Solution', colon: true },
        java: { detect: /public\s+/, className: 'Solution', brace: true },
      },
    },
    {
      id: 'hackerrank',
      priority: 90,
      match: () =>
        !!document.querySelector('.hackerrank-wrap, .hr-editor, [class*="hackerrank"], .monaco-editor') &&
        !!document.querySelector('.challenge-body-html, .problem-statement, .question-description'),
      titleSelectors: ['.challenge-title', 'h1', 'h3'],
      questionSelectors: ['.challenge-body-html', '.problem-statement', '.question-description'],
      editorSelectors: ['.monaco-editor', '.hr-editor', 'textarea[class*="editor"]', '.CodeMirror'],
      editorType: 'auto',
      langSelectors: ['.hr-lang-sel', 'select[id*="lang"]', 'select[class*="lang"]'],
      runSelectors: ['.hr-run-btn', 'button[class*="run"]', '[data-testid*="run"]', '#btn-run'],
      submitSelectors: ['button[class*="submit"]', '[data-testid*="submit"]', '#btn-submit'],
      resultSelectors: ['.output-console', '.console-output', '#console-body', '[class*="test-result"]'],
      containerSelectors: ['.hackerrank-wrap', '.platform-card', '[class*="challenge"]'],
      acceptedPatterns: [/success/i, /passed/i, /accepted/i],
      failedPatterns: [/wrong/i, /failed/i, /error/i],
    },
    {
      id: 'assessment',
      priority: 80,
      match: () =>
        !!document.querySelector('#code-area, textarea[data-coding-name]') &&
        !!document.querySelector('#prob-desc, .prob-desc, .question-content, [class*="question"]'),
      titleSelectors: ['#prob-title', '.prob-title'],
      questionSelectors: ['#prob-desc', '.prob-desc'],
      editorSelectors: ['#code-area', 'textarea[data-coding-name]'],
      editorType: 'textarea',
      langSelectors: ['#lang-sel', 'select[id*="lang"]'],
      runSelectors: ['#btn-run', 'button[id*="run"]'],
      submitSelectors: ['#btn-submit', 'button[id*="submit"]'],
      resultSelectors: ['#console-body', '#run-status', '#submit-result'],
      containerSelectors: ['.platform-card', '.code-question', '#q-card'],
      acceptedPatterns: [/accepted/i, /passed/i, /✅/],
      failedPatterns: [/wrong/i, /failed/i, /❌/i, /compile error/i],
    },
    {
      id: 'generic-monaco',
      priority: 50,
      match: () => !!document.querySelector('.monaco-editor, [data-mode-id]'),
      titleSelectors: ['h1', 'h2', 'h3', '.problem-title', '.challenge-title'],
      questionSelectors: [
        '.problem-description', '.challenge-description', '.question-description',
        '.problem-statement', '[class*="description"]',
      ],
      editorSelectors: ['.monaco-editor', '[data-mode-id]'],
      editorType: 'monaco',
      langSelectors: ['select[id*="lang"]', 'select[class*="lang"]'],
      runSelectors: [
        '#btn-run', 'button[id*="run"]', 'button[class*="run"]',
        '[data-testid*="run"]', 'button[aria-label*="Run"]',
      ],
      submitSelectors: [
        '#btn-submit', 'button[id*="submit"]', 'button[class*="submit"]',
        '[data-testid*="submit"]', 'button[aria-label*="Submit"]',
      ],
      resultSelectors: ['#console-body', '[class*="console"]', '[class*="result"]', '[class*="output"]'],
      containerSelectors: ['.platform-card', '[class*="editor"]', '[class*="challenge"]'],
      acceptedPatterns: [/accepted/i, /passed/i, /success/i],
      failedPatterns: [/wrong/i, /failed/i, /error/i],
    },
    {
      id: 'generic-editor',
      priority: 30,
      match: () =>
        !!document.querySelector(
          'textarea.code-answer, textarea[data-coding], .CodeMirror, .ace_editor, textarea[class*="editor"]'
        ),
      titleSelectors: ['h3', 'h4', '.question-title'],
      questionSelectors: ['.coding-question', '.code-question', '.problem-statement', 'p', 'div'],
      editorSelectors: [
        'textarea.code-answer', 'textarea[data-coding]', '.CodeMirror',
        '.ace_editor', 'textarea[class*="editor"]', 'textarea',
      ],
      editorType: 'auto',
      langSelectors: ['select[id*="lang"]', 'select[class*="lang"]', '#lang-sel'],
      runSelectors: ['#btn-run', 'button[class*="run"]', '[data-testid*="run"]'],
      submitSelectors: ['#btn-submit', 'button[class*="submit"]', 'input[type="submit"]'],
      resultSelectors: ['#console-body', '[class*="result"]', '[class*="output"]'],
      containerSelectors: ['.platform-card', '.code-question', '.cw-wrap'],
      acceptedPatterns: [/passed/i, /accepted/i, /success/i],
      failedPatterns: [/failed/i, /wrong/i, /error/i],
    },
  ];

  function getLangConfig(language) {
    const lang = normalizeToken(language) || language;
    const base = LANGUAGE_REGISTRY[lang] || {};
    return { lang, ...LANG_DEFAULTS, ...base };
  }

  function normalizeToken(raw) {
    const t = (raw || '').toLowerCase().trim();
    if (!t) return null;
    for (const [canonical, cfg] of Object.entries(LANGUAGE_REGISTRY)) {
      if (t === canonical || (cfg.aliases || []).includes(t)) return canonical;
      if ((cfg.monacoIds || []).includes(t)) return canonical;
    }
    if (/typescript|\.ts\b|\bts\b/.test(t)) return 'typescript';
    if (/javascript|\.js\b|\bjs\b|node\.?js|ecmascript/.test(t)) return 'javascript';
    if (/python3?|\.py\b|\bpy\b/.test(t)) return 'python';
    if (/\bjava\b(?!script)/.test(t)) return 'java';
    if (/\bc\+\+\b|cpp|\.cpp/.test(t)) return 'cpp';
    if (/\bc#\b|csharp|\.cs\b/.test(t)) return 'csharp';
    if (/^c$|\.c\b|\bc99\b|\bc11\b/.test(t)) return 'c';
    if (/\bgo\b|golang|\.go\b/.test(t)) return 'go';
    if (/\brust\b|\.rs\b/.test(t)) return 'rust';
    if (/\bkotlin\b|\.kt\b/.test(t)) return 'kotlin';
    if (/\bsql\b/.test(t)) return 'sql';
    return null;
  }

  function normalizeLanguage(hints) {
    const scores = {};
    const bump = (lang, pts) => { if (lang) scores[lang] = (scores[lang] || 0) + pts; };
    for (const h of hints || []) {
      bump(normalizeToken(h.lang), h.weight || 1);
    }
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    return ranked.length > 0 ? ranked[0][0] : null;
  }

  function languagesMatch(expected, detected) {
    const exp = normalizeToken(expected);
    const det = normalizeToken(detected);
    if (!exp || !det) return true;
    if (exp === det) return true;
    const cfg = LANGUAGE_REGISTRY[exp];
    return (cfg?.compatibleWith || []).includes(det) || (LANGUAGE_REGISTRY[det]?.compatibleWith || []).includes(exp);
  }

  function supportsBackendTests(language) {
    const cfg = getLangConfig(language);
    return !!(cfg.backendRunner);
  }

  function getBackendRunner(language) {
    return getLangConfig(language).backendRunner || null;
  }

  function supportsBrowserEval(language) {
    return !!getLangConfig(language).browserEval;
  }

  function extractFunctionName(code, language) {
    const cfg = getLangConfig(language);
    const patterns = cfg.fnPatterns?.length ? cfg.fnPatterns : LANGUAGE_REGISTRY.javascript.fnPatterns;
    const src = unescapeHtml(code || '');
    for (const re of patterns) {
      const m = src.match(re);
      if (m && m[1] && m[1] !== 'main' && m[1] !== 'Solution') return m[1];
    }
    return null;
  }

  function extractFunctionNameFromText(questionText, code, language) {
    if (code) {
      const fromCode = extractFunctionName(code, language);
      if (fromCode) return fromCode;
    }
    const cfg = getLangConfig(language);
    const patterns = [
      ...(cfg.textFnPatterns || []),
      /Write\s+(?:a\s+)?(?:\w+\s+)?function\s+(\w+)/i,
      /implement\s+(?:a\s+)?(?:\w+\s+)?function\s+(\w+)/i,
      /method\s+(\w+)\s*\(/i,
    ];
    for (const re of patterns) {
      const m = (questionText || '').match(re);
      if (m && m[1]) return m[1];
    }
    return null;
  }

  function detectLanguageFromCode(code) {
    const src = unescapeHtml(code || '');
    if (!src.trim()) return null;

    const scores = {};
    const bump = (lang, pts) => { scores[lang] = (scores[lang] || 0) + pts; };

    // ── Python — check FIRST, strong exclusive signals ────────────────────
    const hasPythonDef  = /^\s*def\s+\w+\s*\(/m.test(src);
    const hasPythonIndent = hasPythonDef && !/[{};]/.test(src); // no braces at all = pure Python
    if (hasPythonDef)                                            bump('python', 15);
    if (hasPythonIndent)                                         bump('python', 10); // brace-free = very strong
    if (/^\s*class\s+\w+[:(]/m.test(src))                       bump('python', 8);
    if (/^\s*import\s+\w+/m.test(src))                          bump('python', 6);
    if (/^\s*from\s+\w+\s+import/m.test(src))                   bump('python', 8);
    if (/\belif\b/.test(src))                                    bump('python', 10); // elif is Python-only
    if (/\bNone\b/.test(src))                                    bump('python', 6);  // None is Python-only
    if (/\bTrue\b|\bFalse\b/.test(src))                         bump('python', 5);
    if (/self\./.test(src))                                      bump('python', 8);
    if (/print\s*\(/.test(src))                                  bump('python', 3);
    // Python-exclusive: colon at end of control lines
    if (/^\s*(?:if|for|while|with|try|except|finally|else)\b.*:\s*$/m.test(src)) bump('python', 8);

    // ── JavaScript / TypeScript ───────────────────────────────────────────
    // Only give JS points for signals that DON'T appear in Python
    if (/\bfunction\s+\w+\s*\(/.test(src))                      bump('javascript', 10);
    if (/(?:const|let|var)\s+\w+\s*=/.test(src) && !hasPythonDef) bump('javascript', 5);
    if (/=>\s*\{/.test(src))                                     bump('javascript', 8);
    if (/\.forEach|\bmap\(|\bfilter\(/.test(src) && !hasPythonDef) bump('javascript', 4);
    if (/\bundefined\b/.test(src))                               bump('javascript', 5); // JS-only
    if (/===|!==/.test(src) && !hasPythonDef)                    bump('javascript', 4);
    if (/:\s*(?:number|string|boolean|void|any)/.test(src)) {
      bump('typescript', 12); bump('javascript', -3);
    }
    if (/interface\s+\w+|type\s+\w+\s*=/.test(src))             bump('typescript', 10);
    // Brace-based code without Python def = strong JS signal
    if (!hasPythonDef && /\{[^}]{2,}\}/.test(src))              bump('javascript', 3);

    // ── Java ──────────────────────────────────────────────────────────────
    if (/\bpublic\s+class\s+\w+/.test(src))                     bump('java', 15);
    if (/\bpublic\s+(?:static\s+)?\w+\s+\w+\s*\(/.test(src))   bump('java', 10);
    if (/\bSystem\.out\.print/.test(src))                       bump('java', 10);
    if (/\bString\[\]|int\[\]|List</.test(src))                 bump('java', 6);
    if (/\bimport\s+java\./.test(src))                          bump('java', 12);
    if (/@Override/.test(src))                                   bump('java', 10);
    if (/\bvoid\s+\w+\s*\(/.test(src) && !hasPythonDef)        bump('java', 4);

    // ── C ─────────────────────────────────────────────────────────────────
    if (/#include\s*<\w+\.h>/.test(src))                        bump('c', 14);
    if (/\bprintf\s*\(|\bscanf\s*\(/.test(src))                 bump('c', 8);
    if (/\bint\s+main\s*\(/.test(src))                          bump('c', 10);
    if (/\bmalloc\s*\(|\bfree\s*\(/.test(src))                  bump('c', 10);
    if (/#include\s*<stdio\.h>/.test(src))                       bump('c', 10);

    // ── C++ ───────────────────────────────────────────────────────────────
    if (/#include\s*<iostream>/.test(src))                       bump('cpp', 14);
    if (/using\s+namespace\s+std/.test(src))                     bump('cpp', 12);
    if (/std::/.test(src))                                       bump('cpp', 8);
    if (/\bcout\s*<<|\bcin\s*>>/.test(src))                     bump('cpp', 12);
    if (/vector<|map<|set</.test(src))                           bump('cpp', 6);

    // ── C# ────────────────────────────────────────────────────────────────
    if (/using\s+System/.test(src))                              bump('csharp', 12);
    if (/namespace\s+\w+/.test(src))                             bump('csharp', 10);
    if (/Console\.Write/.test(src))                              bump('csharp', 12);
    if (/List<\w+>|Dictionary</.test(src))                       bump('csharp', 8);
    if (/\bvar\s+\w+\s*=\s*new/.test(src))                      bump('csharp', 5);

    // ── Go ────────────────────────────────────────────────────────────────
    if (/^package\s+\w+/m.test(src))                            bump('go', 18);
    if (/\bfunc\s+\w+\s*\(/.test(src) && !hasPythonDef)        bump('go', 12);
    if (/\bfmt\.Print/.test(src))                               bump('go', 10);
    if (/:=/.test(src))                                          bump('go', 10);
    if (/\bimport\s+"/.test(src))                               bump('go', 8);

    // ── Rust ──────────────────────────────────────────────────────────────
    if (/\bfn\s+\w+\s*\(/.test(src) && !hasPythonDef)          bump('rust', 12);
    if (/\blet\s+mut\s+\w+/.test(src))                         bump('rust', 12);
    if (/println!|eprintln!/.test(src))                          bump('rust', 12);
    if (/\buse\s+std::/.test(src))                              bump('rust', 10);
    if (/impl\s+\w+/.test(src))                                 bump('rust', 8);

    // ── Kotlin ────────────────────────────────────────────────────────────
    if (/\bfun\s+\w+\s*\(/.test(src) && !hasPythonDef)         bump('kotlin', 12);
    if (/\bval\s+\w+|\bvar\s+\w+\s*:/.test(src))               bump('kotlin', 8);
    if (/println\s*\(/.test(src) && !hasPythonDef)              bump('kotlin', 6);

    // ── SQL ───────────────────────────────────────────────────────────────
    if (/\bSELECT\b.*\bFROM\b/i.test(src))                      bump('sql', 18);
    if (/\bCREATE\s+TABLE\b/i.test(src))                        bump('sql', 14);
    if (/\bINSERT\s+INTO\b/i.test(src))                         bump('sql', 12);

    const ranked = Object.entries(scores)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);

    if (!ranked.length) return null;
    const [topLang, topScore] = ranked[0];
    const secondScore = ranked[1]?.[1] || 0;
    // Require a clear margin — ambiguous = return null so caller keeps its language
    if (topScore < 8) return null;
    if (topScore - secondScore < 5 && topScore < 15) return null;
    return normalizeToken(topLang);
  }

  function refineLanguageFromCode(code, language) {
    const fromCode = detectLanguageFromCode(code);
    const base = normalizeToken(language) || language;
    if (!base) return fromCode || PIPELINE_CONFIG.fallbackLanguage;
    if (languagesMatch(base, fromCode)) return base;
    return base;
  }

  function getAiPromptHint(language, platformId) {
    const cfg = getLangConfig(language);
    let hint = cfg.aiPromptHint || `Use ${language} only. Single implementation. No duplicates.`;
    const profile = getProfile(platformId);
    if (profile?.codeWrappers?.[cfg.lang]) {
      const w = profile.codeWrappers[cfg.lang];
      hint += ` Platform format: class ${w.className}${w.colon ? ':' : ' { ... }'}.`;
    }
    return hint;
  }

  function buildDedupConfig(language, fnName) {
    const cfg = getLangConfig(language);
    if (!fnName || !cfg.dedupStart) return null;
    const esc = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return {
      strategy: cfg.dedupStrategy,
      startPattern: cfg.dedupStart.replace(/\{\{fn\}\}/g, esc),
      normalizeIndent: cfg.normalizeIndent,
      indentSize: cfg.indentSize,
      classSolution: true,
      language: cfg.lang,
    };
  }

  function isBalancedBraces(code) {
    const opens = (code.match(/\{/g) || []).length;
    const closes = (code.match(/\}/g) || []).length;
    return opens > 0 && opens === closes;
  }

  function scoreBlock(block, cfg) {
    let score = 0;
    if (/\breturn\b/.test(block)) score += 200;
    score += Math.min(block.length, 500);
    if (isBalancedBraces(block)) score += 100;
    else score -= 500;
    const lines = block.split('\n').filter(l => l.trim());
    if (lines.length) {
      const indents = lines.map(l => (l.match(/^(\s*)/) || ['', ''])[1].length);
      const indentSize = cfg.indentSize || 2;
      if (Math.max(...indents) > indentSize * 8) score -= 150;
      if (cfg.normalizeIndent) {
        const odd = indents.filter((n, i) => i > 0 && lines[i].trim() && n > 0 && n % indentSize !== 0).length;
        score -= odd * 20;
      }
    }
    return score;
  }

  function stripTestHarness(code) {
    let result = (code || '')
      .replace(/^\s*console\.(log|debug|info|warn)\(.*\);?\s*$/gm, '')
      .replace(/^\s*\/\/.*test.*$/gim, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const opens = (result.match(/\{/g) || []).length;
    const closes = (result.match(/\}/g) || []).length;
    if (opens > closes) result += '\n' + '}'.repeat(opens - closes);
    return result;
  }

  function trimNestedFunctions(block, name) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nested = block.search(new RegExp(`\\n\\s*function\\s+(?!${esc})\\w+\\s*\\(`, 'm'));
    if (nested < 0) return block;
    let trimmed = block.slice(0, nested).trim();
    if (!trimmed.endsWith('}')) trimmed += '\n}';
    return trimmed;
  }

  function isValidTopLevelFunction(block, name, isMain) {
    if (!block || !isBalancedBraces(block)) return false;
    if (!isMain && /console\.log/.test(block)) return false;
    const maxLen = isMain ? 3000 : 800;
    return block.length <= maxLen;
  }

  function findCalledHelpers(mainCode) {
    const reserved = new Set([
      'if', 'for', 'while', 'return', 'let', 'const', 'var', 'function', 'new',
      'Math', 'console', 'parseInt', 'parseFloat', 'String', 'Number', 'Array',
      'Object', 'JSON', 'slice', 'split', 'join', 'push', 'pop', 'shift', 'map',
      'filter', 'reduce', 'length', 'toString', 'valueOf',
    ]);
    const calls = new Set();
    for (const m of (mainCode || '').matchAll(/\b([a-zA-Z_]\w*)\s*\(/g)) {
      if (!reserved.has(m[1])) calls.add(m[1]);
    }
    return calls;
  }

  function extractAllFunctions(code) {
    const results = [];
    // Find every top-level function declaration start position
    const re = /(?:^|\n)[ \t]*(?:export\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{/gm;
    let m;
    const starts = [];
    while ((m = re.exec(code)) !== null) {
      // position of the opening brace of this function
      const bracePos = m.index + m[0].lastIndexOf('{');
      starts.push({ name: m[1], blockStart: m.index + (code[m.index] === '\n' ? 1 : 0), bracePos });
    }

    for (let si = 0; si < starts.length; si++) {
      const { name, blockStart, bracePos } = starts[si];
      // next function start = hard boundary so we never consume it
      const boundary = si + 1 < starts.length ? starts[si + 1].blockStart : code.length;

      // Walk braces from opening brace only within our boundary
      let depth = 0, end = bracePos, complete = false;
      for (; end < boundary; end++) {
        if (code[end] === '{') depth++;
        else if (code[end] === '}') {
          depth--;
          if (depth === 0) { end++; complete = true; break; }
        }
      }

      if (!complete) {
        // Unclosed block — cut at boundary and close it manually
        let partial = code.slice(blockStart, boundary).trimEnd();
        const o = (partial.match(/\{/g) || []).length;
        const c = (partial.match(/\}/g) || []).length;
        if (o > c) partial += '\n' + '}'.repeat(o - c);
        if (isBalancedBraces(partial)) {
          results.push({ name, code: partial.trim(), complete: false });
        }
      } else {
        const block = code.slice(blockStart, end).trim();
        if (isBalancedBraces(block)) {
          results.push({ name, code: block, complete: true });
        }
      }
    }
    return results;
  }

  function extractScriptSolution(code, language, fnName, cfg) {
    const fns = extractAllFunctions(code);
    if (!fns.length) return null;

    const mainName = fnName || extractFunctionName(code, language);
    const byName = {};

    for (const f of fns) {
      const isMain = f.name === mainName;
      if (!isValidTopLevelFunction(f.code, f.name, isMain)) continue;
      const prev = byName[f.name];
      const fScore = scoreBlock(f.code, cfg);
      const prevScore = prev ? scoreBlock(prev.code, cfg) : -Infinity;
      // Keep only the best-scored definition per name — discards all duplicates
      if (!prev || fScore > prevScore) byName[f.name] = f;
    }

    if (!mainName || !byName[mainName]) return null;

    const mainBlock = normalizeBlockIndent(byName[mainName].code, cfg);
    const parts = [mainBlock];
    const neededHelpers = cfg.collectHelpers ? findCalledHelpers(mainBlock) : new Set();

    for (const hName of neededHelpers) {
      if (hName === mainName || !byName[hName]) continue;
      // Each helper added exactly once
      parts.push(normalizeBlockIndent(byName[hName].code, cfg));
    }

    const result = stripTestHarness(parts.join('\n\n'));
    return _hardDedup(result);
  }

  function _hardDedup(code) {
    // Collect all brace-balanced blocks per function name, keep best-scored one each
    const re = /(?:^|\n)[ \t]*(?:export\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{/gm;
    let m;
    const allBlocks = {}; // name -> [{start, end, block}]

    while ((m = re.exec(code)) !== null) {
      const name = m[1];
      const blockStart = m.index + (code[m.index] === '\n' ? 1 : 0);
      const bracePos = m.index + m[0].lastIndexOf('{');
      let depth = 0, end = bracePos, complete = false;
      for (; end < code.length; end++) {
        if (code[end] === '{') depth++;
        else if (code[end] === '}') {
          depth--;
          if (depth === 0) { end++; complete = true; break; }
        }
      }
      if (!complete) continue;
      if (!allBlocks[name]) allBlocks[name] = [];
      allBlocks[name].push({ start: blockStart, end, block: code.slice(blockStart, end).trim() });
    }

    // Check if any name has duplicates
    const hasDup = Object.values(allBlocks).some(arr => arr.length > 1);
    if (!hasDup) return code;

    // For each duplicated name, remove all but the longest balanced block
    // Work from end of string backwards to preserve offsets
    const removals = []; // [{start, end}] to cut
    for (const [, arr] of Object.entries(allBlocks)) {
      if (arr.length <= 1) continue;
      // Keep the one with most content (longest balanced block)
      const keepIdx = arr.reduce((best, cur, i) =>
        cur.block.length > arr[best].block.length ? i : best, 0);
      arr.forEach((item, i) => { if (i !== keepIdx) removals.push({ start: item.start, end: item.end }); });
    }

    // Sort removals from last to first so slicing doesn't shift offsets
    removals.sort((a, b) => b.start - a.start);
    let result = code;
    for (const { start, end } of removals) {
      result = result.slice(0, start) + result.slice(end);
    }
    return result.replace(/\n{3,}/g, '\n\n').trim();
  }

  function normalizeBlockIndent(block, cfg) {
    if (!cfg.normalizeIndent) return (block || '').trim();
    const lines = (block || '').split('\n');
    const nonEmpty = lines.filter(l => l.trim());
    if (!nonEmpty.length) return block.trim();
    const minIndent = Math.min(...nonEmpty.map(l => (l.match(/^(\s*)/) || ['', ''])[1].length));
    return lines
      .map(l => (l.trim() ? l.slice(Math.min(minIndent, (l.match(/^(\s*)/) || ['', ''])[1].length)) : l))
      .join('\n')
      .replace(/[ \t]+$/gm, '')
      .trim();
  }

  function extractBlocksByStrategy(code, startPattern, strategy) {
    const re = new RegExp(startPattern, 'gm');
    const matches = [...code.matchAll(re)];
    if (matches.length <= 1) return null;

    if (strategy === 'braceBalanced') {
      const blocks = [];
      for (const m of matches) {
        const start = m.index;
        let brace = code.indexOf('{', start);
        if (brace < 0) continue;
        let depth = 0, end = brace;
        for (; end < code.length; end++) {
          if (code[end] === '{') depth++;
          else if (code[end] === '}') { depth--; if (depth === 0) { end++; break; } }
        }
        blocks.push(code.slice(start, end).trim());
      }
      return blocks.length ? blocks : null;
    }

    const starts = matches.map(m => m.index);
    return starts.map((start, i) => {
      const end = i + 1 < starts.length ? starts[i + 1] : code.length;
      return code.slice(start, end).trim();
    });
  }

  function wrapWithClassSolution(body, wrapper, indentSize) {
    const pad = ' '.repeat(indentSize || 4);
    const dedented = normalizeBlockIndent(body, { normalizeIndent: true, indentSize: indentSize || 4 });
    const inner = dedented.split('\n').map(l => (l.trim() ? pad + l : l)).join('\n');
    if (wrapper.colon) {
      return `class ${wrapper.className}:\n${inner}`;
    }
    return `class ${wrapper.className} {\n${inner}\n}`;
  }

  function extractSingleSolution(code, language, fnName, platformId) {
    if (!code) return code;
    const cfg = getLangConfig(language);
    const name = fnName || extractFunctionName(code, language);

    if (cfg.collectHelpers && (cfg.lang === 'javascript' || cfg.lang === 'typescript')) {
      const scriptResult = extractScriptSolution(code, language, name, cfg);
      if (scriptResult) return scriptResult;
    }

    if (!name || !cfg.dedupStart) return stripTestHarness(normalizeBlockIndent(code, cfg));

    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blocks = extractBlocksByStrategy(
      code,
      cfg.dedupStart.replace(/\{\{fn\}\}/g, esc),
      cfg.dedupStrategy
    );
    if (!blocks || blocks.length <= 1) {
      return stripTestHarness(normalizeBlockIndent(code, cfg));
    }

    const best = blocks.sort((a, b) => scoreBlock(b, cfg) - scoreBlock(a, cfg))[0];
    let result = normalizeBlockIndent(best, cfg);

    const profile = platformId ? getProfile(platformId) : null;
    const wrapper = profile?.codeWrappers?.[cfg.lang];
    const needsWrapper = wrapper && wrapper.detect.test(result) && !/class\s+Solution/i.test(code);
    if (/class\s+Solution/i.test(code) || needsWrapper) {
      const w = wrapper || { className: 'Solution', colon: /^\s*def\s+/.test(result) };
      result = wrapWithClassSolution(result, w, cfg.indentSize);
    }
    return stripTestHarness(result);
  }

  function countDefinitions(code, fnName, language) {
    const cfg = getLangConfig(language);
    if (!fnName || !code || !cfg.dedupStart) return 0;
    const src = unescapeHtml(code);
    const esc = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(cfg.dedupStart.replace(/\{\{fn\}\}/g, esc), 'gm');
    return (src.match(re) || []).length;
  }

  function autoFixCode(code, language) {
    const cfg = getLangConfig(language);
    // 1. Strip markdown fences
    code = (code || '').replace(/^```[\w]*\n?/gm, '').replace(/```\s*$/gm, '').trim();
    // 2. HTML entity decode (always — catches &lt; &gt; &amp; &#39; &quot; in any language)
    code = unescapeHtml(code);
    // 3. Normalize tabs to spaces (except Go which uses real tabs)
    if (cfg.lang !== 'go') {
      code = code.replace(/\t/g, ' '.repeat(cfg.indentSize || 2));
    }
    // 4. Fix unbalanced braces for brace-based languages
    if (cfg.braceBalance) {
      const opens = (code.match(/\{/g) || []).length;
      const closes = (code.match(/\}/g) || []).length;
      if (opens > closes) code += '\n' + '}'.repeat(opens - closes);
    }
    // 5. Python: replace bare pass stub
    if (cfg.passReplacement) {
      code = code.replace(/(def\s+\w+[^:]+:[ \t]*\n)([ \t]+)pass\b/g, `$1$2${cfg.passReplacement}`);
    }
    // 6. Python: fix mixed indentation (tabs mixed with spaces)
    if (cfg.lang === 'python') {
      const lines = code.split('\n');
      code = lines.map(l => l.replace(/^\t+/, m => ' '.repeat(m.length * 4))).join('\n');
    }
    // 7. C/C++: ensure no stray semicolons after function closing brace
    if (cfg.lang === 'c' || cfg.lang === 'cpp') {
      code = code.replace(/\}\s*;(\s*\n)/g, '}$1');
    }
    // 8. Java/C#: ensure class wrapper closing brace exists
    if ((cfg.lang === 'java' || cfg.lang === 'csharp') && /class\s+\w+/.test(code)) {
      const opens = (code.match(/\{/g) || []).length;
      const closes = (code.match(/\}/g) || []).length;
      if (opens > closes) code += '\n' + '}'.repeat(opens - closes);
    }
    // 9. Go: opening brace must be on same line (fix newline-before-brace)
    if (cfg.lang === 'go') {
      code = code.replace(/(func\s+\w+[^{\n]*)\n\s*\{/g, '$1 {');
    }
    return code;
  }

  function removeStubs(code, language, fnName) {
    const cfg = getLangConfig(language);
    let result = code || '';
    for (const pat of cfg.stubPatterns || []) {
      const re = new RegExp(
        pat.replace(/\{\{fn\}\}/g, (fnName || '\\w+').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        'gm'
      );
      result = result.replace(re, '');
    }
    return result.replace(/\n{3,}/g, '\n\n').trim();
  }

  function ensureStructure(code, language, platformId, fnName) {
    const cfg = getLangConfig(language);
    const profile = platformId ? getProfile(platformId) : null;
    const wrapper = profile?.codeWrappers?.[cfg.lang];
    if (!wrapper) return code;

    if (cfg.lang === 'java' && /^\s*def\s+/.test(code)) return code;
    if (/class\s+Solution/i.test(code)) return code;
    if (!wrapper.detect.test(code)) return code;

    if (cfg.structureWrapper?.brace || wrapper.brace) {
      const trimmed = code.trim();
      if (/public\s+/.test(trimmed)) {
        return wrapWithClassSolution(trimmed, wrapper, cfg.indentSize);
      }
    }
    if (wrapper.colon && fnName && /^\s*def\s+/.test(code)) {
      return wrapWithClassSolution(code, wrapper, cfg.indentSize);
    }
    return code;
  }

  function isCompleteSolution(code, language, fnName) {
    if (!code || code.trim().length < 30) return false;
    const cfg = getLangConfig(language);
    if (fnName && !code.includes(fnName)) return false;
    if (cfg.requiresReturn && !/\breturn\b/.test(code)) {
      if (cfg.voidPattern && cfg.voidPattern.test(code)) return true;
      return false;
    }
    return true;
  }

  function checkBasicSyntax(code, language) {
    const cfg = getLangConfig(language);
    // Check for unescaped HTML entities — means code was returned with encoding intact
    if (/&lt;|&gt;|&amp;|&#39;|&quot;/.test(code)) {
      return 'Code contains HTML entities (&lt; &gt; &amp;) — will be auto-decoded';
    }
    if (cfg.braceBalance) {
      const opens = (code.match(/\{/g) || []).length;
      const closes = (code.match(/\}/g) || []).length;
      if (opens !== closes) return `Unbalanced braces: ${opens} open vs ${closes} close`;
      const openP = (code.match(/\(/g) || []).length;
      const closeP = (code.match(/\)/g) || []).length;
      if (openP !== closeP) return `Unbalanced parentheses: ${openP} open vs ${closeP} close`;
    }
    // Python-specific checks
    if (cfg.lang === 'python') {
      if (/^\s*def\s+\w+/.test(code) && !/return\b/.test(code) && /\bpass\s*$/.test(code))
        return 'Python function contains only pass — not implemented';
      if (/\t/.test(code))
        return 'Python code contains tabs — use 4-space indentation';
    }
    // Go-specific: opening brace must be on same line
    if (cfg.lang === 'go' && /func\s+\w+[^{\n]*\n\s*\{/.test(code)) {
      return 'Go: opening brace must be on the same line as func declaration';
    }
    // C/C++ stray semicolon after function brace
    if ((cfg.lang === 'c' || cfg.lang === 'cpp') && /\}\s*;/.test(code)) {
      return 'C/C++: stray semicolon after function closing brace }; — should be just }';
    }
    return null;
  }

  function unescapeHtml(str) {
    return (str || '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"');
  }

  function sanitizeCode(code, language, opts = {}) {
    const { fnName, platformId } = opts;
    code = unescapeHtml(code);
    code = (code || '').replace(/^```[\w]*\n?/gm, '').replace(/```\s*$/gm, '').trim();

    // Auto-detect language from the actual code when the caller passes an
    // unresolved / fallback language — prevents sanitizing Python as Java.
    const detectedLang = detectLanguageFromCode(code);
    const resolvedLang = normalizeToken(language)
      || detectedLang
      || PIPELINE_CONFIG.fallbackLanguage;
    // If detected language is confident and different from what was passed, use it
    const effectiveLang = (detectedLang && normalizeToken(language) !== detectedLang)
      ? detectedLang
      : resolvedLang;

    const name = fnName || extractFunctionName(code, effectiveLang);
    code = extractSingleSolution(code, effectiveLang, name, platformId);
    code = removeStubs(code, effectiveLang, name);
    code = autoFixCode(code, effectiveLang);
    code = ensureStructure(code, effectiveLang, platformId, name);
    code = extractSingleSolution(code, effectiveLang, name, platformId);
    code = _hardDedup(code);  // final catch-all for any remaining duplicates
    return stripTestHarness(code).trim();
  }

  function getMatchingProfiles() {
    return PLATFORM_REGISTRY
      .filter(p => { try { return p.match(); } catch (_) { return false; } })
      .sort((a, b) => b.priority - a.priority);
  }

  function getProfile(id) {
    return PLATFORM_REGISTRY.find(p => p.id === id) || null;
  }

  function getPipelineConfig() {
    return { ...PIPELINE_CONFIG };
  }

  function getPostRunDelay(platformId) {
    return PIPELINE_CONFIG.postRunDelayByPlatform[platformId]
      || PIPELINE_CONFIG.defaultPostRunDelayMs;
  }

  function firstText(selectors) {
    for (const sel of selectors || []) {
      try {
        const el = document.querySelector(sel);
        const t = el?.innerText?.trim() || el?.textContent?.trim();
        if (t && t.length > 2) return t;
      } catch (_) {}
    }
    return '';
  }

  function firstVisible(selectors) {
    for (const sel of selectors || []) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return el;
      } catch (_) {}
    }
    return null;
  }

  return {
    LANGUAGE_REGISTRY,
    PLATFORM_REGISTRY,
    PIPELINE_CONFIG,
    getLangConfig,
    getPipelineConfig,
    getPostRunDelay,
    normalizeToken,
    normalizeLanguage,
    languagesMatch,
    supportsBackendTests,
    getBackendRunner,
    supportsBrowserEval,
    extractFunctionName,
    extractFunctionNameFromText,
    detectLanguageFromCode,
    refineLanguageFromCode,
    getAiPromptHint,
    buildDedupConfig,
    sanitizeCode,
    extractSingleSolution,
    countDefinitions,
    autoFixCode,
    removeStubs,
    ensureStructure,
    isCompleteSolution,
    checkBasicSyntax,
    getMatchingProfiles,
    getProfile,
    firstText,
    firstVisible,
    unescapeHtml,
  };
})();

globalThis.PlatformConfig = PlatformConfig;
if (typeof module !== 'undefined' && module.exports) module.exports = PlatformConfig;
