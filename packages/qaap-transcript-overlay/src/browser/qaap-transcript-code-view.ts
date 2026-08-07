// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export type TranscriptCodeLanguage =
    | 'json'
    | 'grep'
    | 'typescript'
    | 'javascript'
    | 'css'
    | 'shell'
    | 'python'
    | 'rust'
    | 'go'
    | 'java'
    | 'kotlin'
    | 'c'
    | 'cpp'
    | 'csharp'
    | 'html'
    | 'xml'
    | 'yaml'
    | 'toml'
    | 'sql'
    | 'markdown'
    | 'plain'
    | 'log';

const EXTENSION_LANGUAGE: Record<string, TranscriptCodeLanguage> = {
    json: 'json',
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    css: 'css',
    scss: 'css',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    py: 'python',
    pyw: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    c: 'c',
    h: 'c',
    cc: 'cpp',
    cpp: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    html: 'html',
    htm: 'html',
    xml: 'xml',
    svg: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    sql: 'sql',
    md: 'markdown',
    mdx: 'markdown',
};

const LANGUAGE_HINT: Record<string, TranscriptCodeLanguage> = {
    ...EXTENSION_LANGUAGE,
    javascript: 'javascript',
    typescript: 'typescript',
    shell: 'shell',
    bash: 'shell',
    sh: 'shell',
    zsh: 'shell',
    python: 'python',
    py: 'python',
    rust: 'rust',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kotlin: 'kotlin',
    kt: 'kotlin',
    c: 'c',
    cpp: 'cpp',
    'c++': 'cpp',
    csharp: 'csharp',
    'c#': 'csharp',
    html: 'html',
    xml: 'xml',
    svg: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    sql: 'sql',
    markdown: 'markdown',
    md: 'markdown',
    log: 'log',
    plain: 'plain',
    text: 'plain',
    txt: 'plain',
};

export function resolveTranscriptCodeLanguage(
    filePath?: string,
    text?: string,
    languageHint?: string,
): TranscriptCodeLanguage {
    if (languageHint) {
        const normalized = languageHint.toLowerCase().trim();
        const hinted = LANGUAGE_HINT[normalized];
        if (hinted) {
            return hinted;
        }
    }
    if (filePath) {
        const ext = filePath.split('.').pop()?.toLowerCase();
        if (ext && EXTENSION_LANGUAGE[ext]) {
            return EXTENSION_LANGUAGE[ext];
        }
    }
    const trimmed = text?.trim();
    if (trimmed && looksLikeGrepOutput(trimmed)) {
        return 'grep';
    }
    if (trimmed && looksLikeJsonFragment(trimmed)) {
        return 'json';
    }
    if (trimmed && looksLikeShellTranscript(trimmed)) {
        return 'shell';
    }
    if (trimmed && looksLikeJson(trimmed)) {
        return 'json';
    }
    return 'plain';
}

export function normalizeTranscriptCodeText(text: string, language: TranscriptCodeLanguage): string {
    const clean = text.replace(/\r\n/g, '\n');
    if (language !== 'json') {
        return clean;
    }
    try {
        return JSON.stringify(JSON.parse(clean), undefined, 2);
    } catch {
        return clean;
    }
}

/** Raw (normalized) lines last rendered into a code view, keyed by the wrap
 *  element, so {@link patchTranscriptCodeView} can re-tokenize only changed
 *  lines instead of rebuilding the whole view on every streaming tick. */
const codeViewLinesCache = new WeakMap<HTMLElement, string[]>();

export function createTranscriptCodeView(text: string, language: TranscriptCodeLanguage): HTMLElement {
    const normalized = normalizeTranscriptCodeText(text, language);
    const wrap = document.createElement('div');
    wrap.className = `theia-mobile-agent-code-view theia-mod-${language}`;
    wrap.setAttribute('translate', 'no');
    const linesHost = document.createElement('div');
    linesHost.className = 'theia-mobile-agent-code-lines';
    const lines = normalized.split('\n');
    for (let index = 0; index < lines.length; index++) {
        linesHost.append(createTranscriptCodeLineRow(lines[index] ?? '', index, language));
    }
    wrap.append(linesHost);
    codeViewLinesCache.set(wrap, lines);
    return wrap;
}

