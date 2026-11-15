// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { ChildProcess, spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { QaapSandboxFrame, QaapSandboxFrameDecoder } from './qaap-task-sandbox-exec-protocol';

/** The compiled exec server is spawned as the sandbox runs it: node, token on stdin, one TCP port. */
const TOKEN = crypto.randomBytes(32).toString('base64url');

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as net.AddressInfo;
            server.close(() => resolve(port));
        });
    });
}

interface ServerFrame {
    readonly type: QaapSandboxFrame;
    readonly payload: Buffer;
}

/** Sends one exec header (the `cwd` key is left out when `header.cwd` is `undefined`) and collects frames until the server closes. */
function exec(port: number, header: Record<string, unknown>): Promise<ServerFrame[]> {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        const decoder = new QaapSandboxFrameDecoder();
        const frames: ServerFrame[] = [];
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error('exec request timed out'));
        }, 15_000);
        socket.on('connect', () => socket.write(`${JSON.stringify({ token: TOKEN, op: 'exec', ...header })}\n`));
        socket.on('data', (chunk: Buffer) => frames.push(...decoder.push(chunk)));
        socket.on('error', error => {
            clearTimeout(timer);
            reject(error);
        });
        socket.on('close', () => {
            clearTimeout(timer);
            resolve(frames);
        });
    });
}

function stdoutOf(frames: ServerFrame[]): string {
    return frames.filter(frame => frame.type === QaapSandboxFrame.Stdout).map(frame => frame.payload.toString('utf8')).join('');
}

function errorMessageOf(frames: ServerFrame[]): string | undefined {
    const error = frames.find(frame => frame.type === QaapSandboxFrame.Error);
    return error ? (JSON.parse(error.payload.toString('utf8')) as { message: string }).message : undefined;
}

(process.platform === 'win32' ? describe.skip : describe)('qaap-task-sandbox-exec-server working directory', () => {

    let server: ChildProcess;
    let port: number;
    let home: string;
    let work: string;

    before(async () => {
        port = await freePort();
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-exec-cwd-home-'));
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-exec-cwd-work-'));
        server = spawn(process.execPath, [path.join(__dirname, 'qaap-task-sandbox-exec-server.js')], {
            env: { PATH: process.env.PATH, HOME: home, QAAP_SANDBOX_EXEC_PORT: String(port), QAAP_SANDBOX_HOME_LINKS: '[]' },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        server.stdin!.end(`${TOKEN}\n`);
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('exec server did not become ready')), 10_000);
            server.stdout!.on('data', (chunk: Buffer) => {
                if (chunk.toString('utf8').includes('QAAP_SANDBOX_EXEC_READY')) {
                    clearTimeout(timer);
                    resolve();
                }
            });
        });
    });

    after(() => {
        server?.kill('SIGTERM');
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(work, { recursive: true, force: true });
    });

    it('answers a cwd that does not exist with a named error instead of an EACCES spawn failure', async () => {
        const missing = path.join(work, 'missing');
        const frames = await exec(port, { file: '/bin/sh', args: ['-c', 'exit 0'], cwd: missing });
        expect(frames.map(frame => frame.type)).to.deep.equal([QaapSandboxFrame.Error]);
        expect(errorMessageOf(frames)).to.equal(`Task sandbox working directory ${missing} does not exist`);
    });

    it('rejects a cwd that is a file rather than a directory', async () => {
        const file = path.join(work, 'plain-file');
        fs.writeFileSync(file, 'x');
        const frames = await exec(port, { file: '/bin/sh', args: ['-c', 'exit 0'], cwd: file });
        expect(errorMessageOf(frames)).to.equal(`Task sandbox working directory ${file} is not a directory`);
    });

    it('names the uid and the errno when the cwd cannot be entered, and does not spawn', async function (): Promise<void> {
        // root passes every access check, so the refusal cannot be provoked there.
        if (process.getuid?.() === 0) {
            this.skip();
        }
        const locked = path.join(work, 'locked');
        fs.mkdirSync(locked);
        fs.chmodSync(locked, 0o600);
        try {
            const frames = await exec(port, { file: '/bin/sh', args: ['-c', 'exit 0'], cwd: locked });
            expect(frames.map(frame => frame.type)).to.deep.equal([QaapSandboxFrame.Error]);
            expect(errorMessageOf(frames)).to.equal(`Task sandbox cannot enter the working directory ${locked} as uid ${process.getuid?.()}: EACCES`);
        } finally {
            fs.chmodSync(locked, 0o700);
        }
    });

    it('runs the command in the requested cwd when it is enterable', async () => {
        const frames = await exec(port, { file: '/bin/sh', args: ['-c', 'pwd -P'], cwd: work });
        expect(errorMessageOf(frames)).to.equal(undefined);
        expect(stdoutOf(frames)).to.equal(`${fs.realpathSync(work)}\n`);
        const exit = frames.find(frame => frame.type === QaapSandboxFrame.Exit);
        expect(JSON.parse(exit!.payload.toString('utf8')).code).to.equal(0);
    });

    it('falls back to HOME only when the request carries no cwd', async () => {
        const frames = await exec(port, { file: '/bin/sh', args: ['-c', 'pwd -P'] });
        expect(errorMessageOf(frames)).to.equal(undefined);
        expect(stdoutOf(frames)).to.equal(`${fs.realpathSync(home)}\n`);
    });
});
