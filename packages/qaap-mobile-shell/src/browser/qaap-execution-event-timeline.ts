// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// ─── Codex-style Execution Event Timeline (mobile) ───────────────────────────
//
// Replaces the old "tool log" rendering with an event-based tree:
//
//   AgentExecution
//     ExecutionEvent  (narrative + tool group)
//       Narrative     "I'm inspecting the project structure."
//       ToolGroup     (collapsed by default)
//         ToolSummary "3 searches ▶"
//         ToolDetails (hidden until expanded)
//     ExecutionEvent
//       Narrative     "I found the rendering pipeline."
//       ToolGroup     ...
//     DiffSummary     (the natural closing)
//
// Tools are CHILDREN of events, never siblings.
// The narrative is the primary element; tools are secondary.
// Only Terminal/Error/Diff get cards — everything else is text.
// ─────────────────────────────────────────────────────────────────────────────

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import { classifyTranscriptToolActivityKind } from '../common/qaap-agent-transcript-segments';
import { isAgentToolResultFailure, stripAnsiEscapes } from '../common/qaap-transcript-content-display';

// ─── Types ───────────────────────────────────────────────────────────────────

export type MobileEventKind = 'explore' | 'read' | 'write' | 'edit' | 'delete' | 'run' | 'verification' | 'other';

export interface MobileExecutionTool {
    segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>;
    segmentIndex: number;
    kind: MobileEventKind;
    verb: string;
    detail: string;
    isTerminal: boolean;
    isVerification: boolean;
    isError: boolean;
    isFinished: boolean;
}

export interface MobileExecutionEvent {
    id: string;
    narrative: string;
    narrativeSource: 'agent' | 'synthetic';
    kind: MobileEventKind;
    icon: string;
    verb: string;
    tools: MobileExecutionTool[];
    hasPending: boolean;
    hasError: boolean;
}

export interface MobileExecutionTimeline {
    events: MobileExecutionEvent[];
    closingNarrative?: string;
}

// ─── Builder ─────────────────────────────────────────────────────────────────

export function buildMobileExecutionEvents(segments: readonly QaapAgentMessageSegmentDTO[]): MobileExecutionTimeline {
    const events: MobileExecutionEvent[] = [];
    // Accumulate consecutive text/thinking segments so that none are silently
    // dropped. Each entry becomes part of the narrative for the next event
    // (or the closing narrative if no more tools follow).
    let pendingNarrative: string[] = [];
    let closingNarrative: string[] = [];
    let eventIndex = 0;

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];

        if (segment.type === 'text') {
            const text = segment.content?.trim();
            if (!text) {
                continue;
            }
            pendingNarrative.push(text);
            continue;
        }

        if (segment.type === 'thinking') {
            // Thinking segments can serve as narrative if no text is available.
            // Only use the first thinking segment as narrative; subsequent
            // thinking segments are appended so none are dropped.
            const text = segment.content?.trim();
            if (text) {
                const excerpt = text.length > 120 ? text.slice(0, 117) + '...' : text;
                pendingNarrative.push(excerpt);
            }
            continue;
        }

        // Tool segment
        const descriptor = describeMobileTool(segment);
        const lastEvent = events[events.length - 1];

        // Merge into last event if no new narrative and same kind
        if (lastEvent && pendingNarrative.length === 0 && lastEvent.kind === descriptor.kind) {
            lastEvent.tools.push(toMobileTool(segment, i, descriptor));
            updateMobileEventState(lastEvent);
            continue;
        }

        // Start new event
        let narrative: string;
        let narrativeSource: 'agent' | 'synthetic';
        if (pendingNarrative.length > 0) {
            narrative = pendingNarrative.join('\n\n');
            narrativeSource = 'agent';
            pendingNarrative = [];
        } else {
            narrative = descriptor.narrative;
            narrativeSource = 'synthetic';
        }

        const event: MobileExecutionEvent = {
            id: `m-event-${eventIndex++}`,
            narrative,
            narrativeSource,
            kind: descriptor.kind,
            icon: descriptor.icon,
            verb: descriptor.verb,
            tools: [toMobileTool(segment, i, descriptor)],
            hasPending: !segment.finished,
            hasError: isToolError(segment),
        };
        events.push(event);
    }

    if (pendingNarrative.length > 0) {
        closingNarrative = pendingNarrative;
    }

    return { events, closingNarrative: closingNarrative.length > 0 ? closingNarrative.join('\n\n') : undefined };
}