function createTranscriptCodeLineRow(line: string, index: number, language: TranscriptCodeLanguage): HTMLElement {
    const row = document.createElement('div');
    row.className = 'theia-mobile-agent-code-line';
    const gutter = document.createElement('span');
    gutter.className = 'theia-mobile-agent-code-gutter';
    gutter.textContent = String(index + 1);
    const code = document.createElement('code');
    code.className = 'theia-mobile-agent-code-text';
    appendHighlightedLine(code, line, language);
    row.append(gutter, code);
    return row;
}

/**
 * Patches a code view previously built by {@link createTranscriptCodeView} so
 * it shows `text`, re-tokenizing only the lines that actually changed —
 * streaming output typically appends, so unchanged prefix lines keep their DOM
 * nodes untouched. Returns `false` (without mutating anything) when the view
 * can't be patched safely — different language, foreign element, or DOM shape
 * that no longer matches the cache — so callers fall back to a full rebuild.
 */
export function patchTranscriptCodeView(view: HTMLElement, text: string, language: TranscriptCodeLanguage): boolean {
    if (!view.classList.contains('theia-mobile-agent-code-view') || !view.classList.contains(`theia-mod-${language}`)) {
        return false;
    }
    const linesHost = view.querySelector<HTMLElement>(':scope > .theia-mobile-agent-code-lines');
    const prevLines = codeViewLinesCache.get(view);
    if (!linesHost || !prevLines || linesHost.children.length !== prevLines.length) {
        return false;
    }
    const nextLines = normalizeTranscriptCodeText(text, language).split('\n');

    // Validate before mutating: collect the <code> hosts of every line that
    // needs re-tokenizing, so a shape mismatch bails with the DOM untouched
    // rather than leaving it half-patched.
    const shared = Math.min(prevLines.length, nextLines.length);
    const changed: Array<{ code: HTMLElement; line: string }> = [];
    for (let index = 0; index < shared; index++) {
        if (prevLines[index] === nextLines[index]) {
            continue;
        }
        const code = linesHost.children.item(index)?.querySelector<HTMLElement>(':scope > .theia-mobile-agent-code-text');
        if (!code) {
            return false;
        }
        changed.push({ code, line: nextLines[index] ?? '' });
    }

    for (const entry of changed) {
        entry.code.textContent = '';
        appendHighlightedLine(entry.code, entry.line, language);
    }
    for (let index = prevLines.length - 1; index >= nextLines.length; index--) {
        linesHost.children.item(index)?.remove();
    }
    for (let index = prevLines.length; index < nextLines.length; index++) {
        linesHost.append(createTranscriptCodeLineRow(nextLines[index] ?? '', index, language));
    }
    codeViewLinesCache.set(view, nextLines);
    return true;
}

function looksLikeJson(text: string): boolean {
    return (text.startsWith('{') && text.endsWith('}'))
        || (text.startsWith('[') && text.endsWith(']'));
}

function looksLikeJsonFragment(text: string): boolean {
    const sample = text.split('\n').slice(0, 8).filter(line => line.trim());
    if (sample.length === 0) {
        return false;
    }
    const jsonish = sample.filter(line =>
        /^\s*"[^"]+"\s*:/.test(line)
        || /^\s*[{}\]][,]?\s*$/.test(line),
    ).length;
    return jsonish >= Math.min(2, sample.length);
}

function looksLikeGrepOutput(text: string): boolean {
    const sample = text.split('\n').slice(0, 6).filter(line => line.trim());
    if (sample.length === 0) {
        return false;
    }
    const matches = sample.filter(line => /^(?:[^\s:]+\/[^\s]+|\S+\.\w+):\d+/.test(line)).length;
    return matches >= Math.min(2, sample.length);
}

