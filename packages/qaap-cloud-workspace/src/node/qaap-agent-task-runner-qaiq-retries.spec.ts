// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';

describe('QaapAgentTaskRunner QAIQ retry budget', () => {

    const ENV_KEY = 'OPENCLAUDE_MAX_RETRIES';
    let savedValue: string | undefined;

    beforeEach(() => {
        savedValue = process.env[ENV_KEY];
        delete process.env[ENV_KEY];
    });

    afterEach(() => {
        if (savedValue === undefined) {
            delete process.env[ENV_KEY];
        } else {
            process.env[ENV_KEY] = savedValue;
        }
    });

    function createRunner(isQaiqRunner: boolean): QaapAgentTaskRunner {
        const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
        Object.assign(runner, {
            helperApiUrl: '',
            tenantHomeEnvOverlay: undefined,
            resolveAgentSpawnIdentity: () => ({}),
            stripSharedProviderEnv: () => undefined,
            resolveAgentBindingForTask: () => undefined,
            applyProviderPreferenceEnv: () => undefined,
            applyQaiqProviderEnv: () => undefined,
            isQaiqRunner: () => isQaiqRunner,
            applyHelperEnv: () => false,
        });
        return runner;
    }

    function createTask(agentId: string, command: string): QaapAgentTask {
        return {
            id: `retry-${agentId}`,
            title: 'Retry budget task',
            agentId,
            command,
            cwd: '/repo',
            state: 'running',
            createdAt: 0,
        } as QaapAgentTask;
    }

    it('caps the QAIQ child at three retries so a daily free-tier 429 fails fast', () => {
        const env = createRunner(true).buildChildEnv(createTask('qaiq', 'qaiq -p hello'));
        expect(env.OPENCLAUDE_MAX_RETRIES).to.equal('3');
    });

    it('keeps an operator-set retry budget over the default', () => {
        process.env[ENV_KEY] = '7';
        const env = createRunner(true).buildChildEnv(createTask('qaiq', 'qaiq -p hello'));
        expect(env.OPENCLAUDE_MAX_RETRIES).to.equal('7');
    });

    it('does not touch the retry budget of other agents', () => {
        const env = createRunner(false).buildChildEnv(createTask('opencode', 'opencode run --format json hello'));
        expect(env.OPENCLAUDE_MAX_RETRIES).to.equal(undefined);
    });
});
