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

    const MOBILE_QUERY = '(max-width: 767px), (pointer: coarse)';
    const signedIn = { localStorage: { 'theia:/:qaap.auth.signedIn': 'true' } };
    const signedInSession: LoginGateResponder = pathname =>
        pathname === SESSION ? { ok: true, body: { signedIn: true, user: SIGNED_IN_USER } } : undefined;

    /** A `matchMedia` whose mobile query result can be flipped, firing `change` like a resize. */
    function installMobileMedia(window: Window & typeof globalThis): { setMobile(mobile: boolean): void } {
        let mobile = true;
        const listeners = new Set<() => void>();
        window.matchMedia = (query: string): MediaQueryList => ({
            get matches(): boolean {
                return query === MOBILE_QUERY && mobile;
            },
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: (_type: string, listener: () => void) => { listeners.add(listener); },
            removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener); },
            dispatchEvent: () => false,
        } as unknown as MediaQueryList);
        return {
            setMobile: next => {
                mobile = next;
                [...listeners].forEach(listener => listener());
            },
        };
    }

    function startMobile(): { run: LoginGateRun; media: { setMobile(mobile: boolean): void } } {
        let media: { setMobile(mobile: boolean): void } | undefined;
        const run = start(signedInSession, 'http://localhost:3000/', {
            ...signedIn,
            beforeRun: window => { media = installMobileMedia(window); },
        });
        return { run, media: media! };
    }

    it('loads only the mobile Work Hub entry on mobile and leaves desktop on the desktop entry', async () => {
        const mobile = startMobile().run;
        const mobileScript = (await mobile.bundleAppended).script;
        expect(new URL(mobileScript.src).pathname).to.equal('/bundle.mobile.js');
        const mobilePreload = mobile.document.querySelector('link[rel="modulepreload"]')?.getAttribute('href');
        expect(mobilePreload).to.not.equal(undefined);
        expect(new URL(mobilePreload!, mobile.window.location.href).href).to.equal(mobileScript.src);

        const desktop = start(
            signedInSession,
            'http://localhost:3000/',
            signedIn,
        );
        const desktopScript = (await desktop.bundleAppended).script;
        expect(new URL(desktopScript.src).pathname).to.equal('/bundle.js');
    });

    it('falls back to the desktop entry when the phone entry cannot be loaded', async () => {
        const { run } = startMobile();
        const mobileScript = (await run.bundleAppended).script;
        mobileScript.onerror!(new run.window.Event('error'));
        const scripts = (): string[] => [...run.document.querySelectorAll('script')].map(script => new URL(script.src).pathname);
        await run.waitFor(() => scripts().includes('/bundle.js'), 'desktop bundle script');
        expect(scripts()).to.deep.equal(['/bundle.js']);
        expect(run.document.getElementById('qaap-startup-error')).to.equal(null);
    });

    it('reloads into the desktop entry when a phone-entry window widens past the mobile rule', async () => {
        const { run, media } = startMobile();
        const mobileScript = (await run.bundleAppended).script;
        mobileScript.onload!(new run.window.Event('load'));
        media.setMobile(true);
        expect(run.pageErrors.filter(error => /navigation/.test(error))).to.deep.equal([]);
        // jsdom does not implement navigation: a reload surfaces as its "not implemented" error.
        media.setMobile(false);
        expect(run.pageErrors.filter(error => /navigation/.test(error))).to.have.length(1);
        media.setMobile(true);
        media.setMobile(false);
        expect(run.pageErrors.filter(error => /navigation/.test(error))).to.have.length(1);
        run.pageErrors.splice(0, run.pageErrors.length);
    });

    it('never reloads a desktop-entry window on resize', async () => {
        let media: { setMobile(mobile: boolean): void } | undefined;
        const run = start(signedInSession, 'http://localhost:3000/', {
            ...signedIn,
            beforeRun: window => {
                media = installMobileMedia(window);
                media.setMobile(false);
            },
        });
        const script = (await run.bundleAppended).script;
        expect(new URL(script.src).pathname).to.equal('/bundle.js');
        script.onload!(new run.window.Event('load'));
        media!.setMobile(true);
        media!.setMobile(false);
        expect(run.pageErrors.filter(error => /navigation/.test(error))).to.deep.equal([]);
    });

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

    it('keeps the IDE hidden on mobile while a Work Hub action is pending', async () => {
        const run = start(
            pathname => pathname === CONFIG ? { ok: true, body: { skipAuth: true } } : undefined,
            'http://localhost:3000/#/workspace/demo',
            {
                beforeRun: window => {
                    window.sessionStorage.setItem('qaap.mobileProjects.preferDesktopIde', '1');
                    window.sessionStorage.setItem('qaap.hub.pendingAction', '1');
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
        expect(run.document.body.classList.contains('theia-mobile-mod-workhub-composer-header')).to.equal(true);
        expect(run.document.documentElement.classList.contains('theia-mobile-workhub-boot')).to.equal(true);
    });

    it('still holds Work Hub in front on mobile when sessionStorage is unavailable', async () => {
        const run = start(
            pathname => pathname === CONFIG ? { ok: true, body: { skipAuth: true } } : undefined,
            'http://localhost:3000/#/workspace/demo',
            {
                beforeRun: window => {
                    Object.defineProperty(window, 'sessionStorage', {
                        configurable: true,
                        get: () => { throw new Error('sessionStorage unavailable'); },
                    });
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
        expect(run.document.body.classList.contains('theia-mobile-mod-workhub-composer-header')).to.equal(true);
        expect(run.document.documentElement.classList.contains('theia-mobile-workhub-boot')).to.equal(true);
    });

    describe('instant Work Hub shell', () => {
        const SIGNED_IN = { localStorage: { 'theia:/:qaap.auth.signedIn': 'true' } };
        const signedInSession: LoginGateResponder = pathname =>
            pathname === SESSION ? { ok: true, body: { signedIn: true, user: SIGNED_IN_USER } } : undefined;

        it('paints a typeable composer before the auth round-trip and keeps what is typed', () => {
            const run = start(() => undefined, 'http://localhost:3000/#/workspace/demo', SIGNED_IN);
            // Synchronous: painted by the gate script itself, before any fetch has answered.
            const input = run.document.querySelector<HTMLTextAreaElement>('#qaap-instant-work-hub textarea');
            expect(input).to.not.equal(null);
            expect(input!.disabled).to.equal(false);
            input!.value = 'fix the login bug';
            input!.dispatchEvent(new run.window.Event('input'));
            expect(run.window.sessionStorage.getItem('qaap.instantComposer.draft')).to.equal('fix the login bug');
        });

        it('is never painted on the IDE surface', async () => {
            const run = start(signedInSession, 'http://localhost:3000/#/workspace/demo', {
                ...SIGNED_IN,
                beforeRun: window => window.sessionStorage.setItem('qaap.mobileProjects.preferDesktopIde', '1'),
            });
            await run.bundleAppended;
            expect(run.document.getElementById('qaap-instant-work-hub')).to.equal(null);
        });

        it('paints once a skip-auth lab authorizes the bundle', async () => {
            const run = start(pathname => pathname === CONFIG ? { ok: true, body: { skipAuth: true } } : undefined);
            await run.bundleAppended;
            expect(run.document.getElementById('qaap-instant-work-hub')).to.not.equal(null);
        });

        it('gives way to the sign-in gate when the stored session is stale', async () => {
            const run = start(() => undefined, 'http://localhost:3000/', SIGNED_IN);
            expect(run.document.getElementById('qaap-instant-work-hub')).to.not.equal(null);
            await run.waitFor(() => !!run.document.getElementById('qaap-login-host'), 'sign-in gate');
            expect(run.document.getElementById('qaap-instant-work-hub')).to.equal(null);
        });

        it('is released shortly after the app reports startup-ready', async () => {
            let clock: InstalledClock | undefined;
            const run = start(signedInSession, 'http://localhost:3000/', {
                ...SIGNED_IN,
                beforeRun: window => { clock = withGlobal(window).install({ toFake: ['setTimeout', 'clearTimeout'] }); },
            });
            run.window.dispatchEvent(new run.window.Event('qaap-startup-ready'));
            expect(run.document.getElementById('qaap-instant-work-hub')).to.not.equal(null);
            clock!.tick(1500);
            expect(run.document.getElementById('qaap-instant-work-hub')).to.equal(null);
            clock!.uninstall();
        });

        describe('release when the app owns the screen without reporting startup-ready', () => {
            let clock: InstalledClock | undefined;

            afterEach(() => {
                clock?.uninstall();
                clock = undefined;
            });

            function startSignedIn(): LoginGateRun {
                return start(signedInSession, 'http://localhost:3000/', {
                    ...SIGNED_IN,
                    bodyHtml: '<div class="theia-preload"></div>',
                    beforeRun: window => { clock = withGlobal(window).install({ toFake: ['setTimeout', 'clearTimeout'] }); },
                });
            }

            /** Lets the MutationObserver callback (a microtask) run. */
            const observed = (): Promise<void> => Promise.resolve();
            const shell = (run: LoginGateRun): HTMLElement | null => run.document.getElementById('qaap-instant-work-hub');

            it('is released after the app lifts the Work Hub boot guard (IDE fallback included)', async () => {
                const run = startSignedIn();
                run.document.documentElement.classList.remove('theia-mobile-workhub-boot');
                await observed();
                expect(shell(run)).to.not.equal(null);
                clock!.tick(1500);
                expect(shell(run)).to.equal(null);
            });

            it('is released after Theia removes its splash', async () => {
                const run = startSignedIn();
                run.document.querySelector('.theia-preload')!.remove();
                await observed();
                clock!.tick(1500);
                expect(shell(run)).to.equal(null);
            });

            it('survives the boot guard safety timer, then goes once Theia hides the splash', async () => {
                const run = startSignedIn();
                clock!.tick(8000);
                await observed();
                clock!.tick(5000);
                expect(run.document.documentElement.classList.contains('theia-mobile-workhub-boot')).to.equal(false);
                expect(shell(run)).to.not.equal(null);
                run.document.querySelector('.theia-preload')!.classList.add('theia-hidden');
                await observed();
                clock!.tick(1500);
                expect(shell(run)).to.equal(null);
            });
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
            expect(run.requests).to.deep.equal([SESSION]);
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

        it('still honours skip-auth dev mode while the session probe runs', async () => {
            const run = start(pathname => pathname === CONFIG ? { ok: true, body: { skipAuth: true } } : undefined);
            await run.bundleAppended;
            expect(run.document.getElementById('qaap-login-host')).to.equal(null);
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
});