/** Tokenize a single source line into `host` (for React/diff hosts that manage their own layout). */
export function highlightTranscriptCodeInto(host: HTMLElement, line: string, language: TranscriptCodeLanguage): void {
    host.replaceChildren();
    appendHighlightedLine(host, line || ' ', language);
}

function appendHighlightedLine(host: HTMLElement, line: string, language: TranscriptCodeLanguage): void {
    switch (language) {
        case 'grep':
            appendGrepLine(host, line);
            return;
        case 'json':
            appendJsonLine(host, line);
            return;
        case 'typescript':
        case 'javascript':
            appendScriptLine(host, line);
            return;
        case 'css':
            appendCssLine(host, line);
            return;
        case 'shell':
            appendShellLine(host, line);
            return;
        case 'python':
        case 'rust':
        case 'go':
        case 'java':
        case 'kotlin':
        case 'c':
        case 'cpp':
        case 'csharp':
        case 'html':
        case 'xml':
        case 'yaml':
        case 'toml':
        case 'sql':
        case 'markdown':
            appendGenericLanguageLine(host, line, language);
            return;
        case 'log':
            appendLogLine(host, line);
            return;
        default:
            host.textContent = line || ' ';
    }
}

function appendSpan(host: HTMLElement, text: string, tokenClass: string): void {
    if (!text) {
        return;
    }
    const span = document.createElement('span');
    span.className = `theia-mobile-agent-token theia-mod-${tokenClass}`;
    span.textContent = text;
    host.append(span);
}

function appendGrepLine(host: HTMLElement, line: string): void {
    const match = line.match(/^(.+?):(\d+)(?::(.*))?$/);
    if (!match) {
        host.textContent = line || ' ';
        return;
    }
    appendSpan(host, match[1], 'path');
    appendSpan(host, ':', 'sep');
    appendSpan(host, match[2], 'line');
    if (match[3] !== undefined) {
        appendSpan(host, ':', 'sep');
        appendSpan(host, match[3], 'content');
    }
}

function appendJsonLine(host: HTMLElement, line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
        host.textContent = ' ';
        return;
    }
    const keyMatch = trimmed.match(/^("(?:\\.|[^"\\])*")\s*(:\s*)?(.*)$/);
    if (keyMatch && keyMatch[2]) {
        appendSpan(host, line.slice(0, line.indexOf(keyMatch[1])), 'plain');
        appendSpan(host, keyMatch[1], 'key');
        appendSpan(host, keyMatch[2], 'sep');
        appendJsonValue(host, keyMatch[3] ?? '');
        return;
    }
    appendJsonValue(host, trimmed);
}

function appendJsonValue(host: HTMLElement, value: string): void {
    const trimmed = value.trim();
    if (!trimmed) {
        return;
    }
    if (/^"(?:\\.|[^"\\])*",?$/.test(trimmed)) {
        appendSpan(host, value, 'string');
        return;
    }
    if (/^-?\d+(?:\.\d+)?,?$/.test(trimmed)) {
        appendSpan(host, value, 'number');
        return;
    }
    if (/^(true|false|null),?$/.test(trimmed)) {
        appendSpan(host, value, 'keyword');
        return;
    }
    if (/^[\[\]{}],?$/.test(trimmed)) {
        appendSpan(host, value, 'sep');
        return;
    }
    host.textContent = value;
}

function appendScriptLine(host: HTMLElement, line: string): void {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) {
        appendSpan(host, line, 'comment');
        return;
    }
    const keywordMatch = line.match(/^(\s*)(export\s+)?(import|export|const|let|var|function|class|interface|type|return|if|else|for|while|switch|case|break|continue|async|await|from)\b(.*)$/);
    if (keywordMatch) {
        appendSpan(host, keywordMatch[1] ?? '', 'plain');
        appendSpan(host, keywordMatch[2] ?? '', 'keyword');
        appendSpan(host, keywordMatch[3] ?? '', 'keyword');
        appendScriptTail(host, keywordMatch[4] ?? '');
        return;
    }
    appendScriptTail(host, line);
}

