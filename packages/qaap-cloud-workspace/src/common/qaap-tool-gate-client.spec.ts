// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_TOOL_GATE_TOKEN_HEADER, type QaapToolGateRequest } from '@theia/qaap-shared-core/lib/common/qaap-tool-gate-protocol';
import { QaapToolGateClient } from './qaap-tool-gate-client';

const request: QaapToolGateRequest = {
    agentId: 'pi', toolKind: 'shell', rawToolName: 'bash', input: { command: 'ls' }, cwd: '/w',
};

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });

describe('QaapToolGateClient (fail closed)', () => {

    const client = (fetchImpl: typeof fetch, extra: object = {}): QaapToolGateClient => new QaapToolGateClient({
        url: 'http://127.0.0.1:1/qaap/api/tool-gate', token: 't0k', askTtlSec: 1, retries: 1, fetchImpl, ...extra,
    });

    it('denies when it cannot connect to the gate, after retrying connection errors', async () => {
        let attempts = 0;
        const decision = await client((async () => {
            attempts++;
            throw new TypeError('fetch failed');
        }) as typeof fetch).evaluate(request);
        expect(attempts).to.equal(2);
        expect(decision).to.include({ kind: 'deny', source: 'gate-error' });
    });

    it('denies when the URL or token is missing, without calling the network', async () => {
        const never = (async () => { throw new Error('must not be called'); }) as typeof fetch;
        expect((await client(never, { url: undefined }).evaluate(request)).kind).to.equal('deny');
        expect((await client(never, { token: undefined }).evaluate(request)).kind).to.equal('deny');
    });

    it('denies on 401, 5xx and malformed bodies, without retrying', async () => {
        for (const reply of [() => json(401, {}), () => json(503, {}), () => json(200, { decision: { kind: 'maybe' } }),
            () => json(200, {}), () => new Response('not json', { status: 200 })]) {
            let attempts = 0;
            const decision = await client((async () => { attempts++; return reply(); }) as typeof fetch).evaluate(request);
            expect(decision.kind).to.equal('deny');
            expect(attempts).to.equal(1);
        }
    });

    it('denies on timeout instead of retrying a pending ask', async () => {
        let attempts = 0;
        const decision = await client((async () => {
            attempts++;
            throw new DOMException('timed out', 'TimeoutError');
        }) as typeof fetch).evaluate(request);
        expect(attempts).to.equal(1);
        expect(decision.kind).to.equal('deny');
    });

    it('returns the gate decision and sends only the gate token header', async () => {
        let seen: RequestInit | undefined;
        const decision = await client((async (_url: string, init: RequestInit) => {
            seen = init;
            return json(200, { decision: { kind: 'allow', source: 'policy' } });
        }) as unknown as typeof fetch).evaluate(request);
        expect(decision).to.deep.equal({ kind: 'allow', source: 'policy' });
        expect((seen?.headers as Record<string, string>)[QAAP_TOOL_GATE_TOKEN_HEADER]).to.equal('t0k');
    });

    it('passes a gate deny through', async () => {
        const decision = await client((async () => json(200, {
            decision: { kind: 'deny', source: 'user', reason: 'no' },
        })) as typeof fetch).evaluate(request);
        expect(decision).to.deep.equal({ kind: 'deny', source: 'user', reason: 'no' });
    });

    it('reports consecutive transport failures with the next request, flags unavailability at 3, and resets on any answer', async () => {
        const headers: Array<string | undefined> = [];
        let mode: 'down' | 'ok' | 'deny' = 'down';
        const gate = client((async (_url: string, init: RequestInit) => {
            headers.push((init.headers as Record<string, string>)['x-qaap-gate-client-errors']);
            if (mode === 'down') {
                throw new TypeError('fetch failed');
            }
            return json(200, { decision: mode === 'ok' ? { kind: 'allow', source: 'policy' } : { kind: 'deny', source: 'user', reason: 'no' } });
        }) as unknown as typeof fetch, { retries: 0 });
        await gate.evaluate(request);
        await gate.evaluate(request);
        expect(gate.gateUnavailable).to.equal(false);
        mode = 'ok';
        await gate.evaluate(request);
        expect(headers).to.deep.equal([undefined, '1', '2']);
        expect(gate.gateUnavailable).to.equal(false);
        mode = 'down';
        await gate.evaluate(request);
        await gate.evaluate(request);
        await gate.evaluate(request);
        expect(gate.gateUnavailable).to.equal(true);
        mode = 'deny';
        await gate.evaluate(request);
        expect(gate.gateUnavailable).to.equal(false);
    });
});
