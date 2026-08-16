// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'chai';
import {
    clearPreferAgentsSurface,
    clearPreferDesktopIde,
    hasWorkspaceRouteInUrl,
    markPreferAgentsSurface,
    markPreferDesktopIde,
    peekPreferAgentsSurface,
    peekPreferDesktopIde,
    QAAP_HUB_PENDING_ACTION_KEY,
    QAAP_MOBILE_EXPLICIT_DESKTOP_IDE_KEY,
    QAAP_MOBILE_PREFER_AGENTS_SURFACE_KEY,
    QAAP_MOBILE_PREFER_DESKTOP_IDE_KEY,
    resolveWorkSurfaceBootIntent,
    shouldInstallWorkHubBootGuard,
} from './qaap-mobile-work-surface-preference';

describe('qaap-mobile-work-surface-preference', () => {

    const storage = new Map<string, string>();

    beforeEach(() => {
        storage.clear();
        const sessionStorage = {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => { storage.set(key, value); },
            removeItem: (key: string) => { storage.delete(key); },
            clear: () => { storage.clear(); },
            key: () => null,
            length: 0,
        };
        (global as unknown as { sessionStorage: Storage }).sessionStorage = sessionStorage as Storage;
        (global as unknown as { window: Window }).window = { sessionStorage } as unknown as Window;
        clearPreferDesktopIde();
        clearPreferAgentsSurface();
    });

    it('persists desktop IDE choice in sessionStorage for reload', () => {
        expect(peekPreferDesktopIde()).to.equal(false);
        markPreferDesktopIde();
        expect(peekPreferDesktopIde()).to.equal(true);
        expect(storage.get(QAAP_MOBILE_PREFER_DESKTOP_IDE_KEY)).to.equal('1');
        expect(storage.get(QAAP_MOBILE_EXPLICIT_DESKTOP_IDE_KEY)).to.equal('1');
    });

    it('hydrates persisted desktop IDE after a simulated reload', () => {
        storage.set(QAAP_MOBILE_PREFER_DESKTOP_IDE_KEY, '1');
        storage.set(QAAP_MOBILE_EXPLICIT_DESKTOP_IDE_KEY, '1');
        expect(peekPreferDesktopIde()).to.equal(true);
        clearPreferDesktopIde();
        expect(peekPreferDesktopIde()).to.equal(false);
    });

    it('persists the Agents surface after leaving desktop IDE', () => {
        markPreferDesktopIde();
        clearPreferDesktopIde();
        markPreferAgentsSurface();
        expect(peekPreferAgentsSurface()).to.equal(true);
        expect(peekPreferDesktopIde()).to.equal(false);
        clearPreferAgentsSurface();
        expect(peekPreferAgentsSurface()).to.equal(false);
    });

    it('does not override an explicit desktop IDE choice', () => {
        markPreferDesktopIde();
        markPreferAgentsSurface();
        expect(peekPreferDesktopIde()).to.equal(true);
        expect(peekPreferAgentsSurface()).to.equal(false);
    });

    it('detects workspace routes in the URL hash', () => {
        (global as unknown as { window: Window & { location: { hash: string } } }).window = {
            location: { hash: '#/Users/jc/.qaap/workspaces/demo/Mockup' },
            sessionStorage: (global as unknown as { sessionStorage: Storage }).sessionStorage,
        } as Window;
        expect(hasWorkspaceRouteInUrl()).to.equal(true);
    });

    describe('resolveWorkSurfaceBootIntent', () => {
        it('resolves to hub when sessionStorage is empty', () => {
            expect(resolveWorkSurfaceBootIntent()).to.equal('hub');
        });

        it('resolves to ide when the explicit desktop-IDE preference is set', () => {
            markPreferDesktopIde();
            expect(resolveWorkSurfaceBootIntent()).to.equal('ide');
        });

        it('resolves to pending when a Work Hub action is mid-flight', () => {
            storage.set(QAAP_HUB_PENDING_ACTION_KEY, '1');
            expect(resolveWorkSurfaceBootIntent()).to.equal('pending');
        });

        it('resolves to hub after clearing IDE and marking the Agents surface', () => {
            markPreferDesktopIde();
            clearPreferDesktopIde();
            markPreferAgentsSurface();
            expect(resolveWorkSurfaceBootIntent()).to.equal('hub');
        });

        it('takes an explicit preferDesktopIde override over the persisted value', () => {
            expect(resolveWorkSurfaceBootIntent({ preferDesktopIde: true })).to.equal('ide');
        });

        it('takes an explicit hasPendingHubAction override over storage', () => {
            expect(resolveWorkSurfaceBootIntent({ hasPendingHubAction: true })).to.equal('pending');
        });

        it('prioritizes ide over a pending action', () => {
            markPreferDesktopIde();
            storage.set(QAAP_HUB_PENDING_ACTION_KEY, '1');
            expect(resolveWorkSurfaceBootIntent()).to.equal('ide');
        });
    });

    describe('shouldInstallWorkHubBootGuard', () => {
        it('is true only for the hub intent', () => {
            expect(shouldInstallWorkHubBootGuard('hub')).to.equal(true);
            expect(shouldInstallWorkHubBootGuard('ide')).to.equal(false);
            expect(shouldInstallWorkHubBootGuard('pending')).to.equal(false);
        });

        it('defaults to resolving the current boot intent when called with no argument', () => {
            expect(shouldInstallWorkHubBootGuard()).to.equal(true);
            markPreferDesktopIde();
            expect(shouldInstallWorkHubBootGuard()).to.equal(false);
        });
    });

    describe('qaap-login-gate.js key sync', () => {
        it('mirrors every session-storage key used by the TS boot-intent resolver', () => {
            const loginGatePath = path.join(__dirname, '..', '..', '..', 'qaap-product', 'resources', 'qaap-login-gate.js');
            const loginGate = fs.readFileSync(loginGatePath, 'utf8');
            expect(loginGate, `missing ${QAAP_MOBILE_PREFER_DESKTOP_IDE_KEY}`).to.include(QAAP_MOBILE_PREFER_DESKTOP_IDE_KEY);
            expect(loginGate, `missing ${QAAP_MOBILE_EXPLICIT_DESKTOP_IDE_KEY}`).to.include(QAAP_MOBILE_EXPLICIT_DESKTOP_IDE_KEY);
            expect(loginGate, `missing ${QAAP_MOBILE_PREFER_AGENTS_SURFACE_KEY}`).to.include(QAAP_MOBILE_PREFER_AGENTS_SURFACE_KEY);
            expect(loginGate, `missing ${QAAP_HUB_PENDING_ACTION_KEY}`).to.include(QAAP_HUB_PENDING_ACTION_KEY);
        });
    });

});