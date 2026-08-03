// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// ─── Execution Event Renderer + Terminal Output (mobile) ─────────────────────
//
// Creates the DOM elements for execution events, tool groups, tool details,
// file icons, terminal output cards, and shell command details. Also houses
// the terminal output rendering helpers shared with the timeline patcher.
// Extracted from qaap-execution-event-timeline.ts.

import { nls } from '@theia/core/lib/common/nls';
import { stripAnsiEscapes } from '../common/qaap-transcript-content-display';
import { getFileIconClass } from '../common/qaap-file-icon-utils';
import { TRANSCRIPT_TOOL_USE_ID_ATTR } from '../common/qaap-transcript-incremental-update';
import { createTranscriptCodeView, patchTranscriptCodeView, resolveTranscriptCodeLanguage, type TranscriptCodeLanguage } from './qaap-transcript-code-view';
import {
    isTranscriptWebSearchTool,
    resolveTranscriptWebSearchPayload,
} from '../common/qaap-transcript-web-search-core';
import {
    createTranscriptWebSearchCard,
} from './qaap-transcript-web-search-ui';
import { syncActivityToolIconMotion } from './qaap-activity-tool-icon-motion';
import type {
    MobileEventKind,
    MobileExecutionTool,
    MobileExecutionEvent,
} from './mobile-execution-event-types';
import { MOBILE_TOOL_FILE_OPEN_EVENT } from './mobile-execution-event-types';
import {
    MOBILE_EVENT_ID_ATTR,
    pendingTerminalOutputResult,
    timelineDetailsOpenState,
    timelineGroupOpenStateKey,
    timelineTerminalOpenStateKey,
    recordTimelineDetailsOpenState,
} from './mobile-execution-timeline-state';
import { formatMobileEventSummary } from './mobile-execution-event-fingerprint';

export function renderMobileTerminalOutput(content: HTMLElement, result: string): void {
    const clean = stripAnsiEscapes(result);
    const existing = content.querySelector<HTMLElement>('.theia-mobile-terminal-output-pre, .theia-mobile-terminal-output-code-view');
    const language = resolveMobileTerminalOutputLanguage(clean);
    const placeholder = content.querySelector('.theia-mobile-terminal-output-pending');
    if (placeholder) {
        placeholder.remove();
    }
    // Streaming output grows tick by tick — patch the existing view so only
    // changed/new lines are re-tokenized, instead of rebuilding (and
    // re-highlighting) the entire output on every tick.
    if (existing && patchTranscriptCodeView(existing, clean, language)) {
        return;
    }
    const next = createMobileTerminalCodeView(clean, language);
    if (existing) {
        existing.replaceWith(next);
    } else {
        content.append(next);
    }
}

type MobileTerminalOutputLanguage = Exclude<TranscriptCodeLanguage, 'plain'>;

function resolveMobileTerminalOutputLanguage(output: string): MobileTerminalOutputLanguage {
    const inferred = resolveTranscriptCodeLanguage(undefined, output);
    if (inferred !== 'plain') {
        return inferred;
    }
    return 'log';
}

function createMobileTerminalCodeView(output: string, language: MobileTerminalOutputLanguage): HTMLElement {
    const view = createTranscriptCodeView(output, language);
    view.classList.add('theia-mobile-terminal-output-code-view');
    return view;
}

/**
 * Renders deferred terminal stdout/stderr when a card opens. Programmatic
 * `details.open = …` does not reliably fire `toggle`, so callers that flip
 * `open` themselves must invoke this (summary click handler, restore paths).
 * When no result is available for a finished card, paints an explicit empty
 * state so the expanded body is never a blank void.
 */
export function flushMobileTerminalOutputIfPending(details: HTMLDetailsElement, content: HTMLElement): void {
    const latest = pendingTerminalOutputResult.get(details);
    if (latest !== undefined && latest.trim()) {
        renderMobileTerminalOutput(content, latest);
        return;
    }
    // Only paint empty-state when the card is finished (complete/failed).
    // While running, keep the existing "Running…" placeholder.
    if (details.classList.contains('complete') || details.classList.contains('failed')) {
        ensureMobileTerminalEmptyOutputState(content);
    }
}

/** Explicit empty body for a completed terminal card with no stdout/stderr. */
export function ensureMobileTerminalEmptyOutputState(content: HTMLElement): void {
    content.querySelector('.theia-mobile-terminal-output-pending')?.remove();
    if (content.querySelector(
        '.theia-mobile-terminal-output-code-view, .theia-mobile-terminal-output-pre, .theia-mobile-terminal-output-empty',
    )) {
        return;
    }
    const empty = document.createElement('span');
    empty.className = 'theia-mobile-terminal-output-empty';
    empty.textContent = nls.localize('qaap/mobileProjects/terminalOutputEmpty', 'No output');
    content.append(empty);
}

