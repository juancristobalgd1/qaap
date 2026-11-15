// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, nls } from '@theia/core/lib/common';
import { readQaapSignedIn } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import { QAAP_REQUIRE_LOGIN_EVENT, signOutQaapAuth, startGithubOAuth } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { QAAP_AUTH_SIGN_IN_GITHUB_COMMAND, QAAP_AUTH_SIGN_OUT_COMMAND } from './qaap-workbench-account-menu';

@injectable()
export class QaapAuthCommandContribution implements CommandContribution {

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand({
            id: QAAP_AUTH_SIGN_IN_GITHUB_COMMAND,
            label: nls.localize('qaap/accountMenu/signInGithub', 'Sign in with GitHub'),
        }, {
            execute: () => {
                startGithubOAuth();
            },
        });
        registry.registerCommand({
            id: QAAP_AUTH_SIGN_OUT_COMMAND,
            label: nls.localize('qaap/accountMenu/signOut', 'Sign Out'),
        }, {
            isEnabled: () => readQaapSignedIn(),
            execute: async () => {
                await signOutQaapAuth();
                // Reload instead of covering the live app: open sockets, cached shells and in-memory
                // state of the old session must not survive. The gate clears what is left and shows
                // the sign-in screen.
                if (!this.reloadAfterSignOut()) {
                    window.dispatchEvent(new CustomEvent(QAAP_REQUIRE_LOGIN_EVENT));
                }
            },
        });
    }

    /** Full reload into the signed-out gate; false when the page cannot navigate (tests). */
    protected reloadAfterSignOut(): boolean {
        try {
            window.location.replace('/?qaapLogout=1');
            return true;
        } catch {
            return false;
        }
    }
}
