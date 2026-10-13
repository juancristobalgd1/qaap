// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { withGlobal, type InstalledClock } from '@sinonjs/fake-timers';
import { runLoginGate, stubMobileViewport, type LoginGateOptions, type LoginGateResponder, type LoginGateRun } from './test/qaap-login-gate-harness';

const CONFIG = '/qaap/api/auth/config';
const SESSION = '/qaap/api/auth/session';
const HEALTH = '/qaap/api/health';
const PROJECT_SESSIONS = '/qaap/api/github/project-sessions';
const USER_SETTINGS = '/qaap/api/user-settings';
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

    it('clears a saved IDE surface and holds Work Hub in front on mobile boot', async () => {
        const run = start(
            pathname => pathname === CONFIG ? { ok: true, body: { skipAuth: true } } : undefined,
            'http://localhost:3000/#/workspace/demo',
            {
                beforeRun: window => {
                    window.sessionStorage.setItem('qaap.mobileProjects.preferDesktopIde', '1');
                    window.sessionStorage.setItem('qaap.mobileProjects.explicitDesktopIde', '1');
                    window.matchMedia = (query: string): MediaQueryList => ({
                        matches: query === '(max-width: 767px), (pointer: coarse)',
                        media: query,
                        onchange: null,
                        addListener: () => undefined,
                        removeListener: () => undefined,
                        addEventListener: () => undefined,
                        removeEventListener: () => undefined,
                        dispatchEvent: () => false,
                    } as MediaQueryList);
                },
            },
        );
        await run.bundleAppended;
        expect(run.window.sessionStorage.getItem('qaap.mobileProjects.preferDesktopIde')).to.equal(null);
        expect(run.window.sessionStorage.getItem('qaap.mobileProjects.explicitDesktopIde')).to.equal(null);
        expect(run.document.body.classList.contains('theia-mobile-mod-workhub-composer-header')).to.equal(true);
        expect(run.document.documentElement.classList.contains('theia-mobile-workhub-boot')).to.equal(true);
    });

    describe('mobile boot guard watchdog (8 s)', () => {
        let guardClock: InstalledClock | undefined;
        const PLACEHOLDER_ID = 'qaap-mobile-workhub-connecting';

        afterEach(() => {
            guardClock?.uninstall();
            guardClock = undefined;
        });

        function startGuard(mobile: boolean): LoginGateRun {
            return start(
                pathname => pathname === CONFIG ? { ok: true, body: { skipAuth: true } } : undefined,
                'http://localhost:3000/#/workspace/demo',
                {
                    beforeRun: window => {
                        guardClock = withGlobal(window).install({ toFake: ['setTimeout', 'clearTimeout'] });
                        window.matchMedia = (query: string): MediaQueryList => ({
                            matches: mobile && query === '(max-width: 767px), (pointer: coarse)',
                            media: query,
                            onchange: null,
                            addListener: () => undefined,
                            removeListener: () => undefined,
                            addEventListener: () => undefined,
                            removeEventListener: () => undefined,
                            dispatchEvent: () => false,
                        } as MediaQueryList);
                    },
                },
            );
        }

        it('mobile: keeps the IDE shell hidden and shows the loading placeholder', async () => {
            const run = startGuard(true);
            await run.bundleAppended;
            expect(run.document.documentElement.classList.contains('theia-mobile-workhub-boot')).to.equal(true);
            guardClock!.tick(8000);
            expect(run.document.documentElement.classList.contains('theia-mobile-workhub-boot')).to.equal(true);
            expect(run.document.body.classList.contains('theia-mobile-mod-workhub-composer-header')).to.equal(true);
            const placeholder = run.document.getElementById(PLACEHOLDER_ID);
            expect(placeholder, 'placeholder').not.to.equal(null);
            expect(placeholder!.textContent).to.contain('Loading');
            // Showing it again must stay idempotent.
            guardClock!.tick(60_000);
            expect(run.document.querySelectorAll('#' + PLACEHOLDER_ID).length).to.equal(1);
        });

        it('mobile: shows no placeholder once the Work Hub has already lifted the guard', async () => {
            const run = startGuard(true);
            await run.bundleAppended;
            run.document.documentElement.classList.remove('theia-mobile-workhub-boot');
            guardClock!.tick(8000);
            expect(run.document.getElementById(PLACEHOLDER_ID)).to.equal(null);
        });

        it('desktop: still lifts the boot guard after the timeout and shows no placeholder', async () => {
            const run = startGuard(false);
            await run.bundleAppended;
            expect(run.document.documentElement.classList.contains('theia-mobile-workhub-boot')).to.equal(true);
            guardClock!.tick(8000);
            expect(run.document.documentElement.classList.contains('theia-mobile-workhub-boot')).to.equal(false);
            expect(run.document.getElementById(PLACEHOLDER_ID)).to.equal(null);
        });
    });

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
            // The confirmed session then starts the Work Hub data reads with the bundle.
            expect(run.requests).to.deep.equal([SESSION, PROJECT_SESSIONS, USER_SETTINGS]);
        });

        it('falls back to the sign-in gate when the callback session cannot be confirmed', async () => {
            const run = start(() => undefined, 'http://localhost:3000/?qaap_oauth=github');
            await run.bundleAppended;
            expect(run.document.getElementById('qaap-login-host')).to.not.equal(null);
        });

        it('keeps the sign-in gate (never reveals the IDE) when the callback has no signed-in session', async () => {
            const run = start(
                pathname => pathname === SESSION ? { ok: true, body: { signedIn: false } } : undefined,
                'http://localhost:3000/?qaap_oauth=github&keep=1',
            );
            await run.bundleAppended;
            expect(run.document.getElementById('qaap-login-host')).to.not.equal(null);
            expect(run.document.body.classList.contains('qaap-login-active')).to.equal(true);
            expect(run.window.location.search).to.equal('?keep=1');
        });

        it('logs the backend reason of a failed OAuth callback and shows the gate', async () => {
            const run = start(() => undefined, 'http://localhost:3000/?qaap_oauth_error=1&qaap_oauth_reason=state_mismatch');
            await run.bundleAppended;
            expect(run.consoleErrors.join('\n')).to.contain('Reason: state_mismatch');
            expect(run.document.getElementById('qaap-login-host')).to.not.equal(null);
        });
    });

    describe('cold start probes', () => {
        it('renders the mobile sign-in gate immediately while auth probes are still pending', async () => {
            const run = start(() => new Promise<undefined>(() => undefined), undefined, {
                headHtml: '<meta name="qaap-bundle-css" content="./bundle.css?qaap-build=test">',
                beforeRun: window => {
                    window.matchMedia = (query: string): MediaQueryList => ({
                        matches: query === '(max-width: 767px), (pointer: coarse)',
                        media: query,
                        onchange: null,
                        addListener: () => undefined,
                        removeListener: () => undefined,
                        addEventListener: () => undefined,
                        removeEventListener: () => undefined,
                        dispatchEvent: () => false,
                    } as MediaQueryList);
                },
            });
            const startedAt = Date.now();
            await run.waitFor(() => run.document.getElementById('qaap-login-github') !== null, 'mobile sign-in gate');

            expect(Date.now() - startedAt).to.be.lessThan(2000);
            expect(run.document.getElementById('qaap-login-github')?.textContent).to.contain('Sign in with GitHub');
            expect(run.document.querySelectorAll('script[src*="bundle.js"]')).to.have.length(0);
            expect(run.document.querySelectorAll('link[href*="bundle.css"]')).to.have.length(0);
            expect((run.window as unknown as { __qaapBundleLoading?: boolean }).__qaapBundleLoading).to.equal(undefined);
        });

        it('loads the deferred mobile stylesheet with the bundle after session confirmation', async () => {
            const run = start(pathname => {
                if (pathname === CONFIG) {
                    return { ok: true, body: { skipAuth: false, githubOAuth: true } };
                }
                return pathname === SESSION ? { ok: true, body: { signedIn: true, user: SIGNED_IN_USER } } : undefined;
            }, undefined, {
                headHtml: '<meta name="qaap-bundle-css" content="./bundle.css?qaap-build=mobile-test">',
                beforeRun: window => {
                    window.matchMedia = (query: string): MediaQueryList => ({
                        matches: query === '(max-width: 767px), (pointer: coarse)',
                        media: query,
                        onchange: null,
                        addListener: () => undefined,
                        removeListener: () => undefined,
                        addEventListener: () => undefined,
                        removeEventListener: () => undefined,
                        dispatchEvent: () => false,
                    } as MediaQueryList);
                },
            });

            await run.bundleAppended;

            expect(run.document.getElementById('qaap-login-host')).to.equal(null);
            expect(run.document.querySelector('link#qaap-bundle-css')?.getAttribute('href'))
                .to.equal('./bundle.css?qaap-build=mobile-test');
        });

        it('probes auth config and session in parallel and loads a signed-in user without the gate', async () => {
            const run = start(pathname => {
                if (pathname === CONFIG) {
                    return { ok: true, body: { skipAuth: false } };
                }
                return pathname === SESSION ? { ok: true, body: { signedIn: true, user: SIGNED_IN_USER } } : undefined;
            });
            await run.bundleAppended;
            expect(run.requests.slice(0, 2).sort()).to.deep.equal([CONFIG, SESSION].sort());
            expect(run.requests.filter(request => request === SESSION)).to.have.length(1);
            expect(run.document.getElementById('qaap-login-host')).to.equal(null);
        });

        it('starts the Work Hub data reads once the session is confirmed, before the bundle boots', async () => {
            // The frontend only asks for these after all its modules loaded (7-12 s into a cold
            // page load in logs/perf-baseline); qaap-boot-prefetch.ts hands it these responses.
            const run = start(pathname => {
                if (pathname === CONFIG) {
                    return { ok: true, body: { skipAuth: false } };
                }
                return pathname === SESSION ? { ok: true, body: { signedIn: true, user: SIGNED_IN_USER } } : { ok: true, body: {} };
            });
            await run.bundleAppended;
            expect(run.requests).to.include.members([PROJECT_SESSIONS, USER_SETTINGS]);
            const prefetch = (run.window as unknown as {
                __qaapBootPrefetch?: Record<string, { startedAt: number; response: Promise<unknown> }>;
            }).__qaapBootPrefetch;
            expect(Object.keys(prefetch ?? {}).sort()).to.deep.equal([PROJECT_SESSIONS, USER_SETTINGS].sort());
            expect(prefetch?.[PROJECT_SESSIONS].startedAt).to.be.a('number');
            expect(prefetch?.[PROJECT_SESSIONS].response.then).to.be.a('function');
        });

        it('does not read Work Hub data when the tab reloads into the classic IDE', async () => {
            const run = start(pathname => {
                if (pathname === CONFIG) {
                    return { ok: true, body: { skipAuth: false } };
                }
                return pathname === SESSION ? { ok: true, body: { signedIn: true, user: SIGNED_IN_USER } } : { ok: true, body: {} };
            }, undefined, {
                beforeRun: window => window.sessionStorage.setItem('qaap.mobileProjects.preferDesktopIde', '1'),
            });
            await run.bundleAppended;
            expect(run.requests).not.to.include(PROJECT_SESSIONS);
            expect(run.requests).not.to.include(USER_SETTINGS);
        });

        it('does not read Work Hub data for a visitor who is not signed in', async () => {
            const run = start(pathname => {
                if (pathname === CONFIG) {
                    return { ok: true, body: { skipAuth: false, githubOAuth: true } };
                }
                return pathname === SESSION ? { ok: true, body: { signedIn: false } } : undefined;
            });
            await run.waitFor(() => run.document.getElementById('qaap-login-github') !== null, 'sign-in gate');
            expect(run.requests).not.to.include(PROJECT_SESSIONS);
            expect(run.requests).not.to.include(USER_SETTINGS);
        });

        it('still honours skip-auth dev mode while the session probe runs', async () => {
            const run = start(pathname => pathname === CONFIG ? { ok: true, body: { skipAuth: true } } : undefined);
            await run.bundleAppended;
            expect(run.document.getElementById('qaap-login-host')).to.equal(null);
        });
    });

    describe('mobile entry (bundle-mobile.js, QAAP_MOBILE_ENTRY)', () => {
        const MOBILE_QUERY = '(max-width: 767px), (pointer: coarse)';
        const FAILED_KEY = 'qaap.boot.mobileEntryFailed';

        function mobileViewport(window: Window & typeof globalThis, mobile = true): void {
            window.matchMedia = (query: string): MediaQueryList => ({
                matches: mobile && query === MOBILE_QUERY,
                media: query,
                onchange: null,
                addListener: () => undefined,
                removeListener: () => undefined,
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
                dispatchEvent: () => false,
            } as MediaQueryList);
        }

        function startSignedIn(mobileEntry: boolean | undefined, options: { mobile?: boolean; failedBefore?: boolean } = {}): LoginGateRun {
            const flag = mobileEntry === undefined ? {} : { mobileEntry };
            return start(pathname => {
                if (pathname === CONFIG) {
                    return { ok: true, body: { skipAuth: false, githubOAuth: true, ...flag } };
                }
                return pathname === SESSION ? { ok: true, body: { signedIn: true, user: SIGNED_IN_USER, ...flag } } : undefined;
            }, undefined, {
                headHtml: '<meta name="qaap-bundle-css" content="./bundle.css?qaap-build=b1">',
                beforeRun: window => {
                    mobileViewport(window, options.mobile ?? true);
                    if (options.failedBefore) {
                        window.sessionStorage.setItem(FAILED_KEY, 'script-error');
                    }
                },
            });
        }

        function loadedCss(run: LoginGateRun): string | null | undefined {
            return run.document.querySelector('link#qaap-bundle-css')?.getAttribute('href');
        }

        it('loads bundle-mobile.js and bundle-mobile.css for a signed-in mobile user when the server flag is on', async () => {
            const run = startSignedIn(true);
            const { script } = await run.bundleAppended;
            expect(script.getAttribute('src')).to.match(/^\.\/bundle-mobile\.js\?qaap-build=b1$/);
            expect(loadedCss(run)).to.equal('./bundle-mobile.css?qaap-build=b1');
        });

        it('keeps bundle.js while the server flag is off (default)', async () => {
            const run = startSignedIn(undefined);
            const { script } = await run.bundleAppended;
            expect(script.getAttribute('src')).to.equal('./bundle.js?qaap-build=b1');
            expect(loadedCss(run)).to.equal('./bundle.css?qaap-build=b1');
        });

        it('keeps bundle.js on desktop even with the flag on', async () => {
            const run = startSignedIn(true, { mobile: false });
            const { script } = await run.bundleAppended;
            expect(script.getAttribute('src')).to.equal('./bundle.js?qaap-build=b1');
        });

        it('keeps bundle.js after the mobile entry failed once in this tab', async () => {
            const run = startSignedIn(true, { failedBefore: true });
            const { script } = await run.bundleAppended;
            expect(script.getAttribute('src')).to.equal('./bundle.js?qaap-build=b1');
        });

        it('stays on bundle-mobile.js when the download is merely slow (bundle watchdog)', async () => {
            let clock: InstalledClock | undefined;
            const run = start(pathname => {
                if (pathname === CONFIG) {
                    return { ok: true, body: { skipAuth: false, githubOAuth: true, mobileEntry: true } };
                }
                return pathname === SESSION ? { ok: true, body: { signedIn: true, user: SIGNED_IN_USER, mobileEntry: true } } : undefined;
            }, undefined, {
                headHtml: '<meta name="qaap-bundle-css" content="./bundle.css?qaap-build=b1">',
                beforeRun: window => {
                    mobileViewport(window);
                    clock = withGlobal(window).install({ toFake: ['setTimeout', 'clearTimeout'] });
                },
            });
            try {
                const { script } = await run.bundleAppended;
                clock!.tick(30_000);
                expect(script.getAttribute('src')).to.match(/^\.\/bundle-mobile\.js/);
                expect(run.window.sessionStorage.getItem(FAILED_KEY)).to.equal(null);
                expect(run.pageErrors.some(error => /navigation/i.test(error))).to.equal(false);
            } finally {
                clock?.uninstall();
            }
        });

        it('records the failure and reloads into bundle.js when bundle-mobile.js fails to load', async () => {
            const run = startSignedIn(true);
            // The reload is a jsdom "not implemented" navigation: checked here instead of in afterEach.
            runs.splice(runs.indexOf(run), 1);
            const { script } = await run.bundleAppended;
            script.dispatchEvent(new run.window.Event('error'));
            expect(run.window.sessionStorage.getItem(FAILED_KEY)).to.equal('script-error');
            expect(run.document.getElementById('qaap-startup-error')).to.equal(null);
            expect(run.pageErrors.every(error => /navigation/i.test(error))).to.equal(true);
            run.dom.window.close();
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

        it('keeps GitHub sign-in available when auth config times out but health is reachable', async () => {
            let clock: InstalledClock | undefined;
            const run = start(pathname => {
                if (pathname === HEALTH) {
                    return { ok: true, body: { ready: true } };
                }
                if (pathname === SESSION) {
                    return { ok: true, body: { signedIn: false } };
                }
                return pathname === CONFIG ? new Promise<undefined>(() => undefined) : undefined;
            }, 'https://qaap.example/', {
                beforeRun: window => {
                    clock = withGlobal(window).install({ toFake: ['setTimeout', 'clearTimeout'] });
                    window.matchMedia = (query: string): MediaQueryList => ({
                        matches: query === '(max-width: 767px), (pointer: coarse)',
                        media: query,
                        onchange: null,
                        addListener: () => undefined,
                        removeListener: () => undefined,
                        addEventListener: () => undefined,
                        removeEventListener: () => undefined,
                        dispatchEvent: () => false,
                    } as MediaQueryList);
                },
            });
            const retry = run.document.getElementById('qaap-login-retry') as HTMLButtonElement;

            try {
                await run.waitFor(() => button(run) !== null, 'GitHub sign-in button');
                expect((await run.window.fetch(HEALTH)).ok).to.equal(true);
                await clock!.tickAsync(4000);

                expect(button(run).disabled).to.equal(false);
                expect(button(run).textContent).to.contain('Sign in with GitHub');
                expect(status(run)).to.not.contain('The Qaap server is not responding.');
                expect(retry.hidden).to.equal(true);
                expect(run.requests.filter(request => request === CONFIG)).to.have.length(2);
            } finally {
                clock?.uninstall();
            }
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

        it('wraps between visible links when the leading buttons are disabled or hidden', async () => {
            const run = start(pathname => pathname === CONFIG
                ? { ok: true, body: { skipAuth: false, githubOAuth: false } }
                : undefined);
            await run.waitFor(() => (run.document.getElementById('qaap-login-github') as HTMLButtonElement)?.disabled === true,
                'GitHub button disabled');
            const terms = run.document.querySelector('a[href="/legal/terms.html"]') as HTMLAnchorElement;
            const privacy = run.document.querySelector('a[href="/legal/privacy.html"]') as HTMLAnchorElement;

            // GitHub is disabled; local mode and retry are hidden, leaving the legal links reachable.
            privacy.focus();
            expect(tab(run).defaultPrevented).to.equal(true);
            expect(run.document.activeElement).to.equal(terms);
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

        const RUNTIME_STATUS = '/qaap/api/cloud/runtime/status';

        /** `runtimeStates[n]` answers the n-th runtime status probe; `undefined` (or past the end) fails it. */
        function startWithFakeTimers(
            config: object = { skipAuth: true },
            splash = '<div class="theia-preload"></div>',
            runtimeStates: Array<string | undefined> = [],
        ): LoginGateRun {
            return start((pathname, call) => {
                if (pathname === CONFIG) {
                    return { ok: true, body: config };
                }
                const state = pathname === RUNTIME_STATUS ? runtimeStates[call] : undefined;
                return state ? { ok: true, body: { runtime: { tenantLogin: 'alice', state, reaperEnabled: true } } } : undefined;
            }, undefined, {
                bodyHtml: splash,
                beforeRun: window => { clock = withGlobal(window).install({ toFake: ['setTimeout', 'clearTimeout'] }); },
            });
        }

        function startupError(run: LoginGateRun): string | undefined {
            return run.document.getElementById('qaap-startup-error')?.textContent ?? undefined;
        }

        function startupWait(run: LoginGateRun): string | undefined {
            return run.document.getElementById('qaap-startup-wait')?.textContent ?? undefined;
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
            // The runtime status probe failed: not a known cold start, so fail as before.
            await run.waitFor(() => startupError(run) !== undefined, 'startup error');
            expect(startupError(run)).to.contain('The application took too long to start.');
            expect(run.requests).to.include(RUNTIME_STATUS);
        });

        it('keeps waiting with "Starting your workspace" while the tenant runtime is starting', async () => {
            const run = startWithFakeTimers(undefined, undefined, ['starting', 'stopped']);
            await loadedBundle(run);
            clock!.tick(30_000);
            await run.waitFor(() => startupWait(run) !== undefined, 'startup wait message');
            expect(startupWait(run)).to.equal('Starting your workspace\u2026');
            expect(startupError(run)).to.equal(undefined);
            clock!.tick(30_000);
            await run.waitFor(() => run.requests.filter(request => request === RUNTIME_STATUS).length === 2, 'second runtime probe');
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(startupError(run)).to.equal(undefined);
            // Third probe has no answer: the runtime is no longer known to be starting.
            clock!.tick(30_000);
            await run.waitFor(() => startupError(run) !== undefined, 'startup error after the runtime stopped starting');
            expect(startupWait(run)).to.equal(undefined);
        });

        it('gives up after the 120 s cap even while the runtime still reports starting', async () => {
            const run = startWithFakeTimers(undefined, undefined, ['starting', 'starting', 'starting', 'starting']);
            await loadedBundle(run);
            for (let round = 1; round <= 3; round++) {
                clock!.tick(30_000);
                await run.waitFor(() => run.requests.filter(request => request === RUNTIME_STATUS).length === round, `runtime probe ${round}`);
                await new Promise(resolve => setTimeout(resolve, 10));
                expect(startupError(run)).to.equal(undefined);
            }
            clock!.tick(30_000);
            expect(startupError(run)).to.contain('The application took too long to start.');
            expect(run.requests.filter(request => request === RUNTIME_STATUS)).to.have.length(3);
        });

        it('fails at 30 s when the runtime is already active (not a cold start)', async () => {
            const run = startWithFakeTimers(undefined, undefined, ['active']);
            await loadedBundle(run);
            clock!.tick(30_000);
            await run.waitFor(() => startupError(run) !== undefined, 'startup error');
            expect(startupWait(run)).to.equal(undefined);
        });

        it('qaap-startup-ready removes the "Starting your workspace" message and disarms the watchdog', async () => {
            const run = startWithFakeTimers(undefined, undefined, ['starting']);
            await loadedBundle(run);
            clock!.tick(30_000);
            await run.waitFor(() => startupWait(run) !== undefined, 'startup wait message');
            run.window.dispatchEvent(new run.window.Event('qaap-startup-ready'));
            expect(startupWait(run)).to.equal(undefined);
            clock!.tick(120_000);
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(startupError(run)).to.equal(undefined);
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
            await run.waitFor(() => startupError(run) !== undefined, 'startup error');
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

    describe('mobile fast boot (stored session)', () => {
        const RUNTIME_STATUS = '/qaap/api/cloud/runtime/status';
        const PLACEHOLDER_ID = 'qaap-mobile-workhub-connecting';
        const SNAPSHOT_KEY = 'qaap.workhub.shellSnapshot.v1';
        const HINT_KEY = 'qaap.boot.mobileEntryHint';
        const BUNDLE_CSS_META = '<meta name="qaap-bundle-css" content="./bundle.css?qaap-build=b1">';
        const STORED_SESSION: Record<string, string> = {
            'theia:/:qaap.auth.signedIn': 'true',
            'theia:/:qaap.auth.user': JSON.stringify(SIGNED_IN_USER),
        };
        let clock: InstalledClock | undefined;

        afterEach(() => {
            clock?.uninstall();
            clock = undefined;
        });

        type StubResponse = { ok: boolean; body?: unknown } | undefined;

        interface FastBootOptions {
            readonly mobile?: boolean;
            readonly signedIn?: boolean;
            readonly storage?: Record<string, string>;
            readonly session?: () => StubResponse | Promise<StubResponse>;
            readonly runtimeStates?: Array<string | undefined>;
            readonly fakeTimers?: boolean;
            readonly beforeRun?: (window: Window & typeof globalThis) => void;
        }

        function snapshot(overrides: Record<string, unknown> = {}): string {
            return JSON.stringify({
                v: 1,
                savedAt: Date.now() - 60_000,
                login: 'octocat',
                projects: [
                    { name: 'octocat/hello-world', subtitle: 'main', threads: ['Fix the login flow', 'Add tests'] },
                    { name: 'octocat/spoon-knife' },
                ],
                ...overrides,
            });
        }

        function startFastBoot(options: FastBootOptions = {}): LoginGateRun {
            const signedIn = options.signedIn ?? true;
            return start((pathname, call) => {
                if (pathname === CONFIG) {
                    return { ok: true, body: { skipAuth: false, githubOAuth: true } };
                }
                if (pathname === SESSION) {
                    return options.session ? options.session() : { ok: true, body: { signedIn: true, user: SIGNED_IN_USER, mobileEntry: true } };
                }
                if (pathname === RUNTIME_STATUS) {
                    const state = (options.runtimeStates ?? [])[call];
                    return state ? { ok: true, body: { runtime: { tenantLogin: 'octocat', state, reaperEnabled: true } } } : undefined;
                }
                return { ok: true, body: {} };
            }, undefined, {
                headHtml: BUNDLE_CSS_META,
                localStorage: { ...(signedIn ? STORED_SESSION : {}), ...(options.storage ?? {}) },
                beforeRun: window => {
                    stubMobileViewport(window, options.mobile ?? true);
                    if (options.fakeTimers) {
                        clock = withGlobal(window).install({ toFake: ['setTimeout', 'clearTimeout'] });
                    }
                    options.beforeRun?.(window);
                },
            });
        }

        function preloadHref(run: LoginGateRun): string | null | undefined {
            return run.document.querySelector('link[rel="modulepreload"]')?.getAttribute('href');
        }

        function placeholderLabel(run: LoginGateRun): string | undefined {
            return run.document.querySelector(`#${PLACEHOLDER_ID} .qaap-mobile-workhub-connecting-label`)?.textContent ?? undefined;
        }

        async function runtimeProbed(run: LoginGateRun): Promise<void> {
            await run.bundleAppended;
            await run.waitFor(() => run.requests.includes(RUNTIME_STATUS), 'runtime status probe');
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        describe('bundle preload in parallel with the session check', () => {
            it('preloads bundle-mobile.js before the session answers and loads the identical URL', async () => {
                let answerSession: (value: StubResponse) => void = () => undefined;
                const pendingSession = new Promise<StubResponse>(resolve => { answerSession = resolve; });
                const run = startFastBoot({ storage: { [HINT_KEY]: '1' }, session: () => pendingSession });
                // Synchronously, while /auth/session is still in flight.
                expect(preloadHref(run)).to.equal('./bundle-mobile.js?qaap-build=b1');
                expect(run.document.querySelectorAll('link[rel="modulepreload"]')).to.have.length(1);
                expect(run.document.querySelectorAll('script[src*="bundle"]')).to.have.length(0);
                answerSession({ ok: true, body: { signedIn: true, user: SIGNED_IN_USER, mobileEntry: true } });
                const { script } = await run.bundleAppended;
                expect(script.getAttribute('src')).to.equal(preloadHref(run));
            });

            it('preloads bundle.js when the last session did not enable the mobile entry', async () => {
                const run = startFastBoot({ session: () => ({ ok: true, body: { signedIn: true, user: SIGNED_IN_USER } }) });
                expect(preloadHref(run)).to.equal('./bundle.js?qaap-build=b1');
                const { script } = await run.bundleAppended;
                expect(script.getAttribute('src')).to.equal('./bundle.js?qaap-build=b1');
            });

            it('remembers the server flag from the session probe for the next boot', async () => {
                const on = startFastBoot();
                await on.bundleAppended;
                expect(on.window.localStorage.getItem(HINT_KEY)).to.equal('1');
                const off = startFastBoot({
                    storage: { [HINT_KEY]: '1' },
                    session: () => ({ ok: true, body: { signedIn: true, user: SIGNED_IN_USER } }),
                });
                await off.bundleAppended;
                expect(off.window.localStorage.getItem(HINT_KEY)).to.equal(null);
            });

            it('downloads nothing for an unauthenticated phone on the sign-in screen', async () => {
                const run = startFastBoot({ signedIn: false, storage: { [HINT_KEY]: '1' }, session: () => ({ ok: true, body: { signedIn: false } }) });
                await run.waitFor(() => run.document.getElementById('qaap-login-github') !== null, 'sign-in gate');
                await new Promise(resolve => setTimeout(resolve, 20));
                expect(run.document.querySelectorAll('link[rel="modulepreload"]')).to.have.length(0);
                expect(run.document.querySelectorAll('script[src*="bundle"]')).to.have.length(0);
            });

            it('still preloads bundle.js on desktop with a stored session', () => {
                const run = startFastBoot({ mobile: false, storage: { [HINT_KEY]: '1' } });
                expect(preloadHref(run)).to.equal('./bundle.js?qaap-build=b1');
            });
        });

        describe('phase-aware placeholder', () => {
            it('shows nothing extra for 1.5 s, then "Starting your workspace" while the runtime is cold', async () => {
                const run = startFastBoot({ fakeTimers: true, runtimeStates: ['stopped', 'starting'] });
                await runtimeProbed(run);
                // The session is verified and the runtime known to be cold, but the 1.5 s timer
                // (counted from gate start, faked here) has not fired: nothing extra on screen.
                expect(run.document.getElementById(PLACEHOLDER_ID)).to.equal(null);
                clock!.tick(1500);
                expect(placeholderLabel(run)).to.equal('Starting your workspace…');
                expect(run.document.documentElement.classList.contains('theia-mobile-workhub-boot')).to.equal(true);
            });

            it('says "Loading" when the runtime is already active and does not poll again', async () => {
                const run = startFastBoot({ fakeTimers: true, runtimeStates: ['active'] });
                await runtimeProbed(run);
                clock!.tick(1500);
                expect(placeholderLabel(run)).to.equal('Loading…');
                clock!.tick(20_000);
                expect(run.requests.filter(request => request === RUNTIME_STATUS)).to.have.length(1);
            });

            it('switches to "Loading" once a cold runtime becomes active', async () => {
                const run = startFastBoot({ fakeTimers: true, runtimeStates: ['starting', 'active'] });
                await runtimeProbed(run);
                clock!.tick(1500);
                expect(placeholderLabel(run)).to.equal('Starting your workspace…');
                clock!.tick(4000);
                await run.waitFor(() => placeholderLabel(run) === 'Loading…', 'loading text after the runtime is active');
            });

            it('polls the runtime status a bounded number of times', async () => {
                const run = startFastBoot({ fakeTimers: true, runtimeStates: new Array(20).fill('starting') });
                const { script } = await run.bundleAppended;
                script.dispatchEvent(new run.window.Event('load'));
                for (let round = 0; round < 15; round++) {
                    await new Promise(resolve => setTimeout(resolve, 5));
                    clock!.tick(4000);
                }
                await new Promise(resolve => setTimeout(resolve, 10));
                expect(run.requests.filter(request => request === RUNTIME_STATUS)).to.have.length(8);
            });

            it('stops polling once the Work Hub is ready', async () => {
                const run = startFastBoot({ fakeTimers: true, runtimeStates: new Array(20).fill('starting') });
                await runtimeProbed(run);
                run.window.dispatchEvent(new run.window.Event('qaap-startup-ready'));
                // What clearMobileWorkHubBootGuard() does.
                run.document.documentElement.classList.remove('theia-mobile-workhub-boot');
                run.document.getElementById(PLACEHOLDER_ID)?.remove();
                clock!.tick(40_000);
                await new Promise(resolve => setTimeout(resolve, 10));
                expect(run.requests.filter(request => request === RUNTIME_STATUS)).to.have.length(1);
                expect(run.document.getElementById(PLACEHOLDER_ID)).to.equal(null);
            });

            it('shows no placeholder over the sign-in screen', async () => {
                const run = startFastBoot({ signedIn: false, fakeTimers: true, session: () => ({ ok: true, body: { signedIn: false } }) });
                await run.waitFor(() => run.document.getElementById('qaap-login-github') !== null, 'sign-in gate');
                clock!.tick(10_000);
                expect(run.document.getElementById(PLACEHOLDER_ID)).to.equal(null);
                expect(run.requests).not.to.include(RUNTIME_STATUS);
            });
        });

        describe('instant Work Hub shell from the cached snapshot', () => {
            it('paints the cached projects in the first frame, escaped and non-interactive', () => {
                const hostile = '<img src=x onerror="window.__pwned=1">';
                const run = startFastBoot({
                    session: () => new Promise<StubResponse>(() => undefined),
                    storage: { [SNAPSHOT_KEY]: snapshot({ theme: 'dark', projects: [{ name: hostile, subtitle: 'main', threads: ['Fix the login flow'] }] }) },
                });
                // No await: painted synchronously while the gate script ran.
                const shell = run.document.getElementById(PLACEHOLDER_ID);
                expect(shell, 'shell').not.to.equal(null);
                expect(shell!.classList.contains('qaap-boot-shell')).to.equal(true);
                expect(shell!.classList.contains('qaap-boot-theme-dark')).to.equal(true);
                expect(shell!.querySelector('.qaap-boot-shell-name')?.textContent).to.equal(hostile);
                expect(shell!.querySelector('.qaap-boot-shell-thread')?.textContent).to.equal('Fix the login flow');
                expect(shell!.querySelectorAll('img, button, a, input')).to.have.length(0);
                expect(placeholderLabel(run)).to.equal('');
                expect((run.window as unknown as { __pwned?: number }).__pwned).to.equal(undefined);
            });

            it('renders the header and the list of recent projects', () => {
                const run = startFastBoot({ session: () => new Promise<StubResponse>(() => undefined), storage: { [SNAPSHOT_KEY]: snapshot() } });
                const names = Array.from(run.document.querySelectorAll('.qaap-boot-shell-name')).map(node => node.textContent);
                expect(names).to.deep.equal(['octocat/hello-world', 'octocat/spoon-knife']);
                expect(run.document.querySelector('.qaap-boot-shell-title')?.textContent).to.equal('Qaap');
            });

            it('fills in the phase text later without rebuilding the shell', async () => {
                const run = startFastBoot({ fakeTimers: true, runtimeStates: ['starting'], storage: { [SNAPSHOT_KEY]: snapshot() } });
                const shell = run.document.getElementById(PLACEHOLDER_ID);
                expect(shell).not.to.equal(null);
                await runtimeProbed(run);
                clock!.tick(1500);
                expect(run.document.getElementById(PLACEHOLDER_ID)).to.equal(shell);
                expect(placeholderLabel(run)).to.equal('Starting your workspace…');
            });

            const skipped: Array<[string, FastBootOptions]> = [
                ['there is no snapshot', {}],
                ['the snapshot is malformed JSON', { storage: { [SNAPSHOT_KEY]: '{not json' } }],
                ['the snapshot has another version', { storage: { [SNAPSHOT_KEY]: snapshot({ v: 2 }) } }],
                ['the snapshot projects are not a list', { storage: { [SNAPSHOT_KEY]: snapshot({ projects: 'octocat/hello-world' }) } }],
                ['the snapshot belongs to another user', { storage: { [SNAPSHOT_KEY]: snapshot({ login: 'someone-else' }) } }],
                ['the snapshot is stale', { storage: { [SNAPSHOT_KEY]: snapshot({ savedAt: Date.now() - 30 * 24 * 3600 * 1000 }) } }],
                ['the viewport is a desktop', { mobile: false, storage: { [SNAPSHOT_KEY]: snapshot() } }],
                ['the tab reloads into the classic IDE', {
                    mobile: false,
                    storage: { [SNAPSHOT_KEY]: snapshot() },
                    beforeRun: window => window.sessionStorage.setItem('qaap.mobileProjects.preferDesktopIde', '1'),
                }],
                ['a Work Hub action is pending (no boot guard)', {
                    storage: { [SNAPSHOT_KEY]: snapshot() },
                    beforeRun: window => window.sessionStorage.setItem('qaap.hub.pendingAction', '{}'),
                }],
                ['there is no stored session', { signedIn: false, storage: { [SNAPSHOT_KEY]: snapshot() } }],
            ];
            for (const [label, options] of skipped) {
                it(`is skipped when ${label}`, () => {
                    const run = startFastBoot({ session: () => new Promise<StubResponse>(() => undefined), ...options });
                    expect(run.document.querySelector('.qaap-boot-shell')).to.equal(null);
                });
            }

            it('removes the shell and forgets the snapshot when the stored session is no longer valid', async () => {
                const run = startFastBoot({ storage: { [SNAPSHOT_KEY]: snapshot() }, session: () => ({ ok: true, body: { signedIn: false } }) });
                expect(run.document.querySelector('.qaap-boot-shell')).not.to.equal(null);
                await run.waitFor(() => run.document.getElementById('qaap-login-github') !== null, 'sign-in gate');
                expect(run.document.getElementById(PLACEHOLDER_ID)).to.equal(null);
                expect(run.window.localStorage.getItem(SNAPSHOT_KEY)).to.equal(null);
            });

            it('?qaapLogout=1 forgets the snapshot', () => {
                const run = start(() => undefined, 'http://localhost:3000/?qaapLogout=1', {
                    localStorage: { ...STORED_SESSION, [SNAPSHOT_KEY]: snapshot() },
                });
                expect(run.window.localStorage.getItem(SNAPSHOT_KEY)).to.equal(null);
                expect(run.document.querySelector('.qaap-boot-shell')).to.equal(null);
            });
        });

        describe('boot timings', () => {
            interface BootTimings {
                marks: Record<string, number>;
                deltas: Record<string, number | undefined>;
                entry?: string;
                shellSnapshot: boolean;
                runtimeCold: boolean;
            }

            function timingsOf(run: LoginGateRun): BootTimings | undefined {
                return (run.window as unknown as { __qaapBootTimings?: BootTimings }).__qaapBootTimings;
            }

            it('records the milestones and reports them once on qaap-startup-ready', async () => {
                const run = startFastBoot({ storage: { [SNAPSHOT_KEY]: snapshot() } });
                const { script } = await run.bundleAppended;
                script.dispatchEvent(new run.window.Event('load'));
                run.window.dispatchEvent(new run.window.Event('qaap-startup-ready'));
                run.window.dispatchEvent(new run.window.Event('qaap-startup-ready'));
                const timings = timingsOf(run);
                expect(timings, 'window.__qaapBootTimings').not.to.equal(undefined);
                expect(Object.keys(timings!.marks)).to.include.members([
                    'gate-start', 'shell-painted', 'bundle-preloaded', 'session-verified', 'bundle-requested', 'bundle-loaded', 'startup-ready',
                ]);
                const marks = timings!.marks;
                expect(marks['gate-start']).to.be.at.most(marks['session-verified']);
                expect(marks['bundle-requested']).to.be.at.most(marks['bundle-loaded']);
                expect(marks['bundle-loaded']).to.be.at.most(marks['startup-ready']);
                expect(timings!.deltas.total).to.be.a('number');
                expect(timings!.entry).to.equal('mobile');
                expect(timings!.shellSnapshot).to.equal(true);
                const stored = JSON.parse(run.window.sessionStorage.getItem('qaap.boot.lastTimings') ?? 'null');
                expect(stored.marks['startup-ready']).to.equal(marks['startup-ready']);
                const lines = run.consoleInfos.filter(line => line.startsWith('[qaap-boot]'));
                expect(lines).to.have.length(1);
                expect(lines[0]).to.contain('startup-ready=');
            });

            it('marks a cold runtime', async () => {
                const run = startFastBoot({ runtimeStates: ['stopped'] });
                await runtimeProbed(run);
                run.window.dispatchEvent(new run.window.Event('qaap-startup-ready'));
                expect(timingsOf(run)!.marks['runtime-cold']).to.be.a('number');
                expect(timingsOf(run)!.runtimeCold).to.equal(true);
            });

            it('never throws when sessionStorage is unavailable', async () => {
                const run = startFastBoot({
                    beforeRun: window => {
                        Object.defineProperty(window, 'sessionStorage', { get: () => { throw new Error('denied'); } });
                    },
                });
                await run.bundleAppended;
                run.window.dispatchEvent(new run.window.Event('qaap-startup-ready'));
                expect(run.consoleInfos.some(line => line.startsWith('[qaap-boot]'))).to.equal(true);
            });
        });
    });
});
