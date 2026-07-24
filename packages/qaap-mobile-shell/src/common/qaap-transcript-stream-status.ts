// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationDTO, QaapAgentMessageDTO } from './qaap-agent-conversation-client';
import { resolveAgentMessageSegments } from './qaap-transcript-trace-model';

/**
 * Claude-Code-style streaming status line data: elapsed turn time and an approximate
 * token count for the in-flight agent reply ("· 1m 23s · ~4.2k tokens").
 */

/** Rough chars-per-token heuristic — close enough for a progress hint. */
export const STREAM_STATUS_CHARS_PER_TOKEN = 4;

interface StreamStatusMessage {
    readonly role: string;
    readonly createdAt?: number;
    readonly content?: string;
    readonly segments?: ReadonlyArray<{
        readonly type: string;
        readonly content?: string;
        readonly args?: string;
        readonly result?: string;
    }>;
}

/** Start of the in-flight turn: the last user message's timestamp. */
export function resolveTranscriptTurnStartMs(messages: readonly StreamStatusMessage[]): number | undefined {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (message.role === 'user') {
            return message.createdAt;
        }
    }
    return undefined;
}

/**
 * Characters produced by the in-flight agent turn.
 * Counts text + thinking, and tool args/results so mid-tool turns still show a
 * token estimate next to elapsed time (not only after prose streams).
 */
export function resolveTranscriptTurnStreamChars(messages: readonly StreamStatusMessage[]): number {
    const last = messages[messages.length - 1];
    if (!last || last.role === 'user') {
        return 0;
    }
    const segments = resolveAgentMessageSegments(last as QaapAgentMessageDTO);
    if (segments.length) {
        let total = 0;
        for (const segment of segments) {
            if (segment.type === 'text' || segment.type === 'thinking') {
                total += segment.content?.length ?? 0;
            } else if (segment.type === 'tool') {
                total += (segment.args?.length ?? 0) + (segment.result?.length ?? 0);
            }
        }
        return total;
    }
    return last.content?.length ?? 0;
}

/** "12s", "1m 23s", "1h 2m". */
export function formatTranscriptStreamElapsed(elapsedMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60) {
        return `${totalMinutes}m ${totalSeconds % 60}s`;
    }
    return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}

/** "~870 tokens", "~4.2k tokens"; "~0 tokens" when count is zero; undefined if not a number. */
export function formatTranscriptTokenCount(tokens: number): string | undefined {
    if (!Number.isFinite(tokens) || tokens < 0) {
        return undefined;
    }
    if (tokens === 0) {
        return '~0 tokens';
    }
    if (tokens < 1000) {
        return `~${Math.round(tokens)} tokens`;
    }
    const thousands = tokens / 1000;
    const rounded = thousands >= 10 ? Math.round(thousands).toString() : (Math.round(thousands * 10) / 10).toFixed(1);
    return `~${rounded}k tokens`;
}

/** "~870 tokens", "~4.2k tokens"; undefined while nothing has streamed yet. */
export function formatTranscriptStreamTokens(chars: number): string | undefined {
    return formatTranscriptTokenCount(Math.round(chars / STREAM_STATUS_CHARS_PER_TOKEN));
}

type ThinkingPhaseSegment = Readonly<{ readonly type: string; readonly content?: string; readonly finished?: boolean }>;

/**
 * Cursor-style thinking phase: streaming turn with no tool calls or answer text yet.
 * Once tools or text appear, the thought brief switches to a settled duration label.
 */
export function isTranscriptAgentThinkingPhase(
    segments: readonly ThinkingPhaseSegment[],
    streaming: boolean,
): boolean {
    if (!streaming) {
        return false;
    }
    if (segments.some(segment => segment.type === 'text' && (segment.content?.trim() ?? '').length > 0)) {
        return false;
    }
    if (segments.some(segment => segment.type === 'tool')) {
        return false;
    }
    return true;
}

