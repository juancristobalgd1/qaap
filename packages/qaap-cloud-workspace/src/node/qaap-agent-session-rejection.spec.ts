// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { QaapAgentSessionAttestationStore } from './qaap-agent-session-attestation-store';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import type { AgentCandidate } from './qaap-agent-task-runner-types';

class TestableRunner extends QaapAgentTaskRunner {
    recordLastTurnForTest(task: QaapAgentTask): Promise<void> {
        return this.recordLastTurn(task);
    }
}

const PROBED: readonly AgentCandidate[] = [
    { id: 'codex', label: 'Codex', bin: 'codex', template: 'codex exec {prompt}' },
    { id: 'cursor', label: 'Cursor Agent', bin: 'cursor-agent', template: 'cursor-agent -p {prompt}' },
    { id: 'opencode', label: 'OpenCode', bin: 'opencode', template: 'opencode run {prompt}' },
    { id: 'pi', label: 'Pi', bin: 'pi', template: 'pi --mode json {prompt}' },
];

/**
 * A runner whose probed harnesses all answer `connected`, the way a fooled probe does: a hollow Codex
 * `auth.json` ("Logged in using ChatGPT") or a rejected Cursor token ("Logged in").
 */
function runnerWith(log: string): TestableRunner {
    const runner = Object.create(TestableRunner.prototype) as TestableRunner;
    const now = Date.now();
    Object.assign(runner, {
        sessionAttestations: new QaapAgentSessionAttestationStore(),
        detectedAgents: new Map<string, AgentCandidate>(PROBED.map(candidate => [candidate.id, candidate])),
        agentConnectionStates: new Map(PROBED.flatMap(candidate => [
            [`${candidate.id}:alice`, { state: 'connected', at: now }],
            [`${candidate.id}:bob`, { state: 'connected', at: now }],
        ])),
        agentConnectionProbes: new Map(),
        rejectedAgentSessions: new Set(),
        isAgentEnabled: () => true,
        agentAuthSources: (agentId: string) => ({ settingsConnected: undefined, probeBin: PROBED.find(c => c.id === agentId)?.bin }),
        probeAgentConnectionState: async () => 'connected',
        detectAgents: () => undefined,
        resolveTaskAgentId: (task: QaapAgentTask) => task.agentId ?? 'codex',
        readLog: async () => log,
        lastTurns: undefined,
    });
    return runner;
}

function session(runner: QaapAgentTaskRunner, agentId: string, owner = 'alice'): string | undefined {
    return runner.listAgents(owner).find(agent => agent.id === agentId)?.session;
}

function failedTask(agentId: string, extra: Partial<QaapAgentTask> = {}): QaapAgentTask {
    return { id: 't1', agentId, ownerLogin: 'alice', state: 'failed', exitCode: 1, finishedAt: 2_000, ...extra } as unknown as QaapAgentTask;
}

const CODEX_401 = [
    '{"type":"turn.started"}',
    '{"type":"error","message":"unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses"}',
    '{"type":"turn.failed","error":{"message":"unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses"}}',
].join('\n');
/** Pi's own OpenRouter sign-in (auth.json) revoked: Pi 1.4's json stream, as seen on staging on 23 Nov 2026. */
const PI_OPENROUTER_REVOKED = [
    '{"type":"agent_start"}',
    '{"type":"message_end","message":{"role":"assistant","content":[],"provider":"openrouter","model":"cohere/north-mini-code:free","stopReason":"error",'
        + '"errorMessage":"401: {\\"message\\":\\"User not found.\\",\\"code\\":401}"}}',
    '{"type":"agent_settled","aborted":false}',
].join('\n');
const CURSOR_SIGNED_OUT = "Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.\n";

