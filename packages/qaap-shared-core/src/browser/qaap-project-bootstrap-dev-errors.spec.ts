// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    diagnoseBootstrapFailure,
    extractDevOutputProbePorts,
    extractTerminalFailureLine,
    terminalOutputNeedsInstall,
    terminalOutputNextDevLock,
    terminalOutputPortInUse,
} from './qaap-project-bootstrap-dev-errors';
import type { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { extractPortFromInUseMessage, readTerminalTail } from './qaap-project-bootstrap-helpers';

describe('qaap-project-bootstrap-dev-errors', () => {

    it('terminalOutputNeedsInstall detects missing modules', () => {
        expect(terminalOutputNeedsInstall('Cannot find package \'@foo/bar\'')).to.equal(true);
    });

    it('terminalOutputPortInUse detects EADDRINUSE', () => {
        expect(terminalOutputPortInUse('Error: listen EADDRINUSE: address already in use :::3000')).to.equal(true);
    });

    it('terminalOutputPortInUse detects the Vite strict-port failure', () => {
        const viteTail = '\u001b[31merror when starting dev server:\nError: Port 5173 is already in use\n    at Server.onError (vite/dist/node/chunks/dep.js:25119:18)';
        expect(terminalOutputPortInUse(viteTail)).to.equal(true);
        expect(diagnoseBootstrapFailure(viteTail, 'Dev server exited with code 1.').kind).to.equal('port-conflict');
        expect(extractPortFromInUseMessage(viteTail)).to.equal(5173);
    });

    it('extractPortFromInUseMessage keeps preferring the bound address', () => {
        expect(extractPortFromInUseMessage('Error: listen EADDRINUSE: address already in use 127.0.0.1:3001')).to.equal(3001);
        expect(extractPortFromInUseMessage('Local: http://localhost:5173/')).to.equal(5173);
        expect(terminalOutputPortInUse('Port 5173 is free')).to.equal(false);
    });

    it('extractTerminalFailureLine surfaces generic Error lines', () => {
        const tail = 'some log\nError: listen ECONNREFUSED 127.0.0.1:5432\n';
        expect(extractTerminalFailureLine(tail, 'fallback')).to.match(/ECONNREFUSED/);
    });

    it('terminalOutputNextDevLock detects Next dev lock errors', () => {
        expect(terminalOutputNextDevLock('Unable to acquire lock at .next/dev/lock')).to.equal(true);
    });

    it('extractDevOutputProbePorts reads alternate port and Local URL', () => {
        const tail = 'using available port 3001 instead.\n- Local: http://localhost:3001\n';
        expect(extractDevOutputProbePorts(tail)).to.deep.equal([3001]);
    });

    it('extractDevOutputProbePorts reads host and port when the startup line omits the scheme', () => {
        expect(extractDevOutputProbePorts('Local: localhost:5173')).to.deep.equal([5173]);
    });

    it('extractTerminalFailureLine explains Next lock with preview hint', () => {
        const tail = 'using available port 3001 instead.\nUnable to acquire lock\n';
        expect(extractTerminalFailureLine(tail, 'fallback')).to.contain('Next.js is already running');
        expect(extractTerminalFailureLine(tail, 'fallback')).to.contain('3001');
    });

    it('diagnoses missing environment configuration with an actionable Env hint', () => {
        const diagnosis = diagnoseBootstrapFailure('Error: Environment variable DATABASE_URL is not set', 'fallback');
        expect(diagnosis.kind).to.equal('environment');
        expect(diagnosis.message).to.contain('Env');
    });

    it('diagnoses incompatible Node versions', () => {
        const diagnosis = diagnoseBootstrapFailure('npm error code EBADENGINE\nrequires Node >=20', 'fallback');
        expect(diagnosis.kind).to.equal('runtime-version');
        expect(diagnosis.message).to.contain('Node.js version');
    });

    it('diagnoses workspace permission failures', () => {
        const diagnosis = diagnoseBootstrapFailure('Error: EACCES: permission denied, open .next/cache', 'fallback');
        expect(diagnosis.kind).to.equal('permission');
        expect(diagnosis.message).to.contain('permissions');
    });

    describe('readTerminalTail', () => {
        const terminalWithRows = (rows: string[]): TerminalWidget => ({
            buffer: {
                length: rows.length,
                getLines: (start: number, length: number): string[] => rows.slice(start, start + length),
            },
        } as unknown as TerminalWidget);

        it('skips the blank viewport rows under the last output line', () => {
            const rows = ['$ npm run dev', 'Error: Port 5174 is already in use', ...new Array<string>(40).fill('')];
            expect(readTerminalTail(terminalWithRows(rows))).to.equal('$ npm run dev\nError: Port 5174 is already in use');
        });

        it('returns an empty tail for an all-blank buffer so callers use their fallback', () => {
            expect(readTerminalTail(terminalWithRows(new Array<string>(24).fill('   ')))).to.equal('');
        });

        it('keeps only the last maxLines output lines', () => {
            expect(readTerminalTail(terminalWithRows(['a', 'b', 'c', '', '']), 2)).to.equal('b\nc');
        });
    });
});
