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

let loginNotice: string | undefined;

/** Message shown in the gate status line until the user starts a new sign-in (e.g. a mapped OAuth failure). */
export function setQaapLoginGateNotice(message: string | undefined): void {
    loginNotice = message;
    const status = activeHost?.querySelector<HTMLElement>('#qaap-login-status');
    if (status && message) {
        status.textContent = message;
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
  <section class="qaap-login-hero" aria-hidden="true"><span class="qaap-login-kicker">The pocket workspace for coding agents</span><p class="qaap-login-headline">Ship code<br/>from <em>anywhere.</em></p><p class="qaap-login-sub">Claude Code, Codex, Gemini and Copilot working on your repos — you review and merge from your phone.</p><div class="qaap-login-device"><div class="qaap-login-phone"><div class="qaap-login-screen"><div class="qaap-login-statusbar"><span>9:41</span><i></i><b></b></div><div class="qaap-login-appbar"><strong>acme/web</strong><span>fix/checkout</span></div><div class="qaap-login-bubble">Make checkout work on mobile</div><div class="qaap-login-agent">Claude Code</div><ul class="qaap-login-steps"><li class="qaap-login-step"><span>Read <b>checkout.tsx</b></span></li><li class="qaap-login-step"><span>Edited <b>checkout.tsx</b></span><code><span class="qaap-login-add">+42</span> <span class="qaap-login-del">−8</span></code></li><li class="qaap-login-step"><span>Ran <b>npm test</b></span><code>128 passed</code></li></ul><p class="qaap-login-reply">The checkout now fits small screens: the summary collapses and the pay button stays in reach. I opened a pull request.</p><div class="qaap-login-prcard"><div><b>Pull request #214</b><small>All checks passed</small></div><span>Merge</span></div><div class="qaap-login-composer">Ask anything…</div></div></div></div></section>
  <main class="qaap-login-panel"><div class="qaap-login-panel-inner">
    <header class="qaap-login-brand">
      <div class="qaap-login-mark"><img class="qaap-login-logo" src="${escapeAttr(logoUrl)}" width="36" height="36" alt="" /><span class="qaap-login-wordmark">${escapeHtml(appName)}</span></div>
      <h1 id="qaap-login-title" class="qaap-login-title">Sign in to ${escapeHtml(appName)}</h1>
      <p id="qaap-login-description" class="qaap-login-tagline">A pocket workspace for coding agents. Connect your GitHub repos to get started.</p>
    </header>
    <div class="qaap-login-actions">
      <button type="button" id="qaap-login-github" class="qaap-login-btn qaap-login-btn--primary" data-provider="github" aria-label="Continue with GitHub">
        <span class="qaap-login-btn-icon-slot" data-icon="github">${QAAP_LOGIN_GITHUB_SVG}</span>
        <span class="qaap-login-btn-label">Continue with GitHub</span>
      </button>
      <button type="button" id="qaap-login-local" class="qaap-login-btn qaap-login-btn--secondary" hidden>
        ${nls.localize('qaap/auth/continueLocal', 'Continue in local mode')}
      </button>
      <button type="button" id="qaap-login-retry" class="qaap-login-btn qaap-login-btn--secondary" hidden>
        ${nls.localize('qaap/auth/retryConnection', 'Retry connection')}
      </button>
    </div>
    <p id="qaap-login-status" class="qaap-login-status" role="status" aria-live="polite" aria-atomic="true"></p>
    <ul class="qaap-login-points"><li>Run Claude Code, Codex and more in a cloud workspace</li><li>Review diffs and open pull requests from your phone</li><li>Only the repos you choose — revoke access anytime</li></ul>
    <footer class="qaap-login-footer">
      By continuing you agree to the <a href="/legal/terms.html">Terms</a> and <a href="/legal/privacy.html">Privacy Policy</a>.
    </footer>
  </div></main>
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

    // If the server confirms GitHub OAuth is not configured, keep the user on this page with an
    // actionable explanation. A failed capabilities probe does not establish server liveness, so it
    // must not disable sign-in or tell the user the server is down.
    void reflectGithubAvailability(host).then(() => {
        const status = host.querySelector<HTMLElement>('#qaap-login-status');
        if (status && loginNotice && !status.textContent) {
            status.textContent = loginNotice;
        }
    });
    if (loginNotice) {
        setQaapLoginGateNotice(loginNotice);
    }
    githubButton?.focus();
}

function authorize(button: HTMLButtonElement): void {
    if (button.disabled || button.classList.contains('qaap-login-btn--loading')) {
        return;
    }
    loginNotice = undefined;
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
 * Reflect whether GitHub sign-in is configured. Failed config probes leave sign-in available:
 * `/auth/config` is a capabilities endpoint, not a server liveness check.
 */
async function reflectGithubAvailability(host: HTMLElement): Promise<void> {
    const button = host.querySelector<HTMLButtonElement>('#qaap-login-github');
    const localButton = host.querySelector<HTMLButtonElement>('#qaap-login-local');
    const retryButton = host.querySelector<HTMLButtonElement>('#qaap-login-retry');
    const status = host.querySelector<HTMLElement>('#qaap-login-status');
    let productionRuntime = false;
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
            label.textContent = nls.localize('qaap/auth/continueWithGithub', 'Continue with GitHub');
        }
    }
    try {
        const config = await fetchQaapAuthConfig();
        productionRuntime = config.productionRuntime === true;
        if (productionRuntime) {
            if (localButton) {
                localButton.hidden = true;
            }
            if (retryButton) {
                retryButton.hidden = true;
            }
        }
        if (!productionRuntime && config.skipAuth === true && localButton) {
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
        if (!productionRuntime && config.skipAuth === true) {
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
        if (status) {
            status.textContent = '';
        }
        if (retryButton) {
            retryButton.hidden = true;
            retryButton.disabled = false;
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
