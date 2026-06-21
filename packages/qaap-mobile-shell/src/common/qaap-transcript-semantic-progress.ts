// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationDTO } from './qaap-agent-conversation-client';
import { resolveAgentMessageSegments } from './qaap-transcript-trace-model';

export type TranscriptSemanticProgressSegment = Readonly<{
    readonly type: string;
    readonly content?: string;
    readonly finished?: boolean;
    readonly result?: string;
}>;

/** Fingerprint of stream liveness — tools, answer text, thinking, and in-flight tool output. */
export function buildTranscriptSemanticProgressKey(
    segments: readonly TranscriptSemanticProgressSegment[],
): string {
    let toolCount = 0;
    let finishedToolCount = 0;
    let textChars = 0;
    let thinkingChars = 0;
    let activeToolResultChars = 0;
    for (const segment of segments) {
        if (segment.type === 'tool') {
            toolCount += 1;
            if (segment.finished) {
                finishedToolCount += 1;
            } else {
                activeToolResultChars += segment.result?.length ?? 0;
            }
        } else if (segment.type === 'text') {
            textChars += segment.content?.trim().length ?? 0;
        } else if (segment.type === 'thinking') {
            thinkingChars += segment.content?.trim().length ?? 0;
        }
    }
    return `${toolCount}:${finishedToolCount}:${textChars}:${thinkingChars}:${activeToolResultChars}`;
}

export interface TranscriptSemanticProgressClock {
    readonly at: number | undefined;
    readonly key: string | undefined;
}

/** Advance the stall/timeout clock when tools, answer text, thinking, or tool output change. */
export function advanceTranscriptSemanticProgressClock(
    segments: readonly TranscriptSemanticProgressSegment[],
    state: TranscriptSemanticProgressClock,
    now = Date.now(),
): { readonly at: number; readonly key: string } {
    const key = buildTranscriptSemanticProgressKey(segments);
    if (state.key === undefined) {
        return { at: state.at ?? now, key };
    }
    if (key !== state.key) {
        return { at: now, key };
    }
    return { at: state.at ?? now, key };
}

export function resolveTranscriptStreamingAgentSegments(
    conv: QaapAgentConversationDTO,
): readonly TranscriptSemanticProgressSegment[] {
    const lastAgent = [...conv.messages].reverse().find(message => message.role === 'agent');
    if (!lastAgent) {
        return [];
    }
    return resolveAgentMessageSegments(lastAgent);
}

export function seedTranscriptSemanticProgressClock(now = Date.now()): { readonly at: number; readonly key: string } {
    return {
        at: now,
        key: buildTranscriptSemanticProgressKey([]),
    };
}
