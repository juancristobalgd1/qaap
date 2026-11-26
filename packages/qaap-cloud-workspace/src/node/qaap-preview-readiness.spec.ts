// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { QaapPreviewLogRing, stripQaapAnsi } from '../common/qaap-preview-supervisor-types';
import {
    classifyQaapPreviewHttpStatus,
    extractQaapAnnouncedPorts,
    probeQaapPreviewHttp,
    resolveQaapPreviewPortOwnership,
    waitForQaapPreviewServer,
} from './qaap-preview-readiness';

describe('qaap-preview-readiness', () => {
    describe('probeQaapPreviewHttp', () => {
        let server: http.Server;
        let port: number;

        before(async () => {
            server = http.createServer((req, res) => {
                res.statusCode = req.url === '/broken' ? 500 : req.url === '/moved' ? 302 : 200;
                if (req.url === '/moved') {
                    res.setHeader('location', '/elsewhere');
                }
                res.end(`host=${req.headers.host}`);
            });
            await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
            port = (server.address() as AddressInfo).port;
        });

        after(async () => {
            await new Promise(resolve => server.close(resolve));
        });

        it('reports the status code of a GET without following redirects', async () => {
            expect(await probeQaapPreviewHttp({ host: '127.0.0.1', port })).to.deep.equal({ kind: 'answered', status: 200 });
            expect(await probeQaapPreviewHttp({ host: '127.0.0.1', port, path: '/broken' })).to.deep.equal({ kind: 'answered', status: 500 });
            expect(await probeQaapPreviewHttp({ host: '127.0.0.1', port, path: '/moved' })).to.deep.equal({ kind: 'answered', status: 302 });
        });

        it('reports a refused connection', async () => {
            const closed = http.createServer();
            await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
            const freePort = (closed.address() as AddressInfo).port;
            await new Promise(resolve => closed.close(resolve));
            expect((await probeQaapPreviewHttp({ host: '127.0.0.1', port: freePort })).kind).to.equal('refused');
        });
    });

    it('classifies statuses for the agent verdict', () => {
        expect(classifyQaapPreviewHttpStatus(200)).to.equal('ready');
        expect(classifyQaapPreviewHttpStatus(304)).to.equal('ready');
        expect(classifyQaapPreviewHttpStatus(404)).to.equal('ready-4xx');
        expect(classifyQaapPreviewHttpStatus(503)).to.equal('server-error');
    });

    describe('resolveQaapPreviewPortOwnership', () => {
        it('owns a listener that is the child or in the child\'s process group', () => {
            expect(resolveQaapPreviewPortOwnership(3000, 100, { listeningPids: () => [100], processGroupOf: () => 1 })).to.equal('owned');
            expect(resolveQaapPreviewPortOwnership(3000, 100, { listeningPids: () => [105], processGroupOf: () => 100 })).to.equal('owned');
        });

        it('is foreign only on positive evidence, unknown otherwise', () => {
            expect(resolveQaapPreviewPortOwnership(3000, 100, { listeningPids: () => [7], processGroupOf: () => 7 })).to.equal('foreign');
            expect(resolveQaapPreviewPortOwnership(3000, 100, { listeningPids: () => [], processGroupOf: () => undefined })).to.equal('unknown');
            expect(resolveQaapPreviewPortOwnership(3000, undefined, { listeningPids: () => [7], processGroupOf: () => 7 })).to.equal('unknown');
            expect(resolveQaapPreviewPortOwnership(3000, 100, { listeningPids: () => { throw new Error('no lsof'); }, processGroupOf: () => undefined })).to.equal('unknown');
        });
    });

    describe('waitForQaapPreviewServer', () => {
        it('returns ready, exited or timeout', async () => {
            let clock = 0;
            const base = { timeoutMs: 1000, intervalMs: 100, now: () => clock, sleep: async (ms: number) => { clock += ms; } };
            let calls = 0;
            expect(await waitForQaapPreviewServer({ ...base, answers: async () => ++calls > 3, exited: () => false })).to.deep.equal({ ok: true });
            clock = 0;
            expect(await waitForQaapPreviewServer({ ...base, answers: async () => false, exited: () => true })).to.deep.equal({ ok: false, reason: 'exited' });
            clock = 0;
            expect(await waitForQaapPreviewServer({ ...base, answers: async () => false, exited: () => false })).to.deep.equal({ ok: false, reason: 'timeout' });
        });
    });

    it('extracts ports a dev server announced, newest first', () => {
        expect(extractQaapAnnouncedPorts([
            'Server running at http://localhost:3000',
            '  ➜  Local:   http://127.0.0.1:5173/',
            'listening on 0.0.0.0:8080 and 80',
        ])).to.deep.equal([8080, 5173, 3000]);
    });
});

describe('QaapPreviewLogRing', () => {
    it('keeps stdout and stderr lines with their stream, joining chunks split mid-line', () => {
        const ring = new QaapPreviewLogRing();
        ring.push('stdout', 'hel');
        ring.push('stdout', 'lo\nwor');
        ring.push('stderr', 'boom\n');
        expect(ring.tail(10).map(line => `${line.stream}:${line.text}`)).to.deep.equal(['stdout:hello', 'stderr:boom', 'stdout:wor']);
        ring.flush();
        expect(ring.tail(10, { stream: 'stdout' }).map(line => line.text)).to.deep.equal(['hello', 'wor']);
    });

    it('strips ANSI, keeps the last frame of a progress line and filters case-insensitively', () => {
        const ring = new QaapPreviewLogRing();
        ring.push('stdout', '\u001b[32mVITE\u001b[39m ready\n');
        ring.push('stdout', '10%\r50%\r100%\n');
        expect(ring.tail(10).map(line => line.text)).to.deep.equal(['VITE ready', '100%']);
        expect(ring.tail(10, { grep: 'vite' }).map(line => line.text)).to.deep.equal(['VITE ready']);
        expect(stripQaapAnsi('\u001b[1mbold\u001b[0m')).to.equal('bold');
    });

    it('drops the oldest lines past the line and byte caps and counts them', () => {
        const ring = new QaapPreviewLogRing(3, 1_000_000);
        for (let i = 0; i < 5; i++) {
            ring.push('stdout', `line ${i}\n`);
        }
        expect(ring.tail(10).map(line => line.text)).to.deep.equal(['line 2', 'line 3', 'line 4']);
        expect(ring.droppedLines()).to.equal(2);
        const small = new QaapPreviewLogRing(100, 20);
        small.push('stderr', 'aaaaaaaaaa\nbbbbbbbbbb\ncccccccccc\n');
        expect(small.tail(10).map(line => line.text)).to.deep.equal(['cccccccccc']);
    });
});