/**
 * Defers building terminal output until the `<details>` is first opened,
 * so collapsed terminal cards never pay the stripAnsiEscapes + DOM cost while
 * streaming. Reads whatever the latest result is from
 * {@link pendingTerminalOutputResult} at open time, not just what was known
 * when the handler was attached.
 */
export function attachMobileTerminalLazyOpenHandler(details: HTMLDetailsElement, content: HTMLElement): void {
    details.addEventListener('toggle', function onFirstOpen() {
        if (!details.open) {
            return;
        }
        details.removeEventListener('toggle', onFirstOpen);
        flushMobileTerminalOutputIfPending(details, content);
    });
}

/** Patches a single tool-detail row (terminal card or plain/error line) in place. */

// ─── Element Creation ────────────────────────────────────────────────────────

export function createMobileExecutionEventElement(
    event: MobileExecutionEvent,
): HTMLElement {
    const section = document.createElement('section');
    section.className = `theia-mobile-execution-event theia-mod-${event.kind}`;
    section.setAttribute(MOBILE_EVENT_ID_ATTR, event.id);
    if (event.hasError) {
        section.classList.add('theia-mod-error');
    }
    if (event.hasPending) {
        section.classList.add('theia-mod-running');
    }

    // Narrative — synthetic filler ("I'm checking the relevant files.") is
    // suppressed: the tool-group summary already conveys verb + count, so a
    // generic placeholder sentence above it is just noise. Agent-authored
    // narrative (actual reasoning text) is always kept.
    if (event.narrativeSource !== 'synthetic') {
        const narrative = document.createElement('p');
        narrative.className = 'theia-mobile-execution-event-narrative theia-mod-agent';
        narrative.textContent = event.narrative;
        section.append(narrative);
    }

    // Tool group (collapsed by default)
    section.append(createMobileToolGroupElement(event));

    return section;
}

export function createMobileToolGroupElement(
    event: MobileExecutionEvent,
): HTMLElement {
    const webSearchOnly = event.tools.length > 0
        && event.tools.every(tool => isTranscriptWebSearchTool(tool.segment.name));
    const details = document.createElement('details');
    details.className = `theia-mobile-tool-group ${event.hasError ? 'failed' : ''} ${event.hasPending ? 'running' : 'finished'}`;
    if (webSearchOnly) {
        details.classList.add('theia-mod-web-search');
        // AIcss-style cards are the primary chrome — keep the group open.
        details.open = true;
    }
    // Collapsed by default — Codex never auto-expands tool groups.

    // Summary line: icon + verb + count + state + chevron
    const summary = document.createElement('summary');
    summary.className = 'theia-mobile-tool-group-summary';
    if (webSearchOnly) {
        summary.classList.add('theia-mod-web-search-hidden');
    }

    const icon = document.createElement('span');
    icon.className = `codicon ${event.icon} theia-mobile-tool-group-icon`;
    icon.setAttribute('aria-hidden', 'true');
    syncActivityToolIconMotion(icon, event.hasPending && !event.hasError, event.kind);

    const verb = document.createElement('span');
    verb.className = `theia-mobile-tool-group-verb ${event.hasPending ? 'theia-mod-shimmer' : ''}`;
    verb.textContent = event.verb;

    const meta = document.createElement('span');
    meta.className = `theia-mobile-tool-group-meta ${event.hasPending ? 'theia-mod-shimmer' : ''}`;
    meta.textContent = formatMobileEventSummary(event);

    const state = document.createElement('span');
    state.className = `theia-mobile-tool-group-state ${event.hasError ? 'failed' : event.hasPending ? 'running' : 'complete'}`;
    const stateIcon = document.createElement('span');
    stateIcon.className = `codicon ${event.hasError ? 'codicon-error' : event.hasPending ? 'codicon-loading theia-animation-spin' : 'codicon-check'}`;
    state.append(stateIcon);

    const chevron = document.createElement('span');
    chevron.className = 'codicon codicon-chevron-down theia-mobile-tool-group-chevron';
    chevron.setAttribute('aria-hidden', 'true');

    summary.append(icon, verb, meta, state, chevron);
    details.append(summary);

    // Details: individual tools
    const detailsContainer = document.createElement('div');
    detailsContainer.className = 'theia-mobile-tool-group-details';

    event.tools.forEach((tool, index) => {
        detailsContainer.append(createMobileToolDetailElement(event, tool, index));
    });

    details.append(detailsContainer);

    // Restore a user-opened state that survives full row rematerialization
    // (virtual-list scroll-out/scroll-back builds this element from scratch,
    // with no "existing" element around to capture/restore from) and keep
    // recording every subsequent toggle so later rematerializations stay in
    // sync.
    const groupStateKey = timelineGroupOpenStateKey(resolveTimelineGroupCreationKey(event, detailsContainer));
    if (webSearchOnly) {
        details.open = true;
    } else if (timelineDetailsOpenState.get(groupStateKey)) {
        details.open = true;
    }
    details.addEventListener('toggle', () => {
        if (webSearchOnly) {
            // Premium WebSearch cards own expand/collapse; keep the group shell open.
            details.open = true;
            return;
        }
        // Detaching an open group fires toggle(open=false) while disconnected —
        // don't poison sticky open state (that would collapse on remount).
        if (!details.isConnected && !details.open) {
            return;
        }
        recordTimelineDetailsOpenState(groupStateKey, details.open);
    });

    return details;
}

