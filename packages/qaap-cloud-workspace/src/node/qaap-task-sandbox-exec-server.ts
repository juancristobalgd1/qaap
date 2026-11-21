// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/* eslint-disable no-null/no-null */

/**
 * Exec server that runs INSIDE a per-task sandbox in broker mode (doc/qaap-task-sandbox.md).
 *
 * The control plane copies this compiled file, alone, into the read-only `/opt/qaap-agent`
 * toolchain volume and starts it as the sandbox entrypoint. It must therefore stay
 * self-contained: Node built-ins only, imported with `import x = require()` so the compiled
 * output needs no `tslib` helper. Protocol: `qaap-task-sandbox-exec-protocol.ts` (same constants).
 *
 * Every request carries the per-sandbox token. The token arrives as the first line on stdin
 * (the broker writes it through `docker attach` and closes stdin; see `readToken` for the attach
 * body that can precede it), never through the environment:
 * an env var would stay readable in /proc/<pid>/environ of this process and of the init process,
 * and in `docker inspect`, for every command running as the same uid.
 * any process is started, so the commands this server runs never inherit it.
 */

import childProcess = require('child_process');
import crypto = require('crypto');
import fs = require('fs');
import net = require('net');
import path = require('path');

const FRAME_STDIN = 0;
const FRAME_STDOUT = 1;
const FRAME_STDERR = 2;
const FRAME_EXIT = 3;
const FRAME_SIGNAL = 4;
const FRAME_STDIN_END = 5;
const FRAME_RESIZE = 6;
const FRAME_ERROR = 7;
const MAX_HEADER_BYTES = 1024 * 1024;
const KILL_GRACE_MS = 2_000;
const SIGNALS = new Set(['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGKILL', 'SIGQUIT', 'SIGUSR1', 'SIGUSR2', 'SIGWINCH']);

let token = '';
const listenPort = Number(process.env.QAAP_SANDBOX_EXEC_PORT) || 7391;
const homeLinks = process.env.QAAP_SANDBOX_HOME_LINKS ?? '[]';
delete process.env.QAAP_SANDBOX_HOME_LINKS;

function frame(type: number, payload: Buffer | string = ''): Buffer {
    const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
    const header = Buffer.alloc(5);
    header.writeUInt8(type, 0);
    header.writeUInt32BE(body.length, 1);
    return Buffer.concat([header, body]);
}

function tokenMatches(candidate: unknown): boolean {
    if (typeof candidate !== 'string' || token.length < 32) {
        return false;
    }
    const expected = Buffer.from(token);
    const actual = Buffer.from(candidate);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** Recreate the tenant backend's HOME links (agent sign-in state on the mounted tenant storage). */
function linkHome(): void {
    const home = process.env.HOME;
    if (!home) {
        return;
    }
    try {
        fs.mkdirSync(home, { recursive: true });
        const links = JSON.parse(homeLinks) as Array<{ name?: unknown; target?: unknown }>;
        for (const link of Array.isArray(links) ? links : []) {
            if (typeof link.name !== 'string' || typeof link.target !== 'string'
                || !/^\.[A-Za-z0-9._-]+$/.test(link.name) || !path.isAbsolute(link.target)) {
                continue;
            }
            const target = path.join(home, link.name);
            fs.rmSync(target, { recursive: true, force: true });
            fs.symlinkSync(link.target, target);
        }
    } catch (error) {
        process.stderr.write(`[qaap-sandbox-exec] home links: ${(error as Error).message}\n`);
    }
}

function children(pid: number): number[] {
    const result: number[] = [];
    for (const entry of safeReaddir('/proc')) {
        if (!/^\d+$/.test(entry)) {
            continue;
        }
        try {
            const stat = fs.readFileSync(`/proc/${entry}/stat`, 'utf8');
            const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
            if (ppid === pid) {
                result.push(Number(entry));
            }
        } catch {
            // the process exited while we looked
        }
    }
    return result;
}

function descendants(pid: number): number[] {
    const all: number[] = [];
    const queue = [pid];
    while (queue.length && all.length < 4096) {
        for (const child of children(queue.shift()!)) {
            all.push(child);
            queue.push(child);
        }
    }
    return all;
}

function safeReaddir(dir: string): string[] {
    try {
        return fs.readdirSync(dir);
    } catch {
        return [];
    }
}

/** Signal the process group of `pid` and every descendant (a tty exec runs in script's own session). */
function signalTree(pid: number, signal: NodeJS.Signals): void {
    const targets = [pid, ...descendants(pid)];
    try {
        process.kill(-pid, signal);
    } catch {
        // not a group leader any more
    }
    for (const target of targets) {
        try {
            process.kill(target, signal);
        } catch {
            // already gone
        }
    }
}

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, '\'\\\'\'')}'`;
}

