// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    classifyTranscriptToolActivityKind,
    resolveTranscriptToolRowParts,
    type QaapTranscriptToolActivityKind,
} from './qaap-agent-transcript-segments';

export interface QaapTranscriptCursorTraceLabel {
    readonly verb: string;
    readonly detail: string;
    readonly tail?: string;
}

/** Cursor-style verb / detail / muted-tail parts for a timeline step row. */
export function resolveTranscriptCursorTraceLabel(
    toolName: string,
    argsJson: string,
    options?: { readonly path?: string; readonly command?: string },
): QaapTranscriptCursorTraceLabel {
    const kind = classifyTranscriptToolActivityKind(toolName);
    const rowParts = resolveTranscriptToolRowParts(kind, toolName, options);
    const name = toolName.toLowerCase();
    switch (kind) {
        case 'searching': {
            const pattern = extractTranscriptTracePattern(argsJson);
            const verb = name.includes('grep') ? 'Grepped' : 'Searched';
            const detail = pattern
                ? (name.includes('grep') ? pattern : `files ${pattern}`)
                : rowParts.detail;
            return { verb, detail, tail: resolveTranscriptTraceLocationTail(toolName, argsJson) };
        }
        case 'reading':
            return {
                verb: 'Read',
                detail: rowParts.detail,
                tail: resolveTranscriptTraceLocationTail(toolName, argsJson),
            };
        case 'terminal':
            return {
                verb: 'Ran',
                detail: humanizeTranscriptTerminalDetail(options?.command ?? rowParts.detail),
                tail: extractTranscriptCommandTail(options?.command),
            };
        case 'editing': {
            const file = options?.path ? options.path.split('/').pop() ?? options.path : rowParts.detail;
            return { verb: 'Edited', detail: file };
        }
        case 'mcp':
            return { verb: 'Called', detail: rowParts.detail, tail: 'MCP' };
        default:
            return { verb: 'Used', detail: rowParts.detail };
    }
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
