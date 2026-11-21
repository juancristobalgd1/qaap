// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QAAP_HARNESS_DEFINITIONS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import {
    QAAP_HARNESS_INSTANCES_PREF,
    QAAP_HARNESS_SETTINGS_PREF,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-launch-settings';
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
        expect(statuses.find(status => status.id === 'qaiq')).to.equal(undefined);
    });

    it("reports the owner's last turn per harness, and nothing for harnesses never used", () => {
        const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
        const lookups: Array<[string | undefined, string]> = [];
        Object.assign(runner, {
            detectedAgents: new Map<string, AgentCandidate>(),
            resolveAgentCliPrefix: () => '/home/alice/.qaap/cli',
            isOnPath: () => true,
            isAgentEnabled: () => true,
            agentConnectionState: () => 'connected',
            lastTurns: {
                get: (login: string | undefined, agentId: string) => {
                    lookups.push([login, agentId]);
                    return agentId === 'pi' ? { outcome: 'failed', kind: 'auth', at: 5, taskId: 't9' } : undefined;
                },
            },
        });

        const statuses = runner.listHarnessStatuses('alice', () => true);

        expect(statuses.find(status => status.id === 'pi')?.lastTurn).to.deep.equal({ outcome: 'failed', kind: 'auth', at: 5, taskId: 't9' });
        expect(statuses.find(status => status.id === 'codex')).to.not.have.property('lastTurn');
        expect(lookups.every(([login]) => login === 'alice')).to.equal(true);
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
                rejectedAgentSessions: new Set(),
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

    function createRunner(
        probe: (agentId: string) => Promise<ConnectionState>,
        candidates: AgentCandidate[] = [
            { id: 'codex', label: 'Codex', bin: 'codex', template: 'codex {prompt}' },
            { id: 'claude', label: 'Claude Code', bin: 'claude', template: 'claude {prompt}' },
        ],
    ): { runner: QaapAgentTaskRunner; probes: string[] } {
        const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
        const probes: string[] = [];
        Object.assign(runner, {
            detectedAgents: new Map<string, AgentCandidate>(candidates.map(candidate => [candidate.id, candidate])),
            agentConnectionStates: new Map(),
            rejectedAgentSessions: new Set(),
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

    it('serves a remembered snapshot without waiting for its stale re-probe', async () => {
        let resolveProbe: (state: ConnectionState) => void = () => undefined;
        const { runner, probes } = createRunner(agentId => agentId === 'codex'
            ? new Promise<ConnectionState>(resolve => { resolveProbe = resolve; })
            : Promise.resolve('connected'));
        const states = (runner as unknown as { agentConnectionStates: Map<string, { state: ConnectionState; at: number }> }).agentConnectionStates;
        // Both harnesses were answered long ago: the snapshot must be served, not held for the budget.
        states.set('codex:alice', { state: 'connected', at: 0 });
        states.set('claude:alice', { state: 'connected', at: 0 });
        const startedAt = Date.now();
        const agents = await runner.listAgentsFresh('alice', 5000);
        expect(Date.now() - startedAt).to.be.lessThan(1000);
        expect(agents.find(agent => agent.id === 'codex')?.connectionState).to.equal('connected');
        // The re-probe still runs in the background and lands in the cache for the next request.
        expect(probes).to.include('codex');
        resolveProbe('disconnected');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(runner.listAgents('alice').find(agent => agent.id === 'codex')?.connectionState).to.equal('disconnected');
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

    it("probes a tenant whose repos folder does not exist yet from the backend's cwd instead of failing to spawn", async () => {
        const reposRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-probe-root-'));
        const previousRoot = process.env.QAAP_REPOS_ROOT;
        const previousMode = process.env.QAAP_CLOUD_MODE;
        process.env.QAAP_REPOS_ROOT = reposRoot;
        process.env.QAAP_CLOUD_MODE = 'local';
        try {
            const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
            Object.assign(runner, {
                resolveAgentCliPrefix: () => path.join(reposRoot, 'cli'),
                isTenantPrivilegeDropActive: () => false,
                tenantSpawn: {
                    tenantHomeEnvOverlay: () => ({}),
                    // Stands in for `claude auth status` on every platform.
                    wrapArgvForTenant: () => ({ file: process.execPath, args: ['-e', 'console.log(JSON.stringify({ loggedIn: true }))'] }),
                },
            });
            const probe = (runner as unknown as {
                probeAgentConnectionState(agentId: string, bin: string, ownerLogin?: string): Promise<string>;
            }).probeAgentConnectionState('claude', 'claude', '_dev');

            expect(await probe).to.equal('connected');
        } finally {
            restoreEnv('QAAP_REPOS_ROOT', previousRoot);
            restoreEnv('QAAP_CLOUD_MODE', previousMode);
            fs.rmSync(reposRoot, { recursive: true, force: true });
        }
    });
});

function restoreEnv(key: string, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[key];
    } else {
        process.env[key] = value;
    }
}

describe('QaapAgentTaskRunner listAgents session and availability', () => {
    type ConnectionState = 'connected' | 'disconnected' | 'unknown' | undefined;
    const opencode: AgentCandidate = { id: 'opencode', label: 'OpenCode', bin: 'opencode', template: 'opencode run {prompt}' };
    const codex: AgentCandidate = { id: 'codex', label: 'Codex', bin: 'codex', template: 'codex {prompt}' };

    function settledRunner(state: ConnectionState, candidates: AgentCandidate[] = [codex, opencode]): QaapAgentTaskRunner {
        const { runner } = createRunnerForSession(async () => state, candidates);
        return runner;
    }

    // Local copy of the connection-probe helper: the probe answers at once so the snapshot is settled.
    function createRunnerForSession(probe: (agentId: string) => Promise<ConnectionState>, candidates: AgentCandidate[]): { runner: QaapAgentTaskRunner } {
        const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
        Object.assign(runner, {
            detectedAgents: new Map<string, AgentCandidate>(candidates.map(candidate => [candidate.id, candidate])),
            agentConnectionStates: new Map(),
            rejectedAgentSessions: new Set(),
            agentConnectionProbes: new Map(),
            isAgentEnabled: () => true,
            preferenceReaderForOwner: () => () => undefined,
            billingStore: undefined,
            detectAgents: () => undefined,
            probeAgentConnectionState: probe,
        });
        return { runner };
    }

    it('keeps an enabled but signed-out harness listed, with session signed-out and not runnable', async () => {
        const runner = settledRunner('disconnected', [codex]);
        await runner.listAgentsFresh('alice', 50);
        const agent = runner.listAgents('alice').find(entry => entry.id === 'codex');
        expect(agent).to.not.equal(undefined);
        expect(agent?.session).to.equal('signed-out');
        expect(agent?.available).to.equal(false);
    });

    it('keeps OpenCode runnable while signed out, because its Free models need no session', async () => {
        const runner = settledRunner('disconnected', [opencode]);
        await runner.listAgentsFresh('alice', 50);
        const agent = runner.listAgents('alice').find(entry => entry.id === 'opencode');
        expect(agent?.session).to.equal('signed-out');
        expect(agent?.available).to.equal(true);
    });

    it('marks a signed-in harness as signed-in and runnable', async () => {
        const runner = settledRunner('connected', [codex]);
        await runner.listAgentsFresh('alice', 50);
        const agent = runner.listAgents('alice').find(entry => entry.id === 'codex');
        expect(agent?.session).to.equal('signed-in');
        expect(agent?.available).to.equal(true);
    });

    it('reports checking while the probe has not answered, and stays runnable until the sign-in is known', () => {
        const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
        Object.assign(runner, {
            detectedAgents: new Map<string, AgentCandidate>([[codex.id, codex]]),
            agentConnectionStates: new Map(),
            rejectedAgentSessions: new Set(),
            agentConnectionProbes: new Map(),
            isAgentEnabled: () => true,
            preferenceReaderForOwner: () => () => undefined,
            billingStore: undefined,
            detectAgents: () => undefined,
            probeAgentConnectionState: () => new Promise<ConnectionState>(() => undefined),
        });
        const agent = runner.listAgents('alice').find(entry => entry.id === 'codex');
        expect(agent?.session).to.equal('checking');
        // Only a confirmed sign-out makes a harness non-runnable; the pre-spawn guard refreshes a checking one.
        expect(agent?.available).to.equal(true);
    });

    it('does not list a harness the owner turned off, even when it is signed in', async () => {
        const runner = settledRunner('connected', [codex]);
        Object.assign(runner, { isAgentEnabled: () => false });
        await runner.listAgentsFresh('alice', 50);
        expect(runner.listAgents('alice').map(entry => entry.id)).to.not.include('codex');
    });

    it('includes configured harness instances with server-validated Connect overrides and usage home overrides on desktop', () => {
        const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-instance-status-'));
        const originalDesktop = process.env.QAAP_DESKTOP;
        try {
            process.env.QAAP_DESKTOP = '1';
            const customBin = path.join(sandbox, process.platform === 'win32' ? 'codex-work.cmd' : 'codex-work');
            fs.writeFileSync(customBin, process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n', { mode: 0o755 });
            const workHome = path.join(sandbox, 'codex-work-home');
            fs.mkdirSync(workHome, { recursive: true });
            const missingHome = path.join(sandbox, 'missing-home');

            const prefs: Record<string, unknown> = {
                [QAAP_HARNESS_INSTANCES_PREF]: [
                    { id: 'codex#2', baseId: 'codex' },
                    { id: 'codex#3', baseId: 'codex' },
                ],
                [QAAP_HARNESS_SETTINGS_PREF]: {
                    'codex#2': { binaryPath: customBin, homeDir: workHome },
                    'codex#3': { homeDir: missingHome },
                },
            };

            const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
            Object.assign(runner, {
                detectedAgents: new Map<string, AgentCandidate>(),
                resolveAgentCliPrefix: () => path.join(sandbox, '.qaap', 'cli'),
                isOnPath: () => true,
                isAgentEnabled: () => true,
                agentConnectionState: (id: string) => id === 'codex#2' ? 'connected' : 'disconnected',
                preferenceReaderForOwner: () => (key: string) => prefs[key],
            });

            const statuses = runner.listHarnessStatuses('alice', () => true);
            const work = statuses.find(status => status.id === 'codex#2');
            const broken = statuses.find(status => status.id === 'codex#3');
            expect(work?.loginBinaryPath).to.equal(customBin);
            expect(work?.loginEnv).to.deep.equal({ CODEX_HOME: workHome });
            expect(work?.loginOverrideError).to.equal(undefined);
            expect(work?.connectionState).to.equal('connected');
            expect(broken?.loginOverrideError).to.be.a('string').and.not.equal('');
            expect(broken?.connectionState).to.equal('unknown');

            expect(runner.resolveHarnessUsageHomeOverrides('codex#2', 'alice')).to.deep.equal({
                ok: true,
                overrides: { CODEX_HOME: workHome },
            });
            const brokenUsage = runner.resolveHarnessUsageHomeOverrides('codex#3', 'alice');
            expect(brokenUsage.ok).to.equal(false);
        } finally {
            if (originalDesktop === undefined) {
                delete process.env.QAAP_DESKTOP;
            } else {
                process.env.QAAP_DESKTOP = originalDesktop;
            }
            fs.rmSync(sandbox, { recursive: true, force: true });
        }
    });
});
