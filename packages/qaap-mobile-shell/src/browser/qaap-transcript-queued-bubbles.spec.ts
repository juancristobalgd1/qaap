// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
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

    it('paints a user bubble per queued follow-up at the transcript tail', () => {
        const chatHost = createChatHost();
        syncTranscriptQueuedBubbles(chatHost, [{ draft: 'first' }, { draft: 'second' }]);

        expect(queuedTexts(chatHost)).to.deep.equal(['first', 'second']);
        const bubbles = chatHost.querySelectorAll('.theia-mobile-agent-transcript-msg.theia-mod-user.theia-mod-queued');
        expect(bubbles).to.have.length(2);
        const scroller = chatHost.querySelector('.theia-mobile-agent-transcript');
        expect(scroller?.lastElementChild?.className).to.equal(TRANSCRIPT_QUEUED_BUBBLES_CLASS);
        const queue = chatHost.querySelector(`.${TRANSCRIPT_QUEUED_BUBBLES_CLASS}`);
        expect(queue?.getAttribute('role')).to.equal('log');
        expect(queue?.getAttribute('aria-live')).to.equal('polite');
        expect(queue?.getAttribute('aria-relevant')).to.equal('additions text');
    });

    it('stays above the live-status row instead of fighting it for the last slot', () => {
        const chatHost = createChatHost({ liveStatus: true });
        const container = syncTranscriptQueuedBubbles(chatHost, [{ draft: 'first' }]);

        expect(container?.nextElementSibling?.className).to.equal('theia-mobile-agent-live-status');
        // Live-status re-claims the tail every tick; a second sync must not move anything.
        const scroller = chatHost.querySelector('.theia-mobile-agent-transcript') as HTMLElement;
        const before = Array.from(scroller.children);
        syncTranscriptQueuedBubbles(chatHost, [{ draft: 'first' }]);
        expect(Array.from(scroller.children)).to.deep.equal(before);
    });

    it('reuses the container while the queue is unchanged and repaints when it changes', () => {
        const chatHost = createChatHost();
        const first = syncTranscriptQueuedBubbles(chatHost, [{ draft: 'first' }]);
        const firstBubble = first?.firstElementChild;

        expect(syncTranscriptQueuedBubbles(chatHost, [{ draft: 'first' }])).to.equal(first);
        expect(first?.firstElementChild).to.equal(firstBubble);

        expect(buildTranscriptQueuedBubblesFingerprint([{ draft: 'first' }]))
            .to.not.equal(buildTranscriptQueuedBubblesFingerprint([{ draft: 'edited' }]));
        syncTranscriptQueuedBubbles(chatHost, [{ draft: 'edited' }]);
        expect(queuedTexts(chatHost)).to.deep.equal(['edited']);
    });

    it('removes the bubbles once the queue drains into the turn', () => {
        const chatHost = createChatHost();
        syncTranscriptQueuedBubbles(chatHost, [{ draft: 'first' }]);
        syncTranscriptQueuedBubbles(chatHost, []);

        expect(chatHost.querySelector(`.${TRANSCRIPT_QUEUED_BUBBLES_CLASS}`)).to.equal(null);
    });

    it('re-mounts after a full transcript rebuild wiped the scroller', () => {
        const chatHost = createChatHost();
        syncTranscriptQueuedBubbles(chatHost, [{ draft: 'first' }]);
        const scroller = chatHost.querySelector('.theia-mobile-agent-transcript') as HTMLElement;
        scroller.replaceChildren();

        syncTranscriptQueuedBubbles(chatHost, [{ draft: 'first' }]);
        expect(queuedTexts(chatHost)).to.deep.equal(['first']);
    });

    it('accepts the inline execution wrapper the Agents Hub shell passes as chat host', () => {
        const chatHost = createChatHost();
        const inlineWrapper = document.createElement('div');
        inlineWrapper.className = 'theia-mobile-agents-hub-inline-transcript';
        document.body.append(inlineWrapper);
        inlineWrapper.append(chatHost);

        syncTranscriptQueuedBubbles(inlineWrapper, [{ draft: 'first' }]);
        expect(queuedTexts(inlineWrapper)).to.deep.equal(['first']);
    });

    it('is a no-op for a detached host or a host without a transcript scroller', () => {
        const detached = document.createElement('div');
        expect(syncTranscriptQueuedBubbles(detached, [{ draft: 'first' }])).to.equal(undefined);

        const bare = document.createElement('div');
        document.body.append(bare);
        expect(syncTranscriptQueuedBubbles(bare, [{ draft: 'first' }])).to.equal(undefined);
    });
});
