// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QAAP_HARNESS_DEFINITIONS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import type { AgentCandidate } from './qaap-agent-task-runner-types';
import { resolveAgentCliPrefixBinDirectory } from './qaap-agent-cli-prefix';

describe('QaapAgentTaskRunner harness status catalog', () => {
    it('returns every known harness even when disabled or disconnected', () => {
        const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
        const detectedAgents = new Map<string, AgentCandidate>([
            ['codex', { id: 'codex', label: 'Codex', bin: 'codex', template: 'codex {prompt}' }],
            ['opencode', { id: 'opencode', label: 'OpenCode', bin: 'opencode', template: 'opencode {prompt}' }],
        ]);
        const probedPaths: string[] = [];
        Object.assign(runner, {
            detectedAgents,
            resolveAgentCliPrefix: () => '/home/alice/.qaap/cli',
            isOnPath: (bin: string, env: NodeJS.ProcessEnv) => {
                probedPaths.push(env.PATH ?? '');
                return ['codex', 'opencode', 'qaiq'].includes(bin);
            },
            isAgentEnabled: (id: string) => id !== 'codex',
            agentConnectionState: (id: string) => id === 'codex' ? 'disconnected' : 'connected',
        });

        const statuses = runner.listHarnessStatuses('alice', id => id === 'codex');
        const codex = statuses.find(status => status.id === 'codex');

        expect(statuses.map(status => status.id)).to.deep.equal(QAAP_HARNESS_DEFINITIONS.map(harness => harness.id));
        const aliceBin = resolveAgentCliPrefixBinDirectory('/home/alice/.qaap/cli');
        expect(probedPaths.every(value => value.split(path.delimiter)[0] === aliceBin)).to.equal(true);
        expect(codex).to.deep.equal({
            id: 'codex',
            installed: true,
            enabled: false,
            connectionState: 'disconnected',
            installSupported: true,
        });
        expect(statuses.find(status => status.id === 'qaiq')?.installed).to.equal(true);
    });

    it('detects CLIs installed in the default prefix without ever adding it to the backend PATH', () => {
        const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-harness-path-'));
        const originalPath = process.env.PATH;
        try {
            const prefix = path.join(sandbox, '.qaap', 'cli');
            const bin = resolveAgentCliPrefixBinDirectory(prefix);
            fs.mkdirSync(bin, { recursive: true });
            const executable = path.join(bin, process.platform === 'win32' ? 'qaap-fake-harness.cmd' : 'qaap-fake-harness');
            fs.writeFileSync(executable, process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n', { mode: 0o755 });

            const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
            Object.assign(runner, {
                agentConnectionStates: new Map(),
                resolveAgentCliPrefix: () => prefix,
                detectAgents: () => undefined,
            });
            runner.refreshAgentCatalog();

            // Root-owned process PATH is untouched: no tenant-writable directory reaches it.
            expect(process.env.PATH).to.equal(originalPath);
            expect((process.env.PATH ?? '').split(path.delimiter)).not.to.include(bin);
            // Detection still sees the installed CLI through an in-process lookup.
            expect(runner.isOnPath('qaap-fake-harness')).to.equal(true);
            expect(process.env.PATH).to.equal(originalPath);
        } finally {
            process.env.PATH = originalPath;
            fs.rmSync(sandbox, { recursive: true, force: true });
        }
    });
});
