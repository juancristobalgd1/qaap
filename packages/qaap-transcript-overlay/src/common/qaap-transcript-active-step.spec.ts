// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isElementVisibleInScroller,
    resolveTranscriptScrollFabMode,
    shouldShowTranscriptScrollFab,
} from './qaap-transcript-active-step';
import { shouldShowTranscriptScrollToBottomState } from './qaap-transcript-scroll-to-bottom';

function mockRect(top: number, height: number): DOMRect {
    return {
        x: 0,
        y: top,
        width: 320,
        height,
        top,
        left: 0,
        right: 320,
        bottom: top + height,
        toJSON: () => ({}),
    } as DOMRect;
}

function mockStreamingScroller(activeTop: number): HTMLElement {
    const active = {
        getBoundingClientRect: () => mockRect(activeTop, 40),
    } as HTMLElement;
    const row = {
        querySelector: (selector: string) => selector.includes('active') ? active : null,
    } as HTMLElement;
    return {
        querySelector: (selector: string) => selector.includes('streaming') ? row : null,
        getBoundingClientRect: () => mockRect(0, 200),
        scrollTop: 0,
        scrollHeight: 800,
        clientHeight: 200,
    } as unknown as HTMLElement;
}

describe('qaap-transcript-active-step', () => {

    it('detects when the active step is outside the scroller viewport', () => {
        const marker = {
            getBoundingClientRect: () => mockRect(900, 40),
        } as HTMLElement;
        const scroller = {
            getBoundingClientRect: () => mockRect(0, 200),
        } as HTMLElement;
        expect(isElementVisibleInScroller(marker, scroller)).to.equal(false);
    });

    it('prefers active-step mode when the live marker is off-screen during streaming', () => {
        const scroller = mockStreamingScroller(900);
        expect(resolveTranscriptScrollFabMode(scroller)).to.equal('active-step');
    });

    it('shows the scroll fab while the active step is off-screen', () => {
        const scroller = mockStreamingScroller(900);
        const state = {
            emptyChat: false,
            hasConversationMessages: true,
            scrollTop: 0,
            clientHeight: 200,
            scrollHeight: 800,
        };
        const showBottom = shouldShowTranscriptScrollToBottomState(state);
        expect(shouldShowTranscriptScrollFab(state, showBottom, scroller)).to.equal(true);
    });
});
