// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationDTO, QaapAgentConversationSummaryDTO, QaapAgentMessageDTO } from './qaap-agent-conversation-client';
import { hasActiveQaapTraceWork, resolveQaapTranscriptTrace } from './qaap-transcript-trace-model';

export type TranscriptAgentExecutionPhase = 'working' | 'finalizing' | 'ready' | 'failed';

/** Resolve timing from the rendered message, never from a later conversation turn. */
export function resolveAgentMessageTiming(conv: QaapAgentConversationDTO | undefined, message: QaapAgentMessageDTO | undefined, now = Date.now()): { isWorking: boolean; turnStartMs: number | undefined; elapsedMs: number | undefined } {
    const index = conv?.messages.findIndex(item => item.id === message?.id) ?? -1;
    const owner = conv?.messages.find(item => item.id === message?.runUserMessageId)
        ?? conv?.messages.slice(0, index).reverse().find(item => item.role === 'user');
    const turnStartMs = owner?.createdAt ?? message?.createdAt;
    const nextUserAt = conv?.messages.slice(index + 1).find(item => item.role === 'user')?.createdAt;
    const cancelledAt = message?.traceEvents?.find(event => event.type === 'run_cancelled')?.startedAt;
    const isWorking = (conv?.status === 'streaming' || conv?.status === 'settled')
        && cancelledAt === undefined && message?.runFinishedAt === undefined && nextUserAt === undefined;
    const endAt = message?.runFinishedAt ?? cancelledAt ?? nextUserAt ?? conv?.updatedAt;
    return { isWorking, turnStartMs, elapsedMs: turnStartMs === undefined ? undefined : Math.max(0, (isWorking ? now : endAt ?? turnStartMs) - turnStartMs) };
}

export interface TranscriptAgentExecutionState {
    readonly phase: TranscriptAgentExecutionPhase;
    readonly busy: boolean;
}

export function hasUnfinishedAgentWork(conv: QaapAgentConversationDTO): boolean {
    return conv.messages.some(message => message.role === 'agent' && hasUnfinishedAgentMessageWork(message));
}

export function hasUnfinishedAgentMessageWork(message: QaapAgentMessageDTO): boolean {
    return hasActiveQaapTraceWork(message);
}

/**
 * True when the visible agent turn looks complete (tools done, answer or edits shown) even if the
 * backend task is still attached — e.g. a dev server keeps the VPS process alive after the model
 * finished the turn.
 */
export function isConversationTurnVisuallySettled(conv: QaapAgentConversationDTO): boolean {
    if (hasUnfinishedAgentWork(conv)) {
        return false;
    }
    if (conv.status !== 'streaming') {
        return conv.status === 'idle';
    }
    const last = conv.messages[conv.messages.length - 1];
    if (!last || last.role !== 'agent') {
        return false;
    }
    return isAgentMessageVisuallySettled(last);
}

export function isAgentMessageVisuallySettled(message: QaapAgentMessageDTO): boolean {
    if (message.role !== 'agent') {
        return false;
    }
    const segments = resolveQaapTranscriptTrace(message).segments;
    if (segments.length) {
        if (hasUnfinishedAgentMessageWork(message)) {
            return false;
        }
        const hasFinishedTool = segments.some(
            segment => segment.type === 'tool' && segment.finished,
        );
        const hasText = segments.some(
            segment => segment.type === 'text' && !!segment.content?.trim(),
        );
        if (hasText || hasFinishedTool) {
            return true;
        }
        // Thinking-only snapshots are not a completed turn while the backend task is still running.
        return false;
    }
    return !!(message.content?.trim());
}

/** Render-facing status — a visually complete streaming turn renders as settled, not as token stream. */
export function resolveTranscriptEffectiveStatus(
    conv: QaapAgentConversationDTO,
): QaapAgentConversationDTO['status'] {
    if (conv.status === 'failed') {
        return 'failed';
    }
    if (conv.status !== 'streaming') {
        return conv.status;
    }
    if (hasUnfinishedAgentWork(conv)) {
        return 'streaming';
    }
    // When the turn is visually settled but the backend task is still attached, return 'settled'
    // for transcript rendering only. Execution chrome must use resolveTranscriptAgentExecutionState.
    if (isConversationTurnVisuallySettled(conv)) {
        return 'settled';
    }
    return 'streaming';
}

