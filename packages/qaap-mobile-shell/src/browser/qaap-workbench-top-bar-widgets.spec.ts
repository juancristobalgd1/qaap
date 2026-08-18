// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    clearPreferDesktopIde,
    markPreferDesktopIde,
} from '../common/qaap-mobile-work-surface-preference';

describe('qaap-workbench-top-bar-widgets', () => {

    let disableJSDOM: (() => void) | undefined;
    let originalMatchMedia: typeof window.matchMedia;
    let mobileOneColumnLayoutMediaQuery: string;
    let shouldShowMobileIdeHeaderViews: typeof import('./qaap-workbench-top-bar-widgets').shouldShowMobileIdeHeaderViews;

    before(() => {
        disableJSDOM = enableJSDOM();
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        mobileOneColumnLayoutMediaQuery = require('@theia/core/lib/browser/shell/mobile-layout-state').MOBILE_ONE_COLUMN_LAYOUT_MEDIA_QUERY;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        shouldShowMobileIdeHeaderViews = require('./qaap-workbench-top-bar-widgets').shouldShowMobileIdeHeaderViews;
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

    it('hides mobile header views when the classic IDE is active', () => {
        markPreferDesktopIde();
        expect(shouldShowMobileIdeHeaderViews()).to.equal(false);
    });

    it('keeps mobile header views hidden when the IDE body marker survives a narrow resize', () => {
        document.body.classList.add('theia-mobile-mod-desktop-ide');
        expect(shouldShowMobileIdeHeaderViews()).to.equal(false);
        document.body.classList.remove('theia-mobile-mod-desktop-ide');
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
