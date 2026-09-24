// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

// eslint-disable-next-line @typescript-eslint/no-var-requires
import type * as PreferenceModule from './qaap-mobile-work-surface-preference';

/**
 * Owner-confirmed contract (CLAUDE.md / .cursor/rules/work-hub-reload-default.mdc):
 * F5 in the same tab must restore whichever surface (Work Hub or classic IDE) the user
 * had open, via `sessionStorage` only. A brand-new tab (empty sessionStorage) must
 * default to Work Hub. `localStorage`, URL state and restored layout must never be
 * used as the surface selector.
 */
describe('qaap-work-surface-reload (F5 same-tab surface contract)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const MODULE_PATH = require.resolve('./qaap-mobile-work-surface-preference');
    const LOGIN_GATE_PATH = path.join(__dirname, '..', '..', '..', 'qaap-product', 'resources', 'qaap-login-gate.js');

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    /** Simulates F5 in the same tab: a fresh module instance, same sessionStorage. */
    function freshModule(): typeof PreferenceModule {
        delete require.cache[MODULE_PATH];
        // eslint-disable-next-line @typescript-eslint/no-var-requires, import/no-dynamic-require
        return require('./qaap-mobile-work-surface-preference') as typeof PreferenceModule;
    }

    beforeEach(() => {
        window.sessionStorage.clear();
        window.localStorage.clear();
        window.location.hash = '';
        freshModule();
    });

    afterEach(() => {
        window.sessionStorage.clear();
        window.localStorage.clear();
        window.location.hash = '';
        document.body.classList.remove('theia-mobile-mod-desktop-ide');
    });

    it('(1) restores the IDE surface after reload when the user chose "Open IDE"', () => {
        const mod = freshModule();
        mod.markPreferDesktopIde();

        // Reload: a brand-new module instance, same sessionStorage (same tab).
        const reloaded = freshModule();
        expect(reloaded.peekPreferDesktopIde()).to.equal(true);
        expect(reloaded.resolveWorkSurfaceBootIntent()).to.equal('ide');
        expect(reloaded.shouldInstallWorkHubBootGuard()).to.equal(false);
    });

    it('(2) restores the Work Hub surface after reload when the user was in Work Hub', () => {
        const mod = freshModule();
        mod.markPreferAgentsSurface();

        const reloaded = freshModule();
        expect(reloaded.peekPreferDesktopIde()).to.equal(false);
        expect(reloaded.peekPreferAgentsSurface()).to.equal(true);
        expect(reloaded.resolveWorkSurfaceBootIntent()).to.equal('hub');
        expect(reloaded.shouldInstallWorkHubBootGuard()).to.equal(true);
    });

    it('(3) a new tab (fresh sessionStorage) defaults to Work Hub', () => {
        // No prior markPreferDesktopIde()/markPreferAgentsSurface() call — sessionStorage
        // is empty, as it would be in a brand-new tab.
        const mod = freshModule();
        expect(mod.peekPreferDesktopIde()).to.equal(false);
        expect(mod.resolveWorkSurfaceBootIntent()).to.equal('hub');
        expect(mod.shouldInstallWorkHubBootGuard()).to.equal(true);
    });

    it('(4) localStorage and URL hash/query IDE-ish values do not select the IDE surface', () => {
        // Plant IDE-looking values in the two persistence layers the contract forbids.
        window.localStorage.setItem('qaap.mobileProjects.preferDesktopIde', '1');
        window.localStorage.setItem('qaap.mobileProjects.explicitDesktopIde', '1');
        window.location.hash = '#/ide';

        // sessionStorage (the only allowed selector) stays empty.
        const mod = freshModule();
        expect(mod.peekPreferDesktopIde()).to.equal(false);
        expect(mod.resolveWorkSurfaceBootIntent()).to.equal('hub');

        // hasWorkspaceRouteInUrl() reflects the URL (used for other purposes) but must not
        // by itself flip the IDE/hub decision.
        expect(mod.hasWorkspaceRouteInUrl()).to.equal(true);
        expect(mod.resolveWorkSurfaceBootIntent()).to.equal('hub');
    });

    it('(5) the sessionStorage keys the JS boot guard reads match the TS module\'s exported keys', () => {
        const loginGateSource = fs.readFileSync(LOGIN_GATE_PATH, 'utf8');
        const mod = freshModule();

        // Guards the manual key sync between qaap-mobile-work-surface-preference.ts and
        // qaap-login-gate.js: if either side renames/typos a key, F5 silently breaks.
        expect(loginGateSource).to.include(`'${mod.QAAP_MOBILE_PREFER_DESKTOP_IDE_KEY}'`);
        expect(loginGateSource).to.include(`'${mod.QAAP_MOBILE_EXPLICIT_DESKTOP_IDE_KEY}'`);
        expect(loginGateSource).to.include(`'${mod.QAAP_MOBILE_PREFER_AGENTS_SURFACE_KEY}'`);
        expect(loginGateSource).to.include(`'${mod.QAAP_HUB_PENDING_ACTION_KEY}'`);
    });

    describe('(6) qaap-login-gate.js boot-guard decision, evaluated in a jsdom window', () => {
        let disableGuardJSDOM: (() => void) | undefined;
        let installGuard: (win: Window, doc: Document) => void;

        before(() => {
            disableGuardJSDOM = enableJSDOM();
            const source = fs.readFileSync(LOGIN_GATE_PATH, 'utf8');
            const startMarker = '(function installMobileWorkHubBootGuardEarly() {';
            const startIndex = source.indexOf(startMarker);
            expect(startIndex, 'installMobileWorkHubBootGuardEarly() not found in qaap-login-gate.js').to.be.greaterThan(-1);
            const endMarker = '\n    })();';
            const endIndex = source.indexOf(endMarker, startIndex);
            expect(endIndex, 'closing "})();" for the boot guard IIFE not found').to.be.greaterThan(-1);
            const guardSource = source.slice(startIndex, endIndex + endMarker.length);
            // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
            const factory = new Function('window', 'document', `"use strict";\n${guardSource}`);
            installGuard = (win, doc) => factory(win, doc);
        });

        after(() => {
            disableGuardJSDOM?.();
            disableGuardJSDOM = undefined;
        });

        beforeEach(() => {
            window.sessionStorage.clear();
            document.documentElement.classList.remove('theia-mobile-workhub-boot');
            document.body.classList.remove(
                'theia-mobile-mod-workhub-composer-header',
                'theia-mobile-mod-workhub-hide-ide-side-panels',
            );
            document.getElementById('qaap-mobile-workhub-boot-styles')?.remove();
            window.location.hash = '';
        });

        it('installs the Work Hub boot guard when no IDE preference is present', () => {
            installGuard(window, document);
            expect(document.documentElement.classList.contains('theia-mobile-workhub-boot')).to.equal(true);
            expect(document.body.classList.contains('theia-mobile-mod-workhub-composer-header')).to.equal(true);
            expect(document.body.classList.contains('theia-mobile-mod-workhub-hide-ide-side-panels')).to.equal(true);
        });

        it('skips the Work Hub boot guard when the IDE preference is set', () => {
            window.sessionStorage.setItem('qaap.mobileProjects.preferDesktopIde', '1');
            installGuard(window, document);
            expect(document.documentElement.classList.contains('theia-mobile-workhub-boot')).to.equal(false);
            expect(document.body.classList.contains('theia-mobile-mod-workhub-composer-header')).to.equal(false);
            expect(document.body.classList.contains('theia-mobile-mod-workhub-hide-ide-side-panels')).to.equal(false);
        });

        it('skips the Work Hub boot guard when the legacy explicit-IDE marker is set', () => {
            window.sessionStorage.setItem('qaap.mobileProjects.explicitDesktopIde', '1');
            installGuard(window, document);
            expect(document.documentElement.classList.contains('theia-mobile-workhub-boot')).to.equal(false);
        });
    });
});
