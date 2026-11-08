// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { createStickyComposerSendIcon } from './mobile-projects-sticky-composer-send-icon';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

describe('sticky-composer-send-icon', () => {

    useSuiteJSDOM();

    it('renders the Lucide arrow-up glyph, not the paper plane', () => {
        const host = createStickyComposerSendIcon();
        expect(host.classList.contains('theia-mobile-projects-sticky-composer-send-icon')).to.equal(true);
        const paths = Array.from(host.querySelectorAll('svg > path')).map(path => path.getAttribute('d'));
        expect(paths).to.deep.equal(['m5 12 7-7 7 7', 'M12 19V5']);
        expect(host.querySelector('.theia-mobile-projects-sticky-composer-send-plane')).to.equal(null);
        expect(host.querySelector('svg')?.getAttribute('stroke-width')).to.equal('2');
        expect(host.getAttribute('aria-hidden')).to.equal('true');
    });
});
