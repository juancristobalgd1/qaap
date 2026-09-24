// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import {
    classifyTranscriptToolActivityKind,
    extractTranscriptTaskSummary,
    extractTranscriptTracePattern,
    humanizeTranscriptToolDisplayName,
    resolveSpecialTranscriptToolTraceLabel,
    resolveTranscriptToolRowParts,
    type QaapTranscriptToolActivityKind,
} from './qaap-agent-transcript-segments';
import { isTranscriptSubagentToolName } from './qaap-transcript-activity-nesting';
import { formatTranscriptTraceCommandDetail, formatTranscriptTraceMonoPath } from './qaap-transcript-trace-path';

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

function localizeTranscriptCursorVerbRead(): string {
    return nls.localize('qaap/mobileProjects/transcriptCursorVerbRead', 'Read');
}

function localizeTranscriptCursorVerbEdited(): string {
    return nls.localize('qaap/mobileProjects/transcriptCursorVerbEdited', 'Edited');
}

function localizeTranscriptCursorVerbRan(): string {
    return nls.localize('qaap/mobileProjects/transcriptCursorVerbRan', 'Ran');
}

function localizeTranscriptCursorVerbSearched(): string {
    return nls.localize('qaap/mobileProjects/transcriptCursorVerbSearched', 'Searched');
}

function localizeTranscriptCursorVerbGrepped(): string {
    return nls.localize('qaap/mobileProjects/transcriptCursorVerbGrepped', 'Grepped');
}

function localizeTranscriptCursorVerbStarted(): string {
    return nls.localize('qaap/mobileProjects/transcriptCursorVerbStarted', 'Started');
}

function localizeTranscriptCursorVerbUpdated(): string {
    return nls.localize('qaap/mobileProjects/transcriptCursorVerbUpdated', 'Updated');
}

function localizeTranscriptCursorVerbCalled(): string {
    return nls.localize('qaap/mobileProjects/transcriptCursorVerbCalled', 'Called');
}

function localizeTranscriptCursorVerbUsed(): string {
    return nls.localize('qaap/mobileProjects/transcriptCursorVerbUsed', 'Used');
}

function localizeTranscriptCursorVerbPlanning(): string {
    return nls.localize('qaap/mobileProjects/transcriptCursorVerbPlanning', 'Planning');
}

function formatTranscriptSearchPattern(pattern: string): string {
    const clean = pattern.replace(/\s+/g, ' ').trim();
    if (!clean) {
        return 'workspace';
    }
    return clean.length > 52 ? `${clean.slice(0, 51).trimEnd()}…` : clean;
}

function resolveTranscriptTracePathDetail(path: string | undefined, fallback: string): string {
    if (path?.trim()) {
        return formatTranscriptTraceMonoPath(path);
    }
    return fallback;
}

/** Cursor-style verb / detail / muted-tail parts for a timeline step row. */
export function resolveTranscriptCursorTraceLabel(
    toolName: string,
    argsJson: string,
    options?: { readonly path?: string; readonly command?: string },
): QaapTranscriptCursorTraceLabel {
    const normalizedToolName = toolName.toLowerCase().replace(/[_-]+/g, ' ').trim();
    if (normalizedToolName.includes('todo')) {
        return { verb: localizeTranscriptCursorVerbUpdated(), detail: 'todo list' };
    }
    if (isTranscriptSubagentToolName(toolName)) {
        return {
            verb: localizeTranscriptCursorVerbStarted(),
            detail: extractTranscriptTaskSummary(argsJson) ?? 'task',
        };
    }
    const kind = classifyTranscriptToolActivityKind(toolName);
    const pattern = kind === 'searching' ? extractTranscriptTracePattern(argsJson) : undefined;
    const rowParts = resolveTranscriptToolRowParts(kind, toolName, {
        ...options,
        pattern,
        argsJson,
    });
    const name = toolName.toLowerCase();
    switch (kind) {
        case 'searching': {
            const verb = name.includes('grep')
                ? localizeTranscriptCursorVerbGrepped()
                : localizeTranscriptCursorVerbSearched();
            const detail = pattern
                ? formatTranscriptSearchPattern(pattern)
                : rowParts.detail;
            return { verb, detail, tail: resolveTranscriptTraceLocationTail(toolName, argsJson) };
        }
        case 'reading':
            return {
                verb: localizeTranscriptCursorVerbRead(),
                detail: resolveTranscriptTracePathDetail(options?.path, rowParts.detail),
                tail: resolveTranscriptTraceLocationTail(toolName, argsJson),
            };
        case 'terminal':
            return {
                verb: localizeTranscriptCursorVerbRan(),
                detail: humanizeTranscriptTerminalDetail(options?.command ?? rowParts.detail),
                tail: extractTranscriptCommandTail(options?.command),
            };
        case 'editing':
            return {
                verb: localizeTranscriptCursorVerbEdited(),
                detail: resolveTranscriptTracePathDetail(options?.path, rowParts.detail),
            };
        case 'mcp':
            return { verb: localizeTranscriptCursorVerbCalled(), detail: rowParts.detail, tail: 'MCP' };
        default: {
            const special = resolveSpecialTranscriptToolTraceLabel(toolName);
            if (special) {
                return special;
            }
            return {
                verb: localizeTranscriptCursorVerbUsed(),
                detail: humanizeTranscriptToolDisplayName(toolName || 'tool'),
            };
        }
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
            return formatTranscriptTraceCommandDetail(`npm run ${rest.slice(4).trim()}`, 56);
        }
        return formatTranscriptTraceCommandDetail(clean, 56);
    }
    return formatTranscriptTraceCommandDetail(clean, 64);
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
            return {
                verb: localizeTranscriptCursorVerbRead(),
                detail: count === 1
                    ? nls.localize('qaap/mobileProjects/transcriptCursorGroupedReadOne', '1 file')
                    : nls.localize('qaap/mobileProjects/transcriptCursorGroupedReadMany', '{0} files', count),
            };
        case 'searching':
            return {
                verb: localizeTranscriptCursorVerbSearched(),
                detail: count === 1
                    ? nls.localize('qaap/mobileProjects/transcriptCursorGroupedSearchOne', 'once')
                    : nls.localize('qaap/mobileProjects/transcriptCursorGroupedSearchMany', '{0} times', count),
            };
        case 'terminal':
            return {
                verb: localizeTranscriptCursorVerbRan(),
                detail: count === 1
                    ? nls.localize('qaap/mobileProjects/transcriptCursorGroupedTerminalOne', '1 command')
                    : nls.localize('qaap/mobileProjects/transcriptCursorGroupedTerminalMany', '{0} commands', count),
            };
        case 'editing':
            return {
                verb: localizeTranscriptCursorVerbEdited(),
                detail: count === 1
                    ? nls.localize('qaap/mobileProjects/transcriptCursorGroupedEditOne', '1 file')
                    : nls.localize('qaap/mobileProjects/transcriptCursorGroupedEditMany', '{0} files', count),
            };
        default:
            return {
                verb: localizeTranscriptCursorVerbUsed(),
                detail: count === 1
                    ? nls.localize('qaap/mobileProjects/transcriptCursorGroupedToolOne', '1 tool')
                    : nls.localize('qaap/mobileProjects/transcriptCursorGroupedToolMany', '{0} tools', count),
            };
    }
}

export {
    localizeTranscriptCursorVerbPlanning,
};