let scriptPath: string | undefined | null = null;
function findScript(): string | undefined {
    if (scriptPath === null) {
        scriptPath = ['/usr/bin/script', '/bin/script'].find(candidate => fs.existsSync(candidate));
    }
    return scriptPath;
}

interface ExecHeader {
    file?: unknown;
    args?: unknown;
    cwd?: unknown;
    env?: unknown;
    tty?: unknown;
    cols?: unknown;
    rows?: unknown;
}

function handleExec(socket: net.Socket, header: ExecHeader, rest: Buffer): void {
    const file = typeof header.file === 'string' ? header.file : '';
    const args = Array.isArray(header.args) ? header.args.filter((arg): arg is string => typeof arg === 'string') : [];
    const cwd = typeof header.cwd === 'string' && fs.existsSync(header.cwd) ? header.cwd : (process.env.HOME ?? '/');
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (header.env && typeof header.env === 'object') {
        for (const [key, value] of Object.entries(header.env as Record<string, unknown>)) {
            if (typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
                env[key] = value;
            }
        }
    }
    if (!file) {
        socket.end(frame(FRAME_ERROR, JSON.stringify({ message: 'missing file' })));
        return;
    }
    const tty = header.tty === true && !!findScript();
    let launchFile = file;
    let launchArgs = args;
    if (tty) {
        const cols = Number(header.cols) > 0 ? Math.floor(Number(header.cols)) : 80;
        const rows = Number(header.rows) > 0 ? Math.floor(Number(header.rows)) : 24;
        const inner = ['/bin/sh', '-c', `stty cols ${cols} rows ${rows} 2>/dev/null; exec "$@"`, 'qaap-tty', file, ...args]
            .map(shellQuote).join(' ');
        launchFile = findScript()!;
        launchArgs = ['-q', '-f', '-e', '-c', inner, '/dev/null'];
        env.SHELL = '/bin/sh';
    }
    let child: childProcess.ChildProcess;
    try {
        child = childProcess.spawn(launchFile, launchArgs, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
        socket.end(frame(FRAME_ERROR, JSON.stringify({ message: (error as Error).message })));
        return;
    }
    let exited = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const pid = child.pid;
    const terminate = (): void => {
        if (exited || pid === undefined || killTimer) {
            return;
        }
        signalTree(pid, 'SIGTERM');
        killTimer = setTimeout(() => signalTree(pid, 'SIGKILL'), KILL_GRACE_MS);
        killTimer.unref();
    };
    child.on('error', error => {
        exited = true;
        if (!socket.destroyed) {
            socket.end(frame(FRAME_ERROR, JSON.stringify({ message: error.message })));
        }
    });
    child.stdout!.on('data', (chunk: Buffer) => socket.write(frame(FRAME_STDOUT, chunk)));
    child.stderr!.on('data', (chunk: Buffer) => socket.write(frame(FRAME_STDERR, chunk)));
    child.stdin!.on('error', () => undefined);
    child.on('close', (code, signal) => {
        exited = true;
        if (killTimer) {
            clearTimeout(killTimer);
        }
        if (!socket.destroyed) {
            socket.end(frame(FRAME_EXIT, JSON.stringify({ code, signal })));
        }
    });
    let buffer = rest;
    const onFrames = (): void => {
        while (buffer.length >= 5) {
            const length = buffer.readUInt32BE(1);
            if (buffer.length < 5 + length) {
                return;
            }
            const type = buffer.readUInt8(0);
            const payload = buffer.subarray(5, 5 + length);
            buffer = buffer.subarray(5 + length);
            if (type === FRAME_STDIN) {
                child.stdin!.write(payload);
            } else if (type === FRAME_STDIN_END) {
                child.stdin!.end();
            } else if (type === FRAME_SIGNAL && pid !== undefined) {
                const signal = String((JSON.parse(payload.toString('utf8')) as { signal?: unknown }).signal ?? '');
                if (SIGNALS.has(signal)) {
                    if (signal === 'SIGTERM' || signal === 'SIGKILL') {
                        terminate();
                        if (signal === 'SIGKILL') {
                            signalTree(pid, 'SIGKILL');
                        }
                    } else {
                        signalTree(pid, signal as NodeJS.Signals);
                    }
                }
            } else if (type === FRAME_RESIZE && tty && pid !== undefined) {
                const size = JSON.parse(payload.toString('utf8')) as { cols?: unknown; rows?: unknown };
                const cols = Math.floor(Number(size.cols));
                const rows = Math.floor(Number(size.rows));
                const shell = children(pid)[0];
                if (shell && cols > 0 && rows > 0) {
                    // stty on the inner pty sets its window size, which delivers SIGWINCH to its foreground group.
                    childProcess.spawn('stty', ['-F', `/proc/${shell}/fd/0`, 'cols', String(cols), 'rows', String(rows)], { stdio: 'ignore' })
                        .on('error', () => undefined);
                }
            }
        }
    };
    socket.on('data', (chunk: Buffer) => {
        buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
        try {
            onFrames();
        } catch {
            socket.destroy();
        }
    });
    // The client died (task cancelled, dev server restart, backend crash): take the tree down.
    socket.on('close', terminate);
    socket.on('error', terminate);
    onFrames();
}

function handleConnect(socket: net.Socket, port: number, rest: Buffer): void {
    if (!Number.isInteger(port) || port <= 0 || port > 65535 || port === listenPort) {
        socket.end('{"ok":false}\n');
        return;
    }
    const attempt = (hosts: string[]): void => {
        const upstream = net.connect(port, hosts[0]);
        let connected = false;
        upstream.on('connect', () => {
            connected = true;
            socket.write('{"ok":true}\n');
            if (rest.length) {
                upstream.write(rest);
            }
            socket.pipe(upstream);
            upstream.pipe(socket);
        });
        upstream.on('error', () => {
            if (!connected && hosts.length > 1) {
                attempt(hosts.slice(1));
            } else if (!connected) {
                socket.end('{"ok":false}\n');
            } else {
                socket.destroy();
            }
        });
        upstream.on('close', () => socket.destroy());
        socket.on('error', () => upstream.destroy());
        socket.on('close', () => upstream.destroy());
    };
    // Stay paused until the upstream is connected: pipe() resumes, so no early bytes are lost.
    socket.pause();
    attempt(['127.0.0.1', '::1']);
}

function listeningPorts(): number[] {
    const ports = new Set<number>();
    for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
        let text = '';
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        for (const line of text.split('\n')) {
            const fields = line.trim().split(/\s+/);
            // 127.0.0.11 is Docker's embedded DNS resolver, not an app.
            if (fields.length < 4 || fields[3] !== '0A' || fields[1].startsWith('0B00007F:')) {
                continue;
            }
            const port = Number.parseInt(fields[1].split(':').pop() ?? '', 16);
            if (Number.isInteger(port) && port > 0 && port !== listenPort) {
                ports.add(port);
            }
        }
    }
    return [...ports].sort((left, right) => left - right);
}

