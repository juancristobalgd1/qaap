// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { QAAP_TOOL_GATE_ARM_NONCE_HEADER, QAAP_TOOL_GATE_TOKEN_HEADER } from '@theia/qaap-shared-core/lib/common/qaap-tool-gate-protocol';
import { resolveQaapToolGateOpencodePluginPath } from './qaap-tool-gate-opencode-adapter';

type Env = Record<string, string | undefined>;
type Options = { retries?: number; marginMs?: number; armNonce?: string };
interface Hooks {
    config(config: { permission?: Record<string, unknown> }): Promise<void>;
    'tool.execute.before'(input: Record<string, unknown>, output: { args: Record<string, unknown> }): Promise<void>;
    'permission.ask'(input: Record<string, unknown>, output: { status: string }): Promise<void>;
}
interface OpencodePlugin {
    armGate(env?: Env, fetchImpl?: typeof fetch, options?: Options): Promise<boolean>;
    createHooks(cwd: string | undefined, env?: Env, fetchImpl?: typeof fetch, options?: Options): Hooks;
    default: { id: string; server(ctx: { directory: string }): Promise<Hooks> };
}

// The plugin is plain ESM; TypeScript would turn a literal import() into require().
// eslint-disable-next-line no-new-func
const importModule = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<OpencodePlugin>;