describe('QaapAgentTaskRunner session rejection after an auth failure', () => {

    it('locks Codex after its first 401 even though the probe still says connected, for that owner only', async () => {
        const runner = runnerWith(CODEX_401);
        expect(session(runner, 'codex')).to.equal('signed-in');

        await runner.recordLastTurnForTest(failedTask('codex', { agentModel: { provider: 'openai', modelId: 'gpt-6-luna' } } as Partial<QaapAgentTask>));

        expect(session(runner, 'codex')).to.equal('signed-out');
        expect(runner.listAgents('alice').find(agent => agent.id === 'codex')).to.include({ connectionState: 'disconnected', available: false });
        expect(session(runner, 'codex', 'bob')).to.equal('signed-in');
    });

    it("locks Cursor after its \"run 'agent login' first\" refusal", async () => {
        const runner = runnerWith(CURSOR_SIGNED_OUT);
        await runner.recordLastTurnForTest(failedTask('cursor'));
        expect(session(runner, 'cursor')).to.equal('signed-out');
    });

    it('stays locked when the probe answers connected again, until a sign-in refreshes the catalog', async () => {
        const runner = runnerWith(CODEX_401);
        await runner.recordLastTurnForTest(failedTask('codex'));
        const states = (runner as unknown as { agentConnectionStates: Map<string, { state: string; at: number }> }).agentConnectionStates;
        states.set('codex:alice', { state: 'connected', at: Date.now() });
        expect(session(runner, 'codex')).to.equal('signed-out');

        // The sign-in dialog confirms with `?refresh=1`, which runs refreshAgentCatalog for that owner.
        runner.refreshAgentCatalog('alice');
        expect(session(runner, 'codex')).to.not.equal('signed-out');
    });

    it('lifts only the refreshing owner\'s rejections', async () => {
        const runner = runnerWith(CODEX_401);
        await runner.recordLastTurnForTest(failedTask('codex'));
        await runner.recordLastTurnForTest(failedTask('codex', { ownerLogin: 'bob' }));

        runner.refreshAgentCatalog('Bob');

        expect(session(runner, 'codex')).to.equal('signed-out');
        expect(session(runner, 'codex', 'bob')).to.not.equal('signed-out');
    });

    it('ignores Qaap\'s own pre-spawn refusal, a Free model and a non-auth failure', async () => {
        const refusal = runnerWith("Couldn't confirm your sign-in to Codex; try again.\n");
        await refusal.recordLastTurnForTest(failedTask('codex', { preflightFailure: 'sign_in_required' }));
        expect(session(refusal, 'codex')).to.equal('signed-in');

        const free = runnerWith('Error: 401 Unauthorized\n');
        await free.recordLastTurnForTest(failedTask('opencode', { agentModel: { provider: 'openai', vendor: 'opencode', modelId: 'opencode/beam-free' } } as Partial<QaapAgentTask>));
        expect(session(free, 'opencode')).to.equal('signed-in');

        const network = runnerWith('Error: connect ECONNREFUSED 127.0.0.1:443\n');
        await network.recordLastTurnForTest(failedTask('codex'));
        expect(session(network, 'codex')).to.equal('signed-in');
    });

    it("locks Pi when the provider refuses Pi's own sign-in, even on a free OpenRouter model", async () => {
        const runner = runnerWith(PI_OPENROUTER_REVOKED);
        expect(session(runner, 'pi')).to.equal('signed-in');

        await runner.recordLastTurnForTest(failedTask('pi', {
            agentModel: { provider: 'openai', vendor: 'openrouter', modelId: 'openrouter/cohere/north-mini-code:free' },
        } as Partial<QaapAgentTask>));

        // The composer opens Pi's sign-in for a signed-out harness that cannot run otherwise.
        expect(session(runner, 'pi')).to.equal('signed-out');
        expect(runner.listAgents('alice').find(agent => agent.id === 'pi')).to.include({ connectionState: 'disconnected', available: false });
        expect(session(runner, 'pi', 'bob')).to.equal('signed-in');
    });

    it('a per-harness refresh (the Connect dialog poll) lifts only that harness and re-detects nothing', async () => {
        const runner = runnerWith(CODEX_401);
        await runner.recordLastTurnForTest(failedTask('codex'));
        await runner.recordLastTurnForTest(failedTask('cursor', {}));
        let detections = 0;
        (runner as unknown as { detectAgents: () => void }).detectAgents = () => {
            detections++;
        };
        runner.refreshAgentCatalog('alice', 'codex');
        expect(detections).to.equal(0);
        expect(session(runner, 'codex')).to.not.equal('signed-out');
        expect(session(runner, 'cursor')).to.equal('signed-out');

        runner.refreshAgentCatalog('alice');
        expect(detections).to.equal(1);
    });
});
