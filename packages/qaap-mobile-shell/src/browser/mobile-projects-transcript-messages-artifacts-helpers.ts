// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only With Classpath-exception-2.0
// *****************************************************************************

// Pure helpers extracted from MobileProjectsTranscriptMessagesArtifactsUi.
// These functions operate only on their parameters and do not access instance state.

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentConversationDTO, QaapAgentMessageDTO, QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import { hasUnfinishedAgentWork, shouldShowTranscriptLiveStatus } from '../common/qaap-transcript-turn-status';
import type { TranscriptStreamTimeoutCause } from '../common/qaap-transcript-stream-health';
import { destroyThinkingOrbIndicator, QAAP_THINKING_ORB_INDICATOR_CLASS } from './qaap-thinking-orb-indicator';
import { isTranscriptAgentThinkingPhase, resolveTranscriptTraceDisplayPhase, resolveTranscriptTurnStartMs } from '../common/qaap-transcript-stream-status';
import { normalizeMobileClosingNarrativeText, type TranscriptActivityTimelineItem } from './mobile-projects-transcript-timeline-utils';
import { hasMobileExecutionEventTimeline } from './qaap-execution-event-timeline';
import { buildTranscriptExecutionTimelineItems } from './mobile-projects-transcript-timeline-utils';
import { TRANSCRIPT_ACTIVITY_TIMELINE_ATTR, TRANSCRIPT_ACTIVITY_ACTIVE_ATTR, TRANSCRIPT_ACTIVITY_ROW_ATTR } from '../common/qaap-transcript-incremental-update';
import { excerptTranscriptThought, resolveTranscriptThinkingContent } from '../common/qaap-agent-transcript-segments';
import { formatTranscriptActivityStepDuration, isTranscriptActivityLiveState } from '../common/qaap-transcript-activity-step-state';
import { formatTranscriptActivityStepDurationSuffix, formatTranscriptActivityStepMeta } from '../common/qaap-transcript-activity-timing';
import { shouldShowTranscriptActivityExpandContent, type TranscriptActivityExpandContent } from '../common/qaap-transcript-activity-expand-core';
import { recordTranscriptRenderMetric } from '../common/qaap-transcript-render-metrics';
import { TRANSCRIPT_TIMELINE_GAP_POSITION_ATTR } from '../common/qaap-transcript-timeline-gap-expand';
import { fingerprintTranscriptActivityHistoryGapSlot, TRANSCRIPT_ACTIVITY_ITEM_FP_ATTR } from '../common/qaap-transcript-timeline-sync-fingerprint';
import { isTranscriptDocumentVisible } from '../common/qaap-transcript-document-visibility';
import type { TranscriptActivityTimelineOptions } from './mobile-projects-transcript-messages-artifacts-ui';

// ─── Thinking orb cleanup ────────────────────────────────────────────────────

export function destroyThinkingOrbHosts(root: ParentNode): void {
    for (const host of root.querySelectorAll<HTMLElement>(`.${QAAP_THINKING_ORB_INDICATOR_CLASS}`)) {
        destroyThinkingOrbIndicator(host);
    }
}

// ─── Execution timeline refresh queue ────────────────────────────────────────

const pendingExecutionTimelineRefreshSegments = new WeakMap<HTMLElement, readonly QaapAgentMessageSegmentDTO[]>();
const skippedExecutionTimelineRefreshRows = new WeakSet<HTMLElement>();

export function queueExecutionTimelineRefresh(row: HTMLElement, segments: readonly QaapAgentMessageSegmentDTO[]): void {
    pendingExecutionTimelineRefreshSegments.set(row, segments);
}

export function skipExecutionTimelineRefresh(row: HTMLElement): void {
    skippedExecutionTimelineRefreshRows.add(row);
}

export function consumeExecutionTimelineRefresh(row: HTMLElement): readonly QaapAgentMessageSegmentDTO[] | undefined {
    const segments = pendingExecutionTimelineRefreshSegments.get(row);
    if (segments) {
        pendingExecutionTimelineRefreshSegments.delete(row);
        skippedExecutionTimelineRefreshRows.delete(row);
    }
    return segments;
}

export function consumeSkippedExecutionTimelineRefresh(row: HTMLElement): boolean {
    if (!skippedExecutionTimelineRefreshRows.has(row)) {
        return false;
    }
    skippedExecutionTimelineRefreshRows.delete(row);
    return true;
}

// ─── Segment diff ────────────────────────────────────────────────────────────

export function didExecutionToolSegmentsChange(
    previousSegments: readonly QaapAgentMessageSegmentDTO[],
    nextSegments: readonly QaapAgentMessageSegmentDTO[],
): boolean {
    const length = Math.max(previousSegments.length, nextSegments.length);
    for (let index = 0; index < length; index++) {
        const previous = previousSegments[index];
        const next = nextSegments[index];
        if (previous?.type !== 'tool' && next?.type !== 'tool') {
            continue;
        }
        if (previous?.type !== 'tool' || next?.type !== 'tool') {
            return true;
        }
        if (previous.toolUseId !== next.toolUseId
            || previous.name !== next.name
            || previous.finished !== next.finished) {
            return true;
        }
        // O(1) length pre-check before walking the full common prefix —
        // args/result can be large while streaming, and a length
        // mismatch alone already proves a change without comparing
        // every character.
        if ((previous.args?.length ?? 0) !== (next.args?.length ?? 0)
            || (previous.result?.length ?? 0) !== (next.result?.length ?? 0)) {
            return true;
        }
        if (previous.args !== next.args || previous.result !== next.result) {
            return true;
        }
    }
    return false;
}

// ─── Conversation status ─────────────────────────────────────────────────────

export function isConversationWorking(conv: QaapAgentConversationDTO | undefined, renderStreaming = false): boolean {
    if (!conv) {
        return renderStreaming;
    }
    if (conv.status === 'failed') {
        return false;
    }
    return hasUnfinishedAgentWork(conv) || conv.status === 'streaming' || conv.status === 'settled';
}

