// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import {
    clearPreferDesktopIde,
    markPreferDesktopIde,
} from '@theia/qaap-shared-core/lib/common/qaap-mobile-work-surface-preference';

disableImportJSDOM();

describe('qaap-workbench-top-bar-widgets', () => {

    let disableJSDOM: (() => void) | undefined;
    let originalMatchMedia: typeof window.matchMedia;
    let mobileOneColumnLayoutMediaQuery: string;
    let shouldShowMobileIdeHeaderViews: typeof import('./qaap-workbench-top-bar-widgets').shouldShowMobileIdeHeaderViews;
    let shouldShowDesktopIdeModeSwitch: typeof import('./qaap-workbench-top-bar-widgets').shouldShowDesktopIdeModeSwitch;

    before(() => {
        disableJSDOM = enableJSDOM();
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        mobileOneColumnLayoutMediaQuery = require('@theia/core/lib/browser/shell/mobile-layout-state').MOBILE_ONE_COLUMN_LAYOUT_MEDIA_QUERY;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const widgets = require('./qaap-workbench-top-bar-widgets') as typeof import('./qaap-workbench-top-bar-widgets');
        shouldShowMobileIdeHeaderViews = widgets.shouldShowMobileIdeHeaderViews;
        shouldShowDesktopIdeModeSwitch = widgets.shouldShowDesktopIdeModeSwitch;
        originalMatchMedia = window.matchMedia;
    });

    beforeEach(() => {
        window.matchMedia = (query: string): MediaQueryList => ({
            matches: query === mobileOneColumnLayoutMediaQuery,
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        } as MediaQueryList);
        clearPreferDesktopIde();
    });

    after(() => {
        clearPreferDesktopIde();
        window.matchMedia = originalMatchMedia;
        disableJSDOM?.();
    });

    it('allows mobile header views on the Work Hub surface', () => {
        expect(shouldShowMobileIdeHeaderViews()).to.equal(true);
    });

    it('ignores a stale IDE preference and keeps the mobile Work Hub header views available', () => {
        window.sessionStorage.setItem('qaap.mobileProjects.preferDesktopIde', '1');
        expect(shouldShowMobileIdeHeaderViews()).to.equal(true);
        expect(window.sessionStorage.getItem('qaap.mobileProjects.preferDesktopIde')).to.equal(null);
    });

    it('clears the stale IDE body marker and restores Work Hub views after a narrow resize', () => {
        document.body.classList.add('theia-mobile-mod-desktop-ide');
        expect(shouldShowMobileIdeHeaderViews()).to.equal(true);
        expect(document.body.classList.contains('theia-mobile-mod-desktop-ide')).to.equal(false);
    });

    it('keeps the IDE/Work Hub switch hidden on mobile and available in the desktop IDE', () => {
        window.matchMedia = (query: string): MediaQueryList => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        } as MediaQueryList);
        expect(shouldShowDesktopIdeModeSwitch()).to.equal(false);

        markPreferDesktopIde();
        expect(shouldShowDesktopIdeModeSwitch()).to.equal(true);

        window.matchMedia = (query: string): MediaQueryList => ({
            matches: query === mobileOneColumnLayoutMediaQuery,
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        } as MediaQueryList);
        expect(shouldShowDesktopIdeModeSwitch()).to.equal(false);
    });

    it('does not mount a Back to Work Hub button in the IDE history nav', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Event } = require('@theia/core/lib/common');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { QaapWorkbenchHistoryNavWidget } = require('./qaap-workbench-top-bar-widgets');
        const commands = {
            onDidExecuteCommand: Event.None,
            onCommandsChanged: Event.None,
            isEnabled: () => false,
            executeCommand: async () => undefined,
        };
        const workspaceService = {
            onWorkspaceChanged: Event.None,
            onWorkspaceLocationChanged: Event.None,
        };
        const widget = new QaapWorkbenchHistoryNavWidget(commands, workspaceService);
        expect(widget.node.querySelector('.theia-workbench-projects-return-nav-btn')).to.equal(null);
        expect(widget.node.querySelector('.theia-workbench-dashboard-nav-btn')).to.equal(null);
        expect(widget.node.querySelectorAll('.theia-workbench-history-nav-btn')).to.have.length(2);
        widget.dispose();
    });
});
