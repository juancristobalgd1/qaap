// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { withGlobal, type InstalledClock } from '@sinonjs/fake-timers';
import { runLoginGate, type LoginGateOptions, type LoginGateResponder, type LoginGateRun } from './test/qaap-login-gate-harness';

const CONFIG = '/qaap/api/auth/config';
const SESSION = '/qaap/api/auth/session';
const SIGNED_IN_USER = { provider: 'github', login: 'octocat', name: 'The Octocat' };

describe('Qaap login gate', () => {
    const runs: LoginGateRun[] = [];

    afterEach(() => {
        const closed = runs.splice(0);
        closed.forEach(run => run.dom.window.close());
        // A gate exception (e.g. inside a watchdog timer) must fail the test even when the DOM looks right.
        expect(closed.flatMap(run => run.pageErrors)).to.deep.equal([]);
    });

    function start(responder: LoginGateResponder, url?: string, options?: LoginGateOptions): LoginGateRun {
        const run = runLoginGate(responder, url, options);
        runs.push(run);
        return run;
    }

    describe('GitHub OAuth callback', () => {
        it('stores the session, strips the OAuth marker from the URL and loads the bundle', async () => {
            const run = start(
                pathname => pathname === SESSION ? { ok: true, body: { signedIn: true, user: SIGNED_IN_USER } } : undefined,
                'http://localhost:3000/?qaap_oauth=github&keep=1#/workspace/demo',
            );
            await run.bundleAppended;
            expect(run.window.location.search).to.equal('?keep=1');
            expect(run.window.location.hash).to.equal('#/workspace/demo');
            expect(run.document.getElementById('qaap-login-host')).to.equal(null);
            expect(run.document.body.classList.contains('qaap-login-active')).to.equal(false);
            const stored = Object.keys(run.window.localStorage).filter(key => key.includes('qaap.auth'));
            expect(stored.some(key => run.window.localStorage.getItem(key) === 'true')).to.equal(true);
            // The callback trusts the session endpoint only; it never asks for the auth config.
            expect(run.requests).to.deep.equal([SESSION]);
        });

        it('falls back to the sign-in gate when the callback session cannot be confirmed', async () => {
            const run = start(() => undefined, 'http://localhost:3000/?qaap_oauth=github');
            await run.bundleAppended;
            expect(run.document.getElementById('qaap-login-host')).to.not.equal(null);
        });

        it('logs the backend reason of a failed OAuth callback and shows the gate', async () => {
            const run = start(() => undefined, 'http://localhost:3000/?qaap_oauth_error=1&qaap_oauth_reason=state_mismatch');
            await run.bundleAppended;
            expect(run.consoleErrors.join('\n')).to.contain('Reason: state_mismatch');
            expect(run.document.getElementById('qaap-login-host')).to.not.equal(null);
        });
    });

    describe('bundle load failure', () => {
        it('replaces the blank page with a retry screen when bundle.js fails to load', async () => {
            const run = start(pathname => pathname === CONFIG ? { ok: true, body: { skipAuth: true } } : undefined);
            const { script } = await run.bundleAppended;
            script.dispatchEvent(new run.window.Event('error'));
            const error = run.document.getElementById('qaap-startup-error');
            expect(error?.getAttribute('role')).to.equal('alertdialog');
            expect(error?.textContent).to.contain('The application bundle could not load.');
            expect(run.document.getElementById('qaap-err-retry')?.textContent).to.equal('Retry');
            expect((run.window as unknown as { __qaapBundleLoading?: boolean }).__qaapBundleLoading).to.equal(false);
        });

        it('keeps the sign-in gate on top instead of stacking the retry screen over it', async () => {
            const run = start(pathname => pathname === CONFIG ? { ok: true, body: { skipAuth: false, githubOAuth: true } } : undefined);
            const { script } = await run.bundleAppended;
            script.dispatchEvent(new run.window.Event('error'));
            expect(run.document.getElementById('qaap-login-host')).to.not.equal(null);
            expect(run.document.getElementById('qaap-startup-error')).to.equal(null);
        });
    });

    describe('GitHub availability on the sign-in gate', () => {
        function button(run: LoginGateRun): HTMLButtonElement {
            return run.document.getElementById('qaap-login-github') as HTMLButtonElement;
        }

        function status(run: LoginGateRun): string {
            return run.document.getElementById('qaap-login-status')?.textContent ?? '';
        }

        it('disables GitHub sign-in with an admin hint when OAuth is not configured', async () => {
            const run = start(pathname => pathname === CONFIG ? { ok: true, body: { skipAuth: false, githubOAuth: false } } : undefined);
            await run.waitFor(() => button(run)?.disabled === true, 'GitHub button disabled');
            expect(button(run).getAttribute('aria-disabled')).to.equal('true');
            expect(button(run).textContent).to.contain('GitHub sign-in unavailable');
            expect(status(run)).to.contain('isn’t configured on this server yet');
            expect((run.document.getElementById('qaap-login-retry') as HTMLButtonElement).hidden).to.equal(true);
        });

        it('offers a retry when the server does not answer, and re-enables GitHub once it does', async () => {
            let serverUp = false;
            const run = start(pathname => pathname === CONFIG && serverUp
                ? { ok: true, body: { skipAuth: false, githubOAuth: true } }
                : undefined);
            const retry = (): HTMLButtonElement => run.document.getElementById('qaap-login-retry') as HTMLButtonElement;
            await run.waitFor(() => retry()?.hidden === false, 'retry button visible');
            expect(button(run).disabled).to.equal(true);
            expect(status(run)).to.contain('The Qaap server is not responding.');

            serverUp = true;
            retry().click();
            await run.waitFor(() => button(run).disabled === false, 'GitHub button re-enabled');
            expect(button(run).textContent).to.contain('Sign in with GitHub');
            expect(retry().hidden).to.equal(true);
        });

        it('never offers retry or local mode on a production runtime', async () => {
            const run = start(pathname => pathname === CONFIG
                ? { ok: true, body: { skipAuth: false, githubOAuth: false, productionRuntime: true } }
                : undefined);
            await run.waitFor(() => button(run)?.disabled === true, 'GitHub button disabled');
            expect((run.document.getElementById('qaap-login-retry') as HTMLButtonElement).hidden).to.equal(true);
            expect((run.document.getElementById('qaap-login-local') as HTMLButtonElement).hidden).to.equal(true);
            expect(status(run)).to.contain('Ask the administrator');
        });
    });

    describe('sign-out and local mode', () => {
        it('?qaapLogout=1 clears every qaap.auth key but keeps unrelated storage', async () => {
            const run = start(() => undefined, 'http://localhost:3000/?qaapLogout=1', {
                localStorage: {
                    'theia:/:qaap.auth.signedIn': 'true',
                    'theia:/:qaap.auth.provider': '"github"',
                    'theia:/other/:qaap.auth.user': '{}',
                    'theia:/:workbench.layout': '{}',
                },
            });
            await run.bundleAppended;
            const keys = Object.keys(run.window.localStorage);
            expect(keys.filter(key => key.includes('qaap.auth'))).to.deep.equal([]);
            expect(keys).to.include('theia:/:workbench.layout');
            // Signed out, so the gate is shown.
            expect(run.document.getElementById('qaap-login-host')).to.not.equal(null);
        });

        it('"Continue in local mode" writes the dev session and hands over to the loading bundle', async () => {
            // First config read (dev skip-auth probe) says no; the gate's availability check then
            // finds a local-development server without GitHub OAuth.
            const run = start((pathname, call) => pathname === CONFIG
                ? { ok: true, body: call === 0 ? { skipAuth: false } : { skipAuth: true, githubOAuth: false } }
                : undefined);
            const local = (): HTMLButtonElement => run.document.getElementById('qaap-login-local') as HTMLButtonElement;
            await run.waitFor(() => local()?.hidden === false, 'local mode offered');
            await run.bundleAppended;
            local().click();
            expect(run.window.localStorage.getItem('theia:/:qaap.auth.signedIn')).to.equal('true');
            expect(JSON.parse(run.window.localStorage.getItem('theia:/:qaap.auth.provider') ?? 'null')).to.equal('gitlab');
            expect(JSON.parse(run.window.localStorage.getItem('theia:/:qaap.auth.user') ?? '{}').login).to.equal('dev');
            expect(run.document.getElementById('qaap-login-host')).to.equal(null);
            expect(run.document.body.classList.contains('qaap-login-active')).to.equal(false);
            // The gate already started the bundle behind itself; it is not requested twice.
            expect(run.document.querySelectorAll('script[src*="bundle.js"]')).to.have.length(1);
        });
    });

    describe('focus trap', () => {
        function tab(run: LoginGateRun, shiftKey = false): KeyboardEvent {
            const event = new run.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
            (run.document.activeElement ?? run.document.body).dispatchEvent(event);
            return event;
        }

        it('wraps Tab and Shift+Tab between the first and last control of the gate', async () => {
            const run = start(pathname => pathname === CONFIG ? { ok: true, body: { skipAuth: false, githubOAuth: true } } : undefined);
            await run.bundleAppended;
            const github = run.document.getElementById('qaap-login-github') as HTMLButtonElement;
            const privacy = run.document.querySelector('a[href="/legal/privacy.html"]') as HTMLAnchorElement;
            github.focus();
            expect(tab(run, true).defaultPrevented).to.equal(true);
            expect(run.document.activeElement).to.equal(privacy);
            expect(tab(run).defaultPrevented).to.equal(true);
            expect(run.document.activeElement).to.equal(github);
        });

        it('wraps to the first visible control when the leading buttons are disabled or hidden', async () => {
            const run = start(() => undefined);
            const retry = (): HTMLButtonElement => run.document.getElementById('qaap-login-retry') as HTMLButtonElement;
            await run.waitFor(() => retry()?.hidden === false, 'retry button visible');
            const privacy = run.document.querySelector('a[href="/legal/privacy.html"]') as HTMLAnchorElement;
            // GitHub is disabled and local mode hidden: Retry is the first reachable control.
            privacy.focus();
            expect(tab(run).defaultPrevented).to.equal(true);
            expect(run.document.activeElement).to.equal(retry());
            expect(tab(run, true).defaultPrevented).to.equal(true);
            expect(run.document.activeElement).to.equal(privacy);
        });
    });

    describe('startup watchdog', () => {
        let clock: InstalledClock | undefined;

        afterEach(() => {
            clock?.uninstall();
            clock = undefined;
        });

        function startWithFakeTimers(config: object = { skipAuth: true }, splash = '<div class="theia-preload"></div>'): LoginGateRun {
            return start(pathname => pathname === CONFIG ? { ok: true, body: config } : undefined, undefined, {
                bodyHtml: splash,
                beforeRun: window => { clock = withGlobal(window).install({ toFake: ['setTimeout', 'clearTimeout'] }); },
            });
        }

        async function loadedBundle(run: LoginGateRun): Promise<void> {
            const { script } = await run.bundleAppended;
            script.dispatchEvent(new run.window.Event('load'));
            // jsdom has no layout, so the splash never has an offsetParent; pretend it is on screen.
            Object.defineProperty(run.document.querySelector('.theia-preload'), 'offsetParent', { get: () => run.document.body });
        }

        it('shows the "took too long to start" screen when the splash is still up after 30 s', async () => {
            const run = startWithFakeTimers();
            await loadedBundle(run);
            clock!.tick(29_999);
            expect(run.document.getElementById('qaap-startup-error')).to.equal(null);
            clock!.tick(1);
            expect(run.document.getElementById('qaap-startup-error')?.textContent).to.contain('The application took too long to start.');
        });

        for (const [label, splash] of [
            ['hidden by Theia (.theia-hidden)', '<div class="theia-preload theia-hidden"></div>'],
            ['hidden inline (display: none)', '<div class="theia-preload" style="display: none"></div>'],
        ]) {
            it(`stays quiet when the splash is already ${label} at the deadline`, async () => {
                const run = startWithFakeTimers(undefined, splash);
                await loadedBundle(run);
                clock!.tick(30_000);
                expect(run.document.getElementById('qaap-startup-error')).to.equal(null);
            });
        }

        it('shows the bundle retry screen when bundle.js never finishes loading', async () => {
            const run = startWithFakeTimers();
            await run.bundleAppended;
            clock!.tick(29_999);
            expect(run.document.getElementById('qaap-startup-error')).to.equal(null);
            clock!.tick(1);
            expect(run.document.getElementById('qaap-startup-error')?.textContent).to.contain('The application bundle could not load.');
        });

        it('does not arm the bundle watchdog once bundle.js has loaded', async () => {
            // No splash: only the bundle watchdog could produce a screen here.
            const run = startWithFakeTimers(undefined, '');
            const { script } = await run.bundleAppended;
            script.dispatchEvent(new run.window.Event('load'));
            clock!.tick(60_000);
            expect(run.document.getElementById('qaap-startup-error')).to.equal(null);
        });

        it('keeps the sign-in gate instead of the bundle retry screen when bundle.js never loads', async () => {
            const run = startWithFakeTimers({ skipAuth: false, githubOAuth: true });
            await run.bundleAppended;
            clock!.tick(30_000);
            expect(run.document.getElementById('qaap-login-host')).to.not.equal(null);
            expect(run.document.getElementById('qaap-startup-error')).to.equal(null);
        });

        it('qaap-startup-ready removes a shown retry screen', async () => {
            const run = startWithFakeTimers();
            await loadedBundle(run);
            clock!.tick(30_000);
            expect(run.document.getElementById('qaap-startup-error')).to.not.equal(null);
            run.window.dispatchEvent(new run.window.Event('qaap-startup-ready'));
            expect(run.document.getElementById('qaap-startup-error')).to.equal(null);
        });

        it('qaap-startup-ready before the deadline disarms the watchdog', async () => {
            const run = startWithFakeTimers();
            await loadedBundle(run);
            run.window.dispatchEvent(new run.window.Event('qaap-startup-ready'));
            clock!.tick(60_000);
            expect(run.document.getElementById('qaap-startup-error')).to.equal(null);
        });
    });
});

