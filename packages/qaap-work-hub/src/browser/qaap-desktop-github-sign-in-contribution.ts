// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { environment } from '@theia/core/lib/common';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { pollQaapGithubDeviceFlow, startQaapGithubDeviceFlow } from '@theia/qaap-adapters/lib/browser/qaap-github-device-client';
import { QAAP_DESKTOP_GITHUB_SIGN_IN_EVENT, syncQaapAuthSessionFromServer } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { QaapGithubDeviceSignInDialog } from './qaap-github-device-sign-in-dialog';

/**
 * Desktop handler of every "Sign in with GitHub" entry point that calls `startGithubOAuth` (the account menu,
 * the sessions and pull-request sidebars, the composer's Connect GitHub chip). In Electron the web redirect
 * would navigate the whole app window to GitHub and lose its state, so this opens the same device sign-in
 * dialog as the repository import: GitHub's page opens in the system browser, the backend polls GitHub and
 * sets the session cookie, and the app refreshes its session in place. Web never installs the handler.
 */
@injectable()
export class QaapDesktopGithubSignInContribution implements FrontendApplicationContribution {

    @inject(WindowService)
    protected readonly windowService: WindowService;

    protected dialog: QaapGithubDeviceSignInDialog | undefined;

    onStart(): void {
        if (!this.isDesktop()) {
            return;
        }
        window.addEventListener(QAAP_DESKTOP_GITHUB_SIGN_IN_EVENT, this.onSignInRequest);
    }

    onStop(): void {
        window.removeEventListener(QAAP_DESKTOP_GITHUB_SIGN_IN_EVENT, this.onSignInRequest);
    }

    protected isDesktop(): boolean {
        return environment.electron.is();
    }

    protected readonly onSignInRequest = (event: Event): void => {
        event.preventDefault();
        this.open();
    };

    /** Opens the device sign-in dialog; a second request while it is open keeps the current code. */
    protected open(): void {
        const dialog = this.getDialog();
        if (dialog.isOpen) {
            return;
        }
        void dialog.open();
    }

    protected getDialog(): QaapGithubDeviceSignInDialog {
        if (!this.dialog) {
            this.dialog = this.createDialog();
            document.body.append(this.dialog.node);
        }
        return this.dialog;
    }

    protected createDialog(): QaapGithubDeviceSignInDialog {
        return new QaapGithubDeviceSignInDialog({
            api: { start: startQaapGithubDeviceFlow, poll: pollQaapGithubDeviceFlow },
            openExternal: url => this.windowService.openNewWindow(url, { external: true }),
            onSignedIn: () => void this.onSignedIn(),
        });
    }

    /**
     * The backend set the session cookie: refresh the app's session in place. Writing it fires
     * `qaap-auth-session-changed`, which the project lists, the top bar and the GitHub MCP chip follow.
     */
    protected async onSignedIn(): Promise<void> {
        await syncQaapAuthSessionFromServer().catch(() => false);
    }
}