export function createMobileToolDetailElement(
    event: MobileExecutionEvent,
    tool: MobileExecutionTool,
    index: number,
): HTMLElement {
    // Terminal tools get a collapsible output card
    if (tool.isTerminal) {
        return createMobileTerminalOutputElement(event, tool, index);
    }

    if (isTranscriptWebSearchTool(tool.segment.name)) {
        const payload = resolveTranscriptWebSearchPayload(tool.segment);
        const card = createTranscriptWebSearchCard(payload, {
            open: !tool.isFinished || payload.sites.length > 0,
        });
        card.setAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR, tool.segment.toolUseId);
        return card;
    }

    // File-related tools (read/write/edit/delete) get a file-type icon before
    // the filename detail, per the Codex-style file display requirement.
    const fileIcon = isMobileFileDetailKind(event.kind) && tool.detail
        ? createMobileFileIconSpan(tool.detail)
        : undefined;
    const canOpenFile = isMobileFileDetailKind(event.kind) && event.kind !== 'delete' && !!tool.filePath;

    // Error tools get a simple error line
    if (tool.isError) {
        const row = document.createElement('div');
        row.className = `theia-mobile-tool-detail theia-mod-error theia-mod-${event.kind}${canOpenFile ? ' theia-mod-clickable' : ''}`;
        row.setAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR, tool.segment.toolUseId);
        const detail = createMobileToolFileDetailSpan(tool, canOpenFile);
        const errorIcon = document.createElement('span');
        errorIcon.className = 'codicon codicon-error theia-mobile-tool-detail-error-icon';
        if (fileIcon) {
            row.append(fileIcon, detail, errorIcon);
        } else {
            row.append(detail, errorIcon);
        }
        return row;
    }

    // Everything else: plain text line, no card
    const row = document.createElement('div');
    row.className = `theia-mobile-tool-detail theia-mod-text theia-mod-${event.kind}${canOpenFile ? ' theia-mod-clickable' : ''}`;
    row.setAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR, tool.segment.toolUseId);
    const detail = createMobileToolFileDetailSpan(tool, canOpenFile);
    if (fileIcon) {
        row.append(fileIcon, detail);
    } else {
        row.append(detail);
    }
    return row;
}

/**
 * Returns true when the event kind operates on files, so the tool detail is a
 * filename that should be shown with a file-type icon.
 */
export function isMobileFileDetailKind(kind: MobileEventKind): boolean {
    return kind === 'read' || kind === 'write' || kind === 'edit' || kind === 'delete';
}

export function createMobileToolFileDetailSpan(tool: MobileExecutionTool, canOpenFile: boolean): HTMLElement {
    const detail = document.createElement('span');
    detail.className = `theia-mobile-tool-detail-detail${canOpenFile ? ' theia-mod-file-link' : ''}`;
    detail.textContent = tool.detail;
    if (canOpenFile && tool.filePath) {
        const filePath = tool.filePath;
        detail.setAttribute('role', 'link');
        detail.tabIndex = 0;
        detail.dataset.qaapToolFilePath = filePath;
        detail.title = filePath;
        const open = (event: Event): void => {
            event.preventDefault();
            event.stopPropagation();
            const EventCtor = detail.ownerDocument.defaultView?.CustomEvent ?? CustomEvent;
            detail.dispatchEvent(new EventCtor(MOBILE_TOOL_FILE_OPEN_EVENT, {
                bubbles: true,
                composed: true,
                detail: { filePath },
            }));
        };
        detail.addEventListener('click', open);
        detail.addEventListener('keydown', event => {
            if (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) {
                open(event);
            }
        });
    }
    return detail;
}

