// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    clearTranscriptUserScrollIntent,
    markTranscriptUserScrollIntent,
    transcriptHasRecentUserScrollIntent,
} from './qaap-transcript-scroll-intent';

describe('qaap-transcript-scroll-intent', () => {
    let attrs: Map<string, string>;
    let scroller: HTMLElement;

    beforeEach(() => {
        attrs = new Map<string, string>();
        scroller = ({
            setAttribute: (name: string, value: string) => attrs.set(name, value),
            getAttribute: (name: string) => attrs.get(name) ?? null,
            removeAttribute: (name: string) => { attrs.delete(name); },
        } as unknown) as HTMLElement;
    });

    it('pauses auto-follow for recent explicit user intent', () => {
        markTranscriptUserScrollIntent(scroller, 'wheel', 1_000);

        expect(transcriptHasRecentUserScrollIntent(scroller, 1_500)).to.equal(true);
    });

    it('does not pause auto-follow for stale intent', () => {
        markTranscriptUserScrollIntent(scroller, 'wheel', 1_000);

        expect(transcriptHasRecentUserScrollIntent(scroller, 3_000)).to.equal(false);
    });

    it('clears intent when the user explicitly jumps to latest', () => {
        markTranscriptUserScrollIntent(scroller, 'selection');

        clearTranscriptUserScrollIntent(scroller);

        expect(transcriptHasRecentUserScrollIntent(scroller)).to.equal(false);
    });
});
