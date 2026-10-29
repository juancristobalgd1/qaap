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
const MAX_PROBE_FILE_BYTES = 64 * 1024;

/** OS identity OpenCode runs as in the task (`resolveAgentSpawnIdentity`). */
export interface ProbeIdentity {
    readonly uid?: number;
    readonly gid?: number;
}

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

    /**
     * `identity` is the OS identity OpenCode runs as in the task (`resolveAgentSpawnIdentity`): the probe
     * runs as it too, so a root backend never executes OpenCode (or anything the agent can influence).
     */
    async ensure(pluginPath: string, env: NodeJS.ProcessEnv = process.env, command: string = 'opencode', identity?: ProbeIdentity): Promise<QaapOpencodeGateProbeVerdict> {
        const drop = this.resolveDrop(identity);
        let key: string;
        try {
            key = `${command}|${await this.readVersion(command, env, drop)}|${fs.statSync(pluginPath).mtimeMs}`;
        } catch (error) {
            return this.latest = { ok: false, key: `${command}|unknown`, reason: `OpenCode could not be started to probe the gate plugin (${error instanceof Error ? error.message : String(error)}).` };
        }
        const cached = this.verdicts.get(key);
        if (cached && (cached.verdict.ok || Date.now() - cached.at < FAILED_VERDICT_TTL_MS)) {
            return this.latest = cached.verdict;
        }
        let running = this.inflight.get(key);
        if (!running) {
            running = this.runProbe(key, pluginPath, env, command, drop)
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

    /** The identity to drop to, only when it really differs from this process (root backend, agent uid). */
    protected resolveDrop(identity: ProbeIdentity | undefined): { uid: number; gid: number } | undefined {
        const current = typeof process.getuid === 'function' ? process.getuid() : undefined;
        if (identity?.uid === undefined || identity.uid === current) {
            return undefined;
        }
        return { uid: identity.uid, gid: identity.gid ?? identity.uid };
    }

    /** Runs as the agent identity and with a minimal env: the binary found on PATH is the only thing inherited. */
    protected readVersion(command: string, env: NodeJS.ProcessEnv, drop?: { uid: number; gid: number }): Promise<string> {
        return new Promise((resolve, reject) => {
            execFile(command, ['--version'], {
                env: { PATH: env.PATH ?? '' },
                cwd: path.parse(os.tmpdir()).root,
                timeout: 10_000,
                ...(drop ? { uid: drop.uid, gid: drop.gid } : {}),
            }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
        });
    }

    protected async runProbe(key: string, pluginPath: string, env: NodeJS.ProcessEnv, command: string, drop?: { uid: number; gid: number }): Promise<QaapOpencodeGateProbeVerdict> {
        const sandbox = this.createSandbox(drop);
        const probeFile = path.join(sandbox.agentDir, 'probe.log');
        const llm = await this.startFakeProvider();
        try {
            await this.runChild(command, sandbox.agentDir, this.buildProbeEnv(env, sandbox.agentDir, pluginPath, probeFile, llm.port), drop);
            const seen = this.readProbeFile(probeFile);
            if (!seen.includes('config')) {
                return { ok: false, key, reason: 'This OpenCode did not load the Qaap gate plugin.' };
            }
            if (!seen.some(line => line.startsWith('before:'))) {
                return { ok: false, key, reason: 'This OpenCode loaded the Qaap gate plugin but never called tool.execute.before.' };
            }
            return { ok: true, key, reason: 'The gate plugin loads and sees tool calls.' };
        } finally {
            llm.close();
            await this.removeSandbox(sandbox, drop);
        }
    }

    /**
     * Everything the probe touches lives in a random directory this process creates (mkdtemp), never at a
     * predictable path the agent could pre-plant. `base` stays owned by this process (0700, or 0711 with a
     * drop so the agent can reach its own subdirectory); `agentDir` is handed to the agent by file
     * descriptor. This process never operates by path inside `agentDir` except for the guarded read below.
     */
    protected createSandbox(drop: { uid: number; gid: number } | undefined): { base: string; agentDir: string } {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-oc-probe-'));
        try {
            this.verifyDirectory(base, process.getuid?.(), drop ? 0o022 : 0o077);
            const agentDir = path.join(base, 'agent');
            fs.mkdirSync(agentDir, { mode: 0o700 });
            if (drop) {
                this.handOverDirectory(agentDir, drop);
                fs.chmodSync(base, 0o711);
                this.verifyDirectory(base, process.getuid?.(), 0o022);
            }
            return { base, agentDir };
        } catch (error) {
            fs.rmSync(base, { recursive: true, force: true });
            throw error;
        }
    }

    /** lstat checks: a real directory (not a link), owned as expected, no forbidden mode bits. */
    protected verifyDirectory(dir: string, expectedUid: number | undefined, forbiddenMode: number): void {
        const stat = fs.lstatSync(dir);
        if (!stat.isDirectory() || (expectedUid !== undefined && stat.uid !== expectedUid) || (stat.mode & forbiddenMode) !== 0) {
            throw new Error(`Refusing to use ${dir} for the gate probe: it is not a private directory owned by the backend.`);
        }
    }

    protected handOverDirectory(dir: string, owner: { uid: number; gid: number }): void {
        const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | (fs.constants.O_NOFOLLOW ?? 0));
        try {
            this.handOver(fd, owner);
        } finally {
            fs.closeSync(fd);
        }
    }

    /** The only chown: by file descriptor, so a link can never redirect it. Overridable for tests. */
    protected handOver(fd: number, owner: { uid: number; gid: number }): void {
        fs.fchownSync(fd, owner.uid, owner.gid);
    }

    /** A complete env of our own: HOME, XDG, TMPDIR and the inline config all point into the sandbox. */
    protected buildProbeEnv(env: NodeJS.ProcessEnv, agentDir: string, pluginPath: string, probeFile: string, port: number): NodeJS.ProcessEnv {
        return {
            PATH: env.PATH ?? '',
            HOME: agentDir,
            TMPDIR: agentDir,
            XDG_CONFIG_HOME: path.join(agentDir, 'xdg-config'),
            XDG_DATA_HOME: path.join(agentDir, 'xdg-data'),
            XDG_STATE_HOME: path.join(agentDir, 'xdg-state'),
            XDG_CACHE_HOME: path.join(agentDir, 'xdg-cache'),
            OPENCODE_DISABLE_PROJECT_CONFIG: '1',
            OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
            OPENCODE_DISABLE_CLAUDE_CODE: '1',
            OPENCODE_DISABLE_AUTOUPDATE: '1',
            OPENCODE_DISABLE_MODELS_FETCH: '1',
            QAAP_GATE_PROBE_FILE: probeFile,
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
                plugin: [pathToFileURL(pluginPath).toString()],
                model: 'qaapprobe/probe',
                provider: {
                    qaapprobe: {
                        npm: '@ai-sdk/openai-compatible',
                        name: 'qaapprobe',
                        options: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'probe' },
                        models: { probe: { name: 'probe', tool_call: true, limit: { context: 100000, output: 4000 } } },
                    },
                },
            }),
        };
    }

    protected runChild(command: string, cwd: string, env: NodeJS.ProcessEnv, drop?: { uid: number; gid: number }): Promise<void> {
        return new Promise<void>(resolve => {
            const child = spawn(command, ['run', '--format', 'json', '-m', 'qaapprobe/probe', 'probe'], {
                cwd, env, stdio: 'ignore', ...(drop ? { uid: drop.uid, gid: drop.gid } : {}),
            });
            const timer = setTimeout(() => child.kill('SIGKILL'), PROBE_TIMEOUT_MS);
            child.once('exit', () => { clearTimeout(timer); resolve(); });
            child.once('error', () => { clearTimeout(timer); resolve(); });
        });
    }

    /**
     * The agent owns the file, so it is read like Codex reads agent-owned files: without following links,
     * only if it is a regular single-link file, capped in size.
     */
    protected readProbeFile(file: string): string[] {
        let fd: number | undefined;
        try {
            fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW ?? 0));
            const stat = fs.fstatSync(fd);
            if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_PROBE_FILE_BYTES) {
                return [];
            }
            return fs.readFileSync(fd, 'utf8').split('\n');
        } catch {
            return [];
        } finally {
            if (fd !== undefined) {
                fs.closeSync(fd);
            }
        }
    }

    /**
     * With a drop the agent owns everything in `agentDir`, so it is deleted by a child running as the agent
     * (`rm -rf` cannot be redirected into root-only files); this process then only removes the empty `base`.
     */
    protected async removeSandbox(sandbox: { base: string; agentDir: string }, drop: { uid: number; gid: number } | undefined): Promise<void> {
        try {
            if (drop) {
                await new Promise<void>(resolve => {
                    const child = spawn('rm', ['-rf', '--', sandbox.agentDir], { stdio: 'ignore', uid: drop.uid, gid: drop.gid, cwd: path.parse(os.tmpdir()).root });
                    child.once('exit', () => resolve());
                    child.once('error', () => resolve());
                });
                fs.rmdirSync(sandbox.base);
            } else {
                fs.rmSync(sandbox.base, { recursive: true, force: true });
            }
        } catch {
            // A leftover empty or agent-owned directory under the OS temp dir is harmless; never recurse as root.
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
