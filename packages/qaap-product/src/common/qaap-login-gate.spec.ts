// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { runLoginGate, type LoginGateResponder, type LoginGateRun } from './test/qaap-login-gate-harness';

const CONFIG = '/qaap/api/auth/config';
const SESSION = '/qaap/api/auth/session';
const SIGNED_IN_USER = { provider: 'github', login: 'octocat', name: 'The Octocat' };

describe('Qaap login gate', () => {
    const runs: LoginGateRun[] = [];

    afterEach(() => {
        runs.splice(0).forEach(run => run.dom.window.close());
    });

    function start(responder: LoginGateResponder, url?: string): LoginGateRun {
        const run = runLoginGate(responder, url);
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
});
