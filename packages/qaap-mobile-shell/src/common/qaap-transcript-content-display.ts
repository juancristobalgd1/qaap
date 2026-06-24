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

/**
 * Claude / QAIQ Read success payloads: numbered source lines and optional
 * {@code <path>}/{@code <content>} wrappers. Must not run stderr keyword heuristics
 * on this body — identifiers like {@code webglError} or {@code error=} are normal.
 */
export function isLikelyReadToolFileContent(result: string): boolean {
    const trimmed = result.trim();
    if (!trimmed) {
        return false;
    }
    if (/\(End of file - total \d+ lines?\)/i.test(trimmed)) {
        return true;
    }
    if (/<path>[\s\S]+<\/path>[\s\S]*<content>[\s\S]+<\/content>/i.test(trimmed)) {
        return true;
    }
    if (/<type>file<\/type>/i.test(trimmed) && /<content>/i.test(trimmed)) {
        return true;
    }
    const numberedLines = trimmed.split('\n').filter(line => /^\d+:\s/.test(line.trim())).length;
    return numberedLines >= 2;
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

export interface AgentToolResultFailureOptions {
    /** When set to a Read-like tool, file payloads skip keyword heuristics. */
    readonly toolName?: string;
}

function isPureReadToolName(toolName: string | undefined): boolean {
    if (!toolName?.trim()) {
        return false;
    }
    const name = toolName.trim().toLowerCase();
    return name === 'read' || name.endsWith('.read') || name.includes('fileread');
}

/**
 * Whether a finished tool's stdout/stderr indicates failure.
 * Ignores {@code error} substrings inside file paths (e.g. css-syntax-error.js)
 * and inside Read tool file payloads (e.g. {@code webglError}, {@code error=}).
 */
export function isAgentToolResultFailure(
    result: string | undefined,
    options: AgentToolResultFailureOptions = {},
): boolean {
    if (!result?.trim()) {
        return false;
    }
    if (/tool_use_error|InputValidationError/i.test(result)) {
        return true;
    }
    const readFilePayload = isLikelyReadToolFileContent(result)
        || (isPureReadToolName(options.toolName) && /^\d+:\s/m.test(result));
    if (isTranscriptErrorOutput(result) && !readFilePayload) {
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
    if (readFilePayload) {
        return false;
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
