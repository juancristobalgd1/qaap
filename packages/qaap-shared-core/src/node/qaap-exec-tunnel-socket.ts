// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ChildProcess, spawn } from 'child_process';
import * as http from 'http';
import { Duplex } from 'stream';

/** A command that, once spawned, relays its stdin/stdout to a TCP port it can reach. */
export interface QaapExecTunnelLaunch {
    readonly file: string;
    readonly args: readonly string[];
    readonly env?: NodeJS.ProcessEnv;
}

export type QaapExecTunnelSpawn = (file: string, args: readonly string[], env: NodeJS.ProcessEnv) => ChildProcess;

/** First byte a bridge writes once its TCP connect succeeded; never part of the relayed stream. */
export const QAAP_EXEC_TUNNEL_READY_BYTE = 0x01;

/** Upper bound for spawning the bridge (e.g. `docker exec`) plus its TCP connect. */
export const QAAP_EXEC_TUNNEL_HANDSHAKE_TIMEOUT_MS = 15_000;

const defaultSpawn: QaapExecTunnelSpawn = (file, args, env) => spawn(file, [...args], {
    stdio: ['pipe', 'pipe', 'ignore'],
    env,
    windowsHide: true,
});

/**
 * Socket-like duplex backed by a bridge process (for example `docker exec -i <worker> node -e …`).
 *
 * The bridge connects to the dev server from INSIDE the network namespace that owns it, writes
 * {@link QAAP_EXEC_TUNNEL_READY_BYTE}, then relays bytes both ways. Until that byte arrives the
 * socket reports `connecting`; a bridge that exits first surfaces as `ECONNREFUSED`, exactly like
 * a refused loopback connect, so the preview proxy's existing error paths keep working.
 */
export class QaapExecTunnelSocket extends Duplex {

    connecting = true;
    readonly remoteAddress = '127.0.0.1';
    readonly remoteFamily = 'IPv4';

    protected readonly child: ChildProcess;
    protected ready = false;
    protected bridgeEnded = false;
    protected idleTimeoutMs = 0;
    protected idleTimer: ReturnType<typeof setTimeout> | undefined;
    protected handshakeTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        launch: QaapExecTunnelLaunch,
        readonly remotePort: number,
        spawnProcess: QaapExecTunnelSpawn = defaultSpawn,
        handshakeTimeoutMs: number = QAAP_EXEC_TUNNEL_HANDSHAKE_TIMEOUT_MS,
    ) {
        super({ allowHalfOpen: false });
        this.child = spawnProcess(launch.file, launch.args, launch.env ?? process.env);
        this.child.on('error', error => this.fail('ECONNREFUSED', `tunnel bridge failed to start: ${error.message}`));
        this.child.stdin?.on('error', () => this.destroy());
        this.child.stdout?.on('data', (chunk: Buffer) => this.onBridgeData(chunk));
        this.child.stdout?.on('end', () => this.endReadable());
        this.child.on('close', () => {
            if (!this.ready) {
                this.fail('ECONNREFUSED', `connect ECONNREFUSED (tunnel to port ${remotePort})`);
                return;
            }
            this.endReadable();
        });
        this.handshakeTimer = setTimeout(() => this.fail('ETIMEDOUT', `tunnel to port ${remotePort} timed out`), handshakeTimeoutMs);
    }

    /** The idle timeout currently armed (Node's http.Agent compares against this). */
    get timeout(): number {
        return this.idleTimeoutMs;
    }

    setTimeout(timeoutMs: number, callback?: () => void): this {
        this.idleTimeoutMs = timeoutMs > 0 ? timeoutMs : 0;
        if (callback) {
            if (this.idleTimeoutMs === 0) {
                this.removeListener('timeout', callback);
            } else {
                this.once('timeout', callback);
            }
        }
        this.armIdleTimer();
        return this;
    }

    setNoDelay(): this {
        return this;
    }

    setKeepAlive(): this {
        return this;
    }

    ref(): this {
        return this;
    }

    unref(): this {
        return this;
    }

    address(): { port: number; family: string; address: string } {
        return { port: this.remotePort, family: this.remoteFamily, address: this.remoteAddress };
    }

    override _read(): void {
        this.child.stdout?.resume();
    }

    override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        const stdin = this.child.stdin;
        if (!stdin || stdin.destroyed) {
            callback(Object.assign(new Error('tunnel bridge stdin closed'), { code: 'EPIPE' }));
            return;
        }
        this.armIdleTimer();
        if (stdin.write(chunk)) {
            callback();
        } else {
            stdin.once('drain', () => callback());
        }
    }

    override _final(callback: (error?: Error | null) => void): void {
        this.child.stdin?.end();
        callback();
    }

    override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        this.clearTimers();
        if (this.child.exitCode === null && this.child.signalCode === null) {
            this.child.kill();
        }
        callback(error);
    }

    protected onBridgeData(chunk: Buffer): void {
        let payload = chunk;
        if (!this.ready) {
            if (payload.length === 0) {
                return;
            }
            if (payload[0] !== QAAP_EXEC_TUNNEL_READY_BYTE) {
                this.fail('EPROTO', 'tunnel bridge sent an unexpected handshake');
                return;
            }
            this.ready = true;
            this.connecting = false;
            if (this.handshakeTimer) {
                clearTimeout(this.handshakeTimer);
                this.handshakeTimer = undefined;
            }
            this.emit('connect');
            this.emit('ready');
            payload = payload.subarray(1);
        }
        this.armIdleTimer();
        if (payload.length > 0 && !this.bridgeEnded && !this.push(payload)) {
            this.child.stdout?.pause();
        }
    }

    protected endReadable(): void {
        if (!this.ready || this.bridgeEnded) {
            return;
        }
        this.bridgeEnded = true;
        this.push(null);
    }

    protected fail(code: string, message: string): void {
        if (this.destroyed) {
            return;
        }
        this.destroy(Object.assign(new Error(message), { code }));
    }

    protected armIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = undefined;
        }
        if (this.idleTimeoutMs > 0 && !this.destroyed) {
            this.idleTimer = setTimeout(() => this.emit('timeout'), this.idleTimeoutMs);
        }
    }

    protected clearTimers(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = undefined;
        }
        if (this.handshakeTimer) {
            clearTimeout(this.handshakeTimer);
            this.handshakeTimer = undefined;
        }
    }
}

/**
 * Keep-alive HTTP agent whose connections are {@link QaapExecTunnelSocket}s. Spawning a bridge costs a
 * few hundred milliseconds, so sockets are pooled and reused for subsequent preview requests.
 */
export class QaapExecTunnelAgent extends http.Agent {

    constructor(
        protected readonly launchFor: (port: number) => QaapExecTunnelLaunch,
        protected readonly spawnProcess: QaapExecTunnelSpawn = defaultSpawn,
        options: http.AgentOptions = {},
    ) {
        super({
            keepAlive: true,
            keepAliveMsecs: 1000,
            // Each socket is one bridge process in the worker; bound the fan-out per dev server.
            maxSockets: 8,
            maxFreeSockets: 4,
            // Idle pooled bridges are torn down after this long.
            timeout: 30_000,
            ...options,
        });
    }

    override createConnection(options: { port?: number | string | null }): Duplex {
        const port = Number(options.port);
        return new QaapExecTunnelSocket(this.launchFor(port), port, this.spawnProcess);
    }
}
