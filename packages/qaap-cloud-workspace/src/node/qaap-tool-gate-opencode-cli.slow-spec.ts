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
import { applyOpencodeGateEnv, resolveQaapToolGateOpencodePluginPath } from './qaap-tool-gate-opencode-adapter';
import { QAAP_OPENCODE_GATE_PROBE } from './qaap-tool-gate-opencode-probe';

/**
 * Runs the REAL OpenCode CLI against a scripted OpenAI-compatible provider and a fake gate. Verifies that
 * the probe passes, that `tool.execute.before` fires for built-in, MCP and subagent (`task`) tools, and that
 * the plugin arms and lifts the fail-closed `ask` baseline. Skipped when `opencode` is not installed.
 */
describe('OpenCode gate plugin against the real CLI', function (): void {
    this.timeout(180_000);

    const available = spawnSync('opencode', ['--version'], { encoding: 'utf8' }).status === 0;
    let dir: string;
    let provider: http.Server;
    let gate: http.Server;
    let script: Array<{ tool: string; args: Record<string, unknown> }>;
    let gateSeen: string[];
    let armed: number;

    before(function (): void {
        if (!available) {
            this.skip();
        }
    });

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-oc-cli-'));
        script = [];
        gateSeen = [];
        armed = 0;
        provider = http.createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                const tools: string[] = (body.tools ?? []).map((t: { function?: { name?: string } }) => t.function?.name);
                const answered = JSON.stringify(body.messages ?? []).includes('"role":"tool"');
                const isMainSession = tools.includes('task');
                res.writeHead(200, { 'content-type': 'text/event-stream' });
                const base = { id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm' };
                const send = (v: unknown): void => { res.write(`data: ${JSON.stringify(v)}\n\n`); };
                const next = tools.length > 0 && !answered ? (isMainSession ? script[0] : { tool: 'bash', args: { command: 'true', description: 'sub' } }) : undefined;
                if (next) {
                    send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: next.tool, arguments: JSON.stringify(next.args) } }] } }] });
                    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
                } else {
                    send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'done' } }] });
                    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
                }
                res.write('data: [DONE]\n\n');
                res.end();
            });
        });
        gate = http.createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => {
                if (req.url === '/gate/arm') {
                    armed++;
                    res.end('{}');
                    return;
                }
                gateSeen.push(JSON.parse(Buffer.concat(chunks).toString('utf8')).rawToolName);
                res.end(JSON.stringify({ decision: { kind: 'allow', source: 'policy' } }));
            });
        });
        await Promise.all([provider, gate].map(s => new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve))));
    });

    afterEach(() => {
        provider.close();
        gate.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('the probe proves the plugin loads and sees tool calls', async () => {
        const verdict = await QAAP_OPENCODE_GATE_PROBE.ensure(resolveQaapToolGateOpencodePluginPath());
        expect(verdict, verdict.reason).to.include({ ok: true });
    });

    async function runOpencode(first: { tool: string; args: Record<string, unknown> }, extraConfig: Record<string, unknown> = {}): Promise<void> {
        script = [first];
        const env: NodeJS.ProcessEnv = {
            ...process.env,
            QAAP_GATE_URL: `http://127.0.0.1:${(gate.address() as AddressInfo).port}/gate`,
            QAAP_GATE_TOKEN: 't',
            OPENCODE_PERMISSION: '{"edit":"ask","bash":"ask","webfetch":"ask"}',
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
                model: 'fake/m',
                ...extraConfig,
                provider: { fake: { npm: '@ai-sdk/openai-compatible', name: 'fake', options: { baseURL: `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`, apiKey: 'x' }, models: { m: { name: 'm', tool_call: true, limit: { context: 100000, output: 4000 } } } } },
            }),
            XDG_CONFIG_HOME: path.join(dir, 'xdg', 'config'),
            XDG_DATA_HOME: path.join(dir, 'xdg', 'data'),
            XDG_STATE_HOME: path.join(dir, 'xdg', 'state'),
            XDG_CACHE_HOME: path.join(os.tmpdir(), `qaap-opencode-gate-probe-${process.getuid?.() ?? 'u'}`, 'cache'),
        };
        QAAP_OPENCODE_GATE_PROBE.record({ ok: true, reason: 'ok', key: 'spec' });
        applyOpencodeGateEnv(env, false);
        fs.mkdirSync(path.join(dir, 'work'));
        await new Promise<void>(resolve => {
            const child = spawn('opencode', ['run', '--format', 'json', '-m', 'fake/m', 'go'], { cwd: path.join(dir, 'work'), env, stdio: 'ignore' });
            const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
            child.once('exit', () => { clearTimeout(timer); resolve(); });
        });
        QAAP_OPENCODE_GATE_PROBE.record(undefined);
    }

    it('arms, lifts the ask baseline and routes a built-in tool through the gate', async () => {
        await runOpencode({ tool: 'bash', args: { command: 'true', description: 'x' } });
        expect(armed).to.be.greaterThan(0);
        expect(gateSeen).to.include('bash');
    });

    it('routes MCP tools through the gate', async () => {
        const server = path.join(dir, 'mcp.mjs');
        fs.writeFileSync(server, `import readline from 'node:readline';
const send = o => process.stdout.write(JSON.stringify(o) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', l => { const m = JSON.parse(l);
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'm', version: '1' } } });
  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'ping', description: 'ping', inputSchema: { type: 'object', properties: {} } }] } });
  else if (m.method === 'tools/call') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'pong' }] } });
  else if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: {} }); });
`);
        await runOpencode({ tool: 'm_ping', args: {} }, { mcp: { m: { type: 'local', command: ['node', server] } } });
        expect(gateSeen).to.include('m_ping');
    });

    it('routes the task tool and the tools of its subagent through the gate', async () => {
        await runOpencode({ tool: 'task', args: { description: 'sub', prompt: 'say hi', subagent_type: 'general' } });
        expect(gateSeen).to.include.members(['task', 'bash']);
    });
});
