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
import { resolveTranscriptTurnStartMs, resolveTranscriptTraceDisplayPhase } from '../common/qaap-transcript-stream-status';
import { normalizeMobileClosingNarrativeText, type TranscriptActivityTimelineItem } from './mobile-projects-transcript-timeline-utils';
import { TRANSCRIPT_ACTIVITY_TIMELINE_ATTR } from '../common/qaap-transcript-incremental-update';
import { excerptTranscriptThought } from '../common/qaap-agent-transcript-segments';
import { formatTranscriptActivityStepDuration, isTranscriptActivityLiveState } from '../common/qaap-transcript-activity-step-state';
import { formatTranscriptActivityStepDurationSuffix, formatTranscriptActivityStepMeta } from '../common/qaap-transcript-activity-timing';
import { shouldShowTranscriptActivityExpandContent, type TranscriptActivityExpandContent } from '../common/qaap-transcript-activity-expand-core';
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
