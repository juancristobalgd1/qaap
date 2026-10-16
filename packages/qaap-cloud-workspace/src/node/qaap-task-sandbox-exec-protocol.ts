// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Wire protocol between a tenant backend and the exec server inside a per-task sandbox
 * (broker mode, doc/qaap-task-sandbox.md). One TCP connection per operation:
 *
 * 1. The client sends one JSON header line (`\n`-terminated) carrying the per-sandbox token.
 * 2. `exec`: both sides then exchange binary frames `[type u8][length u32 BE][payload]`.
 *    `connect`: after the server's one-line `{"ok":true}` answer the socket is a raw byte pipe
 *    to the sandbox loopback port (preview bridge). `ports` / `ping`: one JSON answer line.
 *
 * Node built-ins only: the exec client runs this from a plain `node` process. The exec server
 * (`qaap-task-sandbox-exec-server.ts`) carries its own copy because it is copied alone into the
 * toolchain volume; `qaap-task-sandbox-exec.spec.ts` checks the two stay compatible.
 */

/** Port the exec server listens on inside every sandbox (reached by container name on the tenant network). */
export const QAAP_SANDBOX_EXEC_PORT = 7391;
export const QAAP_SANDBOX_EXEC_READY_MARKER = 'QAAP_SANDBOX_EXEC_READY';

export enum QaapSandboxFrame {
    Stdin = 0,
    Stdout = 1,
    Stderr = 2,
    /** Server → client: `{ code, signal }` JSON once the process has exited and its output drained. */
    Exit = 3,
    /** Client → server: `{ signal }` JSON, delivered to the remote process group. */
    Signal = 4,
    /** Client → server: stdin reached EOF. */
    StdinEnd = 5,
    /** Client → server: `{ cols, rows }` JSON for a tty exec. */
    Resize = 6,
    /** Server → client: `{ message }` JSON when the process could not be started. */
    Error = 7,
}

export interface QaapSandboxExecRequest {
    readonly token: string;
    readonly op: 'exec';
    readonly file: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    /** Run under a pseudo-terminal (`script`) — terminals. */
    readonly tty?: boolean;
    readonly cols?: number;
    readonly rows?: number;
}

export interface QaapSandboxConnectRequest {
    readonly token: string;
    readonly op: 'connect';
    readonly port: number;
}

export interface QaapSandboxSimpleRequest {
    readonly token: string;
    readonly op: 'ports' | 'ping';
}

export type QaapSandboxExecServerRequest = QaapSandboxExecRequest | QaapSandboxConnectRequest | QaapSandboxSimpleRequest;

export function encodeQaapSandboxFrame(type: QaapSandboxFrame, payload: Buffer | string = Buffer.alloc(0)): Buffer {
    const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
    const header = Buffer.alloc(5);
    header.writeUInt8(type, 0);
    header.writeUInt32BE(body.length, 1);
    return Buffer.concat([header, body]);
}

/** Incremental frame parser: feed socket chunks, get whole frames back. */
export class QaapSandboxFrameDecoder {
    protected buffer: Buffer = Buffer.alloc(0);

    push(chunk: Buffer): Array<{ type: QaapSandboxFrame; payload: Buffer }> {
        this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
        const frames: Array<{ type: QaapSandboxFrame; payload: Buffer }> = [];
        while (this.buffer.length >= 5) {
            const length = this.buffer.readUInt32BE(1);
            if (this.buffer.length < 5 + length) {
                break;
            }
            frames.push({ type: this.buffer.readUInt8(0) as QaapSandboxFrame, payload: this.buffer.subarray(5, 5 + length) });
            this.buffer = this.buffer.subarray(5 + length);
        }
        return frames;
    }
}

/**
 * Listening TCP ports in `/proc/net/tcp` / `/proc/net/tcp6` text (state `0A`). Used for preview
 * port detection: what a dev server in the sandbox actually bound, whatever PORT said.
 */
export function parseQaapListeningPorts(procNetTcp: string): number[] {
    const ports = new Set<number>();
    for (const line of procNetTcp.split('\n')) {
        const fields = line.trim().split(/\s+/);
        if (fields.length < 4 || fields[3] !== '0A') {
            continue;
        }
        const port = Number.parseInt(fields[1].split(':').pop() ?? '', 16);
        if (Number.isInteger(port) && port > 0) {
            ports.add(port);
        }
    }
    return [...ports].sort((left, right) => left - right);
}
