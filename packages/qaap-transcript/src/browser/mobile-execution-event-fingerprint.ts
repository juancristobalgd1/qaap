// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// ─── Execution Event Fingerprint & Summary (mobile) ──────────────────────────
//
// Pure helpers for summarizing and fingerprinting execution events. Used by
// the timeline renderer and patcher to detect whether a re-render can be
// skipped (signature unchanged). Extracted from qaap-execution-event-timeline.ts.

import type {
    MobileExecutionTool,
    MobileExecutionEvent,
} from './mobile-execution-event-types';

export function formatMobileEventSummary(event: MobileExecutionEvent): string {
    const count = event.tools.length;
    const noun = pluralize(count, mobileToolNoun(event));
    return `${count} ${noun}`;
}

/**
 * Resolves the Codex-style live activity verb for the process accordion
 * label: the {@link MobileExecutionEvent.verb} of the LAST event in
 * `events` that still has pending tools (i.e. whichever tool group is
 * actively spinning right now). Returns undefined when nothing is pending
 * (e.g. between tool groups, or before the first tool has arrived), in which
 * case the caller should fall back to the generic "Processing…" label.
 */
export function resolveMobileActivityVerb(events: readonly MobileExecutionEvent[]): string | undefined {
    for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].hasPending) {
            return events[i].verb;
        }
    }
    return undefined;
}

export function fingerprintMobileTool(tool: MobileExecutionTool): string {
    const segment = tool.segment;
    const args = segment.args;
    const result = segment.result;
    // Cheap fingerprint: these values are only ever compared for equality,
    // never displayed, so lengths (+ a short tail slice for same-length
    // paranoia) are enough to detect growth without embedding the full
    // args/result strings -- mirrors segmentToolFingerprint in
    // qaap-transcript-incremental-update.ts.
    return [
        tool.segmentIndex,
        segment.toolUseId,
        segment.name,
        tool.kind,
        tool.verb,
        tool.detail,
        tool.filePath ?? '',
        tool.isFinished ? '1' : '0',
        tool.isError ? '1' : '0',
        `${args?.length ?? 0}:${result?.length ?? 0}`,
        result?.slice(0, 16) ?? '',
        result?.slice(-32) ?? '',
    ].join('\u001f');
}

export function fingerprintMobileExecutionEvent(event: MobileExecutionEvent): string {
    return [
        event.id,
        event.kind,
        event.verb,
        event.icon,
        event.narrativeSource,
        event.narrative,
        event.hasPending ? '1' : '0',
        event.hasError ? '1' : '0',
        event.tools.map(fingerprintMobileTool).join('\u001e'),
    ].join('\u001d');
}

export function fingerprintMobileExecutionEvents(events: readonly MobileExecutionEvent[]): string {
    return events.map(fingerprintMobileExecutionEvent).join('\u001c');
}

function mobileToolNoun(event: MobileExecutionEvent): string {
    switch (event.kind) {
        case 'explore': return 'search';
        case 'read': return 'file';
        case 'write': return 'file';
        case 'edit': return 'file';
        case 'delete': return 'file';
        case 'run': return 'command';
        case 'verification': return 'check';
        default: return 'step';
    }
}

function pluralize(count: number, noun: string): string {
    if (count === 1) {
        return noun;
    }
    if (noun.endsWith('ch') || noun.endsWith('sh')) {
        return `${noun}es`;
    }
    return `${noun}s`;
}