/**
 * Rendering can switch to non-streaming before the agent lifecycle is complete
 * (visually settled/finalizing). Collapse process chrome only once the backend
 * is actually ready/idle, not merely because this render pass is non-streaming.
 */
export function isConversationFinalResponseCommitted(conv: QaapAgentConversationDTO | undefined, renderStreaming: boolean): boolean {
    if (!conv) {
        return !renderStreaming;
    }
    return conv.status !== 'streaming' && conv.status !== 'settled';
}

/** True when the conversation ended in a failure. */
export function isConversationError(conv: QaapAgentConversationDTO | undefined): boolean {
    return conv?.status === 'failed';
}

// ─── Agent message ───────────────────────────────────────────────────────────

export function isAgentMessageCancelled(message: QaapAgentMessageDTO | undefined): boolean {
    return message?.traceEvents?.some(event => event.type === 'run_cancelled') ?? false;
}

// ─── Stream timeout ──────────────────────────────────────────────────────────

export function resolveTranscriptStreamTimeoutDetail(
    cause?: TranscriptStreamTimeoutCause,
): string | undefined {
    switch (cause) {
        case 'sse_disconnected':
            return nls.localize(
                'qaap/mobileProjects/transcriptStreamTimedOutSse',
                'The live connection dropped. Retry to sync this turn.',
            );
        case 'active_tool':
            return nls.localize(
                'qaap/mobileProjects/transcriptStreamTimedOutTool',
                'A command or tool ran too long without returning a result.',
            );
        case 'semantic_idle':
            return nls.localize(
                'qaap/mobileProjects/transcriptStreamTimedOutIdle',
                'No visible progress (reads, edits, or a reply) within the expected time.',
            );
        default:
            return nls.localize(
                'qaap/mobileProjects/transcriptStreamTimedOutDetail',
                'Cancel or retry to continue.',
            );
    }
}

// ─── Pinned live status ──────────────────────────────────────────────────────

export function shouldShowPinnedTranscriptLiveStatus(conv: QaapAgentConversationDTO): boolean {
    return shouldShowTranscriptLiveStatus(conv);
}

// ─── Thought brief icon ──────────────────────────────────────────────────────

export function resolveTranscriptThoughtBriefIconClass(active: boolean): string {
    // LobeHub: Loader2Icon (spin) while thinking, AtomIcon when settled.
    // Codicon equivalents: `loading` (with theia-animation-spin) / `lightbulb`.
    return active
        ? 'codicon codicon-loading theia-animation-spin'
        : 'codicon codicon-lightbulb';
}

// ─── DI-extracted methods (second pass) ──────────────────────────────────────

