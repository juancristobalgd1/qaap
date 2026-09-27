// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as http from 'http';
import { injectable } from '@theia/core/shared/inversify';
import { QaapExecTunnelAgent, QaapExecTunnelLaunch, QaapExecTunnelSpawn, QAAP_EXEC_TUNNEL_READY_BYTE } from './qaap-exec-tunnel-socket';
import { spawn } from 'child_process';

/**
 * Routes preview traffic to dev servers that do NOT listen on this process' loopback.
 *
 * In hosted per-tenant mode the preview proxy runs in the control-plane container while each
 * tenant's dev server runs inside its worker container, in another network namespace (and on a
 * Docker network with ICC disabled). Loopback probing from the proxy can never see it; a tunnel
 * reaches the worker's own loopback instead. Bound only where such isolation exists.
 */
export const QaapDevPreviewUpstreamTunnel = Symbol('QaapDevPreviewUpstreamTunnel');
export interface QaapDevPreviewUpstreamTunnel {
    /** True when `ownerLogin`'s dev servers must be reached through this tunnel. */
    handles(ownerLogin: string): boolean;
    /** Host label to use for `port` when something listens there, otherwise undefined. */
    resolveHost(ownerLogin: string, port: number): Promise<string | undefined>;
    /** HTTP agent whose connections reach `ownerLogin`'s loopback. */
    agentFor(ownerLogin: string): http.Agent;
    /** Drops cached reachability for `port` (all owners). */
    invalidate(port: number): void;
    /** SIGTERMs whatever listens on `port` inside `ownerLogin`'s runtime (best-effort). */
    terminateListeners(ownerLogin: string, port: number): void;
}

/**
 * Runs inside the worker: connects to the dev server on the worker's loopback (IPv4 first, then
 * IPv6 — Vite 7 binds `::1` for `localhost`), writes the ready byte and relays stdin/stdout.
 * argv: `<port> <probe|stream>`. Exit codes: 0 ok, 2 bad port, 3 nothing listening.
 */
export const QAAP_DEV_PREVIEW_BRIDGE_SCRIPT = [
    'const net = require("net");',
    'const port = Number(process.argv[1]);',
    'const mode = process.argv[2];',
    'const hosts = ["127.0.0.1", "::1"];',
    'process.stdout.on("error", () => process.exit(0));',
    'const attempt = index => {',
    '  if (index >= hosts.length) { process.exit(3); }',
    '  const socket = net.connect({ host: hosts[index], port });',
    '  socket.once("error", () => attempt(index + 1));',
    '  socket.once("connect", () => {',
    '    socket.removeAllListeners("error");',
    '    if (mode === "probe") { socket.destroy(); process.stdout.write("\\u0001", () => process.exit(0)); return; }',
    '    socket.setNoDelay(true);',
    '    process.stdout.write("\\u0001");',
    '    socket.on("error", () => process.exit(0));',
    '    socket.on("close", () => process.stdout.end(() => process.exit(0)));',
    '    socket.pipe(process.stdout);',
    '    process.stdin.pipe(socket);',
    '  });',
    '};',
    'if (!Number.isInteger(port) || port < 1 || port > 65535) { process.exit(2); } else { attempt(0); }',
].join('\n');

/**
 * Runs inside the worker: SIGTERMs processes owning a LISTEN socket on `<port>` (never pid 1).
 * Mirrors `terminateListenersOnPort` for runtimes whose processes live in another pid namespace.
 */
export const QAAP_DEV_PREVIEW_TERMINATE_SCRIPT = [
    'const fs = require("fs");',
    'const port = Number(process.argv[1]);',
    'const inodes = new Set();',
    'for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {',
    '  let text = "";',
    '  try { text = fs.readFileSync(table, "utf8"); } catch { continue; }',
    '  for (const line of text.split("\\n").slice(1)) {',
    '    const fields = line.trim().split(/\\s+/);',
    '    if (fields.length > 9 && fields[3] === "0A" && parseInt(fields[1].split(":").pop(), 16) === port) { inodes.add(fields[9]); }',
    '  }',
    '}',
    'if (inodes.size > 0) {',
    '  for (const entry of fs.readdirSync("/proc")) {',
    '    if (!/^\\d+$/.test(entry) || entry === "1" || Number(entry) === process.pid) { continue; }',
    '    try {',
    '      for (const fd of fs.readdirSync("/proc/" + entry + "/fd")) {',
    '        const match = /^socket:\\[(\\d+)\\]$/.exec(fs.readlinkSync("/proc/" + entry + "/fd/" + fd));',
    '        if (match && inodes.has(match[1])) { process.kill(Number(entry), "SIGTERM"); break; }',
    '      }',
    '    } catch { /* process gone or not ours */ }',
    '  }',
    '}',
].join('\n');