const SCRIPT_KEYWORDS = new Set([
    'as',
    'async',
    'await',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'default',
    'else',
    'export',
    'extends',
    'false',
    'finally',
    'for',
    'from',
    'function',
    'if',
    'import',
    'in',
    'instanceof',
    'interface',
    'let',
    'new',
    'null',
    'of',
    'return',
    'switch',
    'throw',
    'true',
    'try',
    'type',
    'undefined',
    'var',
    'while',
]);

function appendScriptTail(host: HTMLElement, line: string): void {
    if (!line) {
        host.textContent = ' ';
        return;
    }
    let index = 0;
    while (index < line.length) {
        const rest = line.slice(index);
        const whitespace = rest.match(/^\s+/)?.[0];
        if (whitespace) {
            appendSpan(host, whitespace, 'plain');
            index += whitespace.length;
            continue;
        }
        if (rest.startsWith('//')) {
            appendSpan(host, rest, 'comment');
            return;
        }
        if (rest[0] === '"' || rest[0] === '\'' || rest[0] === '`') {
            const end = findScriptQuoteEnd(line, index);
            appendSpan(host, line.slice(index, end), 'string');
            index = end;
            continue;
        }
        const number = rest.match(/^\b\d+(?:\.\d+)?\b/)?.[0];
        if (number) {
            appendSpan(host, number, 'number');
            index += number.length;
            continue;
        }
        const identifier = rest.match(/^[A-Za-z_$][\w$]*/)?.[0];
        if (identifier) {
            const after = line.slice(index + identifier.length);
            if (SCRIPT_KEYWORDS.has(identifier)) {
                appendSpan(host, identifier, 'keyword');
            } else if (/^\s*\(/.test(after)) {
                appendSpan(host, identifier, 'function');
            } else if (isInsideCallArgument(line, index)) {
                appendSpan(host, identifier, 'parameter');
            } else {
                appendSpan(host, identifier, 'plain');
            }
            index += identifier.length;
            continue;
        }
        const operator = rest.match(/^(=>|===|!==|==|!=|<=|>=|\+\+|--|&&|\|\||[=+\-*/%<>!?:]+)/)?.[0];
        if (operator) {
            appendSpan(host, operator, 'operator');
            index += operator.length;
            continue;
        }
        const punctuation = rest.match(/^[()[\]{}.,;]/)?.[0];
        if (punctuation) {
            appendSpan(host, punctuation, 'sep');
            index += punctuation.length;
            continue;
        }
        appendSpan(host, rest[0], 'plain');
        index += 1;
    }
}

function isInsideCallArgument(line: string, identifierStart: number): boolean {
    let depth = 0;
    for (let index = 0; index < identifierStart; index++) {
        const char = line[index];
        if (char === '(') {
            depth++;
        } else if (char === ')' && depth > 0) {
            depth--;
        }
    }
    return depth > 0;
}

function findScriptQuoteEnd(line: string, start: number): number {
    const quote = line[start];
    for (let index = start + 1; index < line.length; index++) {
        if (line[index] === '\\' && index + 1 < line.length) {
            index += 1;
            continue;
        }
        if (line[index] === quote) {
            return index + 1;
        }
    }
    return line.length;
}

const GENERIC_LANGUAGE_KEYWORDS: Readonly<Record<string, ReadonlySet<string>>> = {
    python: new Set([
        'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else',
        'False', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'None', 'nonlocal',
        'not', 'or', 'pass', 'raise', 'return', 'True', 'try', 'with', 'while', 'yield',
    ]),
    rust: new Set([
        'as', 'async', 'await', 'const', 'crate', 'dyn', 'else', 'enum', 'false', 'fn', 'for', 'if', 'impl',
        'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'struct',
        'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while',
    ]),
    go: new Set([
        'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough', 'for', 'func',
        'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range', 'return', 'select', 'struct',
        'switch', 'type', 'var', 'true', 'false', 'nil',
    ]),
    java: new Set([
        'abstract', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default',
        'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'if', 'implements',
        'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'null', 'package', 'private',
        'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized',
        'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'true', 'false',
    ]),
    kotlin: new Set([
        'as', 'break', 'class', 'continue', 'data', 'else', 'false', 'for', 'fun', 'if', 'import', 'in', 'interface',
        'internal', 'is', 'lateinit', 'null', 'object', 'open', 'override', 'package', 'private', 'protected',
        'public', 'return', 'sealed', 'super', 'this', 'throw', 'true', 'try', 'typealias', 'val', 'var', 'when',
        'while',
    ]),
    c: new Set([
        'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extern',
        'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register', 'restrict', 'return', 'short', 'signed',
        'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while',
        'true', 'false', 'NULL',
    ]),
    cpp: new Set([
        'alignas', 'auto', 'bool', 'break', 'case', 'catch', 'char', 'class', 'const', 'constexpr', 'continue',
        'default', 'delete', 'do', 'double', 'else', 'enum', 'explicit', 'false', 'final', 'float', 'for', 'friend',
        'if', 'inline', 'int', 'namespace', 'new', 'noexcept', 'nullptr', 'operator', 'private', 'protected',
        'public', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'template', 'this', 'throw',
        'true', 'try', 'typedef', 'typename', 'union', 'unsigned', 'using', 'virtual', 'void', 'volatile', 'while',
    ]),
    csharp: new Set([
        'abstract', 'as', 'async', 'await', 'base', 'bool', 'break', 'case', 'catch', 'char', 'class', 'const',
        'continue', 'decimal', 'default', 'delegate', 'do', 'double', 'else', 'enum', 'event', 'explicit', 'false',
        'finally', 'fixed', 'float', 'for', 'foreach', 'if', 'implicit', 'in', 'int', 'interface', 'internal',
        'is', 'lock', 'long', 'namespace', 'new', 'null', 'object', 'operator', 'out', 'override', 'params',
        'private', 'protected', 'public', 'readonly', 'ref', 'return', 'sealed', 'short', 'sizeof', 'stackalloc',
        'static', 'string', 'struct', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'uint', 'ulong', 'unchecked',
        'unsafe', 'ushort', 'using', 'var', 'virtual', 'void', 'volatile', 'while',
    ]),
    html: new Set(),
    xml: new Set(),
    yaml: new Set(['true', 'false', 'null', 'yes', 'no']),
    toml: new Set(['true', 'false']),
    sql: new Set([
        'alter', 'and', 'as', 'asc', 'between', 'by', 'case', 'create', 'delete', 'desc', 'distinct', 'drop',
        'else', 'end', 'exists', 'from', 'group', 'having', 'in', 'insert', 'into', 'is', 'join', 'left', 'like',
        'limit', 'not', 'null', 'or', 'order', 'outer', 'primary', 'right', 'select', 'set', 'table',
        'then', 'union', 'update', 'values', 'when', 'where', 'with', 'on',
    ]),
    markdown: new Set(),
};

function appendGenericLanguageLine(
    host: HTMLElement,
    line: string,
    language: Exclude<TranscriptCodeLanguage, 'json' | 'grep' | 'typescript' | 'javascript' | 'css' | 'shell' | 'log' | 'plain'>,
): void {
    if (!line) {
        host.textContent = ' ';
        return;
    }
    if (language === 'markdown') {
        const heading = line.match(/^(\s{0,3}#{1,6}\s.*)$/);
        if (heading) {
            appendSpan(host, heading[1], 'key');
            return;
        }
    }
    const keywords = GENERIC_LANGUAGE_KEYWORDS[language] ?? new Set<string>();
    const lineComment = language === 'python' || language === 'yaml' || language === 'toml' ? '#' : language === 'sql' ? '--' : '//';
    let index = 0;
    while (index < line.length) {
        const rest = line.slice(index);
        const whitespace = rest.match(/^\s+/)?.[0];
        if (whitespace) {
            appendSpan(host, whitespace, 'plain');
            index += whitespace.length;
            continue;
        }
        if (rest.startsWith('/*') || rest.startsWith('<!--') || rest.startsWith(lineComment)) {
            appendSpan(host, rest, 'comment');
            return;
        }
        if ((language === 'html' || language === 'xml') && rest.startsWith('<')) {
            const tagEnd = rest.indexOf('>');
            if (tagEnd >= 0) {
                appendSpan(host, rest.slice(0, tagEnd + 1), 'key');
                index += tagEnd + 1;
                continue;
            }
        }
        if (rest[0] === '"' || rest[0] === '\'' || (rest[0] === '`' && language !== 'markdown')) {
            const end = findScriptQuoteEnd(line, index);
            appendSpan(host, line.slice(index, end), 'string');
            index = end;
            continue;
        }
        const number = rest.match(/^\b(?:0[xob][\da-f]+|\d+(?:\.\d+)?)\b/i)?.[0];
        if (number) {
            appendSpan(host, number, 'number');
            index += number.length;
            continue;
        }
        const identifier = rest.match(/^[A-Za-z_$][\w$-]*/)?.[0];
        if (identifier) {
            const after = line.slice(index + identifier.length);
            if ((language === 'yaml' || language === 'toml') && /^\s*:/.test(after)) {
                appendSpan(host, identifier, 'key');
            } else if (keywords.has(identifier) || keywords.has(identifier.toLowerCase())) {
                appendSpan(host, identifier, 'keyword');
            } else if (/^\s*\(/.test(after)) {
                appendSpan(host, identifier, 'function');
            } else {
                appendSpan(host, identifier, 'plain');
            }
            index += identifier.length;
            continue;
        }
        const operator = rest.match(/^(?:=>|->|::|:=|===|!==|==|!=|<=|>=|&&|\|\||\+\+|--|[=+\-*/%<>!?:|&^~]+)/)?.[0];
        if (operator) {
            appendSpan(host, operator, 'operator');
            index += operator.length;
            continue;
        }
        const punctuation = rest.match(/^[()[\]{}.,;]/)?.[0];
        if (punctuation) {
            appendSpan(host, punctuation, 'sep');
            index += punctuation.length;
            continue;
        }
        appendSpan(host, rest[0], 'plain');
        index += 1;
    }
}

function appendCssLine(host: HTMLElement, line: string): void {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//')) {
        appendSpan(host, line, 'comment');
        return;
    }
    const selectorMatch = line.match(/^([^{]+)(\{?)(.*)$/);
    if (selectorMatch && selectorMatch[2]) {
        appendSpan(host, selectorMatch[1], 'key');
        appendSpan(host, selectorMatch[2], 'sep');
        appendSpan(host, selectorMatch[3] ?? '', 'plain');
        return;
    }
    const propMatch = line.match(/^(\s*)([\w-]+)(\s*:\s*)(.*)$/);
    if (propMatch) {
        appendSpan(host, propMatch[1] ?? '', 'plain');
        appendSpan(host, propMatch[2] ?? '', 'key');
        appendSpan(host, propMatch[3] ?? '', 'sep');
        appendSpan(host, propMatch[4] ?? '', 'string');
        return;
    }
    host.textContent = line || ' ';
}

function appendShellLine(host: HTMLElement, line: string): void {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
        appendSpan(host, line, 'comment');
        return;
    }
    const promptMatch = line.match(/^(\s*\$\s?)(.*)$/);
    if (promptMatch) {
        appendSpan(host, promptMatch[1], 'keyword');
        appendShellTokens(host, promptMatch[2] ?? '');
        return;
    }
    appendShellTokens(host, line);
}

function appendShellTokens(host: HTMLElement, line: string): void {
    if (!line) {
        host.textContent = ' ';
        return;
    }
    let index = 0;
    let expectCommand = true;
    while (index < line.length) {
        const rest = line.slice(index);
        const separator = rest.match(/^(\s*(?:&&|\|\||\||;)\s*)/);
        if (separator) {
            appendSpan(host, separator[1], 'sep');
            index += separator[1].length;
            expectCommand = true;
            continue;
        }
        const whitespace = rest.match(/^(\s+)/);
        if (whitespace) {
            appendSpan(host, whitespace[1], 'plain');
            index += whitespace[1].length;
            continue;
        }
        if (rest[0] === '"' || rest[0] === '\'') {
            const end = findShellQuoteEnd(line, index);
            appendSpan(host, line.slice(index, end), 'string');
            index = end;
            expectCommand = false;
            continue;
        }
        if (rest[0] === '#') {
            appendSpan(host, line.slice(index), 'comment');
            return;
        }
        const token = rest.match(/^(\$\{[^}]+\}|\$[\w@#*!?-]+|--?[\w-]+|[^\s#"'|$;&<>]+)/)?.[0];
        if (!token) {
            appendSpan(host, rest[0], 'plain');
            index += 1;
            continue;
        }
        if (token.startsWith('$')) {
            appendSpan(host, token, 'string');
        } else if (/^--?[\w-]+$/.test(token)) {
            appendSpan(host, token, 'keyword');
        } else if (expectCommand) {
            appendSpan(host, token, 'keyword');
            expectCommand = false;
        } else if (/^(?:\d+|2>&1|\d?>&\d)$/.test(token)) {
            appendSpan(host, token, 'number');
        } else if (/[/.]/.test(token)) {
            appendSpan(host, token, 'path');
        } else {
            appendSpan(host, token, 'plain');
        }
        index += token.length;
    }
}

function looksLikeShellTranscript(text: string): boolean {
    const sample = text.split('\n').slice(0, 6).filter(line => line.trim());
    if (sample.length === 0) {
        return false;
    }
    const shellish = sample.filter(line =>
        /^\s*(?:\$|npm|pnpm|yarn|npx|node|git|cat|grep|rg|sed|awk|tail|head|cd|ls|mkdir|rm|cp|mv)\b/.test(line),
    ).length;
    return shellish >= Math.min(2, sample.length);
}

function appendLogLine(host: HTMLElement, line: string): void {
    if (!line) {
        host.textContent = ' ';
        return;
    }
    const levelMatch = line.match(/^(\s*)(PASS|FAIL|ERROR|WARN|INFO|DONE|✓|✔|✗|×)(\b|:)?(.*)$/i);
    if (levelMatch) {
        appendSpan(host, levelMatch[1] ?? '', 'plain');
        appendSpan(host, levelMatch[2] ?? '', /fail|error|✗|×/i.test(levelMatch[2] ?? '') ? 'error' : 'keyword');
        appendSpan(host, levelMatch[3] ?? '', 'sep');
        appendLogLine(host, levelMatch[4] ?? '');
        return;
    }
    const pathMatch = line.match(/^(\s*)([^\s:]+\.\w+)(?::(\d+))?(.*)$/);
    if (pathMatch) {
        appendSpan(host, pathMatch[1] ?? '', 'plain');
        appendSpan(host, pathMatch[2] ?? '', 'path');
        if (pathMatch[3]) {
            appendSpan(host, ':', 'sep');
            appendSpan(host, pathMatch[3], 'line');
        }
        appendSpan(host, pathMatch[4] ?? '', 'plain');
        return;
    }
    appendSpan(host, line, 'plain');
}

function findShellQuoteEnd(line: string, start: number): number {
    const quote = line[start];
    for (let index = start + 1; index < line.length; index++) {
        if (line[index] === '\\' && index + 1 < line.length) {
            index += 1;
            continue;
        }
        if (line[index] === quote) {
            return index + 1;
        }
    }
    return line.length;
}