describe('qaap-tool-gate-opencode.mjs', () => {

    let server: http.Server;
    let url: string;
    let seen: Array<{ token: string | undefined; body: Record<string, unknown> }>;
    let reply: (body: Record<string, unknown>, res: http.ServerResponse) => void;
    let plugin: OpencodePlugin;

    before(async () => {
        plugin = await importModule(`file://${resolveQaapToolGateOpencodePluginPath()}`);
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

    const env = (extra: Env = {}): Env => ({ QAAP_GATE_URL: url, QAAP_GATE_TOKEN: 'tok', QAAP_GATE_ASK_TTL_SEC: '1', ...extra });
    const hooks = (environment: Env = env(), options: Options = { retries: 0, marginMs: 200 }): Hooks =>
        plugin.createHooks('/w', environment, fetch, options);
    const callBefore = (h: Hooks, args: Record<string, unknown> = { command: 'ls' }, callID = 'call-1'): Promise<void> =>
        h['tool.execute.before']({ tool: 'bash', sessionID: 's', callID }, { args });
    const rejection = async (promise: Promise<void>): Promise<string> => {
        try {
            await promise;
        } catch (error) {
            return (error as Error).message;
        }
        throw new Error('expected the hook to throw');
    };

    it('exports a server plugin that returns both hooks for the project directory', async () => {
        expect(plugin.default.id).to.equal('qaap-tool-gate');
        const built = await plugin.default.server({ directory: '/w' });
        expect(Object.keys(built)).to.have.members(['config', 'tool.execute.before', 'permission.ask']);
    });

    it('lets the call through on allow and sends the token, tool name, input, cwd and call id', async () => {
        await callBefore(hooks());
        expect(seen).to.have.length(1);
        expect(seen[0].token).to.equal('tok');
        expect(seen[0].body).to.include({ rawToolName: 'bash', cwd: '/w', harnessCallId: 'call-1', agentId: 'opencode' });
        expect(seen[0].body.input).to.deep.equal({ command: 'ls' });
    });

    it('throws the gate reason on deny', async () => {
        reply = (_b, res) => res.end(JSON.stringify({ decision: { kind: 'deny', source: 'destructive-guard', reason: 'nope' } }));
        expect(await rejection(callBefore(hooks()))).to.equal('nope');
    });

    it('rewrites output.args in place on updatedInput', async () => {
        reply = (_b, res) => res.end(JSON.stringify({ decision: { kind: 'allow', source: 'hook', updatedInput: { command: 'echo safe' } } }));
        const args: Record<string, unknown> = { command: 'rm -rf x', timeout: 5 };
        await callBefore(hooks(), args);
        expect(args).to.deep.equal({ command: 'echo safe' });
    });

    it('waits for an ask that the user approves', async () => {
        reply = (_b, res) => setTimeout(() => res.end(JSON.stringify({ decision: { kind: 'allow', source: 'user' } })), 80);
        await callBefore(hooks());
    });

    it('throws when an ask times out in the gate', async () => {
        reply = (_b, res) => res.end(JSON.stringify({ decision: { kind: 'deny', source: 'ttl', retryable: true, reason: 'Approval timed out; ask the user again.' } }));
        expect(await rejection(callBefore(hooks()))).to.contain('timed out');
    });

    it('throws (and does not retry) when the gate stalls past the ask window', async () => {
        reply = () => { /* never answers */ };
        const message = await rejection(callBefore(hooks(env({ QAAP_GATE_ASK_TTL_SEC: '0.05' }), { retries: 2, marginMs: 100 })));
        expect(message).to.contain('timed out');
        expect(seen).to.have.length(1);
    });

    it('throws when the gate is down, after retrying connection errors only', async () => {
        const dead = http.createServer();
        await new Promise<void>(resolve => dead.listen(0, '127.0.0.1', resolve));
        const port = (dead.address() as AddressInfo).port;
        await new Promise<void>(resolve => dead.close(() => resolve()));
        let attempts = 0;
        const counting = ((input: string, init: RequestInit) => { attempts++; return fetch(input, init); }) as typeof fetch;
        const h = plugin.createHooks('/w', env({ QAAP_GATE_URL: `http://127.0.0.1:${port}/gate` }), counting, { retries: 1, marginMs: 200 });
        expect(await rejection(callBefore(h))).to.contain('unreachable');
        expect(attempts).to.equal(2);
    });

    it('throws when the URL or token is missing, without calling the gate', async () => {
        await rejection(callBefore(hooks(env({ QAAP_GATE_TOKEN: undefined }))));
        await rejection(callBefore(hooks(env({ QAAP_GATE_URL: undefined }))));
        expect(seen).to.have.length(0);
    });

    it('throws on 401, 5xx, bad JSON and malformed decisions without retrying', async () => {
        for (const respond of [
            (res: http.ServerResponse) => { res.statusCode = 401; res.end('{}'); },
            (res: http.ServerResponse) => { res.statusCode = 503; res.end('{}'); },
            (res: http.ServerResponse) => res.end('not json'),
            (res: http.ServerResponse) => res.end(JSON.stringify({ decision: { kind: 'maybe' } })),
            (res: http.ServerResponse) => res.end(JSON.stringify({})),
        ]) {
            seen = [];
            reply = (_b, res) => respond(res);
            await rejection(callBefore(hooks(env(), { retries: 2, marginMs: 200 })));
            expect(seen).to.have.length(1);
        }
    });

    it('throws instead of crashing on a malformed event', async () => {
        const h = plugin.createHooks(undefined, env({ QAAP_GATE_URL: undefined }));
        await rejection(h['tool.execute.before'](undefined as never, undefined as never));
    });

    describe('arming (fail-closed baseline)', () => {
        const armPath = (): http.RequestListener => (req, res) => {
            seen.push({
                token: req.headers[QAAP_TOOL_GATE_TOKEN_HEADER] as string | undefined,
                body: { url: req.url, nonce: req.headers[QAAP_TOOL_GATE_ARM_NONCE_HEADER] },
            });
            res.end('{}');
        };
        const armed = (extra: Env = {}): Env => env({ QAAP_GATE_ARM_NONCE: 'nonce-1', ...extra });

        it('lifts the ask rules only after the gate acknowledged /arm, keeping other rules', async () => {
            server.removeAllListeners('request');
            server.on('request', armPath());
            const config = { permission: { edit: 'ask', bash: 'ask', lsp: 'deny', read: 'allow' } as Record<string, unknown> };
            await hooks(armed()).config(config);
            expect(config.permission).to.deep.equal({ lsp: 'deny', read: 'allow' });
            expect(seen[0]).to.deep.equal({ token: 'tok', body: { url: '/gate/arm', nonce: 'nonce-1' } });
        });

        it('removes the arm nonce from the environment on load, so the tools it spawns never inherit it', () => {
            const environment = armed();
            hooks(environment);
            expect(environment.QAAP_GATE_ARM_NONCE).to.equal(undefined);
        });

        it('keeps every ask rule when the gate cannot be reached, answers an error, has no credentials or no nonce', async () => {
            for (const makeHooks of [
                () => hooks(armed({ QAAP_GATE_URL: 'http://127.0.0.1:1/gate' }), { retries: 0 }),
                () => hooks(armed({ QAAP_GATE_TOKEN: undefined })),
            ]) {
                const config = { permission: { edit: 'ask', bash: 'ask' } as Record<string, unknown> };
                await makeHooks().config(config);
                expect(config.permission).to.deep.equal({ edit: 'ask', bash: 'ask' });
            }
            server.removeAllListeners('request');
            server.on('request', (_req, res) => { res.statusCode = 401; res.end('{}'); });
            const config = { permission: { edit: 'ask' } as Record<string, unknown> };
            await hooks(armed()).config(config);
            expect(config.permission).to.deep.equal({ edit: 'ask' });
            // Without the nonce the plugin never even asks the gate to arm.
            seen = [];
            const unnonced = { permission: { edit: 'ask' } as Record<string, unknown> };
            await hooks(env()).config(unnonced);
            expect(unnonced.permission).to.deep.equal({ edit: 'ask' });
            expect(seen).to.have.length(0);
        });

        it('armGate is true only on a 2xx, and only with a nonce', async () => {
            server.removeAllListeners('request');
            server.on('request', armPath());
            expect(await plugin.armGate(env(), fetch, { armNonce: 'nonce-1' })).to.equal(true);
            expect(await plugin.armGate(env({ QAAP_GATE_TOKEN: undefined }), fetch, { armNonce: 'nonce-1' })).to.equal(false);
            expect(await plugin.armGate(env(), fetch)).to.equal(false);
            expect(seen).to.have.length(1);
        });

        it('probe mode records config and tool calls, never reaches the gate and blocks the tool', async () => {
            // A fresh mkdtemp directory, never a predictable file name in the shared temp dir.
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-probe-'));
            const file = path.join(dir, 'probe.log');
            const probing = plugin.createHooks('/w', armed({ QAAP_GATE_PROBE_FILE: file }), fetch, { retries: 0 });
            const config = { permission: { edit: 'ask' } as Record<string, unknown> };
            await probing.config(config);
            expect(await rejection(callBefore(probing))).to.contain('probe');
            expect(fs.readFileSync(file, 'utf8').split('\n')).to.include.members(['config', 'before:bash']);
            expect(config.permission).to.deep.equal({ edit: 'ask' });
            expect(seen).to.have.length(0);
            fs.rmSync(dir, { recursive: true, force: true });
        });
    });

    describe('permission.ask', () => {
        const ask = (h: Hooks, input: Record<string, unknown>): Promise<string> => {
            const output = { status: 'ask' };
            return h['permission.ask'](input, output).then(() => output.status);
        };

        it('allows the prompt of a call the gate already approved, without asking again', async () => {
            const h = hooks();
            await callBefore(h, { command: 'ls' }, 'call-9');
            expect(await ask(h, { type: 'bash', callID: 'call-9' })).to.equal('allow');
            expect(seen).to.have.length(1);
        });

        it('asks the gate about a prompt with no approved call and follows its answer', async () => {
            expect(await ask(hooks(), { type: 'external_directory', pattern: '/etc/*' })).to.equal('allow');
            expect(seen[0].body).to.include({ rawToolName: 'external_directory' });
            reply = (_b, res) => res.end(JSON.stringify({ decision: { kind: 'deny', source: 'policy', reason: 'no' } }));
            expect(await ask(hooks(), { type: 'external_directory' })).to.equal('deny');
        });

        it('denies when the gate is unreachable', async () => {
            expect(await ask(hooks(env({ QAAP_GATE_TOKEN: undefined })), { type: 'bash' })).to.equal('deny');
        });
    });
});
