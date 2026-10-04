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
            cliBinDirectory: aliceBin,
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
                agentConnectionProbes: new Map(),
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

describe('QaapAgentTaskRunner connection probes', () => {
    type ConnectionState = 'connected' | 'disconnected' | 'unknown' | undefined;

    function createRunner(probe: (agentId: string) => Promise<ConnectionState>): { runner: QaapAgentTaskRunner; probes: string[] } {
        const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
        const probes: string[] = [];
        Object.assign(runner, {
            detectedAgents: new Map<string, AgentCandidate>([
                ['codex', { id: 'codex', label: 'Codex', bin: 'codex', template: 'codex {prompt}' }],
                ['claude', { id: 'claude', label: 'Claude Code', bin: 'claude', template: 'claude {prompt}' }],
            ]),
            agentConnectionStates: new Map(),
            agentConnectionProbes: new Map(),
            isAgentEnabled: () => true,
            preferenceReaderForOwner: () => () => undefined,
            billingStore: undefined,
            detectAgents: () => undefined,
            probeAgentConnectionState: (agentId: string) => {
                probes.push(agentId);
                return probe(agentId);
            },
        });
        return { runner, probes };
    }

    it('answers listAgents without waiting for CLI auth probes', () => {
        const { runner, probes } = createRunner(() => new Promise<ConnectionState>(() => undefined));
        const agents = runner.listAgents('alice');
        expect(agents.filter(agent => agent.id !== 'shell').map(agent => `${agent.id}:${agent.connectionState}`).sort()).to.deep.equal(['claude:unknown', 'codex:unknown']);
        expect(probes.sort()).to.deep.equal(['claude', 'codex']);
        // A second request joins the in-flight probes instead of spawning again.
        runner.listAgents('alice');
        expect(probes).to.have.length(2);
    });

    it('listAgentsFresh returns settled probe results and stops waiting at the budget', async () => {
        const { runner } = createRunner(agentId => agentId === 'codex'
            ? Promise.resolve('disconnected')
            : new Promise<ConnectionState>(() => undefined));
        const startedAt = Date.now();
        const agents = await runner.listAgentsFresh('alice', 50);
        expect(Date.now() - startedAt).to.be.lessThan(1000);
        const codex = agents.find(agent => agent.id === 'codex');
        expect(codex?.connectionState).to.equal('disconnected');
        expect(codex?.available).to.equal(false);
        expect(agents.find(agent => agent.id === 'claude')?.connectionState).to.equal('unknown');
    });

    it('keeps serving the last known state while a stale entry is re-probed', async () => {
        let next: ConnectionState = 'connected';
        const { runner, probes } = createRunner(async () => next);
        expect(await runner.isAgentConnectedFresh('codex', 'alice')).to.equal(true);
        const states = (runner as unknown as { agentConnectionStates: Map<string, { state: ConnectionState; at: number }> }).agentConnectionStates;
        states.set('codex:alice', { state: 'connected', at: 0 });
        next = 'disconnected';
        expect(runner.isAgentConnected('codex', 'alice')).to.equal(true);
        expect(await runner.isAgentConnectedFresh('codex', 'alice')).to.equal(false);
        expect(probes.filter(id => id === 'codex')).to.have.length(2);
    });

    it('drops a probe answer that a catalog refresh superseded', async () => {
        let resolveFirst: (state: ConnectionState) => void = () => undefined;
        const answers: Array<Promise<ConnectionState>> = [
            new Promise<ConnectionState>(resolve => { resolveFirst = resolve; }),
            Promise.resolve('connected'),
        ];
        const { runner } = createRunner(agentId => agentId === 'codex'
            ? answers.shift() ?? Promise.resolve('unknown')
            : new Promise<ConnectionState>(() => undefined));
        runner.listAgents('alice');
        runner.refreshAgentCatalog();
        expect(await runner.isAgentConnectedFresh('codex', 'alice')).to.equal(true);
        resolveFirst('disconnected');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(runner.isAgentConnected('codex', 'alice')).to.equal(true);
    });
});
