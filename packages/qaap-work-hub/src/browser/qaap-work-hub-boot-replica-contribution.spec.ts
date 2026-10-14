// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { qaapAuthStorageKey, QAAP_AUTH_USER_KEY } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import { QAAP_WORK_HUB_BOOT_REPLICA_KEY } from '@theia/qaap-adapters/lib/browser/qaap-work-hub-boot-replica';
import { QaapWorkHubBootReplicaContribution } from './qaap-work-hub-boot-replica-contribution';

disableImportJSDOM();

describe('QaapWorkHubBootReplicaContribution', () => {
    let disableSuiteJSDOM: () => void;
    before(() => { disableSuiteJSDOM = enableJSDOM(); });
    after(() => disableSuiteJSDOM());

    beforeEach(() => {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            writable: true,
            value: (query: string) => ({ matches: true, media: query }),
        });
        signIn();
        document.body.className = 'qaap-theme-light';
        document.body.innerHTML = '<div id="theia-app-shell" class="lm-Widget">'
            + '<div class="theia-mobile-projects theia-mod-visible"><header>wsvite</header></div></div>';
        window.localStorage.removeItem(QAAP_WORK_HUB_BOOT_REPLICA_KEY);
    });

    afterEach(() => {
        window.localStorage.clear();
        delete (window as { matchMedia?: unknown }).matchMedia;
        document.documentElement.classList.remove('theia-mobile-workhub-boot');
    });

    /** The stored session the login gate and the app read (what writeQaapAuthSession stores). */
    function signIn(): void {
        window.localStorage.setItem(qaapAuthStorageKey('qaap.auth.signedIn'), 'true');
        window.localStorage.setItem(qaapAuthStorageKey('qaap.auth.provider'), JSON.stringify('github'));
        window.localStorage.setItem(qaapAuthStorageKey(QAAP_AUTH_USER_KEY), JSON.stringify({ provider: 'github', login: 'octocat' }));
    }

    function contribution(): QaapWorkHubBootReplicaContribution {
        const created = new QaapWorkHubBootReplicaContribution();
        // Layout is not computed in jsdom: treat every matched element as rendered.
        (created as unknown as { isLoading(panel: Element): boolean }).isLoading =
            panel => !!panel.querySelector('[class*="skeleton"], [class*="-loading"], .theia-mod-loading, [aria-busy="true"]');
        return created;
    }

    function stored(): { login: string, tree: unknown } | undefined {
        const raw = window.localStorage.getItem(QAAP_WORK_HUB_BOOT_REPLICA_KEY);
        return raw ? JSON.parse(raw) : undefined;
    }

    it('records the Work Hub at rest for the signed-in user', () => {
        expect(contribution().capture()).to.equal(true);
        expect(stored()?.login).to.equal('octocat');
        expect(JSON.stringify(stored()?.tree)).to.contain('wsvite');
    });

    const notAtRest: Array<[string, () => void]> = [
        ['the Work Hub is still loading', () => document.querySelector('header')!.classList.add('theia-mobile-tasks-skeleton-list')],
        ['the sessions sidebar is open', () => document.body.classList.add('theia-mobile-mod-sessions-sidebar-open')],
        ['the keyboard is open', () => document.body.classList.add('theia-mobile-mod-keyboard-open')],
        ['a dialog is open', () => document.body.insertAdjacentHTML('beforeend', '<div class="dialogOverlay"></div>')],
        ['the boot guard is still up', () => document.documentElement.classList.add('theia-mobile-workhub-boot')],
        ['the layout is not the phone one', () => { (window as { matchMedia: unknown }).matchMedia = (query: string) => ({ matches: false, media: query }); }],
        ['nobody is signed in', () => window.localStorage.clear()],
    ];
    for (const [label, arrange] of notAtRest) {
        it(`keeps the previous record when ${label}`, () => {
            arrange();
            expect(contribution().capture()).to.equal(false);
            expect(stored()).to.equal(undefined);
        });
    }
});
