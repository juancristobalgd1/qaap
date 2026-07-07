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
};

const LANGUAGE_HINT: Record<string, TranscriptCodeLanguage> = {
    ...EXTENSION_LANGUAGE,
    javascript: 'javascript',
    typescript: 'typescript',
    shell: 'shell',
    bash: 'shell',
    sh: 'shell',
    zsh: 'shell',
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

export function createTranscriptCodeView(text: string, language: TranscriptCodeLanguage): HTMLElement {
    const normalized = normalizeTranscriptCodeText(text, language);
    const wrap = document.createElement('div');
    wrap.className = `theia-mobile-agent-code-view theia-mod-${language}`;
    const linesHost = document.createElement('div');
    linesHost.className = 'theia-mobile-agent-code-lines';
    const lines = normalized.split('\n');
    for (let index = 0; index < lines.length; index++) {
        const row = document.createElement('div');
        row.className = 'theia-mobile-agent-code-line';
        const gutter = document.createElement('span');
        gutter.className = 'theia-mobile-agent-code-gutter';
        gutter.textContent = String(index + 1);
        const code = document.createElement('code');
        code.className = 'theia-mobile-agent-code-text';
        appendHighlightedLine(code, lines[index] ?? '', language);
        row.append(gutter, code);
        linesHost.append(row);
    }
    wrap.append(linesHost);
    return wrap;
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
