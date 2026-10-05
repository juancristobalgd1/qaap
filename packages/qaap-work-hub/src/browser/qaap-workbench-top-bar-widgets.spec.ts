// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { QAAP_MOBILE_DEVICE_MEDIA_QUERY } from '@theia/qaap-mobile-shell/lib/common/qaap-mobile-device';
import type { CommandRegistry } from '@theia/core/lib/common';
import type { WorkspaceService } from '@theia/workspace/lib/browser';
import {
    clearPreferDesktopIde,
    markPreferDesktopIde,
} from '@theia/qaap-shared-core/lib/common/qaap-mobile-work-surface-preference';

// Import the browser module under JSDOM, outside Mocha's 2 second before-hook timeout.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const widgets = require('./qaap-workbench-top-bar-widgets') as typeof import('./qaap-workbench-top-bar-widgets');
const shouldShowMobileIdeHeaderViews = widgets.shouldShowMobileIdeHeaderViews;
const shouldShowDesktopIdeModeSwitch = widgets.shouldShowDesktopIdeModeSwitch;
const QaapWorkbenchHistoryNavWidget = widgets.QaapWorkbenchHistoryNavWidget;

disableImportJSDOM();

describe('qaap-workbench-top-bar-widgets', () => {

    let disableJSDOM: (() => void) | undefined;
    let originalMatchMedia: typeof window.matchMedia;
    const globalWithSessionStorage = global as unknown as { sessionStorage?: Storage };
    let originalSessionStorage: Storage | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
        originalMatchMedia = window.matchMedia;
        originalSessionStorage = globalWithSessionStorage.sessionStorage;
        globalWithSessionStorage.sessionStorage = window.sessionStorage;
    });

    beforeEach(() => {
        window.matchMedia = (query: string): MediaQueryList => ({
            matches: query === QAAP_MOBILE_DEVICE_MEDIA_QUERY,
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
        globalWithSessionStorage.sessionStorage = originalSessionStorage;
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
            matches: query === QAAP_MOBILE_DEVICE_MEDIA_QUERY,
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
        const commands = {
            onDidExecuteCommand: Event.None,
            onCommandsChanged: Event.None,
            isEnabled: () => false,
            executeCommand: async () => undefined,
        } as unknown as CommandRegistry;
        const workspaceService = {
            onWorkspaceChanged: Event.None,
            onWorkspaceLocationChanged: Event.None,
        };
        const widget = new QaapWorkbenchHistoryNavWidget(commands, workspaceService as unknown as WorkspaceService);
        expect(widget.node.querySelector('.theia-workbench-projects-return-nav-btn')).to.equal(null);
        expect(widget.node.querySelector('.theia-workbench-dashboard-nav-btn')).to.equal(null);
        expect(widget.node.querySelectorAll('.theia-workbench-history-nav-btn')).to.have.length(2);
        widget.dispose();
    });
});