export function createMobileFileIconSpan(filename: string): HTMLElement {
    const icon = document.createElement('span');
    icon.className = `codicon ${getFileIconClass(filename)} theia-mobile-tool-detail-file-icon`;
    icon.setAttribute('aria-hidden', 'true');
    return icon;
}

export function createMobileTerminalOutputElement(
    event: MobileExecutionEvent,
    tool: MobileExecutionTool,
    index: number,
): HTMLElement {
    const details = document.createElement('details');
    details.className = `theia-mobile-terminal-output ${tool.isError ? 'failed' : tool.isFinished ? 'complete' : 'running'}`;
    details.setAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR, tool.segment.toolUseId);

    // Restore a user-opened state that survives full row rematerialization
    // (see the matching comment in createMobileToolGroupElement) — setting
    // `open` here (rather than after the lazy-render wiring below) lets the
    // existing `if (details.open) { ... }` branch further down render the
    // pending output eagerly, exactly as it already does for the "created
    // already open" case.
    const terminalStateKey = timelineTerminalOpenStateKey(tool.segment.toolUseId);
    if (timelineDetailsOpenState.get(terminalStateKey)) {
        details.open = true;
    }
    details.addEventListener('toggle', () => {
        // Same detach guard as tool groups — synthetic close must not wipe
        // a user-opened terminal card across rematerialization.
        if (!details.isConnected && !details.open) {
            return;
        }
        recordTimelineDetailsOpenState(terminalStateKey, details.open);
    });

    const summary = document.createElement('summary');
    summary.className = 'theia-mobile-terminal-output-summary';

    const detail = document.createElement('span');
    detail.className = 'theia-mobile-terminal-output-detail';
    renderMobileShellCommandDetail(detail, tool.detail);

    const state = document.createElement('span');
    state.className = `codicon ${tool.isError ? 'codicon-error' : tool.isFinished ? 'codicon-check' : 'codicon-loading theia-animation-spin'} theia-mobile-terminal-output-state`;

    summary.append(detail, state);
    details.append(summary);

    // Output content — show the tool result. Terminal cards are collapsed by
    // default (details.open starts false), so building the rendered output is
    // deferred until the card is first opened. Strip ANSI escape sequences
    // (color codes, OSC titles, etc.) before syntax highlighting.
    // Mirrors the cleaning done by cleanTranscriptDisplayText in the content
    // UI layer.
    const content = document.createElement('div');
    content.className = 'theia-mobile-terminal-output-content';
    const result = tool.segment.result;
    if (result) {
        pendingTerminalOutputResult.set(details, result);
    }
    if (!result && !tool.isFinished) {
        const placeholder = document.createElement('span');
        placeholder.className = 'theia-mobile-terminal-output-pending';
        placeholder.textContent = nls.localize('qaap/mobileProjects/terminalOutputPending', 'Running...');
        content.append(placeholder);
    }
    if (details.open) {
        // Created already open (rare) — render eagerly as before.
        if (result) {
            renderMobileTerminalOutput(content, result);
        } else if (tool.isFinished) {
            ensureMobileTerminalEmptyOutputState(content);
        }
    } else {
        attachMobileTerminalLazyOpenHandler(details, content);
    }
    details.append(content);

    // The command detail inside <summary> uses overflow-x:auto + touch-action:pan-x
    // so long commands can scroll. Chromium/WebKit skip the native <details>
    // toggle when the click lands on that scroller — own the toggle so a tap on
    // the command always expands and reveals stdout/stderr. stopPropagation
    // also keeps nested process-accordion / tool-group parents from reacting.
    summary.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const nextOpen = !details.open;
        details.open = nextOpen;
        recordTimelineDetailsOpenState(terminalStateKey, nextOpen);
        if (nextOpen) {
            flushMobileTerminalOutputIfPending(details, content);
        }
    });

    return details;
}

export function renderMobileShellCommandDetail(host: HTMLElement, command: string): void {
    host.replaceChildren();
    const codeView = createTranscriptCodeView(command, 'shell');
    const code = codeView.querySelector<HTMLElement>('.theia-mobile-agent-code-text');
    if (!code) {
        host.textContent = command;
        return;
    }
    host.append(...[...code.childNodes].map(child => child.cloneNode(true)));
}

// Moved from qaap-execution-event-timeline.ts: used only by element creation.
function resolveTimelineGroupCreationKey(event: MobileExecutionEvent, detailsContainer: HTMLElement): string {
    const firstTool = event.tools[0];
    return firstTool?.segment.toolUseId ?? detailsContainer.dataset.qaapToolGroupKey ?? event.id;
}
