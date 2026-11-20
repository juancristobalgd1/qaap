// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
import { QAAP_DESKTOP_GITHUB_SIGN_IN_EVENT } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { QaapDesktopGithubSignInContribution } from './qaap-desktop-github-sign-in-contribution';
import { QaapGithubDeviceSignInDialog } from './qaap-github-device-sign-in-dialog';

// Live desktop bug (Nov 2026): every "Sign in with GitHub" outside the repository dialog (account menu,
// sidebars, the composer's Connect GitHub chip) navigated the whole Electron window to GitHub.
describe('QaapDesktopGithubSignInContribution', () => {
    useSuiteJSDOM();

    class TestContribution extends QaapDesktopGithubSignInContribution {
        desktop = true;
        opens = 0;
        external: Array<{ url: string; external?: boolean }> = [];
        protected override isDesktop(): boolean {
            return this.desktop;
        }
        protected override createDialog(): QaapGithubDeviceSignInDialog {
            const dialog = super.createDialog();
            dialog.open = async () => {
                this.opens++;
                dialog.node.hidden = false;
            };
            return dialog;
        }
    }

    function create(desktop: boolean): TestContribution {
        const contribution = new TestContribution();
        contribution.desktop = desktop;
        Object.assign(contribution, {
            windowService: { openNewWindow: (url: string, options?: { external?: boolean }) => contribution.external.push({ url, external: options?.external }) },
        });
        contribution.onStart();
        return contribution;
    }

    function request(): boolean {
        return window.dispatchEvent(new window.CustomEvent(QAAP_DESKTOP_GITHUB_SIGN_IN_EVENT, { cancelable: true }));
    }

    it('desktop: handles the request in place (the caller does not navigate) and opens the device sign-in once', () => {
        const contribution = create(true);
        try {
            expect(request()).to.equal(false);
            expect(contribution.opens).to.equal(1);
            // A second click while the code is shown keeps that code.
            request();
            expect(contribution.opens).to.equal(1);
        } finally {
            contribution.onStop();
        }
    });

    it('desktop: GitHub\'s page opens in the system browser, never in the app window', () => {
        const contribution = create(true);
        try {
            request();
            const dialog = (contribution as unknown as { dialog: { options: { openExternal(url: string): void } } }).dialog;
            dialog.options.openExternal('https://github.com/login/device');
            expect(contribution.external).to.deep.equal([{ url: 'https://github.com/login/device', external: true }]);
        } finally {
            contribution.onStop();
        }
    });

    it('web: installs no handler', () => {
        const contribution = create(false);
        try {
            expect(request()).to.equal(true);
            expect(contribution.opens).to.equal(0);
        } finally {
            contribution.onStop();
        }
    });
});
