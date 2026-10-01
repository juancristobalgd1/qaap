// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTask, QaapAgentTaskVerificationPhase } from '../common/qaap-agent-task';
import { toConversationSummary, type QaapAgentConversation } from '../common/qaap-agent-conversation';
import {
    QAAP_AGENT_VERIFY_MAX_ATTEMPTS,
    verifySuccessfulAgentTask,
    type VerifySuccessfulAgentTaskDeps,
} from './qaap-agent-task-runner-utils3';
import { resolveConversationTurnPhase } from './qaap-agent-conversation-store-timeline2';

const TASK: QaapAgentTask = {
    id: 't1',
    title: 'edit files',
    command: 'qaiq --prompt "do work"',
    cwd: '/repo',
    state: 'running',
    createdAt: 0,
    agentId: 'qaiq',
};

const RED = { exitCode: 1, stdout: 'error TS2322', stderr: '', timedOut: false };

function deps(overrides: Partial<VerifySuccessfulAgentTaskDeps>, phases: QaapAgentTaskVerificationPhase[]): VerifySuccessfulAgentTaskDeps {
    return {
        buildChildEnv: () => ({}),
        hasEditedFilesForVerification: async () => true,
        resolveVerificationScriptsForCwd: async () => ['typecheck'],
        isTaskStillRunning: () => true,
        runVerificationScripts: async () => undefined,
        runAgentVerificationFixTurn: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
        summarizeVerificationFailure: command => `${command} failed`,
        listWorktreeChanges: () => undefined,
        revertWorktreeChanges: () => [],
        onVerificationPhase: (_task, phase) => phases.push(phase),
        ...overrides,
    };
}

describe('qaap agent task verification phase', () => {

    it('announces a running phase once scripts will actually run', async () => {
        const phases: QaapAgentTaskVerificationPhase[] = [];
        const result = await verifySuccessfulAgentTask(TASK, deps({}, phases));
        expect(result?.status).to.equal('passed');
        expect(phases.map(phase => [phase.status, phase.attempt])).to.deep.equal([['running', 0]]);
        expect(phases[0].maxAttempts).to.equal(QAAP_AGENT_VERIFY_MAX_ATTEMPTS);
    });

    it('never announces a phase when verification is skipped (no edits / no scripts)', async () => {
        const phases: QaapAgentTaskVerificationPhase[] = [];
        await verifySuccessfulAgentTask(TASK, deps({ hasEditedFilesForVerification: async () => false }, phases));
        await verifySuccessfulAgentTask(TASK, deps({ resolveVerificationScriptsForCwd: async () => [] }, phases));
        expect(phases).to.deep.equal([]);
    });

    it('reports each fix attempt before the fix turn and re-verification after it', async () => {
        const phases: QaapAgentTaskVerificationPhase[] = [];
        let runs = 0;
        const result = await verifySuccessfulAgentTask(TASK, deps({
            runVerificationScripts: async () => (runs++ < 1 ? { command: 'npm run typecheck', result: RED } : undefined),
        }, phases));
        expect(result?.status).to.equal('passed');
        expect(phases.map(phase => [phase.status, phase.attempt])).to.deep.equal([
            ['running', 0],
            ['fixing', 1],
            ['running', 1],
        ]);
        expect(phases[1].command).to.equal('npm run typecheck');
    });
});

describe('qaap conversation turn phase', () => {

    it('maps a running task verification phase onto the conversation', () => {
        const turnPhase = resolveConversationTurnPhase({
            state: 'running',
            verificationPhase: { status: 'fixing', attempt: 2, maxAttempts: 2, command: 'npm run lint', startedAt: 5 },
        });
        expect(turnPhase).to.deep.equal({ kind: 'verifying', status: 'fixing', attempt: 2, maxAttempts: 2, startedAt: 5 });
    });

    it('drops the phase for settled tasks or tasks without one', () => {
        expect(resolveConversationTurnPhase({ state: 'running' })).to.equal(undefined);
        expect(resolveConversationTurnPhase({
            state: 'completed',
            verificationPhase: { status: 'running', attempt: 0, maxAttempts: 2, startedAt: 1 },
        })).to.equal(undefined);
    });

    it('exposes turnPhase on the summary only while streaming', () => {
        const base: QaapAgentConversation = {
            id: 'c1',
            cwd: '/repo',
            agentId: 'qaiq',
            title: 'T',
            status: 'streaming',
            createdAt: 0,
            updatedAt: 0,
            messages: [{ id: 'u1', role: 'user', content: 'go', createdAt: 0, taskId: 't1' }],
            turnPhase: { kind: 'verifying', status: 'running', attempt: 0, maxAttempts: 2, startedAt: 1 },
        };
        expect(toConversationSummary(base).turnPhase?.kind).to.equal('verifying');
        expect(toConversationSummary({ ...base, status: 'idle' }).turnPhase).to.equal(undefined);
    });
});
