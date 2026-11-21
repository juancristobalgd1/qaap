// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import {
    qaapAuthUserInitials,
    readQaapAuthUser,
    readQaapSignedIn,
    type QaapAuthUser,
} from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import { readQaapDesktopGithubCredential } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';

/**
 * The account to show: the Qaap GitHub session, or on the desktop app (local mode, no Qaap session) the GitHub account
 * behind `gh` / `GH_TOKEN`, so the avatar is the user's own there too.
 */
function resolveDisplayedAccountUser(): QaapAuthUser | undefined {
    const user = readQaapAuthUser();
    if (user) {
        return user;
    }
    const credentialUser = readQaapDesktopGithubCredential()?.user;
    return credentialUser?.login ? { ...credentialUser, provider: 'github' } as QaapAuthUser : undefined;
}

export interface QaapAccountAvatarVisualOptions {
    /** When set, updates `title` for sign-in hint and account name. */
    titleTarget?: HTMLElement;
}

/** Renders the signed-in user avatar (image, initials, or account icon) into `avatarContainer`. */
export function renderQaapAccountAvatarVisual(
    avatarContainer: HTMLElement,
    options: QaapAccountAvatarVisualOptions = {}
): void {
    const { titleTarget } = options;
    const signedInTitle = nls.localize('qaap/accountMenu/title', 'Account');
    const signInTitle = nls.localize('qaap/accountMenu/signInGithub', 'Sign in with GitHub');

    avatarContainer.replaceChildren();
    const desktopUser = readQaapAuthUser() ? undefined : resolveDisplayedAccountUser();
    const signedIn = readQaapSignedIn() || !!desktopUser;
    if (!signedIn) {
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-account theia-workbench-account-fallback-icon';
        icon.setAttribute('aria-hidden', 'true');
        avatarContainer.appendChild(icon);
        if (titleTarget) {
            titleTarget.title = signInTitle;
        }
        return;
    }
    const user = resolveDisplayedAccountUser();
    if (!user) {
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-account theia-workbench-account-fallback-icon';
        icon.setAttribute('aria-hidden', 'true');
        avatarContainer.appendChild(icon);
        if (titleTarget) {
            titleTarget.title = signedInTitle;
        }
        return;
    }
    if (titleTarget) {
        titleTarget.title = user.name || user.login;
    }
    if (user.avatarUrl) {
        const img = document.createElement('img');
        img.src = user.avatarUrl;
        img.alt = '';
        img.draggable = false;
        img.referrerPolicy = 'no-referrer';
        img.decoding = 'async';
        avatarContainer.appendChild(img);
        return;
    }
    const initials = document.createElement('span');
    initials.className = 'theia-workbench-account-initials';
    initials.textContent = qaapAuthUserInitials(user);
    avatarContainer.appendChild(initials);
}