/** Cursor-style trace phases for progressive disclosure in the transcript. */
export type TranscriptTraceDisplayPhase = 'thinking' | 'acting' | 'writing' | 'settled';

/** Short agent preambles ("I'll…") before tools run are not treated as the answer phase. */
export const TRANSCRIPT_TEXT_PREAMBLE_MAX_CHARS = 40;

export function resolveTranscriptAgentTextChars(segments: readonly ThinkingPhaseSegment[]): number {
    let total = 0;
    for (const segment of segments) {
        if (segment.type === 'text') {
            total += segment.content?.trim().length ?? 0;
        }
    }
    return total;
}

export function isTranscriptShortTextPreamble(segments: readonly ThinkingPhaseSegment[]): boolean {
    const chars = resolveTranscriptAgentTextChars(segments);
    if (chars <= 0 || chars >= TRANSCRIPT_TEXT_PREAMBLE_MAX_CHARS) {
        return false;
    }
    return !segments.some(segment => segment.type === 'tool');
}

export function hasActiveTranscriptToolSegment(
    segments: readonly ThinkingPhaseSegment[],
    pendingToolUseIds?: ReadonlySet<string>,
): boolean {
    if (pendingToolUseIds && pendingToolUseIds.size > 0) {
        return true;
    }
    return segments.some(segment =>
        segment.type === 'tool'
        && !(segment as { readonly finished?: boolean }).finished);
}

export function resolveTranscriptTraceDisplayPhase(
    segments: readonly ThinkingPhaseSegment[],
    streaming: boolean,
): TranscriptTraceDisplayPhase {
    if (hasActiveTranscriptToolSegment(segments)) {
        return 'acting';
    }
    if (!streaming) {
        return 'settled';
    }
    if (isTranscriptAgentThinkingPhase(segments, streaming)) {
        return 'thinking';
    }
    if (isTranscriptShortTextPreamble(segments)) {
        return 'acting';
    }
    if (segments.some(segment => segment.type === 'text' && (segment.content?.trim() ?? '').length > 0)) {
        return 'writing';
    }
    return 'acting';
}

/** @deprecated Bootstrap lifecycle rows removed — keep false so callers skip filler chrome. */
export function shouldShowTranscriptStreamingBootstrapTimeline(
    _segments: readonly ThinkingPhaseSegment[],
    _streaming: boolean,
): boolean {
    return false;
}

/** Show the inline timeline whenever there is visible activity — including
 *  the thinking phase, so the user sees the model's reasoning as a step in
 *  the timeline with its icon. Falls back to the thought brief only when
 *  there is no thinking content yet (e.g. empty streaming turn). */
export function shouldShowTranscriptInlineTimeline(
    segments: readonly ThinkingPhaseSegment[],
    streaming: boolean,
): boolean {
    if (shouldShowTranscriptStreamingBootstrapTimeline(segments, streaming)) {
        return true;
    }
    const phase = resolveTranscriptTraceDisplayPhase(segments, streaming);
    if (phase === 'thinking') {
        return resolveTranscriptThinkingChars(segments) > 0;
    }
    return true;
}

/** Expanded checklist while tools run or model thinks; collapsed once settled (Cursor keeps summary visible). */
export function shouldExpandTranscriptInlineTimeline(
    segments: readonly ThinkingPhaseSegment[],
    streaming: boolean,
): boolean {
    if (shouldShowTranscriptStreamingBootstrapTimeline(segments, streaming)) {
        return true;
    }
    const phase = resolveTranscriptTraceDisplayPhase(segments, streaming);
    if (phase === 'thinking') {
        return resolveTranscriptThinkingChars(segments) > 0;
    }
    return phase === 'acting';
}

/** Short duration label for thought headers — Cursor uses seconds for brief thinks. */
export function formatTranscriptThoughtDuration(elapsedMs: number): string {
    const totalSeconds = Math.max(1, Math.round(elapsedMs / 1000));
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }
    return formatTranscriptStreamElapsed(elapsedMs);
}

