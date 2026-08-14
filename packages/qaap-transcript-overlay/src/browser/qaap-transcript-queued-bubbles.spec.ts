// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    buildTranscriptQueuedBubblesFingerprint,
    syncTranscriptQueuedBubbles,
    TRANSCRIPT_QUEUED_BUBBLES_CLASS,
} from './qaap-transcript-queued-bubbles';

describe('qaap-transcript-queued-bubbles', () => {

    before(() => {
        // Not torn down on purpose: sibling suites enable JSDOM at module scope, so restoring
        // the globals here would strip the document from whichever spec file runs next.
        enableJSDOM();
    });

    function createChatHost(options: { liveStatus?: boolean } = {}): HTMLElement {
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        const scroller = document.createElement('div');
        scroller.className = 'theia-mobile-agent-transcript';
        const message = document.createElement('div');
        message.className = 'theia-mobile-agent-transcript-msg theia-mod-agent';
        scroller.append(message);
        if (options.liveStatus) {
            const live = document.createElement('div');
            live.className = 'theia-mobile-agent-live-status';
            scroller.append(live);
        }
        chatHost.append(scroller);
        document.body.append(chatHost);
        return chatHost;
    }

    function queuedTexts(chatHost: HTMLElement): string[] {
        return Array.from(chatHost.querySelectorAll(
            `.${TRANSCRIPT_QUEUED_BUBBLES_CLASS} .theia-mobile-agent-transcript-content`,
        )).map(node => node.textContent ?? '');
    }

    it('never paints queued bubbles in the transcript (the composer queue list is the single source of truth)', () => {
        const chatHost = createChatHost();
        syncTranscriptQueuedBubbles(chatHost, [{ draft: 'first' }, { draft: 'second' }]);

        expect(queuedTexts(chatHost)).to.deep.equal([]);
        expect(chatHost.querySelector(`.${TRANSCRIPT_QUEUED_BUBBLES_CLASS}`)).to.equal(null);
    });

    it('removes any stale queued-bubble container left from a previous render', () => {
        const chatHost = createChatHost();
        const scroller = chatHost.querySelector('.theia-mobile-agent-transcript') as HTMLElement;
        const stale = document.createElement('div');
        stale.className = TRANSCRIPT_QUEUED_BUBBLES_CLASS;
        const bubble = document.createElement('div');
        bubble.className = 'theia-mobile-agent-transcript-msg theia-mod-user theia-mod-queued';
        const content = document.createElement('div');
        content.className = 'theia-mobile-agent-transcript-content';
        content.textContent = 'stale';
        bubble.append(content);
        stale.append(bubble);
        scroller.append(stale);
        expect(chatHost.querySelector(`.${TRANSCRIPT_QUEUED_BUBBLES_CLASS}`)).to.exist;

        syncTranscriptQueuedBubbles(chatHost, [{ draft: 'first' }]);
        expect(chatHost.querySelector(`.${TRANSCRIPT_QUEUED_BUBBLES_CLASS}`)).to.equal(null);
    });

    it('returns undefined and is a no-op for an empty queue', () => {
        const chatHost = createChatHost();
        expect(syncTranscriptQueuedBubbles(chatHost, [])).to.equal(undefined);
        expect(chatHost.querySelector(`.${TRANSCRIPT_QUEUED_BUBBLES_CLASS}`)).to.equal(null);
    });

    it('accepts the inline execution wrapper the Agents Hub shell passes as chat host', () => {
        const chatHost = createChatHost();
        const inlineWrapper = document.createElement('div');
        inlineWrapper.className = 'theia-mobile-agents-hub-inline-transcript';
        document.body.append(inlineWrapper);
        inlineWrapper.append(chatHost);

        const scroller = chatHost.querySelector('.theia-mobile-agent-transcript') as HTMLElement;
        const stale = document.createElement('div');
        stale.className = TRANSCRIPT_QUEUED_BUBBLES_CLASS;
        scroller.append(stale);

        syncTranscriptQueuedBubbles(inlineWrapper, [{ draft: 'first' }]);
        expect(inlineWrapper.querySelector(`.${TRANSCRIPT_QUEUED_BUBBLES_CLASS}`)).to.equal(null);
    });

    it('is a no-op for a detached host or a host without a transcript scroller', () => {
        const detached = document.createElement('div');
        expect(syncTranscriptQueuedBubbles(detached, [{ draft: 'first' }])).to.equal(undefined);

        const bare = document.createElement('div');
        document.body.append(bare);
        expect(syncTranscriptQueuedBubbles(bare, [{ draft: 'first' }])).to.equal(undefined);
    });

    it('buildTranscriptQueuedBubblesFingerprint is a stable empty string (no longer keyed by drafts)', () => {
        expect(buildTranscriptQueuedBubblesFingerprint([{ draft: 'first' }])).to.equal('');
        expect(buildTranscriptQueuedBubblesFingerprint([{ draft: 'first' }, { draft: 'second' }]))
            .to.equal(buildTranscriptQueuedBubblesFingerprint([{ draft: 'first' }]));
    });
});
