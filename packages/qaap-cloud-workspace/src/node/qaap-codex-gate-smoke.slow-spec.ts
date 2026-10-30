// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { QaapCodexGateOverlayBuilder } from './qaap-codex-gate-overlay';

/**
 * Real `codex exec` against a fake OpenAI-compatible provider and a fake gate: proves the overlay
 * (trust seeding, hook command, env inheritance, fail-closed exits) works end to end. Skipped when
 * no `codex` binary is on PATH.
 */
describe('Codex tool gate smoke (real codex, fake provider)', function (): void {
    this.timeout(120000);

    let tmp: string;
    let provider: http.Server;
    let gate: http.Server;
    let gateCalls: Array<Record<string, any>>;
    let gateReply: (body: Record<string, any>, res: http.ServerResponse) => void;
    let project: string;
    let marker: string;

    before(function (): void {
        if (spawnSync('codex', ['--version']).status !== 0) {
            this.skip();
        }
    });

    beforeEach(async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-codex-smoke-'));
        project = path.join(tmp, 'project');
        marker = path.join(tmp, 'ran.txt');
        fs.mkdirSync(path.join(project, '.codex'), { recursive: true });
        // A project hook that must NOT load in an untrusted folder, even if Codex trusted its cwd itself.
        fs.writeFileSync(path.join(project, '.codex', 'hooks.json'), JSON.stringify({
            hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `echo project-hook >> ${path.join(tmp, 'project-hook.txt')}`, timeout: 10 }] }] },
        }));
        provider = http.createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                res.writeHead(200, { 'content-type': 'text/event-stream' });
                const send = (type: string, data: object): void => {
                    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
                };
                send('response.created', { response: { id: 'r' } });
                if (!body.includes('function_call_output')) {
                    send('response.output_item.done', {
                        item: { type: 'function_call', name: 'exec_command', call_id: 'call_1', arguments: JSON.stringify({ cmd: `echo ran > ${marker}` }) },
                    });
                } else {
                    send('response.output_item.done', { item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] } });
                }
                send('response.completed', { response: { id: 'r', usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } });
                res.end();
            });
        });
        await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
        gateCalls = [];
        gateReply = (_body, res) => {
            res.end(JSON.stringify({ decision: { kind: 'allow', source: 'policy' } }));
        };
        gate = http.createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', () => {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                gateCalls.push(body);
                gateReply(body, res);
            });
        });
        await new Promise<void>(resolve => gate.listen(0, '127.0.0.1', resolve));
    });

    afterEach(async () => {
        await new Promise<void>(resolve => provider.close(() => resolve()));
        await new Promise<void>(resolve => gate.close(() => resolve()));
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    async function runCodex(gateUrl: string | undefined, folderTrusted = false): Promise<string> {
        const sourceHome = path.join(tmp, 'user-codex');
        fs.mkdirSync(sourceHome, { recursive: true });
        fs.writeFileSync(path.join(sourceHome, 'config.toml'), [
            'model = "fake-model"', 'model_provider = "fake"', '[model_providers.fake]', 'name = "fake"',
            `base_url = "http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1"`, 'env_key = "FAKE_KEY"', 'wire_api = "responses"',
        ].join('\n'));
        const env: NodeJS.ProcessEnv = { ...process.env, FAKE_KEY: 'x' };
        if (gateUrl) {
            env.QAAP_GATE_URL = gateUrl;
            env.QAAP_GATE_TOKEN = 'smoke-token';
            env.QAAP_GATE_ASK_TTL_SEC = '600';
        }
        const overlay = await new QaapCodexGateOverlayBuilder().create({
            taskId: 'smoke', cwd: project, folderTrusted, sourceCodexHome: sourceHome, askTtlSec: 600, overlayRoot: path.join(tmp, 'overlays'),
        }, env);
        env.CODEX_HOME = overlay.codexHome;
        try {
            return await new Promise<string>(resolve => {
                const child = spawn('codex', ['exec', '--json', '--skip-git-repo-check', 'go'], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
                let out = '';
                child.stdout.on('data', chunk => out += chunk);
                child.stderr.on('data', chunk => out += chunk);
                child.on('close', () => resolve(out));
            });
        } finally {
            overlay.dispose();
        }
    }

    const gateUrl = (): string => `http://127.0.0.1:${(gate.address() as AddressInfo).port}/gate`;

    it('runs the tool when the gate allows, after the gate saw the call', async () => {
        await runCodex(gateUrl());
        expect(fs.existsSync(marker)).to.equal(true);
        expect(gateCalls).to.have.length(1);
        expect(gateCalls[0]).to.include({ agentId: 'codex', rawToolName: 'Bash' });
        expect(gateCalls[0].input.command).to.contain(marker);
    });

    it('blocks the tool when the gate denies, with the reason shown to the agent', async () => {
        gateReply = (_body, res) => {
            res.end(JSON.stringify({ decision: { kind: 'deny', source: 'guard', reason: 'nope from gate' } }));
        };
        const output = await runCodex(gateUrl());
        expect(fs.existsSync(marker)).to.equal(false);
        expect(output).to.contain('nope from gate');
    });

    it('waits for a slow answer (an ask) before running the tool', async () => {
        gateReply = (_body, res) => {
            setTimeout(() => res.end(JSON.stringify({ decision: { kind: 'allow', source: 'user' } })), 3000);
        };
        await runCodex(gateUrl());
        expect(fs.existsSync(marker)).to.equal(true);
    });

    it('fails closed when the gate is down', async () => {
        const output = await runCodex('http://127.0.0.1:1/gate');
        expect(fs.existsSync(marker)).to.equal(false);
        expect(output).to.contain('unreachable');
    });

    it('fails closed when the gate credentials are missing', async () => {
        await runCodex(undefined);
        expect(fs.existsSync(marker)).to.equal(false);
    });

    it('does not load project hooks from an untrusted folder', async () => {
        await runCodex(gateUrl(), false);
        expect(fs.existsSync(path.join(tmp, 'project-hook.txt'))).to.equal(false);
    });
});
