// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export type TranscriptScrollPhase = 'idle' | 'following' | 'detached' | 'restoring' | 'positioning-turn';

export type TranscriptScrollIntentEvent =
    | { readonly type: 'conversation-open' }
    | { readonly type: 'restore-start' }
    | { readonly type: 'restore-done' }
    | { readonly type: 'position-turn-start' }
    | { readonly type: 'position-turn-done' }
    | { readonly type: 'user-detach'; readonly reason?: string }
    | { readonly type: 'user-return-to-live-edge' }
    | { readonly type: 'jump-to-latest' }
    | { readonly type: 'streaming-start' }
    | { readonly type: 'streaming-end' }
    | { readonly type: 'programmatic-near-bottom' };

export type TranscriptViewportMutationKind = 'follow-tail' | 'position-turn' | 'restore' | 'preserve-anchor';

export function reduceTranscriptScrollPhase(
    phase: TranscriptScrollPhase,
    event: TranscriptScrollIntentEvent,
): TranscriptScrollPhase {
    switch (event.type) {
        case 'conversation-open':
            return 'idle';
        case 'restore-start':
            return 'restoring';
        case 'restore-done':
            return 'detached';
        case 'position-turn-start':
            return 'positioning-turn';
        case 'position-turn-done':
            // Pin the new turn for reading, then stay put. Streaming content may
            // grow off-screen; follow resumes only via Jump to latest / live edge.
            return 'detached';
        case 'user-detach':
            return 'detached';
        case 'user-return-to-live-edge':
            return phase === 'detached' || phase === 'idle' ? 'following' : phase;
        case 'jump-to-latest':
            return 'following';
        case 'streaming-start':
        case 'streaming-end':
        case 'programmatic-near-bottom':
            return phase;
        default:
            return phase;
    }
}

export function transcriptScrollPhaseAllowsAutoFollow(phase: TranscriptScrollPhase): boolean {
    return phase === 'following';
}

export function transcriptScrollPhaseAllowsViewportMutation(
    phase: TranscriptScrollPhase,
    kind: TranscriptViewportMutationKind,
): boolean {
    switch (kind) {
        case 'follow-tail':
            return phase === 'following';
        case 'position-turn':
            return phase === 'positioning-turn';
        case 'restore':
            return phase === 'restoring';
        case 'preserve-anchor':
            return phase === 'idle' || phase === 'detached' || phase === 'restoring';
        default:
            return false;
    }
}
