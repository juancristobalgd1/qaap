// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { formatQaapBootstrapChipLabel, formatQaapBootstrapDiagnostic } from './qaap-bootstrap-display';
import type { QaapBootstrapStateChange } from './qaap-project-bootstrap-service';

describe('formatQaapBootstrapChipLabel', () => {

    it('formats Vite · :5173 · Running', () => {
        const state: QaapBootstrapStateChange = {
            phase: 'running',
            descriptor: {
                rootUri: URI.fromFilePath('/tmp/demo'),
                name: 'demo',
                kind: 'node-vite',
                packageManager: 'npm',
                installCommand: 'npm install',
                nodeModulesPresent: true,
                apps: [],
            },
            previewUrl: 'http://localhost:5173/',
            lastPort: 5173,
        };
        expect(formatQaapBootstrapChipLabel(state)).to.equal('Vite · :5173 · Running');
    });
});

describe('formatQaapBootstrapDiagnostic', () => {

    it('includes actionable Preview state, ports, failure, and bounded output', () => {
        const state: QaapBootstrapStateChange = {
            phase: 'run-failed',
            previewReadiness: 'failed',
            previewWaitTimedOut: true,
            descriptor: {
                rootUri: URI.fromFilePath('/tmp/demo'),
                name: 'demo',
                kind: 'node-vite',
                packageManager: 'npm',
                installCommand: 'npm install',
                nodeModulesPresent: true,
                devCommand: 'npm run dev',
                apps: [],
            },
            error: 'Port is already in use',
            failureKind: 'port-conflict',
            portInUse: true,
            existingServerPort: 5173,
            activePort: 5174,
            portRecoveryFrom: 5173,
            previewLogTail: 'EADDRINUSE: address already in use',
        };
        const diagnostic = formatQaapBootstrapDiagnostic(state, {
            terminalFailure: 'EADDRINUSE',
        });
        expect(diagnostic).to.contain('phase: run-failed');
        expect(diagnostic).to.contain('portRecovery: :5173 -> :5174');
        expect(diagnostic).to.contain('failureKind: port-conflict');
        expect(diagnostic).to.contain('terminalFailure: EADDRINUSE');
        expect(diagnostic).to.contain('serverOutput:');
        expect(diagnostic).to.contain('Open the existing Preview');
    });
});
