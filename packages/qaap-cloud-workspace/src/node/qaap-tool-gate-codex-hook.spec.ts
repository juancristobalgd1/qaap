// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { spawnSync } from 'child_process';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { pathToFileURL } from 'url';
import { QAAP_TOOL_GATE_TOKEN_HEADER } from '@theia/qaap-shared-core/lib/common/qaap-tool-gate-protocol';
import { resolveQaapToolGateCodexHookPath } from './qaap-codex-gate-overlay';
import { resolveQaapToolGatePiExtensionPath } from './qaap-tool-gate-pi-adapter';

interface HookResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

interface CodexHook {
    handleHookInput(raw: string, env: Record<string, string | undefined>, fetchImpl?: typeof fetch,
        options?: { retries?: number; marginMs?: number }): Promise<HookResult>;
}

// The hook is plain ESM; TypeScript would turn a literal import() into require().
// eslint-disable-next-line no-new-func
const importModule = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<CodexHook>;

const hookInput = (extra: Record<string, unknown> = {}): string => JSON.stringify({
    session_id: 's', turn_id: 't', cwd: '/w', hook_event_name: 'PreToolUse', model: 'm', permission_mode: 'default',
    tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'call_1', ...extra,
});

describe('qaap-tool-gate-codex-hook.mjs', () => {

    let server: http.Server;
    let env: Record<string, string>;
    let seen: Array<{ token: string | undefined; body: Record<string, any> }>;
    let reply: (body: Record<string, any>, res: http.ServerResponse) => void;
    let hook: CodexHook;
    // The hook shares the gate module (qaap-tool-gate-pi.mjs) with the Pi extension, so its consecutive-failure counter is module state.
    let gate: { resetGateFailures(): void };

    before(async () => {
        hook = await importModule(`file://${resolveQaapToolGateCodexHookPath()}`);
        gate = await importModule(pathToFileURL(resolveQaapToolGatePiExtensionPath()).href) as unknown as { resetGateFailures(): void };
    });

    beforeEach(async () => {
        gate.resetGateFailures();
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
                reply(body, res);
            });
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        env = {
            QAAP_GATE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/gate`,
            QAAP_GATE_TOKEN: 'tok-1',
            QAAP_GATE_ASK_TTL_SEC: '600',
        };
    });

    afterEach(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    const decisionOf = (result: HookResult): Record<string, any> => JSON.parse(result.stdout).hookSpecificOutput;

    it('allows with exit 0 and sends the Codex call to the gate with the token', async () => {
        const result = await hook.handleHookInput(hookInput(), env);
        expect(result.exitCode).to.equal(0);
        expect(decisionOf(result)).to.deep.equal({ hookEventName: 'PreToolUse', permissionDecision: 'allow' });
        expect(seen).to.have.length(1);
        expect(seen[0].token).to.equal('tok-1');
        expect(seen[0].body).to.include({ agentId: 'codex', rawToolName: 'Bash', cwd: '/w', harnessCallId: 'call_1' });
        expect(seen[0].body.input).to.deep.equal({ command: 'ls' });
    });

    it('passes updatedInput through on allow', async () => {
        reply = (_body, res) => {
            res.end(JSON.stringify({ decision: { kind: 'allow', source: 'policy', updatedInput: { command: 'ls -la' } } }));
        };
        const result = await hook.handleHookInput(hookInput(), env);
        expect(decisionOf(result)).to.deep.include({ permissionDecision: 'allow', updatedInput: { command: 'ls -la' } });
    });

    it('denies with the gate reason, exit 0, and never emits ask', async () => {
        reply = (_body, res) => {
            res.end(JSON.stringify({ decision: { kind: 'deny', source: 'guard', reason: 'rm -rf is blocked' } }));
        };
        const result = await hook.handleHookInput(hookInput(), env);
        expect(result.exitCode).to.equal(0);
        expect(decisionOf(result)).to.deep.include({ permissionDecision: 'deny', permissionDecisionReason: 'rm -rf is blocked' });
        expect(result.stdout).to.not.contain('"ask"');
    });

    it('waits while the gate holds an ask, then applies the human answer', async () => {
        reply = (_body, res) => {
            setTimeout(() => res.end(JSON.stringify({ decision: { kind: 'allow', source: 'user' } })), 300);
        };
        const started = Date.now();
        const result = await hook.handleHookInput(hookInput(), env);
        expect(Date.now() - started).to.be.at.least(250);
        expect(decisionOf(result).permissionDecision).to.equal('allow');
    });

    it('fails closed with exit 2 when the gate never answers within the ask window', async () => {
        reply = () => undefined;
        const result = await hook.handleHookInput(hookInput(), { ...env, QAAP_GATE_ASK_TTL_SEC: '1' }, undefined, { marginMs: 0 });
        expect(result.exitCode).to.equal(2);
        expect(decisionOf(result).permissionDecision).to.equal('deny');
        expect(result.stderr).to.contain('timed out');
    });

    it('fails closed with exit 2 on a 5xx, a malformed decision and malformed hook input', async () => {
        reply = (_body, res) => {
            res.statusCode = 500;
            res.end('{}');
        };
        expect((await hook.handleHookInput(hookInput(), env)).exitCode).to.equal(2);
        reply = (_body, res) => {
            res.end(JSON.stringify({ decision: { kind: 'maybe' } }));
        };
        expect((await hook.handleHookInput(hookInput(), env)).exitCode).to.equal(2);
        const bad = await hook.handleHookInput('not json', env);
        expect(bad.exitCode).to.equal(2);
        expect(decisionOf(bad).permissionDecision).to.equal('deny');
    });

    describe('as a process (what Codex runs)', () => {
        const run = (extraEnv: Record<string, string>, input = hookInput()): { status: number | null; stdout: string; stderr: string } => {
            const result = spawnSync(process.execPath, [resolveQaapToolGateCodexHookPath(), '--dialect', 'codex'], {
                input, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...extraEnv }, timeout: 20000,
            });
            return { status: result.status, stdout: result.stdout, stderr: result.stderr };
        };

        it('exits 2 with a deny decision when the gate is not configured (no token)', () => {
            const result = run({ QAAP_GATE_URL: 'http://127.0.0.1:1/gate' });
            expect(result.status).to.equal(2);
            expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).to.equal('deny');
            expect(result.stderr).to.contain('not configured');
        });

        it('exits 2 when the gate is down', () => {
            const result = run({ QAAP_GATE_URL: 'http://127.0.0.1:1/gate', QAAP_GATE_TOKEN: 'x' });
            expect(result.status).to.equal(2);
            expect(result.stderr).to.contain('unreachable');
        });
    });
});
