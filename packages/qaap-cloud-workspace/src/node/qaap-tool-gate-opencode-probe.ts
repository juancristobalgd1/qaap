// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

/** Result of checking that an OpenCode binary loads the Qaap gate plugin and fires `tool.execute.before`. */
export interface QaapOpencodeGateProbeVerdict {
    readonly ok: boolean;
    readonly reason: string;
    /** Binary + version + plugin build the verdict is about. */
    readonly key: string;
}

const PROBE_TIMEOUT_MS = 60_000;
const FAILED_VERDICT_TTL_MS = 60_000;

/**
 * Proves, once per OpenCode version and plugin build, that the gate plugin really is in the loop: a
 * throw-away `opencode run` against a local fake OpenAI-compatible provider must report both the plugin
 * `config` hook and a `tool.execute.before` call (the plugin's probe mode writes them to a file and blocks
 * the tool). Without that proof the runner does not wire the plugin and keeps OpenCode's own `ask` rules,
 * which refuse gated tools. The last verdict is readable synchronously for the spawn code.
 */
export class QaapOpencodeGateProbe {

    protected readonly verdicts = new Map<string, { verdict: QaapOpencodeGateProbeVerdict; at: number }>();
    protected readonly inflight = new Map<string, Promise<QaapOpencodeGateProbeVerdict>>();
    protected latest: QaapOpencodeGateProbeVerdict | undefined;

    /** Verdict of the latest {@link ensure}; `undefined` before any probe ran (treated as not proven). */
    verdict(): QaapOpencodeGateProbeVerdict | undefined {
        return this.latest;
    }

    /** Records a verdict without probing (tests, or a caller that proved it another way). */
    record(verdict: QaapOpencodeGateProbeVerdict | undefined): void {
        this.latest = verdict;
    }

    async ensure(pluginPath: string, env: NodeJS.ProcessEnv = process.env, command: string = 'opencode'): Promise<QaapOpencodeGateProbeVerdict> {
        let key: string;
        try {
            key = `${command}|${await this.readVersion(command, env)}|${fs.statSync(pluginPath).mtimeMs}`;
        } catch (error) {
            return this.latest = { ok: false, key: `${command}|unknown`, reason: `OpenCode could not be started to probe the gate plugin (${error instanceof Error ? error.message : String(error)}).` };
        }
        const cached = this.verdicts.get(key);
        if (cached && (cached.verdict.ok || Date.now() - cached.at < FAILED_VERDICT_TTL_MS)) {
            return this.latest = cached.verdict;
        }
        let running = this.inflight.get(key);
        if (!running) {
            running = this.runProbe(key, pluginPath, env, command)
                .catch(error => ({ ok: false, key, reason: `The gate probe failed (${error instanceof Error ? error.message : String(error)}).` }))
                .then(verdict => {
                    this.verdicts.set(key, { verdict, at: Date.now() });
                    this.inflight.delete(key);
                    return verdict;
                });
            this.inflight.set(key, running);
        }
        return this.latest = await running;
    }

    protected readVersion(command: string, env: NodeJS.ProcessEnv): Promise<string> {
        return new Promise((resolve, reject) => {
            execFile(command, ['--version'], { env, timeout: 10_000 }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
        });
    }

    protected async runProbe(key: string, pluginPath: string, env: NodeJS.ProcessEnv, command: string): Promise<QaapOpencodeGateProbeVerdict> {
        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-oc-probe-'));
        // Provider packages are fetched into this cache once; keep it across probes.
        const stateDir = path.join(os.tmpdir(), `qaap-opencode-gate-probe-${process.getuid?.() ?? 'u'}`);
        const probeFile = path.join(workDir, 'probe.log');
        const llm = await this.startFakeProvider();
        try {
            const childEnv: NodeJS.ProcessEnv = { ...env };
            for (const name of Object.keys(childEnv)) {
                if (name.startsWith('QAAP_GATE_') || name.startsWith('OPENCODE_')) {
                    delete childEnv[name];
                }
            }
            Object.assign(childEnv, {
                XDG_CONFIG_HOME: path.join(stateDir, 'config'),
                XDG_DATA_HOME: path.join(stateDir, 'data'),
                XDG_STATE_HOME: path.join(stateDir, 'state'),
                XDG_CACHE_HOME: path.join(stateDir, 'cache'),
                OPENCODE_DISABLE_PROJECT_CONFIG: '1',
                QAAP_GATE_PROBE_FILE: probeFile,
                OPENCODE_CONFIG_CONTENT: JSON.stringify({
                    plugin: [pathToFileURL(pluginPath).toString()],
                    model: 'qaapprobe/probe',
                    provider: {
                        qaapprobe: {
                            npm: '@ai-sdk/openai-compatible',
                            name: 'qaapprobe',
                            options: { baseURL: `http://127.0.0.1:${llm.port}/v1`, apiKey: 'probe' },
                            models: { probe: { name: 'probe', tool_call: true, limit: { context: 100000, output: 4000 } } },
                        },
                    },
                }),
            });
            fs.mkdirSync(stateDir, { recursive: true });
            await new Promise<void>(resolve => {
                const child = spawn(command, ['run', '--format', 'json', '-m', 'qaapprobe/probe', 'probe'], { cwd: workDir, env: childEnv, stdio: 'ignore' });
                const timer = setTimeout(() => child.kill('SIGKILL'), PROBE_TIMEOUT_MS);
                child.once('exit', () => { clearTimeout(timer); resolve(); });
                child.once('error', () => { clearTimeout(timer); resolve(); });
            });
            const seen = fs.existsSync(probeFile) ? fs.readFileSync(probeFile, 'utf8').split('\n') : [];
            if (!seen.includes('config')) {
                return { ok: false, key, reason: 'This OpenCode did not load the Qaap gate plugin.' };
            }
            if (!seen.some(line => line.startsWith('before:'))) {
                return { ok: false, key, reason: 'This OpenCode loaded the Qaap gate plugin but never called tool.execute.before.' };
            }
            return { ok: true, key, reason: 'The gate plugin loads and sees tool calls.' };
        } finally {
            llm.close();
            fs.rmSync(workDir, { recursive: true, force: true });
        }
    }

    /** Minimal OpenAI-compatible streaming endpoint whose only answer is one `bash` tool call. */
    protected startFakeProvider(): Promise<{ port: number; close: () => void }> {
        return new Promise(resolve => {
            const server = http.createServer((req, res) => {
                const chunks: Buffer[] = [];
                req.on('data', chunk => chunks.push(chunk));
                req.on('end', () => {
                    const answered = Buffer.concat(chunks).toString('utf8').includes('"role":"tool"');
                    res.writeHead(200, { 'content-type': 'text/event-stream' });
                    const base = { id: 'probe', object: 'chat.completion.chunk', created: 1, model: 'probe' };
                    const send = (value: unknown): void => { res.write(`data: ${JSON.stringify(value)}\n\n`); };
                    if (answered) {
                        send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'done' } }] });
                        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
                        res.write('data: [DONE]\n\n');
                        res.end();
                        return;
                    }
                    send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_probe', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: 'true', description: 'probe' }) } }] } }] });
                    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
                    res.write('data: [DONE]\n\n');
                    res.end();
                });
            });
            server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as AddressInfo).port, close: () => server.close() }));
        });
    }
}

/** Process-wide probe: the spawn path awaits `ensure`, the synchronous env wiring reads `verdict`. */
export const QAAP_OPENCODE_GATE_PROBE = new QaapOpencodeGateProbe();
