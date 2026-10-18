// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as net from 'net';
import {
    extractListeningInodesForPort,
    findListeningPidsOnPort,
    findListeningProcessCwdsOnPort,
    findPidsForSocketInodes,
    parseProcNetTcpLocalPort,
    terminateListenersOnPort,
} from './qaap-dev-preview-port-listener';

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

    it('reports the working directory of the process listening on a port', async function (): Promise<void> {
        if (process.platform === 'win32') {
            this.skip();
        }
        const server = net.createServer();
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const port = (server.address() as net.AddressInfo).port;
            const cwds = findListeningProcessCwdsOnPort(port).map(cwd => fs.realpathSync(cwd));
            expect(cwds).to.deep.equal([fs.realpathSync(process.cwd())]);
        } finally {
            await new Promise<void>(resolve => server.close(() => resolve()));
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
