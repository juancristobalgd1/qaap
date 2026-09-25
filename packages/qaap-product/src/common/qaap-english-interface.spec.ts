// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { runLoginGate, type LoginGateRun } from './test/qaap-login-gate-harness';

describe('Qaap English interface bootstrap', () => {
    const runs: LoginGateRun[] = [];

    afterEach(() => {
        // Clears the gate's watchdog timers along with the page.
        runs.splice(0).forEach(run => run.dom.window.close());
    });

    function start(responses: Record<string, { ok: boolean; body?: unknown }>): LoginGateRun {
        const run = runLoginGate(pathname => responses[pathname]);
        runs.push(run);
        return run;
    }

    it('forces English before the bundle script is appended (signed-out gate)', async () => {
        const run = start({
            '/qaap/api/auth/config': { ok: true, body: { skipAuth: false, githubOAuth: true } },
            '/qaap/api/auth/session': { ok: false },
        });
        const atAppend = await run.bundleAppended;
        expect(atAppend.localeId).to.equal('en');
        expect(atAppend.lang).to.equal('en');
        expect(new URL(atAppend.script.src).pathname).to.equal('/bundle.js');

        const gate = run.document.getElementById('qaap-login-host');
        expect(gate?.textContent).to.include('Sign in with GitHub');
        expect(gate?.querySelector('a[href="/legal/terms.html"]')).to.not.equal(null);
        expect(gate?.querySelector('a[href="/legal/privacy.html"]')).to.not.equal(null);
        expect(gate?.textContent).to.not.include('Iniciar con GitHub');
        expect(gate?.textContent).to.not.include('Reintentar');
    });

    it('forces English before the bundle script is appended (dev skip-auth, no gate)', async () => {
        const run = start({
            '/qaap/api/auth/config': { ok: true, body: { skipAuth: true } },
        });
        const atAppend = await run.bundleAppended;
        expect(atAppend.localeId).to.equal('en');
        expect(atAppend.lang).to.equal('en');
        expect(run.document.getElementById('qaap-login-host')).to.equal(null);
    });
});