export function isLobeWorkflowProcessText(
    content: string,
    cleanTranscriptDisplayText: (content: string) => string,
): boolean {
    const normalized = cleanTranscriptDisplayText(content).trim();
    if (!normalized) {
        return true;
    }
    if (normalized.length > 280) {
        return false;
    }
    if (/^#{1,3}\s+\S/.test(normalized) || /^\s*[-*]\s+\S/m.test(normalized) || /\n\s*[-*]\s+\S/.test(normalized)) {
        return false;
    }
    if (/\b(summary|findings|risks|recommendations|review|result|changes|issues)\b/i.test(normalized)
        && /[:\n]/.test(normalized)) {
        return false;
    }
    return /^(let me|i['']?ll|i will|i need to|i'm going to|i am going to|now\b|next\b|checking\b|reading\b|looking\b|fetching\b|running\b|reviewing\b|analyzing\b|searching\b)/i
        .test(normalized);
}

export function collectMobileClosingNarrativeTextsBefore(
    segments: readonly QaapAgentMessageSegmentDTO[],
    lastToolIndex: number,
    beforeIndex: number,
    isLobeWorkflowProcessTextFn: (content: string) => boolean,
): Set<string> {
    const seen = new Set<string>();
    for (let index = lastToolIndex + 1; index < beforeIndex; index++) {
        const segment = segments[index];
        if (segment?.type !== 'text') {
            continue;
        }
        const text = segment.content?.trim() ?? '';
        if (!text || isLobeWorkflowProcessTextFn(segment.content)) {
            continue;
        }
        seen.add(normalizeMobileClosingNarrativeText(text));
    }
    return seen;
}

export function resolveLobeVisibleTextSegmentIndexes(
    segments: readonly QaapAgentMessageSegmentDTO[],
    activityTimelineShown: boolean,
    isLobeWorkflowProcessTextFn: (content: string) => boolean,
): ReadonlySet<number> {
    const textIndexes = segments
        .map((segment, index) => segment.type === 'text' && segment.content.trim() ? index : -1)
        .filter(index => index >= 0);
    if (textIndexes.length === 0) {
        return new Set();
    }
    const hasTools = segments.some(segment => segment.type === 'tool');
    if (!activityTimelineShown && !hasTools) {
        return new Set(textIndexes);
    }
    const lastToolIndex = segments.reduce(
        (last, segment, index) => segment.type === 'tool' ? index : last,
        -1,
    );
    const visible = textIndexes.filter(index => {
        const segment = segments[index];
        if (segment?.type !== 'text') {
            return false;
        }
        if (index <= lastToolIndex) {
            return false;
        }
        return !isLobeWorkflowProcessTextFn(segment.content);
    });
    return new Set(visible);
}

export function resolveConversationElapsedMs(
    conv: QaapAgentConversationDTO | undefined,
    isConversationWorking: (conv: QaapAgentConversationDTO) => boolean,
): number | undefined {
    if (!conv) {
        return undefined;
    }
    const startAt = resolveTranscriptTurnStartMs(conv.messages) ?? conv.createdAt;
    if (isConversationWorking(conv)) {
        return Math.max(0, Date.now() - startAt);
    }
    const lastAgentCreatedAt = conv.messages.length > 0
        ? conv.messages[conv.messages.length - 1].createdAt
        : undefined;
    const endAt = conv.updatedAt >= startAt
        ? conv.updatedAt
        : (typeof lastAgentCreatedAt === 'number' && lastAgentCreatedAt >= startAt
            ? lastAgentCreatedAt
            : undefined);
    if (typeof endAt === 'number' && endAt >= startAt) {
        return endAt - startAt;
    }
    return undefined;
}

export function scrollTranscriptStreamingTraceIntoView(
    chatHost: HTMLElement | undefined,
    options?: { readonly expandTimeline?: boolean },
): void {
    if (!chatHost?.isConnected) {
        return;
    }
    const messageHost = chatHost.querySelector('.theia-mobile-agent-transcript-real-chat')
        ?? chatHost.querySelector('.theia-mobile-agent-transcript');
    if (!(messageHost instanceof HTMLElement)) {
        return;
    }
    const row = messageHost.querySelector<HTMLElement>('.theia-mobile-agent-transcript-msg.theia-mod-agent.theia-mod-streaming')
        ?? [...messageHost.querySelectorAll<HTMLElement>('.theia-mobile-agent-transcript-msg.theia-mod-agent')].at(-1);
    if (!row) {
        return;
    }
    const timeline = row.querySelector<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`);
    if (options?.expandTimeline && timeline instanceof HTMLDetailsElement) {
        timeline.open = true;
    }
    const thought = row.querySelector('.theia-mobile-agent-thought-brief');
    const target = timeline ?? thought ?? row;
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export function enrichChangedFilesWithComposerGitStats(
    files: ReadonlyArray<{
        readonly path: string;
        readonly kind: 'edited' | 'created';
        readonly added?: number;
        readonly removed?: number;
    }>,
    gitFiles: ReadonlyArray<{ readonly path: string; readonly added?: number; readonly removed?: number }> | undefined,
): Array<{
    readonly path: string;
    readonly kind: 'edited' | 'created';
    readonly added?: number;
    readonly removed?: number;
}> {
    if (!gitFiles?.length) {
        return [...files];
    }
    return files.map(file => {
        if ((file.added ?? 0) > 0 || (file.removed ?? 0) > 0) {
            return file;
        }
        const match = gitFiles.find(git => {
            const gitPath = git.path.replace(/\\/g, '/');
            const filePath = file.path.replace(/\\/g, '/');
            return gitPath === filePath
                || gitPath.endsWith(`/${filePath}`)
                || filePath.endsWith(`/${gitPath}`)
                || (gitPath.split('/').pop() === filePath.split('/').pop()
                    && !!filePath.split('/').pop());
        });
        if (!match || ((match.added ?? 0) <= 0 && (match.removed ?? 0) <= 0)) {
            return file;
        }
        return {
            ...file,
            added: match.added,
            removed: match.removed,
        };
    });
}

// ─── DI-extracted methods (third pass — large DOM methods) ───────────────────

export interface TranscriptActivityThinkingCopyDeps {
    resolveTranscriptStreamVisualIdle(segments: readonly QaapAgentMessageSegmentDTO[], streaming: boolean): boolean;
    cleanTranscriptDisplayText(content: string): string;
    isConversationFinalResponseCommitted(conv: QaapAgentConversationDTO | undefined, streaming: boolean): boolean;
    guardTranscriptActivityExpandClose(copy: HTMLElement): void;
}

export function syncTranscriptActivityThinkingCopy(
    copy: HTMLElement,
    item: TranscriptActivityTimelineItem,
    isActive: boolean,
    options: TranscriptActivityTimelineOptions | undefined,
    deps: TranscriptActivityThinkingCopyDeps,
): void {
    copy.querySelector('.theia-mobile-agent-activity-row:not(.theia-mobile-agent-activity-thinking-summary .theia-mobile-agent-activity-row)')?.remove();
    copy.querySelector('.theia-mobile-agent-activity-label')?.remove();
    let details = copy.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-thinking');
    if (!details) {
        details = document.createElement('details');
        details.className = 'theia-mobile-agent-activity-thinking';
        const summary = document.createElement('summary');
        summary.className = 'theia-mobile-agent-activity-thinking-summary';
        const rowEl = document.createElement('span');
        rowEl.className = 'theia-mobile-agent-activity-row';
        const verb = document.createElement('span');
        verb.className = 'theia-mobile-agent-activity-verb';
        rowEl.append(verb);
        const chevron = document.createElement('span');
        chevron.className = 'theia-mobile-agent-activity-thinking-chevron codicon codicon-chevron-right';
        chevron.setAttribute('aria-hidden', 'true');
        summary.append(rowEl, chevron);
        const body = document.createElement('div');
        body.className = 'theia-mobile-agent-activity-thinking-body';
        details.append(summary, body);
        copy.prepend(details);
        summary.addEventListener('click', event => event.stopPropagation());
    }
    if (item.segmentIndex !== undefined) {
        details.dataset.transcriptThinkingSegment = String(item.segmentIndex);
    } else {
        details.removeAttribute('data-transcript-thinking-segment');
    }
    const summaryEl = details.querySelector<HTMLElement>('.theia-mobile-agent-activity-thinking-summary');
    summaryEl?.querySelector('.theia-mobile-agent-activity-tail')?.remove();
    copy.querySelector(':scope > .theia-mobile-agent-activity-meta')?.remove();
    details.querySelector(':scope > .theia-mobile-agent-activity-meta')?.remove();
    const verbEl = details.querySelector<HTMLElement>('.theia-mobile-agent-activity-verb');
    const bodyEl = details.querySelector<HTMLElement>('.theia-mobile-agent-activity-thinking-body');
    const rowEl = details.querySelector<HTMLElement>('.theia-mobile-agent-activity-row');
    const shimmerActive = isActive
        && !!options?.streaming
        && !options?.stalled
        && isTranscriptActivityLiveState(item.state)
        && !deps.resolveTranscriptStreamVisualIdle(options?.segments ?? [], !!options?.streaming);
    if (verbEl) {
        verbEl.textContent = nls.localize('qaap/mobileProjects/transcriptThinking', 'Thinking');
        verbEl.classList.toggle('theia-mod-shimmer', shimmerActive);
    }
    // Add a duration detail inline so the row reads like Devin's
    // "Thought for 1s" instead of a separate meta tag.
    let durationEl = rowEl?.querySelector<HTMLElement>('.theia-mobile-agent-activity-detail.theia-mod-thinking-duration');
    if (rowEl && item.durationMs !== undefined) {
        const durationText = formatTranscriptActivityStepDuration(item.durationMs);
        if (durationText) {
            if (!durationEl) {
                durationEl = document.createElement('span');
                durationEl.className = 'theia-mobile-agent-activity-detail theia-mod-thinking-duration';
                rowEl.append(document.createTextNode(' '), durationEl);
            }
            durationEl.textContent = nls.localize('qaap/mobileProjects/transcriptThoughtForDuration', 'for {0}', durationText);
            durationEl.classList.toggle('theia-mod-shimmer', shimmerActive);
        }
    } else {
        durationEl?.remove();
    }
    // Add a dim excerpt preview below the verb so the user can see what the
    // model was reasoning about. Always visible — even when the thinking
    // details is open — to show a chain of thought below each reasoning step.
    const thinkingSummaryEl = details.querySelector<HTMLElement>('.theia-mobile-agent-activity-thinking-summary');
    const excerptEl = thinkingSummaryEl?.querySelector<HTMLElement>('.theia-mobile-agent-activity-detail.theia-mod-thinking-excerpt');
    if (thinkingSummaryEl && item.thinkingContent) {
        const excerpt = excerptTranscriptThought(item.thinkingContent, 120);
        if (excerpt) {
            let detail = excerptEl;
            if (!detail) {
                detail = document.createElement('span');
                detail.className = 'theia-mobile-agent-activity-detail theia-mod-thinking-excerpt';
                thinkingSummaryEl.append(detail);
            }
            detail.textContent = excerpt;
            detail.classList.toggle('theia-mod-shimmer', shimmerActive);
        } else {
            excerptEl?.remove();
        }
    } else {
        excerptEl?.remove();
    }
    // Duration is rendered inline as 'for 1s'; remove any legacy meta tag.
    rowEl?.querySelector('.theia-mobile-agent-activity-meta')?.remove();
    if (bodyEl && item.thinkingContent) {
        bodyEl.textContent = deps.cleanTranscriptDisplayText(item.thinkingContent);
    }
    details.classList.toggle('theia-mod-live', shimmerActive);
    // Track if the thinking was ever shown live so we can keep it expanded
    // while tools run after thinking (don't auto-collapse reasoning mid-turn).
    if (shimmerActive) {
        details.dataset.thinkingWasLive = '1';
    }
    // Detect the overall message phase. Writing/finalizing is still part
    // of the active turn, so it must not auto-collapse the chain of
    // thought. Collapse only after the backend has committed the final
    // response and returned to ready/idle.
    const segments = options?.segments ?? [];
    const phase = resolveTranscriptTraceDisplayPhase(segments, !!options?.streaming);
    const isStreaming = !!options?.streaming;
    const executionComplete = deps.isConversationFinalResponseCommitted(options?.conv, isStreaming);
    const shouldCollapseForFinalResponse = executionComplete && phase === 'settled';
    if (shouldCollapseForFinalResponse) {
        details.dataset.thinkingCollapsedForWriting = '1';
    }
    if (!details.dataset.thinkingUserToggled) {
        // Once opened during streaming, keep thinking visible while tools
        // run, while final text streams, and during finalizing.
        if (!executionComplete) {
            if (details.dataset.thinkingWasLive === '1' && !details.open) {
                details.dataset.thinkingProgrammaticToggle = '1';
                details.open = true;
            }
        } else {
            // Final response committed — auto-collapse unless user toggled.
            const collapsedForWriting = details.dataset.thinkingCollapsedForWriting === '1';
            const desiredOpen = shimmerActive
                || (details.dataset.thinkingWasLive === '1' && !collapsedForWriting);
            if (details.open !== desiredOpen) {
                details.dataset.thinkingProgrammaticToggle = '1';
                details.open = desiredOpen;
            }
        }
    }
    // Reflect the open state on the copy element so CSS can hide the
    // streaming cursor when the thinking body is already visible.
    copy.classList.toggle('theia-mod-thinking-open', details.open);
    if (!details.dataset.thinkingToggleBound) {
        details.dataset.thinkingToggleBound = '1';
        details.addEventListener('toggle', () => {
            if (details.dataset.thinkingProgrammaticToggle) {
                details.removeAttribute('data-thinking-programmatic-toggle');
                copy.classList.toggle('theia-mod-thinking-open', details.open);
                return;
            }
            details.dataset.thinkingUserToggled = '1';
            copy.classList.toggle('theia-mod-thinking-open', details.open);
            if (!details.open) {
                deps.guardTranscriptActivityExpandClose(copy);
            }
        });
    }
}

export interface TranscriptActivityStepCopyDeps {
    syncTranscriptActivityThinkingCopy(copy: HTMLElement, item: TranscriptActivityTimelineItem, isActive: boolean, options?: TranscriptActivityTimelineOptions): void;
    unwrapTranscriptActivityExpandCopy(copy: HTMLElement): void;
    syncTranscriptActivityStepCopyCursorTrace(rowEl: HTMLElement, item: TranscriptActivityTimelineItem): boolean;
    shouldRenderTranscriptActivityDetailAsPill(detail: string | undefined, toolKind?: string): boolean;
    createTranscriptActivityFileChip(detail: string, toolKind: string | undefined, filePath: string | undefined): HTMLElement;
    appendTranscriptActivityEditDiffTail(rowEl: HTMLElement, added: number, removed: number): void;
    createTranscriptActivityLabel(label: string, compact: boolean): HTMLElement;
    applyTranscriptActivityStepShimmer(copy: HTMLElement, isActive: boolean, shimmerActive: boolean, stalled: boolean): void;
    syncTranscriptActivityRunningBadge(copy: HTMLElement, item: TranscriptActivityTimelineItem, isActive: boolean, options?: TranscriptActivityTimelineOptions): void;
    syncTranscriptActivityDiffPeek(copy: HTMLElement, item: TranscriptActivityTimelineItem, options?: TranscriptActivityTimelineOptions): void;
    syncTranscriptActivityErrorCopy(copy: HTMLElement, item: TranscriptActivityTimelineItem, options?: TranscriptActivityTimelineOptions): void;
    resolveTranscriptActivityExpandContent(item: TranscriptActivityTimelineItem, options?: TranscriptActivityTimelineOptions): TranscriptActivityExpandContent | undefined;
    syncTranscriptActivityExpandCopy(copy: HTMLElement, content: TranscriptActivityExpandContent): void;
    guardTranscriptActivityExpandClose(copy: HTMLElement): void;
}

export function populateTranscriptActivityStepCopy(
    copy: HTMLElement,
    item: TranscriptActivityTimelineItem,
    isActive: boolean,
    options: TranscriptActivityTimelineOptions | undefined,
    deps: TranscriptActivityStepCopyDeps,
): void {
    if (item.thinkingContent || item.navigate === 'thought') {
        deps.syncTranscriptActivityThinkingCopy(copy, item, isActive, options);
        return;
    }
    deps.unwrapTranscriptActivityExpandCopy(copy);

    let label: HTMLElement | undefined = copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-label') ?? undefined;
    if (options?.cursorTrace && item.verb && item.detail) {
        let rowEl = copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-row');
        if (!rowEl) {
            label?.remove();
            label = undefined;
            rowEl = document.createElement('span');
            rowEl.className = 'theia-mobile-agent-activity-row';
            copy.prepend(rowEl);
        }
        if (!deps.syncTranscriptActivityStepCopyCursorTrace(rowEl, item)) {
            rowEl.replaceChildren();
            const verb = document.createElement('span');
            verb.className = 'theia-mobile-agent-activity-verb';
            verb.textContent = item.verb;
            const detail = document.createElement('span');
            detail.className = 'theia-mobile-agent-activity-detail';
            const detailAsPill = deps.shouldRenderTranscriptActivityDetailAsPill(item.detail, item.toolKind);
            detail.classList.toggle('theia-mod-pill', detailAsPill);
            detail.classList.toggle('theia-mod-command', item.toolKind === 'terminal' && !detailAsPill);
            detail.classList.toggle('theia-mod-edit-file', item.toolKind === 'editing' && detailAsPill);
            if (detailAsPill && item.detail) {
                detail.append(deps.createTranscriptActivityFileChip(item.detail, item.toolKind, item.filePath));
            } else {
                detail.textContent = item.detail ?? '';
            }
            if (item.filePath) {
                detail.title = item.filePath;
            }
            rowEl.append(verb, document.createTextNode(' '), detail);
            if (item.editAdded !== undefined || item.editRemoved !== undefined) {
                deps.appendTranscriptActivityEditDiffTail(rowEl, item.editAdded ?? 0, item.editRemoved ?? 0);
            } else if (item.tail) {
                const tail = document.createElement('span');
                tail.className = 'theia-mobile-agent-activity-tail';
                tail.textContent = ` ${item.tail}`;
                rowEl.append(tail);
            }
        }
    } else {
        copy.querySelector('.theia-mobile-agent-activity-row')?.remove();
        if (!label) {
            label = deps.createTranscriptActivityLabel(item.label, false);
            copy.prepend(label);
        }
        label.textContent = item.label;
    }

    deps.applyTranscriptActivityStepShimmer(
        copy,
        isActive,
        isActive
        && !!options?.streaming
        && !options?.stalled
        && isTranscriptActivityLiveState(item.state),
        !!options?.stalled,
    );
    deps.syncTranscriptActivityRunningBadge(copy, item, isActive, options);

    let mcpBadge = copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-mcp-badge');
    if (item.toolKind === 'mcp') {
        if (!mcpBadge) {
            mcpBadge = document.createElement('span');
            mcpBadge.className = 'theia-mobile-agent-activity-mcp-badge';
            mcpBadge.setAttribute('aria-hidden', 'true');
            (copy.querySelector('.theia-mobile-agent-activity-row') ?? label)?.after(mcpBadge);
        }
        mcpBadge.textContent = 'MCP';
    } else {
        mcpBadge?.remove();
    }

    const metaText = options?.cursorTrace
        ? (() => {
            const durationSuffix = formatTranscriptActivityStepDurationSuffix(item.durationMs);
            if (durationSuffix) {
                return durationSuffix;
            }
            return formatTranscriptActivityStepMeta(item.durationMs, item.timestamp);
        })()
        : formatTranscriptActivityStepMeta(item.durationMs, item.timestamp);
    let meta = copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-meta');
    if (metaText) {
        if (!meta) {
            meta = document.createElement('span');
            meta.className = 'theia-mobile-agent-activity-meta';
            if (options?.cursorTrace) {
                (copy.querySelector('.theia-mobile-agent-activity-row') ?? label)?.after(meta);
            } else {
                copy.append(meta);
            }
        }
        meta.textContent = metaText;
    } else {
        meta?.remove();
    }

    deps.syncTranscriptActivityDiffPeek(copy, item, options);

    let errorDetail = copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-error-detail');
    if (item.errorSummary && item.state === 'error') {
        errorDetail?.remove();
        copy.querySelector('.theia-mobile-agent-activity-error-expand')?.remove();
        deps.syncTranscriptActivityErrorCopy(copy, item, options);
    } else {
        copy.querySelector('.theia-mobile-agent-activity-error-panel')?.remove();
        errorDetail?.remove();
        copy.querySelector('.theia-mobile-agent-activity-error-expand')?.remove();
    }

    let waitingBadge = copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-waiting-badge');
    if (item.state === 'waiting') {
        if (!waitingBadge) {
            waitingBadge = document.createElement('span');
            waitingBadge.className = 'theia-mobile-agent-activity-waiting-badge';
            const badgeIcon = document.createElement('span');
            badgeIcon.className = 'codicon codicon-shield';
            badgeIcon.setAttribute('aria-hidden', 'true');
            const badgeLabel = document.createElement('span');
            badgeLabel.className = 'theia-mobile-agent-activity-waiting-badge-label';
            badgeLabel.textContent = nls.localize('qaap/mobileProjects/transcriptWaitingApproval', 'Awaiting approval');
            waitingBadge.append(badgeIcon, badgeLabel);
            (copy.querySelector('.theia-mobile-agent-activity-row') ?? label)?.after(waitingBadge);
        }
    } else {
        waitingBadge?.remove();
    }

    let resultPreview = copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-result-preview');
    const expandContent = deps.resolveTranscriptActivityExpandContent(item, options);
    const showExpand = shouldShowTranscriptActivityExpandContent(item, expandContent);
    if (showExpand && expandContent) {
        resultPreview?.remove();
        deps.syncTranscriptActivityExpandCopy(copy, expandContent);
    } else {
        copy.querySelector('.theia-mobile-agent-activity-expand')?.remove();
        if (item.resultPreview && item.toolKind === 'reading' && !item.grouped) {
            if (!resultPreview) {
                resultPreview = document.createElement('div');
                resultPreview.className = 'theia-mobile-agent-activity-result-preview';
                copy.append(resultPreview);
            }
            if (resultPreview.textContent !== item.resultPreview) {
                resultPreview.textContent = item.resultPreview;
            }
        } else {
            resultPreview?.remove();
        }
    }
}

// ─── Pure DOM: syncTranscriptActivityHistoryGap (0 this. refs) ───────────────

export function syncTranscriptActivityHistoryGap(
    li: HTMLElement,
    hiddenCount: number,
    position: 'before' | 'after',
): void {
    const gapFingerprint = fingerprintTranscriptActivityHistoryGapSlot(hiddenCount, position);
    if (li.getAttribute(TRANSCRIPT_ACTIVITY_ITEM_FP_ATTR) === gapFingerprint) {
        recordTranscriptRenderMetric('timeline_item_sync_skipped');
        return;
    }
    const labelText = position === 'before'
        ? nls.localize(
            'qaap/mobileProjects/transcriptActivityHiddenSteps',
            '+{0} earlier steps',
            String(hiddenCount),
        )
        : nls.localize(
            'qaap/mobileProjects/transcriptActivityHiddenMoreSteps',
            '+{0} more steps',
            String(hiddenCount),
        );
    const existingLabel = li.querySelector<HTMLElement>('.theia-mobile-agent-activity-label');
    if (li.classList.contains('theia-mod-history-gap') && existingLabel) {
        li.setAttribute(TRANSCRIPT_ACTIVITY_ITEM_FP_ATTR, gapFingerprint);
        if (existingLabel.textContent !== labelText) {
            existingLabel.textContent = labelText;
        }
        if (li.getAttribute('aria-label') !== labelText) {
            li.setAttribute('aria-label', labelText);
        }
        recordTranscriptRenderMetric('timeline_item_sync_light');
        return;
    }
    li.setAttribute(TRANSCRIPT_ACTIVITY_ITEM_FP_ATTR, gapFingerprint);
    recordTranscriptRenderMetric('timeline_item_sync');
    li.className = 'theia-mobile-agent-activity-item theia-mod-history-gap theia-mod-clickable';
    li.setAttribute(TRANSCRIPT_TIMELINE_GAP_POSITION_ATTR, position);
    li.removeAttribute(TRANSCRIPT_ACTIVITY_ACTIVE_ATTR);
    li.removeAttribute('data-transcript-activity-action');
    li.removeAttribute('data-transcript-activity-segment-index');
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');
    li.setAttribute('aria-label', labelText);
    const icon = document.createElement('span');
    icon.className = 'theia-mobile-agent-activity-icon theia-mod-history-gap codicon codicon-ellipsis';
    icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    copy.className = 'theia-mobile-agent-activity-copy';
    const label = document.createElement('span');
    label.className = 'theia-mobile-agent-activity-label';
    label.textContent = labelText;
    copy.append(label);
    li.replaceChildren(icon, copy);
}

// ─── DI-extracted: refreshTranscriptThoughtBriefTitle (1 this. recursive) ────

export interface RefreshTranscriptThoughtBriefTitleDeps {
    refreshTranscriptThoughtBriefTitle(
        title: HTMLElement,
        block: HTMLElement,
        options: {
            readonly thinking: string | undefined;
            readonly thinkingActive: boolean;
            readonly streaming: boolean;
            readonly turnStartMs: number | undefined;
            readonly segments?: readonly QaapAgentMessageSegmentDTO[];
        },
    ): void;
}

export function refreshTranscriptThoughtBriefTitle(
    title: HTMLElement,
    block: HTMLElement,
    options: {
        readonly thinking: string | undefined;
        readonly thinkingActive: boolean;
        readonly streaming: boolean;
        readonly turnStartMs: number | undefined;
        readonly segments?: readonly QaapAgentMessageSegmentDTO[];
    },
    deps: RefreshTranscriptThoughtBriefTitleDeps,
): void {
    title.classList.remove('theia-mod-shimmer');
    if (options.thinkingActive && options.turnStartMs !== undefined) {
        title.classList.add('theia-mod-shimmer');
        // LobeHub Thinking.thinking = "Deep Thinking..." — shown while
        // the model is actively reasoning (streaming). The text itself is
        // constant while thinking is active, so avoid rewriting
        // `textContent` (and triggering layout/style work) on every tick;
        // this timer's real job is watching for the live class to drop.
        const update = (): void => {
            if (!title.isConnected) {
                return;
            }
            const next = nls.localize('qaap/lobehub/thinking/thinking', 'Deep Thinking...');
            if (title.textContent !== next) {
                title.textContent = next;
            }
        };
        update();
        if (block.dataset.thoughtLiveTimer !== '1') {
            block.dataset.thoughtLiveTimer = '1';
            // Capture the block's document view instead of the global `window` so the
            // interval can clear itself after jsdom teardown between specs without a
            // global `window is not defined` error (see ensureTranscriptStreamStallWatch).
            const view = (block.ownerDocument?.defaultView ?? window) as Window & typeof globalThis;
            const timer = view.setInterval(() => {
                if (!title.isConnected) {
                    view.clearInterval(timer);
                    block.removeAttribute('data-thought-live-timer');
                    return;
                }
                if (!block.classList.contains('theia-mod-thinking-live')) {
                    view.clearInterval(timer);
                    block.removeAttribute('data-thought-live-timer');
                    deps.refreshTranscriptThoughtBriefTitle(title, block, {
                        ...options,
                        thinkingActive: false,
                    });
                    return;
                }
                if (!isTranscriptDocumentVisible()) {
                    return;
                }
                update();
            }, 1000);
        }
        return;
    }
    block.removeAttribute('data-thought-live-timer');
    // LobeHub Thinking.thoughtWithDuration = "Deeply Thought" — shown once
    // reasoning has settled (whether or not thinking content is present).
    // Kept in sync with the technical-details thinking branch and the IDE
    // React renderer (QaapLobehubThinkingRenderer).
    title.textContent = nls.localize('qaap/lobehub/thinking/thought', 'Deeply Thought');
}

// ─── DI-extracted: syncTranscriptThoughtBriefElement (4 this. method calls) ──

export interface SyncTranscriptThoughtBriefElementDeps {
    isConversationFinalResponseCommitted(conv: QaapAgentConversationDTO | undefined, streaming: boolean): boolean;
    isConversationWorking(conv: QaapAgentConversationDTO | undefined, streaming: boolean): boolean;
    syncTranscriptThoughtBriefIcon(icon: HTMLElement, active: boolean): void;
    refreshTranscriptThoughtBriefTitle(
        title: HTMLElement,
        block: HTMLElement,
        options: {
            readonly thinking: string | undefined;
            readonly thinkingActive: boolean;
            readonly streaming: boolean;
            readonly turnStartMs: number | undefined;
            readonly segments?: readonly QaapAgentMessageSegmentDTO[];
        },
    ): void;
}

export function syncTranscriptThoughtBriefElement(
    block: HTMLElement,
    segments: readonly QaapAgentMessageSegmentDTO[],
    options: { readonly streaming?: boolean; readonly conv?: QaapAgentConversationDTO },
    deps: SyncTranscriptThoughtBriefElementDeps,
): void {
    const thinking = resolveTranscriptThinkingContent([...segments]);
    const streaming = !!options.streaming;
    const thinkingActive = isTranscriptAgentThinkingPhase(segments, streaming);
    const executionComplete = deps.isConversationFinalResponseCommitted(options.conv, streaming);
    const title = block.querySelector<HTMLElement>('.theia-mobile-agent-thought-brief-title');
    if (!title) {
        return;
    }
    const turnStartMs = options.conv ? resolveTranscriptTurnStartMs(options.conv.messages) : undefined;
    if (thinkingActive) {
        block.classList.add('theia-mod-thinking-live');
        block.removeAttribute('data-thought-duration-ms');
        if (block instanceof HTMLDetailsElement) {
            block.open = true;
        }
    } else if (streaming && block.classList.contains('theia-mod-thinking-live')) {
        block.classList.remove('theia-mod-thinking-live');
        if (turnStartMs !== undefined && !block.dataset.thoughtDurationMs) {
            block.dataset.thoughtDurationMs = String(Math.max(0, Date.now() - turnStartMs));
        }
        // Keep the thought brief open during the entire execution turn so
        // the user can always see what the agent reasoned. It will be
        // collapsed once the backend is actually ready, not merely when
        // the transcript render switches to a non-streaming/finalizing mode.
        if (block instanceof HTMLDetailsElement && !block.dataset.thoughtUserExpanded) {
            block.open = true;
        }
    } else if (block instanceof HTMLDetailsElement
        && !block.dataset.thoughtUserExpanded
        && !thinkingActive
        && executionComplete) {
        block.open = false;
    }
    const meta = block.querySelector<HTMLElement>('.theia-mobile-agent-thought-brief-meta');
    meta?.remove();
    // Sync the thought brief icon: spinning loader (LobeHub Loader2) while
    // the backend is still streaming (including the Finalizing state where
    // the turn is visually settled but the backend is still active),
    // lightbulb (LobeHub Atom) when the backend is truly idle.
    const backendStreaming = deps.isConversationWorking(options.conv, streaming);
    const briefIcon = block.querySelector<HTMLElement>('.theia-mobile-agent-thought-brief-icon');
    if (briefIcon) {
        deps.syncTranscriptThoughtBriefIcon(briefIcon, backendStreaming || thinkingActive);
    }
    const bodyWrap = block.querySelector<HTMLElement>('.theia-mobile-agent-thought-brief-body-wrap');
    if (thinking) {
        if (!bodyWrap) {
            const wrap = document.createElement('div');
            wrap.className = 'theia-mobile-agent-thought-brief-body-wrap';
            const body = document.createElement('p');
            body.className = 'theia-mobile-agent-thought-brief-body';
            wrap.append(body);
            block.append(wrap);
        }
        const body = block.querySelector<HTMLElement>('.theia-mobile-agent-thought-brief-body');
        if (body) {
            body.textContent = excerptTranscriptThought(thinking);
        }
    } else {
        bodyWrap?.remove();
    }
    if (block instanceof HTMLDetailsElement && block.dataset.thoughtToggleBound !== '1') {
        block.dataset.thoughtToggleBound = '1';
        block.addEventListener('toggle', () => {
            if (block.open) {
                block.dataset.thoughtUserExpanded = '1';
            } else {
                block.removeAttribute('data-thought-user-expanded');
            }
        });
    }
    deps.refreshTranscriptThoughtBriefTitle(title, block, {
        thinking,
        thinkingActive,
        streaming,
        turnStartMs,
        segments: [...segments],
    });
}

// ─── DI-extracted: syncTranscriptStreamStallChrome (9 this. method calls) ────

export interface SyncTranscriptStreamStallChromeDeps {
    resolveTranscriptStreamHealth(conv?: QaapAgentConversationDTO): { stalled: boolean; timedOut: boolean; timeoutCause?: TranscriptStreamTimeoutCause };
    syncTranscriptStreamTimeoutBanner(segmentsBody: ParentNode, timedOut: boolean, cause?: TranscriptStreamTimeoutCause, conv?: QaapAgentConversationDTO): void;
    resolveTranscriptActivityItemsForDisplay(segments: readonly QaapAgentMessageSegmentDTO[], options?: { readonly stalled?: boolean; readonly timedOut?: boolean; readonly row?: HTMLElement; readonly conv?: QaapAgentConversationDTO; readonly streaming?: boolean }): readonly TranscriptActivityTimelineItem[];
    resolveTranscriptRowSegments(conv: QaapAgentConversationDTO, row: HTMLElement): QaapAgentMessageSegmentDTO[];
    syncTranscriptActivityTimelineElement(timeline: HTMLElement, items: readonly TranscriptActivityTimelineItem[], options?: TranscriptActivityTimelineOptions): void;
    syncTranscriptStreamingActivityLine(line: Element, conv: QaapAgentConversationDTO, stalled: boolean, timedOut?: boolean): void;
}

export function syncTranscriptStreamStallChrome(
    row: HTMLElement,
    conv: QaapAgentConversationDTO,
    deps: SyncTranscriptStreamStallChromeDeps,
): void {
    const health = deps.resolveTranscriptStreamHealth(conv);
    const { stalled, timedOut, timeoutCause } = health;
    // Only rebuild the (relatively expensive) activity timeline items when the
    // stall/timeout state actually changed, or while stalled/timed out (so the
    // banner/detail text can keep updating). Steady-state streaming ticks skip
    // the rebuild; the cheap class toggles below still run every tick.
    const stallState = `${stalled ? 1 : 0}${timedOut ? 1 : 0}`;
    const stallStateChanged = row.dataset.qaapStallState !== stallState;
    row.dataset.qaapStallState = stallState;
    row.classList.toggle('theia-mod-stream-stalled', stalled);
    row.classList.toggle('theia-mod-stream-timed-out', timedOut);
    const segmentsBody = row.querySelector('.theia-mobile-agent-transcript-segments');
    if (segmentsBody) {
        deps.syncTranscriptStreamTimeoutBanner(segmentsBody, timedOut, timeoutCause, conv);
        // Codex-style execution event timeline: toggle stalled class on the container.
        if (hasMobileExecutionEventTimeline(row)) {
            const eventTimeline = segmentsBody.querySelector<HTMLElement>(`.theia-mobile-execution-timeline`);
            if (eventTimeline) {
                eventTimeline.classList.toggle('theia-mod-stalled', stalled);
                eventTimeline.classList.toggle('theia-mod-timed-out', timedOut);
            }
        }
        const timeline = segmentsBody.querySelector<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`);
        if (timeline) {
            timeline.classList.toggle('theia-mod-stalled', stalled);
            timeline.classList.toggle('theia-mod-timed-out', timedOut);
            if (stallStateChanged || stalled || timedOut) {
                const items = deps.resolveTranscriptActivityItemsForDisplay(
                    deps.resolveTranscriptRowSegments(conv, row),
                    { stalled, timedOut, row, conv, streaming: true },
                );
                deps.syncTranscriptActivityTimelineElement(timeline, buildTranscriptExecutionTimelineItems(items), {
                    streaming: true,
                    stalled,
                    timedOut,
                    expanded: false,
                    segments: deps.resolveTranscriptRowSegments(conv, row),
                    conv,
                    row,
                });
            }
        }
        const streamLine = segmentsBody.querySelector('.theia-mobile-agent-stream-line, .qaap-agent-setup');
        if (streamLine) {
            deps.syncTranscriptStreamingActivityLine(streamLine, conv, stalled, timedOut);
        }
    }
    if (row.hasAttribute(TRANSCRIPT_ACTIVITY_ROW_ATTR)) {
        const line = row.querySelector('.theia-mobile-agent-stream-line, .qaap-agent-setup');
        if (line) {
            deps.syncTranscriptStreamingActivityLine(line, conv, stalled, timedOut);
        }
        deps.syncTranscriptStreamTimeoutBanner(row, timedOut, timeoutCause, conv);
        row.classList.toggle('theia-mod-stream-stalled', stalled);
        row.classList.toggle('theia-mod-stream-timed-out', timedOut);
    }
}
