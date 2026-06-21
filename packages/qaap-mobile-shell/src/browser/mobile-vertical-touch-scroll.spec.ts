// *****************************************************************************
// Copyright (C) 2026 theia-ide and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'chai';
import {
    isMobileScrollCompositorExcluded,
    MOBILE_SCROLL_COMPOSITOR_EXCLUDED_SELECTORS,
    MOBILE_SCROLL_GPU_COMPOSITOR_CLASS,
    MOBILE_VERTICAL_SCROLL_SELECTORS,
} from './mobile-vertical-touch-scroll';

/** Overlay scroll hosts added with product UI — must stay registered in touch-scroll CSS. */
const OVERLAY_SCROLL_HOSTS = [
    '.theia-mobile-work-hub-sessions-sidebar-scroll',
    '.theia-mobile-sticky-composer-sheet-list',
    '.theia-qaap-approval-policy-sheet-list',
    '.qaap-project-bootstrap-picker',
] as const;

describe('mobile-vertical-touch-scroll', () => {

    it('registers overlay scroll hosts for MutationObserver patching', () => {
        for (const selector of OVERLAY_SCROLL_HOSTS) {
            expect(MOBILE_VERTICAL_SCROLL_SELECTORS).to.include(selector);
        }
    });

    it('lists the same overlay scroll hosts in qaap-mobile-touch-scroll.css', () => {
        const cssPath = path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-mobile-touch-scroll.css');
        const css = fs.readFileSync(cssPath, 'utf8');
        for (const selector of OVERLAY_SCROLL_HOSTS) {
            expect(css, `missing ${selector} in qaap-mobile-touch-scroll.css`).to.include(selector);
        }
    });

    it('registers GPU compositor scroll isolation in qaap-mobile-touch-scroll.css', () => {
        const cssPath = path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-mobile-touch-scroll.css');
        const css = fs.readFileSync(cssPath, 'utf8');
        expect(css).to.include('contain: layout style paint');
        expect(css).to.include(`.${MOBILE_SCROLL_GPU_COMPOSITOR_CLASS}:not(.theia-mobile-projects-scroll)`);
        expect(css).to.include('translate3d(0, 0, 0)');
    });

    it('excludes Work Hub projects scroll from compositor promotion', () => {
        expect(MOBILE_SCROLL_COMPOSITOR_EXCLUDED_SELECTORS).to.include('.theia-mobile-projects-scroll');
    });

    it('does not treat transcript real-chat as the scroll host (inner list scrolls)', () => {
        expect(MOBILE_VERTICAL_SCROLL_SELECTORS).to.not.include(
            '.theia-mobile-agents-hub-inline-transcript .theia-mobile-agent-transcript-real-chat',
        );
    });

    it('isMobileScrollCompositorExcluded guards Work Hub projects scroll', () => {
        const projectsScroll = {
            matches: (selector: string) => selector === '.theia-mobile-projects-scroll',
        } as unknown as HTMLElement;
        const transcript = { matches: () => false } as unknown as HTMLElement;
        expect(isMobileScrollCompositorExcluded(projectsScroll)).to.equal(true);
        expect(isMobileScrollCompositorExcluded(transcript)).to.equal(false);
    });
});
