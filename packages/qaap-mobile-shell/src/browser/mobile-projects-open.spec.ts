// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    clearPreferAgentsSurface,
    clearPreferDesktopIde,
    installMobileWorkHubBootGuard,
    markMobileProjectsHomeVisible,
    markMobileProjectsPanelDismiss,
    markPreferAgentsSurface,
    markPreferDesktopIde,
    recomputeMobileWorkHubHideIdeSidePanels,
    setMobileWorkHubComposerHeaderChrome,
    setMobileWorkHubSideSheetOpen,
    shouldBootstrapMobileAgentsChat,
    shouldPreferWorkHubAgentsLayout,
} from '../browser/mobile-projects-open';
import {
    QAAP_HUB_PENDING_ACTION_KEY,
    readMobileShellLandingBootSnapshot,
    resolveInitialLandingBodyClass,
    shouldMarkLandingLeftFromStorage,
} from '../browser/mobile-shell-landing-state';

describe('mobile-projects-open work hub bootstrap', () => {

    const storage = new Map<string, string>();

    before(() => {
        enableJSDOM();
    });

    beforeEach(() => {
        storage.clear();
        document.body.className = '';
        document.documentElement.className = '';
        const sessionStorage = {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => { storage.set(key, value); },
            removeItem: (key: string) => { storage.delete(key); },
            clear: () => { storage.clear(); },
            key: () => null,
            length: 0,
        };
        (global as unknown as { sessionStorage: Storage }).sessionStorage = sessionStorage as Storage;
        Object.defineProperty(window, 'sessionStorage', { value: sessionStorage, configurable: true });
        clearPreferDesktopIde();
        clearPreferAgentsSurface();
        window.location.hash = '#/Users/jc/.qaap/workspaces/demo/Mockup';
    });

    it('bootstraps agents chat for workspace routes even without persisted agents preference', () => {
        expect(shouldBootstrapMobileAgentsChat()).to.equal(true);
        expect(shouldPreferWorkHubAgentsLayout()).to.equal(false);
    });

    it('does not bootstrap agents chat for workspace routes when desktop IDE is active in runtime', () => {
        markPreferDesktopIde();
        expect(shouldBootstrapMobileAgentsChat()).to.equal(false);
        expect(shouldPreferWorkHubAgentsLayout()).to.equal(false);
    });

    it('does not bootstrap agents chat after reload when desktop IDE preference is persisted', () => {
        storage.set('qaap.mobileProjects.preferDesktopIde', '1');
        storage.set('qaap.mobileProjects.explicitDesktopIde', '1');
        expect(shouldBootstrapMobileAgentsChat()).to.equal(false);
    });

    it('bootstraps agents chat for workspace routes even when homeVisible is stale in sessionStorage', () => {
        markMobileProjectsHomeVisible();
        expect(shouldBootstrapMobileAgentsChat()).to.equal(true);
    });

    it('prefers agents surface persistence when no workspace route is targeted', () => {
        window.location.hash = '';
        markPreferAgentsSurface();
        expect(shouldBootstrapMobileAgentsChat()).to.equal(true);
        expect(shouldPreferWorkHubAgentsLayout()).to.equal(true);
    });

    it('keeps the home landing when homeVisible is set without a workspace route', () => {
        window.location.hash = '';
        markMobileProjectsHomeVisible();
        expect(shouldBootstrapMobileAgentsChat()).to.equal(false);
    });

    it('installs the Work Hub boot guard on desktop viewports by default', () => {
        installMobileWorkHubBootGuard();
        expect(document.documentElement.classList.contains('theia-mobile-workhub-boot')).to.equal(true);
    });

    it('does not install the Work Hub boot guard when desktop IDE is active', () => {
        markPreferDesktopIde();
        installMobileWorkHubBootGuard();
        expect(document.documentElement.classList.contains('theia-mobile-workhub-boot')).to.equal(false);
    });

});

