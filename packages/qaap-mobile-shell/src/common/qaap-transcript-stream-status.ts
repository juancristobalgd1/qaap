// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentMessageDTO } from './qaap-agent-conversation-client';
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
    readonly segments?: ReadonlyArray<{ readonly type: string; readonly content?: string }>;
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

/** Characters produced by the in-flight agent turn (text + thinking segments, or raw content). */
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

/** "~870 tokens", "~4.2k tokens"; undefined while nothing has streamed yet. */
export function formatTranscriptStreamTokens(chars: number): string | undefined {
    const tokens = Math.round(chars / STREAM_STATUS_CHARS_PER_TOKEN);
    if (tokens <= 0) {
        return undefined;
    }
    if (tokens < 1000) {
        return `~${tokens} tokens`;
    }
    const thousands = tokens / 1000;
    const rounded = thousands >= 10 ? Math.round(thousands).toString() : (Math.round(thousands * 10) / 10).toFixed(1);
    return `~${rounded}k tokens`;
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

/** True while the turn is streaming but no tool or substantive answer has arrived yet. */
export function shouldShowTranscriptStreamingBootstrapTimeline(
    segments: readonly ThinkingPhaseSegment[],
    streaming: boolean,
): boolean {
    if (!streaming) {
        return false;
    }
    if (segments.some(segment => segment.type === 'tool')) {
        return false;
    }
    if (hasActiveTranscriptToolSegment(segments)) {
        return false;
    }
    const textChars = resolveTranscriptAgentTextChars(segments);
    if (textChars > 0 && !isTranscriptShortTextPreamble(segments)) {
        return false;
    }
    return true;
}

/** Show bootstrap lifecycle steps during thinking-only streaming; otherwise hide redundant thinking chrome. */
export function shouldShowTranscriptInlineTimeline(
    segments: readonly ThinkingPhaseSegment[],
    streaming: boolean,
): boolean {
    if (shouldShowTranscriptStreamingBootstrapTimeline(segments, streaming)) {
        return true;
    }
    return resolveTranscriptTraceDisplayPhase(segments, streaming) !== 'thinking';
}

/** Expanded checklist while tools run; collapsed once settled (Cursor keeps summary visible). */
export function shouldExpandTranscriptInlineTimeline(
    segments: readonly ThinkingPhaseSegment[],
    streaming: boolean,
): boolean {
    if (shouldShowTranscriptStreamingBootstrapTimeline(segments, streaming)) {
        return true;
    }
    return resolveTranscriptTraceDisplayPhase(segments, streaming) === 'acting';
}

/** Short duration label for thought headers — Cursor uses seconds for brief thinks. */
export function formatTranscriptThoughtDuration(elapsedMs: number): string {
    const totalSeconds = Math.max(1, Math.round(elapsedMs / 1000));
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }
    return formatTranscriptStreamElapsed(elapsedMs);
}

/** Cursor switches from "Planning next moves" to this after ~15s without visible progress. */
export const TRANSCRIPT_STREAM_STALL_MS = 15_000;

/** Hard timeout when no semantic progress (tools / answer text) for this long. */
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
export function shouldShowTranscriptStreamingActivity(
    segments: readonly ThinkingPhaseSegment[],
    streaming: boolean,
    options?: {
        readonly turnElapsedMs?: number;
        readonly userPromptChars?: number;
        readonly stalled?: boolean;
    },
): boolean {
    if (!streaming) {
        return false;
    }
    if (options?.stalled) {
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