/** Single source of truth for visual agent execution chrome: Stop, composer glow, header state. */
export function resolveTranscriptAgentExecutionState(
    summary: Pick<QaapAgentConversationSummaryDTO, 'id' | 'status'> | undefined,
    conv: QaapAgentConversationDTO | undefined,
): TranscriptAgentExecutionState {
    if (conv && (!summary || conv.id === summary.id)) {
        if (conv.status === 'failed') {
            return { phase: 'failed', busy: false };
        }
        if (conv.status === 'streaming') {
            // A settled-looking snapshot mid-stream (unfinished trace) is still 'working'; a visually
            // complete one is 'finalizing' while the backend task detaches. Both are busy.
            return {
                phase: isConversationTurnVisuallySettled(conv) ? 'finalizing' : 'working',
                busy: true,
            };
        }
        if (conv.status === 'settled') {
            return { phase: 'finalizing', busy: true };
        }
        // Terminal/idle backend status: the task has ended, so execution chrome (Stop, composer glow,
        // and the Changes Accept/Discard menu) is NOT busy — even if the last message's trace still
        // looks unfinished. A flaky model can leave a tool_call 'pending' forever, which previously
        // wedged the turn in a permanent "working" state and disabled Accept/Discard. Rendering may
        // retain trace details, but must not restart timers or show an active turn.
        return { phase: 'ready', busy: false };
    }
    if (summary?.status === 'failed') {
        return { phase: 'failed', busy: false };
    }
    if (summary?.status === 'streaming') {
        return { phase: 'working', busy: true };
    }
    if (summary?.status === 'settled') {
        return { phase: 'finalizing', busy: true };
    }
    return { phase: 'ready', busy: false };
}

export function isTranscriptAgentExecutionBusy(
    summary: Pick<QaapAgentConversationSummaryDTO, 'id' | 'status'> | undefined,
    conv: QaapAgentConversationDTO | undefined,
): boolean {
    return resolveTranscriptAgentExecutionState(summary, conv).busy;
}

/** True while the UI should treat the conversation as an in-flight agent turn (composer stop, stall watch). */
export function isTranscriptSummaryAgentWorking(
    summary: Pick<QaapAgentConversationSummaryDTO, 'id' | 'status'>,
    conv: QaapAgentConversationDTO | undefined,
): boolean {
    return isTranscriptAgentExecutionBusy(summary, conv);
}

/** True when the last agent message should use live streaming markdown (plain/hybrid)
 * instead of full settled rendering.
 */
export function isTranscriptAgentTailStreaming(conv: QaapAgentConversationDTO): boolean {
    if (resolveTranscriptEffectiveStatus(conv) !== 'streaming' || isConversationTurnVisuallySettled(conv)) {
        return false;
    }
    const last = conv.messages[conv.messages.length - 1];
    return last?.role === 'agent';
}

/**
 * Mid-turn pinned live-status (orb + activity + elapsed · tokens).
 * Stay visible for the whole backend turn (streaming + settled/finalizing).
 * Hide only when the task ends (idle/failed) — never on "visually settled"
 * mid-stream, or the chrome flickers between tools / while preparing the answer.
 *
 * A conversation with no user message yet (empty chat) never shows the live-status,
 * even if the backend reports a stale `streaming`/`settled` status — there is no
 * in-flight turn to depict, so the orb + "Planning next moves…" chrome would be
 * misleading (e.g. "19m 59s · ~0 tokens" pinned on a blank transcript).
 */
export function shouldShowTranscriptLiveStatus(conv: QaapAgentConversationDTO): boolean {
    if (!conversationHasUserMessage(conv)) {
        return false;
    }
    return conv.status === 'streaming' || conv.status === 'settled';
}

export function conversationHasUserMessage(
    conv: QaapAgentConversationDTO,
    cached?: Pick<QaapAgentConversationDTO, 'id' | 'messages'>,
): boolean {
    if (conv.messages.some(message => message.role === 'user')) {
        return true;
    }
    if (cached?.id === conv.id && cached.messages.some(message => message.role === 'user')) {
        return true;
    }
    return false;
}

/** Quick-action chips only before the user sends their first message in this chat. */
export function shouldShowTranscriptEmptyQuickActions(
    conv: QaapAgentConversationDTO,
    cached?: Pick<QaapAgentConversationDTO, 'id' | 'messages'>,
): boolean {
    if (conversationHasUserMessage(conv, cached)) {
        return false;
    }
    if (resolveTranscriptEffectiveStatus(conv) === 'streaming') {
        return false;
    }
    return conv.messages.length === 0;
}

/** Composer quick-actions row: full chips, only the preview-starting chip, or hidden. */
export type TranscriptComposerQuickActionsMode = 'full' | 'preview-only' | 'hidden';