/** Cursor switches from "Planning next moves" to this after ~20s without visible progress. */
export const TRANSCRIPT_STREAM_STALL_MS = 20_000;

/** Hard timeout when no liveness signals for this long (see qaap-transcript-stream-health). */
export const TRANSCRIPT_STREAM_TIMEOUT_MS = 60_000;

/** Hide "Thinking for…" / planning chrome until the turn has been thinking-only this long. */
export const TRANSCRIPT_THINKING_UI_GRACE_MS = 2_000;

/** Turns with at most this much internal reasoning and no tools are treated as simple Q&A. */
export const TRANSCRIPT_SIMPLE_THINKING_MAX_CHARS = 160;

/** User prompts longer than this are never classified as simple Q&A. */
export const TRANSCRIPT_SIMPLE_USER_PROMPT_MAX_CHARS = 220;

export function resolveTranscriptTurnElapsedMs(
    turnStartMs: number | undefined,
    now = Date.now(),
): number | undefined {
    if (turnStartMs === undefined) {
        return undefined;
    }
    return Math.max(0, now - turnStartMs);
}

export function resolveLastUserPromptChars(
    messages: readonly StreamStatusMessage[],
): number | undefined {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (message.role === 'user') {
            const length = message.content?.trim().length ?? 0;
            return length > 0 ? length : undefined;
        }
    }
    return undefined;
}

function resolveTranscriptThinkingChars(segments: readonly ThinkingPhaseSegment[]): number {
    let total = 0;
    for (const segment of segments) {
        if (segment.type === 'thinking') {
            total += segment.content?.trim().length ?? 0;
        }
    }
    return total;
}

/**
 * Cursor-style simple turn: direct answer, no tools, little or no visible reasoning.
 * These turns skip thought briefs and planning chrome so "¿Qué hace X?" feels instant.
 */
export function isTranscriptSimpleQaTurn(
    segments: readonly ThinkingPhaseSegment[],
    options?: { readonly userPromptChars?: number },
): boolean {
    if (segments.some(segment => segment.type === 'tool')) {
        return false;
    }
    if (!segments.some(segment => segment.type === 'text' && (segment.content?.trim() ?? '').length > 0)) {
        return false;
    }
    if (resolveTranscriptThinkingChars(segments) > TRANSCRIPT_SIMPLE_THINKING_MAX_CHARS) {
        return false;
    }
    const userChars = options?.userPromptChars;
    if (userChars !== undefined && userChars > TRANSCRIPT_SIMPLE_USER_PROMPT_MAX_CHARS) {
        return false;
    }
    return true;
}

/** True while a streaming turn is still in the thinking-only grace window. */
export function isTranscriptThinkingGracePeriod(
    segments: readonly ThinkingPhaseSegment[],
    streaming: boolean,
    turnElapsedMs: number | undefined,
): boolean {
    if (!isTranscriptAgentThinkingPhase(segments, streaming)) {
        return false;
    }
    if (turnElapsedMs === undefined) {
        return true;
    }
    return turnElapsedMs < TRANSCRIPT_THINKING_UI_GRACE_MS;
}

/** Whether the thought brief block should render for this turn. */
export function shouldShowTranscriptThoughtBrief(
    segments: readonly ThinkingPhaseSegment[],
    streaming: boolean,
    options?: {
        readonly turnElapsedMs?: number;
        readonly userPromptChars?: number;
        readonly hasActivityStats?: boolean;
        readonly thinkingContent?: string;
    },
): boolean {
    if (!streaming) {
        if (isTranscriptSimpleQaTurn(segments, { userPromptChars: options?.userPromptChars })) {
            return false;
        }
        if (options?.hasActivityStats) {
            return true;
        }
        const thinkingLength = options?.thinkingContent?.trim().length
            ?? resolveTranscriptThinkingChars(segments);
        return thinkingLength > TRANSCRIPT_SIMPLE_THINKING_MAX_CHARS;
    }
    if (isTranscriptThinkingGracePeriod(segments, streaming, options?.turnElapsedMs)) {
        return false;
    }
    if (isTranscriptAgentThinkingPhase(segments, streaming)) {
        return true;
    }
    if (options?.hasActivityStats) {
        return true;
    }
    const thinkingLength = options?.thinkingContent?.trim().length
        ?? resolveTranscriptThinkingChars(segments);
    return thinkingLength > 0;
}

