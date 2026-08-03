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
import { resolveTranscriptTurnStartMs } from '../common/qaap-transcript-stream-status';
import { normalizeMobileClosingNarrativeText } from './mobile-projects-transcript-timeline-utils';
import { TRANSCRIPT_ACTIVITY_TIMELINE_ATTR } from '../common/qaap-transcript-incremental-update';

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