function toMobileTool(
    segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
    segmentIndex: number,
    descriptor: MobileToolDescriptor,
): MobileExecutionTool {
    return {
        segment,
        segmentIndex,
        kind: descriptor.kind,
        verb: descriptor.verb,
        detail: extractToolDetail(segment, descriptor.kind),
        isTerminal: descriptor.kind === 'run' || descriptor.kind === 'verification',
        isVerification: descriptor.kind === 'verification',
        isError: isToolError(segment),
        isFinished: segment.finished,
    };
}

function updateMobileEventState(event: MobileExecutionEvent): void {
    event.hasPending = event.tools.some(t => !t.isFinished);
    event.hasError = event.tools.some(t => t.isError);
}

function isToolError(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>): boolean {
    if (!segment.finished) {
        return false;
    }
    // Use the shared failure detector so substrings inside file paths
    // (e.g. css-syntax-error.js) and Read payloads don't trigger false positives.
    return isAgentToolResultFailure(segment.result, { toolName: segment.name });
}

// ─── Tool classification ─────────────────────────────────────────────────────

interface MobileToolDescriptor {
    kind: MobileEventKind;
    icon: string;
    verb: string;
    narrative: string;
}

function describeMobileTool(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>): MobileToolDescriptor {
    const name = segment.name.toLowerCase();
    const activityKind = classifyTranscriptToolActivityKind(segment.name);

    if (isVerificationTool(segment, name)) {
        return { kind: 'verification', icon: 'codicon-checklist', verb: 'Verification', narrative: "I'm validating the implementation." };
    }
    if (activityKind === 'terminal' || matchesName(name, ['bash', 'shell', 'terminal', 'command', 'exec', 'run', 'npm', 'yarn', 'pnpm', 'node'])) {
        return { kind: 'run', icon: 'codicon-terminal', verb: 'Run', narrative: "I'm running commands." };
    }
    if (activityKind === 'searching' || matchesName(name, ['grep', 'glob', 'search', 'find', 'ripgrep', 'rg'])) {
        return { kind: 'explore', icon: 'codicon-search', verb: 'Explore', narrative: "I'm looking through the project structure." };
    }
    if (activityKind === 'reading' || matchesName(name, ['read', 'open', 'fetch', 'list', 'ls'])) {
        return { kind: 'read', icon: 'codicon-file', verb: 'Read', narrative: "I'm checking the relevant files." };
    }
    if (matchesName(name, ['write', 'create', 'new'])) {
        return { kind: 'write', icon: 'codicon-new-file', verb: 'Write', narrative: "I'm writing the implementation." };
    }
    if (activityKind === 'editing' || matchesName(name, ['edit', 'update', 'patch', 'replace', 'modify', 'multi'])) {
        return { kind: 'edit', icon: 'codicon-edit', verb: 'Update', narrative: "I'm updating the implementation." };
    }
    if (matchesName(name, ['delete', 'remove', 'rm'])) {
        return { kind: 'delete', icon: 'codicon-trash', verb: 'Delete', narrative: "I'm removing obsolete pieces." };
    }
    return { kind: 'other', icon: 'codicon-tools', verb: 'Use', narrative: "I'm applying the next step." };
}

function isVerificationTool(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>, name: string): boolean {
    if (matchesName(name, ['vitest', 'test', 'lint', 'typecheck', 'tsc'])) {
        return true;
    }
    if (!matchesName(name, ['bash', 'shell', 'terminal', 'command', 'exec', 'run', 'npm', 'yarn', 'pnpm', 'node'])) {
        return false;
    }
    return containsVerificationCommand(segment.args);
}

function containsVerificationCommand(args: string | undefined): boolean {
    if (!args) {
        return false;
    }
    return /(^|[\s"'`:,{[])(npm|yarn|pnpm|npx|node)?\s*(run\s+)?(test|vitest|lint|typecheck|tsc)(:|\b)/i.test(args);
}

function matchesName(name: string, tokens: string[]): boolean {
    const normalized = name.split(/[^a-z0-9]+|_/).filter(Boolean);
    return tokens.some(token => normalized.includes(token));
}

function extractToolDetail(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>, kind: MobileEventKind): string {
    if (kind === 'run' || kind === 'verification') {
        return extractCommand(segment.args) ?? segment.name;
    }
    const filePath = extractFilePath(segment.args);
    if (filePath) {
        return filePath;
    }
    return segment.name;
}

function extractCommand(args: string | undefined): string | undefined {
    if (!args) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(args);
        if (typeof parsed === 'object' && parsed !== null) {
            const command = parsed.command ?? parsed.cmd ?? parsed.input;
            if (typeof command === 'string') {
                return command.length > 60 ? command.slice(0, 57) + '...' : command;
            }
        }
    } catch {
        return args.length > 60 ? args.slice(0, 57) + '...' : args;
    }
    return undefined;
}

function extractFilePath(args: string | undefined): string | undefined {
    if (!args) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(args);
        if (typeof parsed === 'object' && parsed !== null) {
            const path = parsed.file_path ?? parsed.path ?? parsed.filePath ?? parsed.filename;
            if (typeof path === 'string') {
                return path.split('/').pop() ?? path;
            }
        }
    } catch {
        // Not JSON
    }
    return undefined;
}

