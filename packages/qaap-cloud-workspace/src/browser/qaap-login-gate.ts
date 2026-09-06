// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { fetchQaapAuthConfig, startGithubOAuth } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { nls } from '@theia/core/lib/common/nls';
import { placeholderQaapAuthUser, writeQaapAuthSession } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import { QAAP_LOGIN_GITHUB_SVG } from './qaap-login-icons';
import { readQaapSignedIn } from './qaap-login-storage';

const BODY_CLASS = 'qaap-login-active';
const HOST_ID = 'qaap-login-host';

let activeHost: HTMLElement | undefined;
let previousActiveElement: HTMLElement | undefined;

export function isQaapLoginGateMounted(): boolean {
    return activeHost !== undefined || document.getElementById(HOST_ID) !== null;
}

export function dismissQaapLoginGate(): void {
    const host = activeHost ?? document.getElementById(HOST_ID);
    host?.remove();
    activeHost = undefined;
    document.body.classList.remove(BODY_CLASS);
    const restoreFocus = previousActiveElement;
    previousActiveElement = undefined;
    if (restoreFocus?.isConnected) {
        restoreFocus.focus();
    }
}

export function presentQaapLoginGate(): void {
    if (readQaapSignedIn() || isQaapLoginGateMounted()) {
        return;
    }
    const activeElement = document.activeElement;
    previousActiveElement = activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : undefined;
    document.body.classList.add(BODY_CLASS);

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-labelledby', 'qaap-login-title');
    host.setAttribute('aria-describedby', 'qaap-login-description');
    host.tabIndex = -1;
    activeHost = host;

    const appName = document.querySelector('meta[name="application-name"]')?.getAttribute('content')?.trim() || 'Qaap';
    const logoUrl = document.querySelector('meta[name="application-icon"]')?.getAttribute('content')?.trim() || './media/qaap-logo.svg';

    host.innerHTML = `
<div class="qaap-login-overlay">
  <header class="qaap-login-brand">
    <img class="qaap-login-logo" src="${escapeAttr(logoUrl)}" width="64" height="64" alt="" />
    <h1 id="qaap-login-title" class="qaap-login-title">${escapeHtml(appName)}</h1>
    <p id="qaap-login-description" class="qaap-login-tagline">A pocket workspace for coding agents.<br/>Sign in to connect your repos.</p>
  </header>
  <div class="qaap-login-spacer"></div>
  <div class="qaap-login-actions">
    <button type="button" id="qaap-login-github" class="qaap-login-btn qaap-login-btn--primary" data-provider="github" aria-label="Sign in with GitHub">
      <span class="qaap-login-btn-icon-slot" data-icon="github">${QAAP_LOGIN_GITHUB_SVG}</span>
      <span class="qaap-login-btn-label">Sign in with GitHub</span>
    </button>
    <button type="button" id="qaap-login-local" class="qaap-login-btn qaap-login-btn--secondary" hidden>
      ${nls.localize('qaap/auth/continueLocal', 'Continue in local mode')}
    </button>
    <button type="button" id="qaap-login-retry" class="qaap-login-btn qaap-login-btn--secondary" hidden>
      ${nls.localize('qaap/auth/retryConnection', 'Retry connection')}
    </button>
  </div>
  <p id="qaap-login-status" class="qaap-login-status" role="status" aria-live="polite" aria-atomic="true"></p>
  <footer class="qaap-login-footer">
    By continuing you agree to the <a href="/legal/terms.html">terms</a> &amp; <a href="/legal/privacy.html">privacy</a>.
    <br/>${escapeHtml(appName)} never reads your repos without permission.
  </footer>
</div>`;

    document.body.appendChild(host);

    for (const el of document.getElementsByClassName('theia-preload')) {
        (el as HTMLElement).style.display = 'none';
    }

    const githubButton = host.querySelector<HTMLButtonElement>('#qaap-login-github');
    if (githubButton) {
        const handler = (event: Event): void => {
            event.preventDefault();
            authorize(githubButton);
        };
        githubButton.addEventListener('click', handler);
    }

    const localButton = host.querySelector<HTMLButtonElement>('#qaap-login-local');
    localButton?.addEventListener('click', event => {
        event.preventDefault();
        continueInLocalMode(localButton);
    });

    const retryButton = host.querySelector<HTMLButtonElement>('#qaap-login-retry');
    retryButton?.addEventListener('click', event => {
        event.preventDefault();
        retryButton.disabled = true;
        const status = host.querySelector<HTMLElement>('#qaap-login-status');
        if (status) {
            status.textContent = nls.localize('qaap/auth/checkingServer', 'Checking server connection…');
        }
        void reflectGithubAvailability(host);
    });

    host.addEventListener('keydown', event => {
        if (event.key !== 'Tab') {
            return;
        }
        const focusable = [...host.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        )];
        if (focusable.length === 0) {
            event.preventDefault();
            host.focus();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });

    // If the server has no GitHub OAuth app configured, or cannot be reached, keep the user on this
    // page with an actionable explanation instead of navigating to a blank/timeout OAuth page.
    void reflectGithubAvailability(host);
    githubButton?.focus();
}

