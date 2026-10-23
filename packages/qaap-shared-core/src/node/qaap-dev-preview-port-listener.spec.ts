// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import {
    extractListeningInodesForPort,
    findListeningPidsOnPort,
    findListeningProcessCwdsOnPort,
    findPidsForSocketInodes,
    isSelfOrUnsafeSignalTarget,
    parseProcNetTcpLocalPort,
    terminateListenersOnPort,
} from './qaap-dev-preview-port-listener';

/** Starts a detached node process listening on a random port inside `cwd`; resolves with its port. */
function spawnListeningChild(cwd: string): Promise<{ child: ChildProcess, port: number }> {
    const script = "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));setInterval(()=>{},1000);";
    const child = spawn(process.execPath, ['-e', script], { cwd, detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return new Promise((resolve, reject) => {
        child.once('error', reject);
        child.stdout!.once('data', (data: Buffer) => resolve({ child, port: Number(data.toString().trim()) }));
    });
}

describe('qaap-dev-preview-port-listener', () => {

    it('parses hex local_address ports from /proc/net/tcp', () => {
        expect(parseProcNetTcpLocalPort('0100007F:1428')).to.equal(5160);
        expect(parseProcNetTcpLocalPort('00000000000000000000000000000000:1F90')).to.equal(8080);
        expect(parseProcNetTcpLocalPort('invalid')).to.equal(undefined);
    });

    it('extracts LISTEN inodes for a target port', () => {
        const table = [
            '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
            '   0: 0100007F:1428 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 12345',
            '   1: 0100007F:1429 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 67890',
            '   2: 0100007F:1428 0100007F:8BFE 01 00000000:00000000 00:00000000 00000000  1000        0 11111',
        ].join('\n');
        expect([...extractListeningInodesForPort(table, 5160)]).to.deep.equal(['12345']);
    });

    it('findPidsForSocketInodes returns empty for an empty inode set', () => {
        expect(findPidsForSocketInodes(new Set())).to.deep.equal([]);
    });

    it('findListeningPidsOnPort returns empty on win32 or invalid ports', () => {
        if (process.platform === 'win32') {
            expect(findListeningPidsOnPort(5173)).to.deep.equal([]);
        }
        expect(findListeningPidsOnPort(-1)).to.deep.equal([]);
        expect(findListeningPidsOnPort(999999)).to.deep.equal([]);
    });

    it('terminateListenersOnPort never throws for invalid ports', () => {
        expect(() => terminateListenersOnPort(-1)).not.to.throw();
        expect(() => terminateListenersOnPort(0)).not.to.throw();
        expect(() => terminateListenersOnPort(65536)).not.to.throw();
    });

    it('reports the working directory of a child process listening on a port', async function (): Promise<void> {
        if (process.platform === 'win32') {
            this.skip();
        }
        const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-port-cwd-')));
        const { child, port } = await spawnListeningChild(cwd);
        try {
            if (!findListeningPidsOnPort(port).includes(child.pid!)) {
                // Hosts that restrict reading other processes' /proc entries (e.g. Yama ptrace_scope on
                // CI runners) cannot attribute the socket to the child; nothing to assert there.
                this.skip();
            }
            const cwds = findListeningProcessCwdsOnPort(port).map(entry => fs.realpathSync(entry));
            expect(cwds).to.deep.equal([cwd]);
        } finally {
            child.kill('SIGKILL');
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it('does not report the working directory of this process when it is the only listener', async function (): Promise<void> {
        if (process.platform === 'win32') {
            this.skip();
        }
        const server = net.createServer();
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const port = (server.address() as net.AddressInfo).port;
            expect(findListeningProcessCwdsOnPort(port)).to.deep.equal([]);
        } finally {
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });

    it('terminateListenersOnPort does not signal this process when it is the listener', async function (): Promise<void> {
        if (process.platform === 'win32') {
            this.skip();
        }
        let sigtermReceived = false;
        const onSigterm = (): void => { sigtermReceived = true; };
        const server = net.createServer();
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        process.on('SIGTERM', onSigterm);
        try {
            const port = (server.address() as net.AddressInfo).port;
            terminateListenersOnPort(port);
            await new Promise(resolve => setTimeout(resolve, 200));
            expect(sigtermReceived).to.equal(false);
            expect(server.listening).to.equal(true);
        } finally {
            process.removeListener('SIGTERM', onSigterm);
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });

    it('isSelfOrUnsafeSignalTarget refuses group/invalid pids and this process', () => {
        for (const pid of [0, 1, -5, NaN, 1.5, process.pid]) {
            expect(isSelfOrUnsafeSignalTarget(pid), String(pid)).to.equal(true);
        }
    });

    it('isSelfOrUnsafeSignalTarget accepts a real child process', async function (): Promise<void> {
        if (process.platform === 'win32') {
            this.skip();
        }
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-port-guard-'));
        const { child } = await spawnListeningChild(cwd);
        try {
            expect(isSelfOrUnsafeSignalTarget(child.pid!)).to.equal(false);
        } finally {
            child.kill('SIGKILL');
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it('reports no working directory for a port nobody listens on', async () => {
        const server = net.createServer();
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = (server.address() as net.AddressInfo).port;
        await new Promise<void>(resolve => server.close(() => resolve()));
        expect(findListeningProcessCwdsOnPort(port)).to.deep.equal([]);
    });
});