/** Whether transcript footer / composer should show planning or writing chrome. */
export function isAwaitingFirstTranscriptAgentOutput(
    conv: Pick<QaapAgentConversationDTO, 'messages'>,
): boolean {
    const last = conv.messages.at(-1);
    return !last || last.role === 'user';
}

export function shouldShowTranscriptStreamingActivity(
    segments: readonly ThinkingPhaseSegment[],
    streaming: boolean,
    options?: {
        readonly turnElapsedMs?: number;
        readonly userPromptChars?: number;
        readonly stalled?: boolean;
        readonly awaitingFirstAgentOutput?: boolean;
    },
): boolean {
    if (!streaming) {
        return false;
    }
    if (options?.stalled) {
        return true;
    }
    if (options?.awaitingFirstAgentOutput) {
        return true;
    }
    const hasActiveTool = segments.some(segment =>
        segment.type === 'tool'
        && !(segment as { readonly finished?: boolean }).finished);
    if (hasActiveTool) {
        return true;
    }
    if (isTranscriptSimpleQaTurn(segments, { userPromptChars: options?.userPromptChars })
        && segments.some(segment => segment.type === 'text' && (segment.content?.trim() ?? '').length > 0)) {
        return false;
    }
    if (isTranscriptThinkingGracePeriod(segments, streaming, options?.turnElapsedMs)) {
        return false;
    }
    return true;
}

export function isTranscriptStreamStalled(
    lastProgressAtMs: number | undefined,
    streaming: boolean,
    now = Date.now(),
): boolean {
    if (!streaming || lastProgressAtMs === undefined) {
        return false;
    }
    return now - lastProgressAtMs >= TRANSCRIPT_STREAM_STALL_MS;
}

/** @deprecated Prefer resolveTranscriptStreamHealth for timeout cause and active-tool budgets. */
export function isTranscriptStreamTimedOut(
    lastProgressAtMs: number | undefined,
    streaming: boolean,
    now = Date.now(),
): boolean {
    if (!streaming || lastProgressAtMs === undefined) {
        return false;
    }
    return now - lastProgressAtMs >= TRANSCRIPT_STREAM_TIMEOUT_MS;
}

/** True when the composer should use the lightweight idle chrome instead of the premium border beam. */
export function isTranscriptComposerVisualIdle(
    segments: readonly ThinkingPhaseSegment[],
    streaming: boolean,
    lastProgressAtMs: number | undefined,
    now = Date.now(),
): boolean {
    if (!streaming) {
        return false;
    }
    if (isTranscriptStreamStalled(lastProgressAtMs, streaming, now)
        || isTranscriptStreamTimedOut(lastProgressAtMs, streaming, now)) {
        return true;
    }
    const hasActiveTool = segments.some(segment =>
        segment.type === 'tool' && !segment.finished);
    if (hasActiveTool) {
        return false;
    }
    return !segments.some(segment =>
        segment.type === 'text' && (segment.content?.trim().length ?? 0) > 0);
}

export function shouldTranscriptStreamLabelShimmer(kind: string, stalled: boolean, timedOut = false): boolean {
    if (stalled || timedOut) {
        return false;
    }
    return kind !== 'planning' && kind !== 'thinking' && kind !== 'stall' && kind !== 'timeout';
}
