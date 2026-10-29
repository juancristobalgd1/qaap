// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { QAAP_TOOL_GATE_TOKEN_HEADER } from '@theia/qaap-shared-core/lib/common/qaap-tool-gate-protocol';
import { resolveQaapToolGatePiExtensionPath } from './qaap-tool-gate-pi-adapter';

interface PiExtension {
    handleToolCall(event: Record<string, unknown>, ctx: { cwd: string }, env: Record<string, string | undefined>,
        fetchImpl?: typeof fetch, options?: { retries?: number; marginMs?: number }): Promise<{ block?: boolean; reason?: string } | undefined>;
    default(pi: { on(name: string, handler: unknown): void }): void;
}

// The extension is plain ESM; TypeScript would turn a literal import() into require().
// eslint-disable-next-line no-new-func
const importModule = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<PiExtension>;

describe('qaap-tool-gate-pi.mjs', () => {

    let server: http.Server;
    let url: string;
    let seen: Array<{ token: string | undefined; body: Record<string, unknown> }>;
    let reply: (body: Record<string, unknown>, res: http.ServerResponse) => void;
    let ext: PiExtension;

    before(async () => {
        ext = await importModule(`file://${resolveQaapToolGatePiExtensionPath()}`);
    });

    beforeEach(async () => {
        seen = [];
        reply = (_body, res) => {
            res.end(JSON.stringify({ decision: { kind: 'allow', source: 'policy' } }));
        };
        server = http.createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', () => {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                seen.push({ token: req.headers[QAAP_TOOL_GATE_TOKEN_HEADER] as string | undefined, body });
                if (req.url !== '/gate/evaluate') {
                    res.statusCode = 404;
                    res.end('{}');
                    return;
                }
                reply(body, res);
            });
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/gate`;
    });

    afterEach(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    const env = (extra: Record<string, string | undefined> = {}): Record<string, string | undefined> =>
        ({ QAAP_GATE_URL: url, QAAP_GATE_TOKEN: 'tok', QAAP_GATE_ASK_TTL_SEC: '1', ...extra });
    const event = (input: Record<string, unknown> = { command: 'ls' }): Record<string, unknown> =>
        ({ type: 'tool_call', toolName: 'bash', toolCallId: 'call-1', input });
    const run = (e: Record<string, unknown>, environment = env(), options: { retries?: number; marginMs?: number } = { retries: 0, marginMs: 200 }):
        ReturnType<PiExtension['handleToolCall']> => ext.handleToolCall(e, { cwd: '/w' }, environment, fetch, options);

    it('registers a tool_call handler', () => {
        const registered: string[] = [];
        ext.default({ on: name => registered.push(name) });
        expect(registered).to.deep.equal(['tool_call']);
    });

    it('lets the call through on allow and sends the token, tool name, input, cwd and call id', async () => {
        expect(await run(event())).to.equal(undefined);
        expect(seen).to.have.length(1);
        expect(seen[0].token).to.equal('tok');
        expect(seen[0].body).to.include({ rawToolName: 'bash', cwd: '/w', harnessCallId: 'call-1', agentId: 'pi' });
        expect(seen[0].body.input).to.deep.equal({ command: 'ls' });
    });

    it('blocks with the gate reason on deny', async () => {
        reply = (_b, res) => res.end(JSON.stringify({ decision: { kind: 'deny', source: 'destructive-guard', reason: 'nope' } }));
        expect(await run(event())).to.deep.equal({ block: true, reason: 'nope' });
    });

    it('rewrites event.input in place on updatedInput', async () => {
        reply = (_b, res) => res.end(JSON.stringify({ decision: { kind: 'allow', source: 'hook', updatedInput: { command: 'echo safe' } } }));
        const e = event({ command: 'rm -rf x', timeout: 5 });
        const input = e.input;
        expect(await run(e)).to.equal(undefined);
        expect(e.input).to.equal(input);
        expect(e.input).to.deep.equal({ command: 'echo safe' });
    });

    it('waits for an ask that the user approves', async () => {
        reply = (_b, res) => setTimeout(() => res.end(JSON.stringify({ decision: { kind: 'allow', source: 'user' } })), 80);
        expect(await run(event())).to.equal(undefined);
    });

    it('blocks an ask that the gate denies on timeout', async () => {
        reply = (_b, res) => res.end(JSON.stringify({ decision: { kind: 'deny', source: 'ttl', retryable: true, reason: 'Approval timed out; ask the user again.' } }));
        const result = await run(event());
        expect(result?.block).to.equal(true);
        expect(result?.reason).to.contain('timed out');
    });

    it('blocks (and does not retry) when the gate stalls past the ask window', async () => {
        reply = () => { /* never answers */ };
        const result = await run(event(), env({ QAAP_GATE_ASK_TTL_SEC: '0.05' }), { retries: 2, marginMs: 100 });
        expect(result?.block).to.equal(true);
        expect(seen).to.have.length(1);
    });

    it('blocks when the gate is down, after retrying connection errors only', async () => {
        const dead = http.createServer();
        await new Promise<void>(resolve => dead.listen(0, '127.0.0.1', resolve));
        const port = (dead.address() as AddressInfo).port;
        await new Promise<void>(resolve => dead.close(() => resolve()));
        let attempts = 0;
        const counting = ((input: string, init: RequestInit) => { attempts++; return fetch(input, init); }) as typeof fetch;
        const result = await ext.handleToolCall(event(), { cwd: '/w' }, env({ QAAP_GATE_URL: `http://127.0.0.1:${port}/gate` }), counting, { retries: 1, marginMs: 200 });
        expect(result?.block).to.equal(true);
        expect(attempts).to.equal(2);
    });

    it('blocks when the URL or token is missing, without calling the gate', async () => {
        expect((await run(event(), env({ QAAP_GATE_TOKEN: undefined })))?.block).to.equal(true);
        expect((await run(event(), env({ QAAP_GATE_URL: undefined })))?.block).to.equal(true);
        expect(seen).to.have.length(0);
    });

    it('blocks on 401, 5xx, bad JSON and malformed decisions without retrying', async () => {
        for (const respond of [
            (res: http.ServerResponse) => { res.statusCode = 401; res.end('{}'); },
            (res: http.ServerResponse) => { res.statusCode = 503; res.end('{}'); },
            (res: http.ServerResponse) => res.end('not json'),
            (res: http.ServerResponse) => res.end(JSON.stringify({ decision: { kind: 'maybe' } })),
            (res: http.ServerResponse) => res.end(JSON.stringify({})),
        ]) {
            seen = [];
            reply = (_b, res) => respond(res);
            expect((await run(event(), env(), { retries: 2, marginMs: 200 }))?.block).to.equal(true);
            expect(seen).to.have.length(1);
        }
    });

    it('blocks instead of throwing on a malformed event', async () => {
        const result = await ext.handleToolCall(undefined as unknown as Record<string, unknown>, undefined as unknown as { cwd: string },
            env({ QAAP_GATE_URL: undefined }));
        expect(result?.block).to.equal(true);
    });
});
