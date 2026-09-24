// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import {
    STICKY_COMPOSER_SEND_FLY_CLASS,
    createStickyComposerSendIcon,
    playStickyComposerSendFly,
} from './mobile-projects-sticky-composer-send-icon';

describe('sticky-composer-send-icon', () => {
    it('renders a Lucide-style send plane with a transform group', () => {
        const host = createStickyComposerSendIcon();
        expect(host.classList.contains('theia-mobile-projects-sticky-composer-send-icon')).to.equal(true);
        const plane = host.querySelector('.theia-mobile-projects-sticky-composer-send-plane');
        expect(plane).to.not.equal(null);
        expect(plane?.querySelectorAll('path').length).to.equal(2);
        expect(host.getAttribute('aria-hidden')).to.equal('true');
    });

    it('plays the send-fly class on the icon host inside the send button', () => {
        const button = document.createElement('button');
        button.className = 'theia-mobile-projects-sticky-composer-send';
        button.append(createStickyComposerSendIcon());
        const host = button.querySelector('.theia-mobile-projects-sticky-composer-send-icon') as HTMLElement;
        expect(host.classList.contains(STICKY_COMPOSER_SEND_FLY_CLASS)).to.equal(false);

        playStickyComposerSendFly(button);
        expect(host.classList.contains(STICKY_COMPOSER_SEND_FLY_CLASS)).to.equal(true);

        host.classList.remove(STICKY_COMPOSER_SEND_FLY_CLASS);
        playStickyComposerSendFly(button);
        expect(host.classList.contains(STICKY_COMPOSER_SEND_FLY_CLASS)).to.equal(true);
    });

    it('does not play send-fly when prefers-reduced-motion is enabled', () => {
        const matchMedia = window.matchMedia;
        window.matchMedia = ((query: string) => ({
            matches: query.includes('prefers-reduced-motion'),
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        })) as typeof window.matchMedia;
        try {
            const host = createStickyComposerSendIcon();
            playStickyComposerSendFly(host);
            expect(host.classList.contains(STICKY_COMPOSER_SEND_FLY_CLASS)).to.equal(false);
        } finally {
            window.matchMedia = matchMedia;
        }
    });
});
