// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { QAAP_AGENT_SESSION_ATTESTATION_TTL_MS, QaapAgentSessionAttestationStore } from './qaap-agent-session-attestation-store';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import type { AgentCandidate } from './qaap-agent-task-runner-types';

class ClockedAttestationStore extends QaapAgentSessionAttestationStore {
    clock = 1_000;
    protected override now(): number {
        return this.clock;
    }
}

class TestableRunner extends QaapAgentTaskRunner {
    recordLastTurnForTest(task: QaapAgentTask): Promise<void> {
        return this.recordLastTurn(task);
    }
}

/** A runner where Copilot is detected without an auth probe, as in production. */
function runnerWith(store: QaapAgentSessionAttestationStore, log = ''): TestableRunner {
    const runner = Object.create(TestableRunner.prototype) as TestableRunner;
    Object.assign(runner, {
        sessionAttestations: store,
        detectedAgents: new Map<string, AgentCandidate>([
            ['copilot', { id: 'copilot', label: 'Copilot', bin: 'copilot', template: 'copilot {prompt}' }],
        ]),
        agentConnectionStates: new Map(),
        rejectedAgentSessions: new Set(),
        agentConnectionProbes: new Map(),
        isAgentEnabled: () => true,
        agentAuthSources: () => ({ settingsConnected: undefined, probeBin: undefined }),
        resolveTaskAgentId: (task: QaapAgentTask) => task.agentId ?? 'copilot',
        readLog: async () => log,
        lastTurns: undefined,
    });
    return runner;
}

function copilotSession(runner: QaapAgentTaskRunner, owner: string): string | undefined {
    return runner.listAgents(owner).find(agent => agent.id === 'copilot')?.session;
}

function finishedTask(state: QaapAgentTask['state'], ownerLogin = 'alice'): QaapAgentTask {
    return { id: 't1', agentId: 'copilot', ownerLogin, state, exitCode: state === 'failed' ? 1 : 0, finishedAt: 2_000 } as unknown as QaapAgentTask;
}

describe('QaapAgentSessionAttestationStore', () => {
    it('accepts only harnesses without an auth probe, and only with an owner', () => {
        const store = new ClockedAttestationStore();
        expect(store.attest('alice', 'copilot')).to.equal(true);
        expect(store.attest('alice', 'Grok')).to.equal(true);
        expect(store.attest('alice', 'codex')).to.equal(false);
        expect(store.attest(undefined, 'copilot')).to.equal(false);
        expect(store.attest('  ', 'copilot')).to.equal(false);
        expect(store.isAttested('alice', 'codex')).to.equal(false);
        expect(store.isAttested('ALICE', 'grok')).to.equal(true);
        expect(store.isAttested('bob', 'copilot')).to.equal(false);
    });

    it('expires after the TTL', () => {
        const store = new ClockedAttestationStore();
        store.attest('alice', 'copilot');
        store.clock += QAAP_AGENT_SESSION_ATTESTATION_TTL_MS - 1;
        expect(store.isAttested('alice', 'copilot')).to.equal(true);
        store.clock += 1;
        expect(store.isAttested('alice', 'copilot')).to.equal(false);
        expect(QAAP_AGENT_SESSION_ATTESTATION_TTL_MS).to.equal(12 * 60 * 60 * 1000);
    });
});

describe('QaapAgentTaskRunner session attestation', () => {
    // Was: unattested read as signed-out (fail-closed). Copilot has no probe, so without an attestation its session
    // cannot be known: it fails open ('unknown', Pro selectable) and a turn that fails auth locks it (see below).
    it('lists an attested Copilot as signed-in for that owner only, and unknown (not locked) once the TTL expires', () => {
        const store = new ClockedAttestationStore();
        const runner = runnerWith(store);
        expect(copilotSession(runner, 'alice')).to.equal('unknown');

        expect(runner.attestAgentSession('copilot', 'alice')).to.equal(true);
        expect(copilotSession(runner, 'alice')).to.equal('signed-in');
        expect(runner.listAgents('alice').find(agent => agent.id === 'copilot')).to.include({ connectionState: 'connected', available: true });
        expect(copilotSession(runner, 'bob')).to.equal('unknown');

        store.clock += QAAP_AGENT_SESSION_ATTESTATION_TTL_MS;
        expect(copilotSession(runner, 'alice')).to.equal('unknown');
        expect(runner.listAgents('alice').find(agent => agent.id === 'copilot')).to.include({ available: true });
    });

    it('never attests a harness that has a real probe', () => {
        const runner = runnerWith(new ClockedAttestationStore());
        expect(runner.attestAgentSession('codex', 'alice')).to.equal(false);
    });

    it('revokes the attestation when a turn of that agent fails with an auth error', async () => {
        const store = new ClockedAttestationStore();
        const runner = runnerWith(store, 'Error: No authentication information found.\nRun /login or `gh auth login`.\n');
        runner.attestAgentSession('copilot', 'alice');

        // Copilot prints its refusal and exits 0: the clean exit is still an auth failure.
        await runner.recordLastTurnForTest(finishedTask('completed'));

        expect(store.isAttested('alice', 'copilot')).to.equal(false);
        expect(copilotSession(runner, 'alice')).to.equal('signed-out');
    });

    it('revokes on a failed exit classified as auth too', async () => {
        const store = new ClockedAttestationStore();
        const runner = runnerWith(store, 'Error: No authentication information found.\n');
        runner.attestAgentSession('copilot', 'alice');

        await runner.recordLastTurnForTest(finishedTask('failed'));

        expect(store.isAttested('alice', 'copilot')).to.equal(false);
    });

    it('keeps the attestation after a successful turn or a non-auth failure, and never touches other owners', async () => {
        const store = new ClockedAttestationStore();
        store.attest('alice', 'copilot');
        store.attest('bob', 'copilot');

        await runnerWith(store, 'Done. Edited 2 files.').recordLastTurnForTest(finishedTask('completed'));
        await runnerWith(store, 'Error: connect ECONNREFUSED 127.0.0.1:443').recordLastTurnForTest(finishedTask('failed'));
        await runnerWith(store, 'Error: No authentication information found.').recordLastTurnForTest(finishedTask('failed', 'bob'));

        expect(store.isAttested('alice', 'copilot')).to.equal(true);
        expect(store.isAttested('bob', 'copilot')).to.equal(false);
    });
});
