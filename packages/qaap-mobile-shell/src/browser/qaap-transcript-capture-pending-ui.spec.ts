// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { parseHTML } from 'linkedom';
import {
    buildQaapVisualVerificationMarkdown,
    QAAP_VISUAL_VERIFICATION_MARKER,
} from '../common/qaap-visual-verification';
import {
    buildTranscriptCapturePendingChip,
    enhanceTranscriptCaptureDirectives,
    TRANSCRIPT_CAPTURE_PENDING_CHIP_CLASS,
} from './qaap-transcript-capture-pending-ui';
import {
    enhanceTranscriptMarkdownRichContent,
    TRANSCRIPT_MARKDOWN_TABLE_SCROLL_CLASS,
} from './qaap-transcript-rich-content-ui';

describe('qaap-transcript-capture-pending-ui', () => {
    const { document } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    let previousDocument: Document | undefined;

    before(() => {
        previousDocument = globalThis.document;
        (globalThis as typeof globalThis & { document: Document }).document = document as unknown as Document;
    });

    after(() => {
        if (previousDocument) {
            (globalThis as typeof globalThis & { document: Document }).document = previousDocument;
        }
    });

    function createMessageRow(contentHtml: string): { row: HTMLElement; host: HTMLElement } {
        const row = document.createElement('div');
        row.className = 'theia-mobile-agent-transcript-msg theia-mod-agent';
        const host = document.createElement('div');
        host.className = 'theia-mobile-agent-transcript-content theia-mod-markdown';
        host.innerHTML = contentHtml;
        row.append(host);
        document.body.append(row);
        return { row, host };
    }

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('builds image and video pending chips with route badges', () => {
        const imageChip = buildTranscriptCapturePendingChip('image', ['/']);
        expect(imageChip.classList.contains('theia-mod-image')).to.equal(true);
        expect(imageChip.querySelector('.theia-mobile-agent-transcript-capture-pending-routes')?.textContent).to.equal('/');

        const videoChip = buildTranscriptCapturePendingChip('video', ['/', '/checkout']);
        expect(videoChip.classList.contains('theia-mod-video')).to.equal(true);
        expect(videoChip.querySelector('.theia-mobile-agent-transcript-capture-pending-label')?.textContent)
            .to.contain('Processing video');
    });

    it('inserts a skeleton chip below a capture directive paragraph while evidence is pending', () => {
        const { host } = createMessageRow('<p>Listo.</p><p>[QAAP capture: /]</p>');
        expect(enhanceTranscriptCaptureDirectives(host)).to.equal(1);

        const chip = host.querySelector(`.${TRANSCRIPT_CAPTURE_PENDING_CHIP_CLASS}`);
        expect(chip).to.not.equal(null);
        expect(chip?.classList.contains('theia-mod-image')).to.equal(true);
        expect(host.querySelector('p.theia-mobile-agent-transcript-capture-directive')?.textContent)
            .to.contain('[QAAP capture: /]');
        expect(host.querySelector('p.theia-mobile-agent-transcript-capture-directive')?.nextElementSibling)
            .to.equal(chip);
    });

    it('uses the video variant for `[QAAP record]` directives', () => {
        const { host } = createMessageRow('<p>[QAAP record: / /checkout]</p>');
        enhanceTranscriptCaptureDirectives(host);
        const chip = host.querySelector(`.${TRANSCRIPT_CAPTURE_PENDING_CHIP_CLASS}`);
        expect(chip?.classList.contains('theia-mod-video')).to.equal(true);
        expect(chip?.querySelector('.theia-mobile-agent-transcript-capture-pending-routes')?.textContent)
            .to.equal('/ /checkout');
    });

    it('removes pending chips once visual verification evidence arrives in the message row', () => {
        const { row, host } = createMessageRow('<p>[QAAP capture: /]</p>');
        enhanceTranscriptCaptureDirectives(host);
        expect(row.querySelector(`.${TRANSCRIPT_CAPTURE_PENDING_CHIP_CLASS}`)).to.not.equal(null);

        const evidenceHost = document.createElement('div');
        evidenceHost.className = 'theia-mobile-agent-transcript-content theia-mod-markdown';
        evidenceHost.innerHTML = buildQaapVisualVerificationMarkdown('/qaap/api/agent-conversations/c1/visual-verifications/evidence-1', {
            status: 'passed',
            summary: 'Looks good.',
            issues: [],
        }).replace(/\n/g, '<br>');
        row.append(evidenceHost);

        expect(enhanceTranscriptCaptureDirectives(host)).to.equal(0);
        expect(row.querySelector(`.${TRANSCRIPT_CAPTURE_PENDING_CHIP_CLASS}`)).to.equal(null);
        expect(evidenceHost.textContent).to.contain(QAAP_VISUAL_VERIFICATION_MARKER);
    });

    it('removes the skeleton for resolved image or video media in any row child', () => {
        const { row, host } = createMessageRow('<p>[QAAP record: /]</p>');
        enhanceTranscriptCaptureDirectives(host);
        expect(row.querySelector(`.${TRANSCRIPT_CAPTURE_PENDING_CHIP_CLASS}`)).to.not.equal(null);

        const mediaHost = document.createElement('div');
        const image = document.createElement('img');
        image.src = '/qaap/api/agent-conversations/c1/visual-verifications/image-1';
        const video = document.createElement('video');
        video.className = 'qaap-transcript-video-evidence';
        mediaHost.append(image, video);
        row.append(mediaHost);

        expect(enhanceTranscriptCaptureDirectives(mediaHost)).to.equal(0);
        expect(row.querySelector(`.${TRANSCRIPT_CAPTURE_PENDING_CHIP_CLASS}`)).to.equal(null);
    });

    it('reconciles a detached row after its evidence block is assembled', () => {
        const row = document.createElement('div');
        row.className = 'theia-mobile-agent-transcript-msg theia-mod-agent';
        const directiveHost = document.createElement('div');
        directiveHost.className = 'theia-mobile-agent-transcript-content theia-mod-markdown';
        directiveHost.innerHTML = '<p>[QAAP capture: /]</p>';

        // Simulate synchronous fallback rendering while the content host is detached.
        expect(enhanceTranscriptCaptureDirectives(directiveHost)).to.equal(1);

        const evidenceHost = document.createElement('div');
        evidenceHost.className = 'theia-mobile-agent-transcript-content theia-mod-markdown';
        const image = document.createElement('img');
        image.src = '/qaap/api/agent-conversations/c1/visual-verifications/image-2';
        evidenceHost.append(image);
        row.append(directiveHost, evidenceHost);

        // This is the row-builder reconciliation after all detached blocks are mounted.
        expect(enhanceTranscriptCaptureDirectives(directiveHost)).to.equal(0);
        expect(row.querySelector(`.${TRANSCRIPT_CAPTURE_PENDING_CHIP_CLASS}`)).to.equal(null);
    });

    it('hooks into markdown rich-content enhancement for rendered closing narrative', () => {
        const { row, host } = createMessageRow('<p>Done.</p><p>[QAAP capture: /]</p>');
        enhanceTranscriptMarkdownRichContent(host);
        expect(row.querySelector(`.${TRANSCRIPT_CAPTURE_PENDING_CHIP_CLASS}`)).to.not.equal(null);
    });

    it('wraps rendered Markdown tables in a bounded horizontal scroller', () => {
        const { host } = createMessageRow('<table><thead><tr><th>File</th></tr></thead><tbody><tr><td>index.ts</td></tr></tbody></table>');

        enhanceTranscriptMarkdownRichContent(host);

        const scroll = host.querySelector(`.${TRANSCRIPT_MARKDOWN_TABLE_SCROLL_CLASS}`);
        expect(scroll?.querySelector('table')).to.not.equal(null);
        expect(host.querySelectorAll(`.${TRANSCRIPT_MARKDOWN_TABLE_SCROLL_CLASS}`).length).to.equal(1);

        enhanceTranscriptMarkdownRichContent(host);
        expect(host.querySelectorAll(`.${TRANSCRIPT_MARKDOWN_TABLE_SCROLL_CLASS}`).length).to.equal(1);
    });
});