describe('work hub hide-ide-side-panels invariant', () => {

    const HIDE_CLASS = 'theia-mobile-mod-workhub-hide-ide-side-panels';
    const storage = new Map<string, string>();

    before(() => {
        enableJSDOM();
    });

    beforeEach(() => {
        storage.clear();
        document.body.className = '';
        const sessionStorage = {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => { storage.set(key, value); },
            removeItem: (key: string) => { storage.delete(key); },
            clear: () => { storage.clear(); },
            key: () => null,
            length: 0,
        };
        (global as unknown as { sessionStorage: Storage }).sessionStorage = sessionStorage as Storage;
        Object.defineProperty(window, 'sessionStorage', { value: sessionStorage, configurable: true });
        clearPreferDesktopIde();
        setMobileWorkHubSideSheetOpen(false);
        document.body.className = '';
    });

    const hasHideClass = (): boolean => document.body.classList.contains(HIDE_CLASS);

    it('hides restored IDE side panels on EVERY Work Hub surface, not only composer/transcript', () => {
        // The landing/tasks-home surface removes the composer chrome; the panels must still be hidden.
        setMobileWorkHubComposerHeaderChrome(false);
        expect(hasHideClass()).to.equal(true);
        setMobileWorkHubComposerHeaderChrome(true);
        expect(hasHideClass()).to.equal(true);
    });

    it('reveals the panels only while a side sheet is explicitly open', () => {
        recomputeMobileWorkHubHideIdeSidePanels();
        expect(hasHideClass()).to.equal(true);
        setMobileWorkHubSideSheetOpen(true);
        expect(hasHideClass()).to.equal(false);
        setMobileWorkHubSideSheetOpen(false);
        expect(hasHideClass()).to.equal(true);
    });

    it('never hides when the classic IDE is open (desktop-ide)', () => {
        markPreferDesktopIde();
        setMobileWorkHubComposerHeaderChrome(false);
        expect(hasHideClass()).to.equal(false);
        recomputeMobileWorkHubHideIdeSidePanels();
        expect(hasHideClass()).to.equal(false);
    });

});

describe('mobile-shell-landing-state', () => {

    const storage = new Map<string, string>();

    before(() => {
        enableJSDOM();
    });

    beforeEach(() => {
        storage.clear();
        document.body.className = '';
        const sessionStorage = {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => { storage.set(key, value); },
            removeItem: (key: string) => { storage.delete(key); },
            clear: () => { storage.clear(); },
            key: () => null,
            length: 0,
        };
        (global as unknown as { sessionStorage: Storage }).sessionStorage = sessionStorage as Storage;
        Object.defineProperty(window, 'sessionStorage', { value: sessionStorage, configurable: true });
        clearPreferDesktopIde();
        clearPreferAgentsSurface();
        window.location.hash = '#/Users/jc/.qaap/workspaces/demo/Mockup';
    });

    it('marks landing left when dismissPanel survives reload', () => {
        markMobileProjectsPanelDismiss();
        expect(shouldMarkLandingLeftFromStorage()).to.equal(true);
    });

    it('marks landing left for workspace routes even without dismiss flag', () => {
        expect(shouldMarkLandingLeftFromStorage()).to.equal(true);
    });

    it('does not mark landing left for homeVisible without workspace route', () => {
        window.location.hash = '';
        markMobileProjectsHomeVisible();
        expect(shouldMarkLandingLeftFromStorage()).to.equal(false);
    });

    it('resolves agents chrome for workspace routes on mobile mq', () => {
        expect(resolveInitialLandingBodyClass(true)).to.equal('agents');
    });

    it('resolves landing chrome when no workspace route and no dismiss flag', () => {
        window.location.hash = '';
        expect(resolveInitialLandingBodyClass(true)).to.equal('landing');
    });

    it('resolves none when mobile mq does not match', () => {
        expect(resolveInitialLandingBodyClass(false)).to.equal('none');
    });

    it('resolves none when the user chose the classic IDE (preferDesktopIde survives reload)', () => {
        window.location.hash = '';
        markPreferDesktopIde();
        try {
            expect(resolveInitialLandingBodyClass(true)).to.equal('none');
        } finally {
            clearPreferDesktopIde();
        }
    });

    it('resolves none when a hub action is pending across reload', () => {
        storage.set(QAAP_HUB_PENDING_ACTION_KEY, '{}');
        const snapshot = readMobileShellLandingBootSnapshot();
        expect(snapshot.hasPendingHubAction).to.equal(true);
        expect(resolveInitialLandingBodyClass(true, snapshot)).to.equal('none');
    });

});
