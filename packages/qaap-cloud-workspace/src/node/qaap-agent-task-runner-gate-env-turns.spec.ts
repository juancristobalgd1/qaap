// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import type { QaapGenericCommandResult } from './qaap-agent-task-runner';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { runAgentVerificationFixTurnExtracted } from './qaap-agent-task-runner-activity2';
import { reviewSuccessfulAgentTask } from './qaap-agent-task-runner-utils3';
import { QaapToolGateTokenService } from './qaap-tool-gate-token-service';

const task = { id: 'task-1', cwd: '/w', ownerLogin: 'alice', command: 'pi', agentId: 'pi', state: 'running', autoApprove: true } as unknown as QaapAgentTask;
const ok: QaapGenericCommandResult = { exitCode: 0, stdout: '', stderr: '', timedOut: false };

describe('gate credentials for harness runs inside verification', () => {

    it('a Pi fix turn gets the task gate token on a copy; the shared verification env stays clean', async () => {
        const tokens = new QaapToolGateTokenService();
        const seen: NodeJS.ProcessEnv[] = [];
        const ctx = {
            isTaskStillRunning: () => true,
            resolveTaskAgentId: () => 'pi',
            buildAgentVerificationFixPrompt: () => 'fix',
            buildAgentCommand: () => ({ command: 'pi', agentId: 'pi' }),
            appendAndFireOutput: () => undefined,
            applyToolGateEnv: (env: NodeJS.ProcessEnv) => {
                env.QAAP_GATE_TOKEN = tokens.issue('task-1', 'alice', '/w');
                env.QAAP_GATE_URL = 'http://127.0.0.1:1/qaap/api/tool-gate';
            },
            runGenericCommand: async (_c: string, _cwd: string, env: NodeJS.ProcessEnv) => {
                seen.push(env);
                return ok;
            },
        } as unknown as QaapAgentTaskRunnerContext;
        const verificationEnv: NodeJS.ProcessEnv = { PATH: '/bin' };
        await runAgentVerificationFixTurnExtracted(ctx, task, verificationEnv, 'npm test', ok, 1, Date.now());
        expect(seen).to.have.length(1);
        expect(tokens.resolve(seen[0].QAAP_GATE_TOKEN)?.taskId).to.equal('task-1');
        expect(seen[0].QAAP_GATE_URL).to.contain('/tool-gate');
        expect(verificationEnv.QAAP_GATE_TOKEN).to.equal(undefined);
        expect(verificationEnv.QAAP_GATE_URL).to.equal(undefined);
    });

    describe('reviewer', () => {
        const saved = process.env.QAAP_AGENT_REVIEW;
        before(() => { process.env.QAAP_AGENT_REVIEW = 'all'; });
        after(() => {
            if (saved === undefined) {
                delete process.env.QAAP_AGENT_REVIEW;
            } else {
                process.env.QAAP_AGENT_REVIEW = saved;
            }
        });

        it('a Pi reviewer gets a read-only one-shot grant revoked afterwards; git commands get no gate env', async () => {
            const tokens = new QaapToolGateTokenService();
            const calls: Array<{ command: string; env: NodeJS.ProcessEnv; live?: unknown }> = [];
            await reviewSuccessfulAgentTask(task, undefined, {
                isTaskStillRunning: () => true,
                resolveTaskAgentId: () => 'pi',
                buildChildEnv: () => ({ PATH: '/bin' }),
                hasEditedFilesForVerification: async () => true,
                runGenericCommand: async (command: string, _cwd: string, env: NodeJS.ProcessEnv) => {
                    calls.push({ command, env, live: env.QAAP_GATE_TOKEN ? tokens.resolve(env.QAAP_GATE_TOKEN) : undefined });
                    return { ...ok, stdout: command.startsWith('git') ? 'x' : '' };
                },
                applyOneShotToolGateEnv: (env: NodeJS.ProcessEnv, t: { agentId?: string; cwd: string; ownerLogin?: string }) => {
                    const grant = tokens.issueOneShot(t.agentId ?? 'pi', t.ownerLogin, t.cwd);
                    env.QAAP_GATE_TOKEN = grant.token;
                    return grant.release;
                },
                changedSensitiveFiles: () => [],
                resolveReviewerCandidates: () => ['pi'],
                buildAgentCommand: () => ({ command: 'pi review', agentId: 'pi' }),
                appendAndFireOutput: () => undefined,
            } as unknown as Parameters<typeof reviewSuccessfulAgentTask>[2]);
            const git = calls.filter(call => call.command.startsWith('git'));
            expect(git.length).to.be.greaterThan(0);
            for (const call of git) {
                expect(call.env.QAAP_GATE_TOKEN).to.equal(undefined);
            }
            const reviewer = calls.find(call => call.command === 'pi review')!;
            expect(reviewer.env.QAAP_GATE_TOKEN).to.be.a('string');
            expect((reviewer.live as { oneShot?: unknown }).oneShot).to.deep.equal({ agentId: 'pi' });
            expect(tokens.resolve(reviewer.env.QAAP_GATE_TOKEN)).to.equal(undefined);
        });
    });
});
