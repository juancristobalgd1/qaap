// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_HARNESS_DEFINITIONS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import type { AgentCandidate } from './qaap-agent-task-runner-types';

describe('QaapAgentTaskRunner harness status catalog', () => {
    it('returns every known harness even when disabled or disconnected', () => {
        const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
        const detectedAgents = new Map<string, AgentCandidate>([
            ['codex', { id: 'codex', label: 'Codex', bin: 'codex', template: 'codex {prompt}' }],
            ['opencode', { id: 'opencode', label: 'OpenCode', bin: 'opencode', template: 'opencode {prompt}' }],
        ]);
        Object.assign(runner, {
            detectedAgents,
            isCandidateAvailable: () => true,
            isOnPath: (bin: string) => bin === 'qaiq',
            isAgentEnabled: (id: string) => id !== 'codex',
            agentConnectionState: (id: string) => id === 'codex' ? 'disconnected' : 'connected',
        });

        const statuses = runner.listHarnessStatuses('alice', id => id === 'codex');
        const codex = statuses.find(status => status.id === 'codex');

        expect(statuses.map(status => status.id)).to.deep.equal(QAAP_HARNESS_DEFINITIONS.map(harness => harness.id));
        expect(codex).to.deep.equal({
            id: 'codex',
            installed: true,
            enabled: false,
            connectionState: 'disconnected',
            installSupported: true,
        });
        expect(statuses.find(status => status.id === 'qaiq')?.installed).to.equal(true);
    });
});