function authorize(button: HTMLButtonElement): void {
    if (button.disabled || button.classList.contains('qaap-login-btn--loading')) {
        return;
    }
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const label = button.querySelector('.qaap-login-btn-label');
    if (label) {
        label.textContent = 'Authorizing…';
    }
    const status = button.closest<HTMLElement>('#qaap-login-host')?.querySelector<HTMLElement>('#qaap-login-status');
    if (status) {
        status.textContent = 'Opening GitHub sign-in…';
    }
    // Full-page redirect to GitHub OAuth; the session lands after the callback and is picked up on
    // reload (presentQaapLoginGate early-returns when already signed in).
    startGithubOAuth();
}

/**
 * Reflect whether GitHub sign-in is actually usable. When OAuth is unavailable or the backend
 * cannot be reached, keep the user on this page with a clear recovery action.
 */
async function reflectGithubAvailability(host: HTMLElement): Promise<void> {
    const button = host.querySelector<HTMLButtonElement>('#qaap-login-github');
    const localButton = host.querySelector<HTMLButtonElement>('#qaap-login-local');
    const retryButton = host.querySelector<HTMLButtonElement>('#qaap-login-retry');
    const status = host.querySelector<HTMLElement>('#qaap-login-status');
    if (localButton) {
        localButton.hidden = true;
    }
    if (retryButton) {
        retryButton.hidden = true;
        retryButton.disabled = false;
    }
    if (button) {
        button.disabled = false;
        button.removeAttribute('aria-disabled');
        button.classList.remove('qaap-login-btn--unavailable');
        const label = button.querySelector('.qaap-login-btn-label');
        if (label) {
            label.textContent = nls.localize('qaap/auth/signInWithGithub', 'Sign in with GitHub');
        }
    }
    try {
        const config = await fetchQaapAuthConfig();
        if (config.skipAuth === true && localButton) {
            localButton.hidden = false;
            if (status) {
                status.textContent = nls.localize(
                    'qaap/auth/localModeAvailable',
                    'Local development mode is enabled on this server.'
                );
            }
        }
        if (config.githubOAuth === true) {
            return;
        }
        if (config.skipAuth === true) {
            setGithubUnavailable(
                host,
                nls.localize(
                    'qaap/auth/githubUnavailableLocalMode',
                    'GitHub sign-in is unavailable. Continue in local mode or configure GitHub OAuth.'
                )
            );
            return;
        }
        setGithubUnavailable(
            host,
            nls.localize(
                'qaap/auth/githubUnavailable',
                'GitHub sign-in isn’t configured on this server yet. Ask the administrator to set the GitHub OAuth credentials.'
            )
        );
    } catch {
        setGithubUnavailable(
            host,
            nls.localize(
                'qaap/auth/serverUnavailable',
                'The Qaap server is not responding. Check the VPS, proxy, or firewall, then retry.'
            )
        );
        if (retryButton) {
            retryButton.hidden = false;
        }
    }
}

function setGithubUnavailable(host: HTMLElement, message: string): void {
    const button = host.querySelector<HTMLButtonElement>('#qaap-login-github');
    if (button) {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
        button.classList.add('qaap-login-btn--unavailable');
        const label = button.querySelector('.qaap-login-btn-label');
        if (label) {
            label.textContent = nls.localize('qaap/auth/githubUnavailableButton', 'GitHub sign-in unavailable');
        }
    }
    const status = host.querySelector<HTMLElement>('#qaap-login-status');
    if (status) {
        status.textContent = message;
    }
}

function continueInLocalMode(button: HTMLButtonElement): void {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    writeQaapAuthSession('gitlab', placeholderQaapAuthUser('gitlab'));
    dismissQaapLoginGate();
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
    return escapeHtml(value).replace(/'/g, '&#39;');
}