/**
 * The "Run app" chip is the only visible sign that a preview is booting. The row used to hide as
 * soon as the chat left its empty state, so the chip stayed in the DOM under `display: none` and
 * the "Starting preview…" button measured 0×0. While a preview request is in flight the row now
 * stays visible, narrowed to the chip (`preview-only`).
 */
export function resolveTranscriptComposerQuickActionsMode(
    conv: QaapAgentConversationDTO,
    cached: Pick<QaapAgentConversationDTO, 'id' | 'messages'> | undefined,
    previewStarting: boolean,
): TranscriptComposerQuickActionsMode {
    if (shouldShowTranscriptEmptyQuickActions(conv, cached)) {
        return 'full';
    }
    return previewStarting ? 'preview-only' : 'hidden';
}

/** What a turn Stop does to the preview request that turn may have started. */
export type QaapTurnStopPreviewRequestAction =
    /** No preview request is pending or running: nothing to clear. */
    | 'none'
    /** The request only waits on the agent or a probe: clear it so "Starting preview…" becomes "Run app". */
    | 'clear'
    /** A real Qaap bootstrap is installing or serving the app: leave it running, the chip stays cancelable. */
    | 'keep';

export interface QaapTurnStopPreviewRequestInput {
    readonly requestPending: boolean;
    readonly requestRunning: boolean;
    /** Phase of the project bootstrap service (`installing`, `starting`, `running`, `ready-to-run`, ...). */
    readonly bootstrapPhase?: string;
    /** A preview URL already answers: the request is done and nothing keeps it alive. */
    readonly previewUrl?: string;
}

/**
 * Stopping the agent turn must not kill a preview process Qaap is starting (the bootstrap keeps
 * it), but a request that only waits on the agent has no process to keep: it is cleared at once.
 */
export function resolveQaapTurnStopPreviewRequestAction(input: QaapTurnStopPreviewRequestInput): QaapTurnStopPreviewRequestAction {
    if (!input.requestPending && !input.requestRunning) {
        return 'none';
    }
    const bootstrapActive = input.bootstrapPhase === 'installing'
        || input.bootstrapPhase === 'starting'
        || input.bootstrapPhase === 'running';
    if (bootstrapActive && !input.previewUrl) {
        return 'keep';
    }
    return 'clear';
}

/** What the end of an agent turn does to a preview request still showing "Starting preview…". */
export type QaapSettledPreviewRequestAction =
    /** No preview request is pending or running. */
    | 'none'
    /** The turn has not really ended, or a Qaap launch / agent-fallback watchdog owns the request. */
    | 'keep'
    /** Nothing will ever resolve the request: drop it so the chip falls back to "Run app". */
    | 'clear'
    /** The request only waited on the agent: run Qaap's own launch once (it ends ready or failed). */
    | 'relaunch';

export interface QaapSettledPreviewRequestInput extends QaapTurnStopPreviewRequestInput {
    /** Backend status of the conversation whose turn just settled (a visual settle stays `streaming`). */
    readonly conversationStatus: string | undefined;
    /** The settled turn failed or was cancelled. */
    readonly turnEndedBadly: boolean;
    /** The user stopped the preview (Stop latch); it is never relaunched behind their back. */
    readonly suppressedByUser: boolean;
    /** A Qaap launcher is available to start the app without another agent turn. */
    readonly canRelaunch: boolean;
}

/**
 * Every preview request must end in a ready preview, "Run app" or a reported failure, never an
 * endless "Starting preview…". A chat request ("start the app") only waits on the agent turn
 * (`requestPending` without `requestRunning`); when that turn ends nothing else resolves it, so it
 * is either handed to Qaap's own launch (which clears the flags when it finishes) or cleared. A
 * failed/cancelled turn never relaunches; only a bootstrap actively starting the app keeps the chip.
 */
export function resolveQaapSettledPreviewRequestAction(input: QaapSettledPreviewRequestInput): QaapSettledPreviewRequestAction {
    if (!input.requestPending && !input.requestRunning) {
        return 'none';
    }
    if (input.conversationStatus === 'streaming') {
        return 'keep';
    }
    if (input.turnEndedBadly || input.suppressedByUser) {
        return resolveQaapTurnStopPreviewRequestAction(input) === 'keep' ? 'keep' : 'clear';
    }
    if (input.requestRunning) {
        return 'keep';
    }
    return input.canRelaunch ? 'relaunch' : 'clear';
}
