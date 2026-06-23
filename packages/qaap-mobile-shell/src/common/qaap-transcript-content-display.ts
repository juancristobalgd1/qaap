// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Returns true when transcript text should render as Markdown, not a terminal/log panel. */
export function looksLikeTranscriptMarkdown(content: string): boolean {
    if (!content.trim()) {
        return false;
    }
    if (/^#{1,6}\s+\S/m.test(content)) {
        return true;
    }
    if (/^```/m.test(content)) {
        return true;
    }
    if (/\*\*[^*\n]+\*\*/.test(content)) {
        return true;
    }
    if (/^[-*+]\s+\S/m.test(content)) {
        return true;
    }
    if (/^\d+\.\s+\S/m.test(content)) {
        return true;
    }
    if (/^>\s+\S/m.test(content)) {
        return true;
    }
    if (/\[[^\]]+\]\([^)]+\)/.test(content)) {
        return true;
    }
    return false;
}

/** Heuristic: multi-line stderr / stack traces that belong in a collapsible terminal panel. */
export function isTranscriptTerminalOutputText(content: string): boolean {
    if (looksLikeTranscriptMarkdown(content)) {
        return false;
    }
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length < 4) {
        return false;
    }
    const signals = lines.filter(line =>
        /file:\/\/\/|node_modules\/[^\s:]+\.\w+:\d+|^\s*at\s+(?:\S+\.)?\S+\s*\(|Traceback \(most recent call last\)|The above error occurred|React will try to recreate/i.test(line)
        || /^(?:\w+)?Error:\s|^(?:\w+)?Exception:\s/i.test(line)
    ).length;
    return signals >= 2;
}

/** Whether a terminal panel should use the failed/error chrome and label. */
export function isTranscriptErrorOutput(content: string): boolean {
    return /Traceback \(most recent call last\)|The above error occurred|React will try to recreate/i.test(content)
        || /^(?:\w+)?(?:Error|Exception):\s/m.test(content)
        || /^\s*at\s+(?:\S+\.)?\S+\s*\(/m.test(content);
}

/** Path-like stdout line from Glob/Grep/LS — not an error summary. */
export function isLikelyToolResultPathLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) {
        return false;
    }
    if (/^\(.*Results are truncated/i.test(trimmed)) {
        return true;
    }
    if (/^[\w./-]*node_modules\//.test(trimmed) || /\/node_modules\//.test(trimmed)) {
        return true;
    }
    if (/^(?:package\.json|index\.html|src\/|README(?:\.md)?)$/i.test(trimmed)) {
        return true;
    }
    if (/^[\w./-]+\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|css|html|txt|yml|yaml|map)$/i.test(trimmed)) {
        return true;
    }
    return false;
}

/**
 * Whether a finished tool's stdout/stderr indicates failure.
 * Ignores {@code error} substrings inside file paths (e.g. css-syntax-error.js).
 */
export function isAgentToolResultFailure(result: string | undefined): boolean {
    if (!result?.trim()) {
        return false;
    }
    if (/tool_use_error|InputValidationError/i.test(result)) {
        return true;
    }
    if (isTranscriptErrorOutput(result)) {
        return true;
    }
    if (/\b(?:exit\s+code|exited with (?:code )?)\s*[1-9]\d*\b/i.test(result)) {
        return true;
    }
    if (/\bfatal:\s/i.test(result)) {
        return true;
    }
    if (/\bcommand not found\b/i.test(result)) {
        return true;
    }
    for (const line of result.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || isLikelyToolResultPathLine(trimmed)) {
            continue;
        }
        if (/^(?:Error|Fatal):\s/i.test(trimmed)) {
            return true;
        }
        if (/\b(error|failed|failure)\b/i.test(trimmed) && !/\b0\s+failed\b/i.test(trimmed)) {
            return true;
        }
    }
    return false;
}
