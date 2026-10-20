// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

let disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { QaapFrameCheckResult } from '../common/qaap-frame-check';
import { QaapPreviewBlockedFrameGuard } from './qaap-preview-blocked-frame-guard';

disableJSDOM();

const IDE = 'https://ide.qaap.dev';
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe('QaapPreviewBlockedFrameGuard', () => {

    let slot: HTMLElement;
    let frame: HTMLIFrameElement;
    let opened: string[];

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    beforeEach(() => {
        slot = document.createElement('div');
        frame = document.createElement('iframe');
        // jsdom has no `HTMLIFrameElement.sandbox`; a class list is the same DOMTokenList API.
        Object.defineProperty(frame, 'sandbox', { value: document.createElement('span').classList });
        frame.sandbox.add('allow-scripts', 'allow-same-origin');
        slot.append(frame);
        document.body.append(slot);
        opened = [];
    });

    afterEach(() => {
        slot.remove();
    });

    function createGuard(check: (url: string) => Promise<QaapFrameCheckResult | undefined>, timeoutMs = 10_000): QaapPreviewBlockedFrameGuard {
        return new QaapPreviewBlockedFrameGuard({
            frame,
            ideOrigin: IDE,
            openExternal: url => opened.push(url),
            checkFrame: check,
            timeoutMs,
        });
    }

    const card = (): HTMLElement | null => slot.querySelector('.qaap-preview-blocked-frame');

    it('shows the open-in-new-tab card when the preflight says the site refuses framing', async () => {
        const guard = createGuard(async () => ({ embeddable: false, reason: 'X-Frame-Options: deny' }));
        guard.arm('https://claude.ai/');
        await flush();
        expect(card()).to.not.equal(null);
        expect(card()!.textContent).to.contain('claude.ai');
        expect(guard.blockedUrl).to.equal('https://claude.ai/');
        card()!.querySelector('button')!.click();
        expect(opened).to.deep.equal(['https://claude.ai/']);
        guard.dispose();
    });

    it('keeps the card even though the browser fires load for its refused-to-connect page', async () => {
        const guard = createGuard(async () => ({ embeddable: false }));
        guard.arm('https://claude.ai/');
        await flush();
        frame.dispatchEvent(new frame.ownerDocument.defaultView!.Event('load'));
        expect(card()).to.not.equal(null);
        guard.dispose();
    });

    it('shows nothing for embeddable sites', async () => {
        const guard = createGuard(async () => ({ embeddable: true }));
        guard.arm('https://example.com/');
        frame.dispatchEvent(new frame.ownerDocument.defaultView!.Event('load'));
        await flush();
        expect(card()).to.equal(null);
        guard.dispose();
    });

    it('never checks same-origin previews and removes the external sandbox tokens', async () => {
        let checks = 0;
        const guard = createGuard(async () => {
            checks++;
            return { embeddable: false };
        });
        guard.arm('https://example.com/');
        expect(frame.sandbox.contains('allow-downloads')).to.equal(true);
        guard.arm(`${IDE}/qaap-dev/5173/`);
        await flush();
        expect(checks).to.equal(1);
        expect(card()).to.equal(null);
        expect(frame.sandbox.contains('allow-downloads')).to.equal(false);
        guard.dispose();
    });

    it('never lets an external frame or its popups navigate the Qaap tab (tab-nabbing)', () => {
        frame.sandbox.add('allow-popups', 'allow-popups-to-escape-sandbox', 'allow-top-navigation', 'allow-top-navigation-by-user-activation');
        const guard = createGuard(async () => ({ embeddable: true }));
        guard.arm('https://example.com/');
        expect(frame.sandbox.contains('allow-popups')).to.equal(true);
        expect(frame.sandbox.contains('allow-popups-to-escape-sandbox')).to.equal(false);
        expect(frame.sandbox.contains('allow-top-navigation')).to.equal(false);
        expect(frame.sandbox.contains('allow-top-navigation-by-user-activation')).to.equal(false);
        guard.dispose();
    });

    it('treats isolated Qaap preview hosts as internal: no preflight, no extra sandbox, no timeout card', async () => {
        let checks = 0;
        const guard = createGuard(async () => {
            checks++;
            return { embeddable: false };
        }, 5);
        guard.arm('https://0123456789abcdef0123456789abcdef.preview.qaap.dev/');
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(checks).to.equal(0);
        expect(card()).to.equal(null);
        expect(guard.blockedUrl).to.equal(undefined);
        expect(frame.sandbox.contains('allow-downloads')).to.equal(false);
        guard.dispose();
    });

    it('keeps the load timeout when the preflight could not answer', async () => {
        const guard = createGuard(async () => ({ embeddable: true, unknown: true }), 5);
        guard.arm('https://claude.ai/');
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(card()).to.not.equal(null);
        guard.dispose();
    });

    it('cancels the load timeout once the preflight confirms the site is embeddable', async () => {
        const guard = createGuard(async () => ({ embeddable: true }), 5);
        guard.arm('https://slow.example/');
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(card()).to.equal(null);
        guard.dispose();
    });

    it('shows the insecure-page card for http:// sites inside an https:// Qaap without a preflight', async () => {
        let checks = 0;
        const guard = createGuard(async () => {
            checks++;
            return { embeddable: true };
        });
        guard.arm('http://neverssl.com/');
        await flush();
        expect(checks).to.equal(0);
        expect(card()).to.not.equal(null);
        expect(card()!.textContent).to.contain('neverssl.com');
        guard.dispose();
    });

    it('ignores a stale preflight after the user navigated elsewhere', async () => {
        let resolveFirst: (result: QaapFrameCheckResult) => void = () => undefined;
        const guard = createGuard(url => url.includes('claude')
            ? new Promise(resolve => { resolveFirst = resolve; })
            : Promise.resolve({ embeddable: true }));
        guard.arm('https://claude.ai/');
        guard.arm('https://example.com/');
        resolveFirst({ embeddable: false });
        await flush();
        expect(card()).to.equal(null);
        guard.dispose();
    });

    it('falls back to the load timeout when the preflight is unavailable, and a late load hides the card', async () => {
        const guard = createGuard(async () => undefined, 5);
        guard.arm('https://slow.example/');
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(card()).to.not.equal(null);
        frame.dispatchEvent(new frame.ownerDocument.defaultView!.Event('load'));
        expect(card()).to.equal(null);
        guard.dispose();
    });
});
