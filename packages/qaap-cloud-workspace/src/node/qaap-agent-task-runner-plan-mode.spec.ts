// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';

describe('QaapAgentTaskRunner Plan mode sandbox', () => {

    it('sets fail-closed OpenCode permissions on the spawned task environment', () => {
        const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
        Object.assign(runner, {
            helperApiUrl: '',
            tenantHomeEnvOverlay: undefined,
            resolveAgentSpawnIdentity: () => ({}),
            stripSharedProviderEnv: () => undefined,
            resolveAgentBindingForTask: () => undefined,
            isQaiqRunner: () => false,
            applyHelperEnv: () => false,
        });
        const task = {
            id: 'plan-opencode',
            title: 'Plan task',
            agentId: 'opencode',
            command: 'opencode run --format json inspect',
            cwd: '/repo',
            state: 'running',
            createdAt: 0,
            readOnlyWorkspace: true,
        } as QaapAgentTask;

        const env = runner.buildChildEnv(task);

        expect(JSON.parse(env.OPENCODE_PERMISSION ?? '{}')).to.deep.equal({
            '*': 'deny',
            read: 'allow',
            glob: 'allow',
            grep: 'allow',
            list: 'allow',
            webfetch: 'allow',
            websearch: 'allow',
            lsp: 'allow',
            question: 'allow',
        });
    });
});
