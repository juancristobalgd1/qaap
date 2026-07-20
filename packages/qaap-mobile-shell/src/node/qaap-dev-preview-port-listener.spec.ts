// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    extractListeningInodesForPort,
    findListeningPidsOnPort,
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
});