// ─── Summary formatting ──────────────────────────────────────────────────────

export function formatMobileEventSummary(event: MobileExecutionEvent): string {
    const count = event.tools.length;
    const noun = pluralize(count, mobileToolNoun(event));
    return `${count} ${noun}`;
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

// ─── DOM Rendering ───────────────────────────────────────────────────────────

/** CSS class on the top-level execution event timeline container. */
export const MOBILE_EXECUTION_TIMELINE_CLASS = 'theia-mobile-execution-timeline';

/**
 * Creates the Codex-style execution event timeline as a DOM element.
 * Replaces the old activity timeline + tool pills + diff/verification cards.
 *
 * Note: closing narrative (text after the last tool) is NOT rendered here.
 * The caller is responsible for rendering it as a rich content block so the
 * agent's final answer gets full markdown rendering.
 */
export function createMobileExecutionEventTimeline(
    segments: readonly QaapAgentMessageSegmentDTO[],
): HTMLElement {
    const timeline = buildMobileExecutionEvents(segments);
    const container = document.createElement('div');
    container.className = MOBILE_EXECUTION_TIMELINE_CLASS;

    for (const event of timeline.events) {
        container.append(createMobileExecutionEventElement(event));
    }

    return container;
}

/**
 * Returns true if the row already contains a Codex-style execution event timeline.
 * Used by streaming-patch methods to decide whether to rebuild the new timeline
 * instead of falling back to the legacy activity-timeline DOM.
 */
export function hasMobileExecutionEventTimeline(row: HTMLElement): boolean {
    return !!row.querySelector(`.${MOBILE_EXECUTION_TIMELINE_CLASS}`);
}

/**
 * Replaces the existing execution event timeline inside `segmentsBody` with a
 * fresh one built from `segments`. Preserves the open/closed state of any
 * `<details>` elements that have corresponding events by index.
 *
 * Both tool-group and terminal-output elements are `<details>`, so we capture
 * all of them in document order. The DOM structure is:
 *   section.theia-mobile-execution-event
 *     > details.theia-mobile-tool-group
 *         > div.theia-mobile-tool-group-details
 *             > details.theia-mobile-terminal-output  (terminal tools only)
 */
export function refreshMobileExecutionEventTimeline(
    segmentsBody: HTMLElement,
    segments: readonly QaapAgentMessageSegmentDTO[],
): HTMLElement {
    const existing = segmentsBody.querySelector<HTMLElement>(`.${MOBILE_EXECUTION_TIMELINE_CLASS}`);
    // Capture open state of all <details> elements before rebuilding.
    const openStateByIndex: boolean[] = [];
    if (existing) {
        const allDetails = existing.querySelectorAll<HTMLDetailsElement>('details');
        allDetails.forEach(details => {
            openStateByIndex.push(details.open);
        });
    }
    const fresh = createMobileExecutionEventTimeline(segments);
    // Restore open state by index.
    if (openStateByIndex.length > 0) {
        const newDetails = fresh.querySelectorAll<HTMLDetailsElement>('details');
        newDetails.forEach((details, index) => {
            if (index < openStateByIndex.length && openStateByIndex[index]) {
                details.open = true;
            }
        });
    }
    if (existing) {
        existing.replaceWith(fresh);
    } else {
        segmentsBody.append(fresh);
    }
    return fresh;
}

function createMobileExecutionEventElement(
    event: MobileExecutionEvent,
): HTMLElement {
    const section = document.createElement('section');
    section.className = `theia-mobile-execution-event theia-mod-${event.kind}`;
    if (event.hasError) {
        section.classList.add('theia-mod-error');
    }
    if (event.hasPending) {
        section.classList.add('theia-mod-running');
    }

    // Narrative
    const narrative = document.createElement('p');
    narrative.className = `theia-mobile-execution-event-narrative ${event.narrativeSource === 'synthetic' ? 'theia-mod-synthetic' : 'theia-mod-agent'}`;
    narrative.textContent = event.narrative;
    section.append(narrative);

    // Tool group (collapsed by default)
    section.append(createMobileToolGroupElement(event));

    return section;
}

function createMobileToolGroupElement(
    event: MobileExecutionEvent,
): HTMLElement {
    const details = document.createElement('details');
    details.className = `theia-mobile-tool-group ${event.hasError ? 'failed' : ''} ${event.hasPending ? 'running' : 'finished'}`;
    // Collapsed by default — Codex never auto-expands tool groups.

    // Summary line: icon + verb + count + state + chevron
    const summary = document.createElement('summary');
    summary.className = 'theia-mobile-tool-group-summary';

    const icon = document.createElement('span');
    icon.className = `codicon ${event.icon} theia-mobile-tool-group-icon`;
    icon.setAttribute('aria-hidden', 'true');

    const verb = document.createElement('span');
    verb.className = 'theia-mobile-tool-group-verb';
    verb.textContent = event.verb;

    const meta = document.createElement('span');
    meta.className = 'theia-mobile-tool-group-meta';
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
    return details;
}

function createMobileToolDetailElement(
    event: MobileExecutionEvent,
    tool: MobileExecutionTool,
    index: number,
): HTMLElement {
    // Terminal tools get a collapsible output card
    if (tool.isTerminal) {
        return createMobileTerminalOutputElement(event, tool, index);
    }

    // Error tools get a simple error line
    if (tool.isError) {
        const row = document.createElement('div');
        row.className = 'theia-mobile-tool-detail theia-mod-error';
        const label = document.createElement('span');
        label.className = 'theia-mobile-tool-detail-label';
        label.textContent = `${event.verb} ${index + 1}`;
        const detail = document.createElement('span');
        detail.className = 'theia-mobile-tool-detail-detail';
        detail.textContent = tool.detail;
        const errorIcon = document.createElement('span');
        errorIcon.className = 'codicon codicon-error theia-mobile-tool-detail-error-icon';
        row.append(label, detail, errorIcon);
        return row;
    }

    // Everything else: plain text line, no card
    const row = document.createElement('div');
    row.className = 'theia-mobile-tool-detail theia-mod-text';
    const label = document.createElement('span');
    label.className = 'theia-mobile-tool-detail-label';
    label.textContent = `${event.verb} ${index + 1}`;
    const detail = document.createElement('span');
    detail.className = 'theia-mobile-tool-detail-detail';
    detail.textContent = tool.detail;
    row.append(label, detail);
    return row;
}

function createMobileTerminalOutputElement(
    event: MobileExecutionEvent,
    tool: MobileExecutionTool,
    index: number,
): HTMLElement {
    const details = document.createElement('details');
    details.className = `theia-mobile-terminal-output ${tool.isError ? 'failed' : tool.isFinished ? 'complete' : 'running'}`;

    const summary = document.createElement('summary');
    summary.className = 'theia-mobile-terminal-output-summary';

    const label = document.createElement('span');
    label.className = 'theia-mobile-terminal-output-label';
    label.textContent = `${event.verb} ${index + 1}`;

    const detail = document.createElement('span');
    detail.className = 'theia-mobile-terminal-output-detail';
    detail.textContent = tool.detail;

    const state = document.createElement('span');
    state.className = `codicon ${tool.isError ? 'codicon-error' : tool.isFinished ? 'codicon-check' : 'codicon-loading theia-animation-spin'} theia-mobile-terminal-output-state`;

    summary.append(label, detail, state);
    details.append(summary);

    // Output content — show the tool result
    const content = document.createElement('div');
    content.className = 'theia-mobile-terminal-output-content';
    if (tool.segment.result) {
        const pre = document.createElement('pre');
        pre.className = 'theia-mobile-terminal-output-pre';
        // Strip ANSI escape sequences (color codes, OSC titles, etc.) so they
        // don't render as visible garbage in the <pre>. Mirrors the cleaning
        // done by cleanTranscriptDisplayText in the content UI layer.
        pre.textContent = stripAnsiEscapes(tool.segment.result);
        content.append(pre);
    } else if (!tool.isFinished) {
        const placeholder = document.createElement('span');
        placeholder.className = 'theia-mobile-terminal-output-pending';
        placeholder.textContent = nls.localize('qaap/mobileProjects/terminalOutputPending', 'Running...');
        content.append(placeholder);
    }
    details.append(content);

    return details;
}

// ─── Diff Summary (closing of the story) ─────────────────────────────────────

export interface MobileDiffFileEntry {
    name: string;
    type?: string;
}

export function createMobileDiffSummaryElement(
    fileCount: number,
    added: number,
    modified: number,
    deleted: number,
    files?: MobileDiffFileEntry[],
): HTMLElement {
    const summary = document.createElement('div');
    summary.className = 'theia-mobile-diff-summary';

    const header = document.createElement('div');
    header.className = 'theia-mobile-diff-summary-header';

    const icon = document.createElement('span');
    icon.className = 'codicon codicon-diff theia-mobile-diff-summary-icon';
    icon.setAttribute('aria-hidden', 'true');

    const title = document.createElement('span');
    title.className = 'theia-mobile-diff-summary-title';
    title.textContent = fileCount === 1 ? '1 file changed' : `${fileCount} files changed`;

    header.append(icon, title);

    if (added > 0) {
        const stat = document.createElement('span');
        stat.className = 'theia-mobile-diff-summary-stat theia-mod-added';
        stat.textContent = `+${added}`;
        header.append(stat);
    }
    if (modified > 0) {
        const stat = document.createElement('span');
        stat.className = 'theia-mobile-diff-summary-stat theia-mod-modified';
        stat.textContent = `${modified} modified`;
        header.append(stat);
    }
    if (deleted > 0) {
        const stat = document.createElement('span');
        stat.className = 'theia-mobile-diff-summary-stat theia-mod-deleted';
        stat.textContent = `-${deleted}`;
        header.append(stat);
    }

    summary.append(header);

    if (files && files.length > 0) {
        const fileList = document.createElement('div');
        fileList.className = 'theia-mobile-diff-summary-files';
        for (const file of files.slice(0, 6)) {
            const row = document.createElement('div');
            row.className = 'theia-mobile-diff-summary-file';
            const name = document.createElement('span');
            name.className = 'theia-mobile-diff-summary-file-name';
            name.textContent = file.name;
            row.append(name);
            if (file.type) {
                const type = document.createElement('span');
                type.className = `theia-mobile-diff-summary-file-type theia-mod-${file.type}`;
                type.textContent = file.type === 'add' ? 'added' : file.type === 'delete' ? 'deleted' : 'modified';
                row.append(type);
            }
            fileList.append(row);
        }
        if (files.length > 6) {
            const more = document.createElement('div');
            more.className = 'theia-mobile-diff-summary-more';
            more.textContent = `+${files.length - 6} more`;
            fileList.append(more);
        }
        summary.append(fileList);
    }

    return summary;
}

/**
 * Creates a line-level diff summary for the case where we have aggregate
 * added/removed line counts but no per-file change set (e.g. when the change
 * set is inferred from diff stats embedded in tool output rather than from
 * Write/Edit tool invocations).
 *
 * Unlike {@link createMobileDiffSummaryElement}, this does NOT claim a file
 * count — it renders only the "+N / -N" line stats with a generic "Changes"
 * title, avoiding the misleading "1 file changed" label that would otherwise
 * result from passing line counts into the file-count API.
 */
export function createMobileLineDiffSummaryElement(
    linesAdded: number,
    linesRemoved: number,
): HTMLElement {
    const summary = document.createElement('div');
    summary.className = 'theia-mobile-diff-summary';

    const header = document.createElement('div');
    header.className = 'theia-mobile-diff-summary-header';

    const icon = document.createElement('span');
    icon.className = 'codicon codicon-diff theia-mobile-diff-summary-icon';
    icon.setAttribute('aria-hidden', 'true');

    const title = document.createElement('span');
    title.className = 'theia-mobile-diff-summary-title';
    title.textContent = nls.localize('qaap/mobileProjects/transcriptDiffSummary', 'Change summary');

    header.append(icon, title);

    if (linesAdded > 0) {
        const stat = document.createElement('span');
        stat.className = 'theia-mobile-diff-summary-stat theia-mod-added';
        stat.textContent = `+${linesAdded}`;
        header.append(stat);
    }
    if (linesRemoved > 0) {
        const stat = document.createElement('span');
        stat.className = 'theia-mobile-diff-summary-stat theia-mod-deleted';
        stat.textContent = `-${linesRemoved}`;
        header.append(stat);
    }

    summary.append(header);
    return summary;
}