const TUNNEL_HOST_LABEL = '127.0.0.1';
const REACHABILITY_CACHE_TTL_MS = 10_000;
const PROBE_TIMEOUT_MS = 8_000;
const TERMINATE_TIMEOUT_MS = 10_000;

const defaultTunnelSpawn: QaapExecTunnelSpawn = (file, args, env) => spawn(file, [...args], {
    stdio: ['pipe', 'pipe', 'ignore'],
    env,
    windowsHide: true,
});

/**
 * Tunnel whose bridge is a `node` command executed inside the tenant runtime. Subclasses decide which
 * owners it applies to and how a worker command is launched (e.g. wrapped in `docker exec -i`).
 */
@injectable()
export abstract class QaapExecDevPreviewUpstreamTunnel implements QaapDevPreviewUpstreamTunnel {

    protected readonly agents = new Map<string, QaapExecTunnelAgent>();
    protected readonly reachability = new Map<string, { host: string; at: number }>();
    protected spawnProcess: QaapExecTunnelSpawn = defaultTunnelSpawn;

    abstract handles(ownerLogin: string): boolean;

    /** Wraps a command meant to run inside `ownerLogin`'s runtime into a local launch. */
    protected abstract wrapRuntimeCommand(ownerLogin: string, command: readonly string[]): QaapExecTunnelLaunch;

    async resolveHost(ownerLogin: string, port: number): Promise<string | undefined> {
        const key = this.cacheKey(ownerLogin, port);
        const cached = this.reachability.get(key);
        if (cached && Date.now() - cached.at < REACHABILITY_CACHE_TTL_MS) {
            return cached.host;
        }
        if (await this.probe(ownerLogin, port)) {
            this.reachability.set(key, { host: TUNNEL_HOST_LABEL, at: Date.now() });
            return TUNNEL_HOST_LABEL;
        }
        this.reachability.delete(key);
        return undefined;
    }

    agentFor(ownerLogin: string): http.Agent {
        let agent = this.agents.get(ownerLogin);
        if (!agent) {
            agent = new QaapExecTunnelAgent(port => this.bridgeLaunch(ownerLogin, port, 'stream'), this.spawnProcess);
            this.agents.set(ownerLogin, agent);
        }
        return agent;
    }

    invalidate(port: number): void {
        const suffix = `\u0000${port}`;
        for (const key of [...this.reachability.keys()]) {
            if (key.endsWith(suffix)) {
                this.reachability.delete(key);
            }
        }
    }

    terminateListeners(ownerLogin: string, port: number): void {
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            return;
        }
        this.invalidate(port);
        try {
            const launch = this.wrapRuntimeCommand(ownerLogin, ['node', '-e', QAAP_DEV_PREVIEW_TERMINATE_SCRIPT, String(port)]);
            const child = this.spawnProcess(launch.file, launch.args, launch.env ?? process.env);
            child.on('error', () => undefined);
            child.stdin?.end();
            const timer = setTimeout(() => child.kill(), TERMINATE_TIMEOUT_MS);
            child.on('close', () => clearTimeout(timer));
        } catch (error) {
            console.warn('[qaap-preview] could not terminate tunnelled listener', { ownerLogin, port, error: String(error) });
        }
    }

    protected bridgeLaunch(ownerLogin: string, port: number, mode: 'probe' | 'stream'): QaapExecTunnelLaunch {
        return this.wrapRuntimeCommand(ownerLogin, ['node', '-e', QAAP_DEV_PREVIEW_BRIDGE_SCRIPT, String(port), mode]);
    }

    protected probe(ownerLogin: string, port: number): Promise<boolean> {
        return new Promise(resolve => {
            let settled = false;
            let sawReady = false;
            const finish = (ok: boolean): void => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    resolve(ok);
                }
            };
            let child: ReturnType<QaapExecTunnelSpawn>;
            try {
                const launch = this.bridgeLaunch(ownerLogin, port, 'probe');
                child = this.spawnProcess(launch.file, launch.args, launch.env ?? process.env);
            } catch {
                resolve(false);
                return;
            }
            const timer = setTimeout(() => {
                child.kill();
                finish(false);
            }, PROBE_TIMEOUT_MS);
            child.on('error', () => finish(false));
            child.stdin?.on('error', () => undefined);
            child.stdin?.end();
            child.stdout?.on('data', (chunk: Buffer) => {
                if (chunk.includes(QAAP_EXEC_TUNNEL_READY_BYTE)) {
                    sawReady = true;
                }
            });
            child.on('close', code => finish(code === 0 && sawReady));
        });
    }

    protected cacheKey(ownerLogin: string, port: number): string {
        return `${ownerLogin}\u0000${port}`;
    }
}
