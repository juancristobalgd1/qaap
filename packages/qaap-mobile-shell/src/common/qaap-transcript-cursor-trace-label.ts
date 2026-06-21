// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    classifyTranscriptToolActivityKind,
    humanizeTranscriptToolDisplayName,
    resolveSpecialTranscriptToolTraceLabel,
    resolveTranscriptToolRowParts,
    type QaapTranscriptToolActivityKind,
} from './qaap-agent-transcript-segments';

export interface QaapTranscriptCursorTraceLabel {
    readonly verb: string;
    readonly detail: string;
    readonly tail?: string;
}

/** One readable timeline row (`Ran ls -la`, `Read 3 files`, `Asked a question`). */
export function formatTranscriptCursorTraceRowText(
    verb: string | undefined,
    detail: string | undefined,
    tail?: string,
): string {
    const left = verb?.trim() ?? '';
    const middle = detail?.trim() ?? '';
    const suffix = tail?.trim() ?? '';
    const core = middle ? (left ? `${left} ${middle}` : middle) : left;
    return suffix ? `${core} ${suffix}`.trim() : core;
}

function formatTranscriptSearchPattern(pattern: string): string {
    const clean = pattern.replace(/\s+/g, ' ').trim();
    if (!clean) {
        return 'workspace';
    }
    return compactTraceDetail(clean, 52) ?? clean;
}

/** Cursor-style verb / detail / muted-tail parts for a timeline step row. */
export function resolveTranscriptCursorTraceLabel(
    toolName: string,
    argsJson: string,
    options?: { readonly path?: string; readonly command?: string },
): QaapTranscriptCursorTraceLabel {
    const normalizedToolName = toolName.toLowerCase().replace(/[_-]+/g, ' ').trim();
    if (normalizedToolName.includes('todo')) {
        return { verb: 'Updated', detail: 'todo list' };
    }
    if (normalizedToolName === 'task' || normalizedToolName.includes('task')) {
        return { verb: 'Started', detail: extractTranscriptTaskSummary(argsJson) ?? 'task' };
    }
    const kind = classifyTranscriptToolActivityKind(toolName);
    const rowParts = resolveTranscriptToolRowParts(kind, toolName, options);
    const name = toolName.toLowerCase();
    const fileName = options?.path ? options.path.replace(/\\/g, '/').split('/').filter(Boolean).pop() : undefined;
    switch (kind) {
        case 'searching': {
            const pattern = extractTranscriptTracePattern(argsJson);
            const verb = name.includes('grep') ? 'Grepped' : 'Searched';
            const detail = pattern
                ? formatTranscriptSearchPattern(pattern)
                : rowParts.detail;
            return { verb, detail, tail: resolveTranscriptTraceLocationTail(toolName, argsJson) };
        }
        case 'reading':
            return {
                verb: 'Read',
                detail: fileName ?? rowParts.detail,
                tail: resolveTranscriptTraceLocationTail(toolName, argsJson),
            };
        case 'terminal':
            return {
                verb: 'Ran',
                detail: humanizeTranscriptTerminalDetail(options?.command ?? rowParts.detail),
                tail: extractTranscriptCommandTail(options?.command),
            };
        case 'editing': {
            const file = fileName ?? rowParts.detail;
            return { verb: 'Edited', detail: file };
        }
        case 'mcp':
            return { verb: 'Called', detail: rowParts.detail, tail: 'MCP' };
        default: {
            const special = resolveSpecialTranscriptToolTraceLabel(toolName);
            if (special) {
                return special;
            }
            return { verb: 'Used', detail: humanizeTranscriptToolDisplayName(toolName || 'tool') };
        }
    }
}

function extractTranscriptTaskSummary(argsJson: string): string | undefined {
    const trimmed = argsJson.trim();
    if (!trimmed) {
        return undefined;
    }
    try {
        const args = JSON.parse(trimmed) as Record<string, unknown>;
        const value = [args.description, args.prompt, args.task, args.title]
            .find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);
        return compactTraceDetail(value);
    } catch {
        const match = trimmed.match(/<(?:description|prompt|task|title)>\s*([^<]+?)\s*<\/(?:description|prompt|task|title)>/i)
            ?? trimmed.match(/<(?:description|prompt|task|title)>\s*([^\n\r<]+)/i);
        return compactTraceDetail(match?.[1]);
    }
}

function compactTraceDetail(value: string | undefined, max = 44): string | undefined {
    const clean = value?.replace(/\s+/g, ' ').trim();
    if (!clean) {
        return undefined;
    }
    return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function extractTranscriptTracePattern(argsJson: string): string | undefined {
    try {
        const args = JSON.parse(argsJson) as Record<string, unknown>;
        const pattern = [args.pattern, args.query, args.glob_pattern, args.glob]
            .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
        return pattern?.trim();
    } catch {
        return undefined;
    }
}

function resolveTranscriptTraceLocationTail(toolName: string, argsJson: string): string | undefined {
    const name = toolName.toLowerCase();
    if (name.includes('terminal') || argsJson.toLowerCase().includes('terminal')) {
        return 'terminals';
    }
    return undefined;
}

function humanizeTranscriptTerminalDetail(command: string): string {
    const segments = command.split('&&').map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const clean = segments[segments.length - 1] ?? command.replace(/\s+/g, ' ').trim();
    if (!clean || clean === 'command') {
        return 'command';
    }
    if (clean.startsWith('npm ')) {
        const rest = clean.slice(4).trim();
        if (rest.startsWith('run ')) {
            return `npm run ${rest.slice(4).trim()}`;
        }
        return clean.length > 56 ? `${clean.slice(0, 53)}…` : clean;
    }
    return clean.length > 64 ? `${clean.slice(0, 61)}…` : clean;
}

/** Muted suffix tags such as `cd, npm` on finished shell rows. */
export function extractTranscriptCommandTail(command: string | undefined): string | undefined {
    if (!command?.trim()) {
        return undefined;
    }
    const tokens = command
        .replace(/[|;&]+/g, ' ')
        .split(/\s+/)
        .map(token => token.trim())
        .filter(Boolean);
    const tags = new Set<string>();
    for (const token of tokens) {
        const normalized = token.toLowerCase();
        if (normalized === 'cd' || normalized === 'npm' || normalized === 'npx' || normalized === 'node') {
            tags.add(normalized);
        }
    }
    if (tags.size === 0) {
        return undefined;
    }
    return [...tags].join(', ');
}

export function splitTranscriptCursorGroupedLabel(
    kind: QaapTranscriptToolActivityKind,
    count: number,
): QaapTranscriptCursorTraceLabel {
    switch (kind) {
        case 'reading':
            return { verb: 'Read', detail: count === 1 ? '1 file' : `${count} files` };
        case 'searching':
            return { verb: 'Searched', detail: count === 1 ? 'once' : `${count} times` };
        case 'terminal':
            return { verb: 'Ran', detail: count === 1 ? '1 command' : `${count} commands` };
        case 'editing':
            return { verb: 'Edited', detail: count === 1 ? '1 file' : `${count} files` };
        default:
            return { verb: 'Used', detail: count === 1 ? '1 tool' : `${count} tools` };
    }
}
