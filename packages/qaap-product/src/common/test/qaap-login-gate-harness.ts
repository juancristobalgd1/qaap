// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { JSDOM, VirtualConsole } from 'jsdom';

const GATE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../../resources/qaap-login-gate.js'), 'utf8');

export interface LoginGateResponse {
    readonly ok: boolean;
    readonly body?: unknown;
}

/** Answers a stubbed request; `call` counts earlier requests to the same pathname (0-based). */
export type LoginGateResponder = (pathname: string, call: number) => LoginGateResponse | undefined;

export interface LoginGateBundleAppend {
    readonly script: HTMLScriptElement;
    /** `localeId` and `<html lang>` as they were when the bundle `<script>` was appended. */
    readonly localeId: string | null;
    readonly lang: string | null;
}

export interface LoginGateRun {
    readonly dom: JSDOM;
    readonly window: Window & typeof globalThis;
    readonly document: Document;
    readonly requests: string[];
    readonly consoleErrors: string[];
    readonly bundleAppended: Promise<LoginGateBundleAppend>;
    /** Resolve once `predicate` holds, polling on macrotasks (the gate chains fetch promises). */
    waitFor(predicate: () => boolean, description: string): Promise<void>;
}

/**
 * Execute the real `qaap-login-gate.js` in a fresh jsdom page with the network stubbed. The page
 * starts in Spanish so English enforcement is observable. Close `run.dom.window` when done: that
 * also clears the gate's watchdog timers.
 */
export function runLoginGate(responder: LoginGateResponder, url = 'http://localhost:3000/'): LoginGateRun {
    const consoleErrors: string[] = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('error', (...args: unknown[]) => consoleErrors.push(args.map(String).join(' ')));
    const dom = new JSDOM('<!doctype html><html lang="es"><head></head><body></body></html>', {
        url,
        runScripts: 'outside-only',
        pretendToBeVisual: true,
        virtualConsole,
    });
    const window = dom.window as unknown as Window & typeof globalThis & { eval(source: string): unknown };
    window.localStorage.setItem('localeId', 'es');
    const requests: string[] = [];
    const calls = new Map<string, number>();
    (window as unknown as { fetch: unknown }).fetch = async (input: string): Promise<unknown> => {
        const pathname = new URL(input, url).pathname;
        const call = calls.get(pathname) ?? 0;
        calls.set(pathname, call + 1);
        requests.push(pathname);
        const response = responder(pathname, call) ?? { ok: false };
        return { ok: response.ok, status: response.ok ? 200 : 503, json: async () => response.body };
    };
    const bundleAppended = new Promise<LoginGateBundleAppend>(resolve => {
        const appendChild = window.Node.prototype.appendChild;
        window.Node.prototype.appendChild = function <T extends Node> (this: Node, child: T): T {
            if (child instanceof window.HTMLScriptElement && child.src.includes('bundle.js')) {
                resolve({
                    script: child,
                    localeId: window.localStorage.getItem('localeId'),
                    lang: window.document.documentElement.getAttribute('lang'),
                });
            }
            return appendChild.call(this, child) as T;
        };
    });
    window.eval(GATE_SOURCE);
    const waitFor = async (predicate: () => boolean, description: string): Promise<void> => {
        for (let attempt = 0; attempt < 200; attempt++) {
            if (predicate()) {
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        throw new Error(`Timed out waiting for: ${description}`);
    };
    return { dom, window, document: window.document, requests, consoleErrors, bundleAppended, waitFor };
}
