// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapToolGateTokenService } from './qaap-tool-gate-token-service';

const task = (agentId: string): QaapAgentTask => ({ id: 'task-1', cwd: '/w', ownerLogin: 'alice', command: 'x', agentId }) as unknown as QaapAgentTask;

/** The two gate-env entry points of the real runner, run against a minimal `this`. */
function fakeRunner(trusted: boolean, withGate = true): QaapAgentTaskRunner {
    return {
        toolGateTokens: withGate ? new QaapToolGateTokenService() : undefined,
        helperApiUrl: withGate ? 'http://127.0.0.1:3000/qaap/api/helper' : undefined,
        resolveTaskAgentId: (t: QaapAgentTask) => t.agentId ?? 'qaiq',
        isProjectFolderTrusted: () => trusted,
    } as unknown as QaapAgentTaskRunner;
}
const seed = (runner: QaapAgentTaskRunner, env: NodeJS.ProcessEnv, agentId: string): void =>
    QaapAgentTaskRunner.prototype.applyToolGateEnv.call(runner, env, task(agentId));
const seedOneShot = (runner: QaapAgentTaskRunner, env: NodeJS.ProcessEnv, agentId: string): (() => void) =>
    QaapAgentTaskRunner.prototype.applyOneShotToolGateEnv.call(runner, env, task(agentId));

describe('OpenCode tool gate wiring in the task runner', () => {

    it('seeds the plugin config together with the gate credentials for an OpenCode harness', () => {
        const env: NodeJS.ProcessEnv = {};
        seed(fakeRunner(true), env, 'opencode');
        expect(env.QAAP_GATE_TOKEN).to.be.a('string');
        expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT as string).plugin).to.have.length(1);
        expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).to.equal(undefined);
    });

    it('an untrusted folder also disables repo config', () => {
        const env: NodeJS.ProcessEnv = {};
        seed(fakeRunner(false), env, 'opencode');
        expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).to.equal('1');
    });

    it('replaces the built-in ask rules, which headless OpenCode would reject', () => {
        const env: NodeJS.ProcessEnv = { OPENCODE_PERMISSION: '{"edit":"ask","bash":"ask"}' };
        seed(fakeRunner(true), env, 'opencode');
        expect(env.OPENCODE_PERMISSION).to.equal(undefined);
    });

    it('seeds nothing without a gate (the ask rules stay as the fail-closed fallback)', () => {
        const env: NodeJS.ProcessEnv = { OPENCODE_PERMISSION: '{"bash":"ask"}' };
        seed(fakeRunner(true, false), env, 'opencode');
        expect(env).to.deep.equal({ OPENCODE_PERMISSION: '{"bash":"ask"}' });
    });

    it('never touches the env of other harnesses', () => {
        for (const agentId of ['pi', 'qaiq', 'claude', 'codex']) {
            const env: NodeJS.ProcessEnv = {};
            seed(fakeRunner(false), env, agentId);
            expect(Object.keys(env).filter(key => key.startsWith('OPENCODE_')), agentId).to.deep.equal([]);
        }
    });

    it('a one-shot gate (reviewer) wires the plugin too, and releases its token', () => {
        const env: NodeJS.ProcessEnv = {};
        const release = seedOneShot(fakeRunner(false), env, 'opencode');
        expect(env.OPENCODE_CONFIG_CONTENT).to.be.a('string');
        expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).to.equal('1');
        expect(env.QAAP_GATE_ASK_TTL_SEC).to.equal('0');
        release();
    });
});
