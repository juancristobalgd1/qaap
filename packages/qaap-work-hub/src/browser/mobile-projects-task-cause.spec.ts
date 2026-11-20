// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTaskDetailDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { taskCause } from './mobile-projects-task-cause';

function detail(overrides: Partial<QaapAgentTaskDetailDTO>): QaapAgentTaskDetailDTO {
    return { id: 'task-1', cwd: '/repo', state: 'failed', log: 'work\nagent crashed', ...overrides };
}

describe('taskCause', () => {
    it('shows the last log line for a plain failed task', () => {
        expect(taskCause(detail({}))).to.equal('agent crashed');
    });

    it('shows the stop failure instead of the log tail when Stop could not signal the agent', () => {
        const cause = taskCause(detail({ stopFailure: 'Could not stop the agent; it may still be running.' }));

        expect(cause).to.equal('Could not stop the agent; it may still be running.');
    });

    it('keeps the stop failure ahead of the cancelled and interrupted causes', () => {
        expect(taskCause(detail({ state: 'cancelled', stopFailure: 'stop failed' }))).to.equal('stop failed');
        expect(taskCause(detail({ state: 'interrupted', stopFailure: 'stop failed' }))).to.equal('stop failed');
    });

    it('reports no cause for an empty log without a stop failure', () => {
        expect(taskCause(detail({ log: '\n  \n' }))).to.equal('No cause was reported.');
    });
});
