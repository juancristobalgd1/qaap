// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    TRANSCRIPT_ACTIVITY_ACTIVE_ATTR,
    TRANSCRIPT_ACTIVITY_TIMELINE_ATTR,
} from './qaap-transcript-incremental-update';

export { TRANSCRIPT_ACTIVITY_ACTIVE_ATTR };

export type TranscriptScrollFabMode = 'bottom' | 'active-step';

export function findTranscriptStreamingAgentRow(root: ParentNode): HTMLElement | null {
    return root.querySelector('.theia-mobile-agent-transcript-msg.theia-mod-agent.theia-mod-streaming');
}

export function findTranscriptActiveActivityStep(root: ParentNode): HTMLElement | null {
    return root.querySelector(`[${TRANSCRIPT_ACTIVITY_ACTIVE_ATTR}="true"]`);
}

export function isElementVisibleInScroller(
    element: HTMLElement,
    scroller: HTMLElement,
    marginPx = 24,
): boolean {
    const scrollerRect = scroller.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return rect.top >= scrollerRect.top - marginPx
        && rect.bottom <= scrollerRect.bottom + marginPx;
}

export function resolveTranscriptActiveStepScrollTarget(streamingRow: HTMLElement): HTMLElement {
    const timeline = streamingRow.querySelector<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`);
    if (timeline instanceof HTMLDetailsElement) {
        timeline.open = true;
    }
    return findTranscriptActiveActivityStep(streamingRow)
        ?? timeline
        ?? streamingRow;
}

export function resolveTranscriptScrollFabMode(
    scroller: HTMLElement,
    nearBottomThresholdPx?: number,
): TranscriptScrollFabMode {
    const streamingRow = findTranscriptStreamingAgentRow(scroller);
    if (!streamingRow) {
        return 'bottom';
    }
    const activeStep = findTranscriptActiveActivityStep(streamingRow);
    if (!activeStep) {
        return 'bottom';
    }
    // Only offer "Back to current step" when the active step sits BELOW the viewport — i.e. the
    // reader scrolled up, away from where the agent is working. When the active step is above the
    // viewport the reader is already past it, watching the live tail grow below; scrolling them
    // back UP to a timeline header at the top of a tall streaming message is disorienting, so the
    // correct action there is "Jump to latest" (bottom). Keeps the timeline-agent case intact.
    const scrollerRect = scroller.getBoundingClientRect();
    const stepRect = activeStep.getBoundingClientRect();
    const stepBelowViewport = stepRect.top > scrollerRect.bottom;
    const stepAboveViewport = stepRect.bottom < scrollerRect.top;
    if (stepBelowViewport) {
        return 'active-step';
    }
    if (stepAboveViewport) {
        return 'bottom';
    }
    if (nearBottomThresholdPx !== undefined) {
        const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
        if (distance > nearBottomThresholdPx) {
            return 'active-step';
        }
    }
    return 'bottom';
}

export function shouldShowTranscriptScrollFab(
    state: {
        readonly scrollTop: number;
        readonly clientHeight: number;
        readonly scrollHeight: number;
        readonly emptyChat: boolean;
        readonly hasConversationMessages: boolean;
        readonly nearBottomThresholdPx?: number;
    },
    shouldShowBottom: boolean,
    scroller: HTMLElement,
): boolean {
    if (shouldShowBottom) {
        return true;
    }
    if (state.emptyChat || !state.hasConversationMessages) {
        return false;
    }
    return resolveTranscriptScrollFabMode(scroller, state.nearBottomThresholdPx) === 'active-step';
}
