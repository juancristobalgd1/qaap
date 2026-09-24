// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';

const GATE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../resources/qaap-login-gate.js'), 'utf8');

interface GateRun {
    readonly dom: JSDOM;
    /** `localeId` and `<html lang>` as they were at the moment the bundle `<script>` was appended. */
    readonly atBundleAppend: Promise<{ localeId: string | null; lang: string | null; src: string }>;
}

/**
 * Execute the real login gate in a fresh jsdom page. The network is stubbed per URL, and the page
 * starts in Spanish so the test proves the gate switches it to English before the bundle loads.
 */
function runGate(responses: Record<string, { ok: boolean; body?: unknown }>): GateRun {
    const dom = new JSDOM('<!doctype html><html lang="es"><head></head><body></body></html>', {
        url: 'http://localhost:3000/',
        runScripts: 'outside-only',
        pretendToBeVisual: true,
    });
    const window = dom.window as unknown as Window & typeof globalThis & { eval(source: string): unknown };
    window.localStorage.setItem('localeId', 'es');
    (window as unknown as { fetch: unknown }).fetch = async (input: string): Promise<unknown> => {
        const pathname = new URL(input, 'http://localhost:3000/').pathname;
        const response = responses[pathname] ?? { ok: false };
        return { ok: response.ok, status: response.ok ? 200 : 404, json: async () => response.body };
    };
    const atBundleAppend = new Promise<{ localeId: string | null; lang: string | null; src: string }>(resolve => {
        const appendChild = window.Node.prototype.appendChild;
        window.Node.prototype.appendChild = function <T extends Node> (this: Node, child: T): T {
            if (child instanceof window.HTMLScriptElement && child.src.includes('bundle.js')) {
                resolve({
                    localeId: window.localStorage.getItem('localeId'),
                    lang: window.document.documentElement.getAttribute('lang'),
                    src: child.src,
                });
            }
            return appendChild.call(this, child) as T;
        };
    });
    window.eval(GATE_SOURCE);
    return { dom, atBundleAppend };
}

describe('Qaap English interface bootstrap', () => {
    const runs: JSDOM[] = [];

    afterEach(() => {
        // Clears the gate's watchdog timers along with the page.
        runs.splice(0).forEach(dom => dom.window.close());
    });

    it('forces English before the bundle script is appended (signed-out gate)', async () => {
        const run = runGate({
            '/qaap/api/auth/config': { ok: true, body: { skipAuth: false, githubOAuth: true } },
            '/qaap/api/auth/session': { ok: false },
        });
        runs.push(run.dom);
        const atAppend = await run.atBundleAppend;
        expect(atAppend.localeId).to.equal('en');
        expect(atAppend.lang).to.equal('en');
        expect(new URL(atAppend.src).pathname).to.equal('/bundle.js');

        const gate = run.dom.window.document.getElementById('qaap-login-host');
        expect(gate?.textContent).to.include('Sign in with GitHub');
        expect(gate?.querySelector('a[href="/legal/terms.html"]')).to.not.equal(null);
        expect(gate?.querySelector('a[href="/legal/privacy.html"]')).to.not.equal(null);
        expect(gate?.textContent).to.not.include('Iniciar con GitHub');
        expect(gate?.textContent).to.not.include('Reintentar');
    });

    it('forces English before the bundle script is appended (dev skip-auth, no gate)', async () => {
        const run = runGate({
            '/qaap/api/auth/config': { ok: true, body: { skipAuth: true } },
        });
        runs.push(run.dom);
        const atAppend = await run.atBundleAppend;
        expect(atAppend.localeId).to.equal('en');
        expect(atAppend.lang).to.equal('en');
        expect(run.dom.window.document.getElementById('qaap-login-host')).to.equal(null);
    });
});