const server = net.createServer(socket => {
    socket.setNoDelay(true);
    let header = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
        header = Buffer.concat([header, chunk]);
        const newline = header.indexOf(10);
        if (newline < 0) {
            if (header.length > MAX_HEADER_BYTES) {
                socket.destroy();
            }
            return;
        }
        socket.off('data', onData);
        const rest = header.subarray(newline + 1);
        let request: { token?: unknown; op?: unknown; port?: unknown } & ExecHeader;
        try {
            request = JSON.parse(header.subarray(0, newline).toString('utf8'));
        } catch {
            socket.destroy();
            return;
        }
        if (!tokenMatches(request.token)) {
            socket.end('{"ok":false,"error":"unauthorized"}\n');
            return;
        }
        if (request.op === 'exec') {
            handleExec(socket, request, rest);
        } else if (request.op === 'connect') {
            handleConnect(socket, Number(request.port), rest);
        } else if (request.op === 'ports') {
            socket.end(`${JSON.stringify({ ok: true, ports: listeningPorts() })}\n`);
        } else if (request.op === 'ping') {
            socket.end('{"ok":true}\n');
        } else {
            socket.destroy();
        }
    };
    socket.on('data', onData);
    socket.on('error', () => undefined);
});

/** Read the token line from stdin, then close stdin for good. */
function readToken(timeoutMs: number): Promise<string> {
    return new Promise(resolve => {
        let text = '';
        const done = (): void => {
            clearTimeout(timer);
            process.stdin.removeAllListeners('data');
            process.stdin.destroy();
            // The token is base64url, so the trailing run of those characters on the first line. Anything
            // before it is the attach request's JSON body: docker-modem POSTs the attach options and,
            // under load, the daemon hands those bytes to the hijacked stdin ahead of the token.
            resolve(/[A-Za-z0-9_-]*$/.exec(text.split('\n')[0].trim())![0]);
        };
        const timer = setTimeout(done, timeoutMs);
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk: string) => {
            text += chunk;
            if (text.includes('\n') || text.length > 4096) {
                done();
            }
        });
        process.stdin.on('end', done);
        process.stdin.on('error', done);
    });
}

readToken(30_000).then(received => {
    token = received;
    if (token.length < 32) {
        process.stderr.write('[qaap-sandbox-exec] refusing to start without a token on stdin\n');
        process.exit(2);
    }
    linkHome();
    listen();
});

function listen(): void {
    server.listen(listenPort, '0.0.0.0', () => {
        try {
            fs.mkdirSync('/tmp/.qaap-exec', { recursive: true });
            fs.writeFileSync('/tmp/.qaap-exec/ready', `${process.pid}\n`);
        } catch {
            // readiness is also announced on stdout
        }
        process.stdout.write('QAAP_SANDBOX_EXEC_READY\n');
    });
}
const stop = (): void => {
    server.close();
    process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
