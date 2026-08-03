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
