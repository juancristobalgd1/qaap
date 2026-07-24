// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    clearLegacyTranscriptStreamFooterHost,
    createTranscriptLiveStatusElement,
    ensureTranscriptLiveStatusAtScrollerTail,
    ensureTranscriptStreamFooterHost,
    formatTranscriptLiveStatusMeta,
    formatTranscriptLiveStatusText,
    removeNestedTranscriptLiveStatusCopies,
    resolveTranscriptLiveStatusTokenCount,
    syncTranscriptLiveStatusElement,
    TRANSCRIPT_LIVE_STATUS_CLASS,
    TRANSCRIPT_LIVE_STATUS_LOGO_CLASS,
    TRANSCRIPT_STREAM_FOOTER_HOST_CLASS,
} from './qaap-transcript-live-status';
import { QAAP_BRAND_LOGO_INDICATOR_CLASS } from './qaap-agent-setup-phrases';

describe('qaap-transcript-live-status', () => {
    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    it('formats Claude-style live status text', () => {
        expect(formatTranscriptLiveStatusText({
            elapsedMs: 13_000,
            streamChars: 256,
            activityTitle: 'Planning next moves',
        })).to.equal('Planning next moves… · 13s · ~64 tokens');
    });

    it('puts token count beside elapsed time, preferring provider usage', () => {
        expect(formatTranscriptLiveStatusMeta({
            elapsedMs: 83_000,
            streamChars: 0,
            tokenCount: 1_250,
            activityTitle: 'Planning next moves',
        })).to.equal('1m 23s · ~1.3k tokens');
        expect(formatTranscriptLiveStatusMeta({
            elapsedMs: 12_000,
            streamChars: 0,
            tokenCount: 0,
            activityTitle: 'Planning next moves',
        })).to.equal('12s · ~0 tokens');
        expect(resolveTranscriptLiveStatusTokenCount({
            streamChars: 400,
            contextUsage: { inputTokens: 10_000, outputTokens: 420 },
        })).to.equal(420);
        expect(resolveTranscriptLiveStatusTokenCount({ streamChars: 400 })).to.equal(100);
    });

    it('createTranscriptLiveStatusElement renders logo, activity, and meta (no chevron)', () => {
        const el = createTranscriptLiveStatusElement();
        expect(el.classList.contains(TRANSCRIPT_LIVE_STATUS_CLASS)).to.equal(true);
        expect(el.querySelector(`.${QAAP_BRAND_LOGO_INDICATOR_CLASS}.${TRANSCRIPT_LIVE_STATUS_LOGO_CLASS}`)).to.not.equal(null);
        expect(el.querySelector('.qaap-transcript-live-status-activity')).to.not.equal(null);
        expect(el.querySelector('.qaap-transcript-live-status-meta')).to.not.equal(null);
        expect(el.querySelector('.qaap-transcript-live-status-chevron')).to.equal(null);
        const children = [...el.children].map(child => child.className);
        expect(children).to.have.length(3);
        expect(children[0]).to.contain(TRANSCRIPT_LIVE_STATUS_LOGO_CLASS);
        expect(children[1]).to.contain('qaap-transcript-live-status-activity');
        expect(children[2]).to.equal('qaap-transcript-live-status-meta');
    });

    it('removeNestedTranscriptLiveStatusCopies keeps the scroller-tail canonical node', () => {
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        const scroller = document.createElement('div');
        scroller.className = 'theia-mobile-agent-transcript';
        chatHost.append(scroller);
        const row = document.createElement('div');
        row.className = 'theia-mobile-agent-transcript-msg';
        const nested = createTranscriptLiveStatusElement();
        row.append(nested);
        scroller.append(row);
        const tail = createTranscriptLiveStatusElement();
        scroller.append(tail);

        removeNestedTranscriptLiveStatusCopies(chatHost);

        expect(row.querySelector(`.${TRANSCRIPT_LIVE_STATUS_CLASS}`)).to.equal(null);
        expect(scroller.lastElementChild).to.equal(tail);
    });

    it('ensureTranscriptLiveStatusAtScrollerTail keeps the node last after new messages', () => {
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        const scroller = document.createElement('div');
        scroller.className = 'theia-mobile-agent-transcript';
        chatHost.append(scroller);
        const live = createTranscriptLiveStatusElement();
        ensureTranscriptLiveStatusAtScrollerTail(chatHost, live);
        expect(scroller.lastElementChild).to.equal(live);
        const msg = document.createElement('div');
        msg.className = 'theia-mobile-agent-transcript-msg';
        scroller.append(msg);
        expect(scroller.lastElementChild).to.equal(msg);
        ensureTranscriptLiveStatusAtScrollerTail(chatHost, live);
        expect(scroller.lastElementChild).to.equal(live);
        expect([...scroller.children]).to.deep.equal([msg, live]);
    });

    it('ensureTranscriptStreamFooterHost stays a sibling under the chat host', () => {
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        const list = document.createElement('div');
        list.className = 'theia-mobile-agent-transcript';
        chatHost.append(list);
        const footer = ensureTranscriptStreamFooterHost(chatHost);
        expect(footer.classList.contains(TRANSCRIPT_STREAM_FOOTER_HOST_CLASS)).to.equal(true);
        expect(footer.previousElementSibling).to.equal(list);
        expect(ensureTranscriptStreamFooterHost(chatHost)).to.equal(footer);
        footer.hidden = false;
        footer.append(createTranscriptLiveStatusElement());
        clearLegacyTranscriptStreamFooterHost(chatHost);
        expect(footer.hidden).to.equal(true);
        expect(footer.querySelector(`.${TRANSCRIPT_LIVE_STATUS_CLASS}`)).to.equal(null);
    });

    it('accepts a custom working indicator factory', () => {
        const el = createTranscriptLiveStatusElement({
            createIndicator: () => {
                const host = document.createElement('span');
                host.className = 'qaap-thinking-orb-indicator';
                return host;
            },
        });
        expect(el.querySelector(`.qaap-thinking-orb-indicator.${TRANSCRIPT_LIVE_STATUS_LOGO_CLASS}`)).to.not.equal(null);
        expect(el.querySelector(`.${QAAP_BRAND_LOGO_INDICATOR_CLASS}`)).to.equal(null);
    });

    it('syncTranscriptLiveStatusElement updates text and stall class', () => {
        const el = createTranscriptLiveStatusElement();
        syncTranscriptLiveStatusElement(el, {
            elapsedMs: 83_000,
            streamChars: 16_800,
            activityTitle: 'Reading files',
            stalled: true,
        });
        expect(el.querySelector('.qaap-transcript-live-status-meta')?.textContent)
            .to.equal('1m 23s · ~4.2k tokens');
        const activity = el.querySelector<HTMLElement>('.qaap-transcript-live-status-activity');
        expect(activity?.getAttribute('aria-label')).to.equal('Reading files…');
        expect(activity?.querySelectorAll('.qaap-agent-setup-letter').length).to.be.greaterThan(0);
        expect(el.classList.contains('theia-mod-stalled')).to.equal(true);
    });
});
