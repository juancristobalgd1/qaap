// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Local exec client for broker-mode sandboxes (doc/qaap-task-sandbox.md). The tenant backend's
 * spawn seam launches `node <this file> <request-file>` instead of the real command: this process
 * streams its stdio to the exec server inside the sandbox, so stdio never transits the control
 * plane, and it behaves like the remote process for its parent (exit code, exit signal, kill).
 *
 * The request file (mode 0600 in a backend-private directory) holds the endpoint, the per-sandbox
 * token and the exact environment for the command. It is read and deleted at once: no secret is
 * ever on an argv or in this process's environment.
 */

/* eslint-disable no-null/no-null */

import * as fs from 'fs';
import * as net from 'net';
import { encodeQaapSandboxFrame, QaapSandboxFrame, QaapSandboxFrameDecoder } from './qaap-task-sandbox-exec-protocol';

export interface QaapSandboxExecClientRequest {
    readonly host: string;
    readonly port: number;
    readonly token: string;
    readonly file: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly tty?: boolean;
}

const CONNECT_RETRY_MS = 5_000;
const FORWARDED_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT', 'SIGUSR1', 'SIGUSR2'];

function readRequest(file: string | undefined): QaapSandboxExecClientRequest {
    if (!file) {
        throw new Error('usage: qaap-task-sandbox-exec-client-main <request-file>');
    }
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as QaapSandboxExecClientRequest;
    } finally {
        fs.rmSync(file, { force: true });
    }
}

function connect(request: QaapSandboxExecClientRequest, deadline: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
        const socket = net.connect(request.port, request.host);
        socket.once('connect', () => {
            socket.removeAllListeners('error');
            resolve(socket);
        });
        socket.once('error', error => {
            socket.destroy();
            if (Date.now() < deadline) {
                setTimeout(() => connect(request, deadline).then(resolve, reject), 100);
            } else {
                reject(error);
            }
        });
    });
}

async function main(): Promise<void> {
    const request = readRequest(process.argv[2]);
    let socket: net.Socket;
    try {
        socket = await connect(request, Date.now() + CONNECT_RETRY_MS);
    } catch (error) {
        process.stderr.write(`qaap-sandbox: cannot reach the sandbox exec server: ${(error as Error).message}\n`);
        process.exit(126);
    }
    socket.setNoDelay(true);
    const tty = !!request.tty && !!process.stdin.isTTY;
    socket.write(`${JSON.stringify({
        token: request.token,
        op: 'exec',
        file: request.file,
        args: request.args,
        cwd: request.cwd,
        env: request.env,
        tty,
        cols: process.stdout.columns,
        rows: process.stdout.rows,
    })}\n`);

    let exited = false;
    const decoder = new QaapSandboxFrameDecoder();
    socket.on('data', (chunk: Buffer) => {
        for (const { type, payload } of decoder.push(chunk)) {
            if (type === QaapSandboxFrame.Stdout) {
                if (!process.stdout.write(payload)) {
                    socket.pause();
                    process.stdout.once('drain', () => socket.resume());
                }
            } else if (type === QaapSandboxFrame.Stderr) {
                process.stderr.write(payload);
            } else if (type === QaapSandboxFrame.Exit) {
                exited = true;
                const { code, signal } = JSON.parse(payload.toString('utf8')) as { code: number | null; signal: NodeJS.Signals | null };
                finish(code, signal);
            } else if (type === QaapSandboxFrame.Error) {
                exited = true;
                process.stderr.write(`qaap-sandbox: ${(JSON.parse(payload.toString('utf8')) as { message?: string }).message ?? 'exec failed'}\n`);
                finish(127, null);
            }
        }
    });
    socket.on('close', () => {
        if (!exited) {
            process.stderr.write('qaap-sandbox: connection to the sandbox was lost\n');
            finish(255, null);
        }
    });
    socket.on('error', () => undefined);

    if (tty) {
        process.stdin.setRawMode?.(true);
        process.stdout.on('resize', () => socket.write(encodeQaapSandboxFrame(QaapSandboxFrame.Resize,
            JSON.stringify({ cols: process.stdout.columns, rows: process.stdout.rows }))));
    }
    process.stdin.on('data', (chunk: Buffer) => socket.write(encodeQaapSandboxFrame(QaapSandboxFrame.Stdin, chunk)));
    process.stdin.on('end', () => socket.write(encodeQaapSandboxFrame(QaapSandboxFrame.StdinEnd)));
    process.stdin.on('error', () => undefined);

    for (const signal of FORWARDED_SIGNALS) {
        process.on(signal, () => {
            socket.write(encodeQaapSandboxFrame(QaapSandboxFrame.Signal, JSON.stringify({ signal })));
            if (signal === 'SIGTERM' || signal === 'SIGHUP') {
                // The server escalates to SIGKILL after its grace period; never outlive that by much.
                setTimeout(() => finish(null, signal), 10_000).unref();
            }
        });
    }

    function finish(code: number | null, signal: NodeJS.Signals | null): void {
        const done = (): void => {
            socket.destroy();
            if (signal) {
                // Die by the same signal so the parent sees exactly what the remote process did.
                for (const forwarded of FORWARDED_SIGNALS) {
                    process.removeAllListeners(forwarded);
                }
                process.kill(process.pid, signal);
                setTimeout(() => process.exit(128 + 15), 200).unref();
                return;
            }
            process.exit(code ?? 0);
        };
        // Let buffered output reach the parent before exiting.
        process.stdout.write('', () => process.stderr.write('', done));
    }
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`qaap-sandbox: ${(error as Error).message}\n`);
        process.exit(126);
    });
}
