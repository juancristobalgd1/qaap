// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Pure helpers extracted from MobileProjectsTranscriptMessagesToolUi.
// These functions operate only on their parameters and do not access instance state.

import { nls } from '@theia/core/lib/common/nls';
import { getFileIconClass } from '../common/qaap-file-icon-utils';
import type { TranscriptActivityTerminalExpandEntry } from '../common/qaap-transcript-activity-expand-core';
import type { LobeTraceStatus } from './mobile-projects-transcript-lobehub-ui';

// ─── Tool icon / verb helpers ────────────────────────────────────────────────

export function transcriptToolIconClass(kind: string): string {
    switch (kind) {
        case 'reading': return 'codicon-file';
        case 'searching': return 'codicon-search';
        case 'editing': return 'codicon-edit';
        case 'terminal': return 'codicon-terminal';
        case 'mcp': return 'codicon-server-process';
        default: return 'codicon-tools';
    }
}

/** Human verb for a finished/running tool, e.g. "Read", "Edited", "Searched". */
export function transcriptToolVerb(kind: string, toolName: string): string {
    switch (kind) {
        case 'reading': return nls.localize('qaap/mobileProjects/transcriptToolRead', 'Read');
        case 'searching': return nls.localize('qaap/mobileProjects/transcriptToolSearched', 'Searched');
        case 'editing': return nls.localize('qaap/mobileProjects/transcriptToolEdited', 'Edited');
        case 'terminal': return nls.localize('qaap/mobileProjects/transcriptToolRan', 'Ran');
        case 'mcp': return nls.localize('qaap/mobileProjects/transcriptToolMcp', 'Called');
        default: return (toolName ?? 'tool').replace(/_/g, ' ');
    }
}

// ─── Shell state helpers ─────────────────────────────────────────────────────

export function transcriptShellStateAriaLabel(finished: boolean, failed: boolean): string {
    if (!finished) {
        return nls.localize('qaap/mobileProjects/transcriptShellRunning', 'running');
    }
    return failed
        ? nls.localize('qaap/mobileProjects/transcriptShellFailed', 'failed')
        : nls.localize('qaap/mobileProjects/transcriptShellDone', 'done');
}

export function resolveLobeTraceStatus(options: {
    readonly finished: boolean;
    readonly failed: boolean;
}): LobeTraceStatus {
    if (!options.finished) {
        return 'running';
    }
    return options.failed ? 'failed' : 'completed';
}

export function parseTranscriptShellExitCode(result: string | undefined): number | undefined {
    if (!result?.trim()) {
        return undefined;
    }
    const match = result.match(/\bexit(?:\s+code)?[:\s]+(\d+)\b/i)
        ?? result.match(/\b(?:exited|code)\s+(\d+)\b/i);
    return match ? Number(match[1]) : undefined;
}

// ─── Terminal activity helpers ───────────────────────────────────────────────

export function isTranscriptActivityTerminalEntryFailed(entry: TranscriptActivityTerminalExpandEntry): boolean {
    if (entry.failed) {
        return true;
    }
    return entry.exitCode !== undefined && entry.exitCode !== 0;
}

export function resolveTranscriptActivityTerminalDefaultOpenIndex(
    entries: readonly TranscriptActivityTerminalExpandEntry[],
): number {
    const runningIndex = entries.findIndex(entry => entry.finished === false);
    if (runningIndex >= 0) {
        return runningIndex;
    }
    const failedIndex = entries.findIndex(entry => isTranscriptActivityTerminalEntryFailed(entry));
    if (failedIndex >= 0) {
        return failedIndex;
    }
    return 0;
}

// ─── File icon helper ────────────────────────────────────────────────────────

export function transcriptFileIconClass(path: string): string {
    return getFileIconClass(path);
}
