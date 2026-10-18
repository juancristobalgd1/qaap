// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import { withTaskPlanningInstruction } from './qaap-agent-conversation-store-tool-pills2';

describe('withTaskPlanningInstruction', () => {
    const conv = (state: 'drafting' | 'awaiting-approval'): QaapAgentConversation => ({
        id: 'c', cwd: '/r', agentId: 'qaiq', title: 't', status: 'streaming', createdAt: 0, updatedAt: 0,
        messages: [{ id: 'm1', role: 'user', content: 'do it', createdAt: 0 }, { id: 'm2', role: 'user', content: 'more', createdAt: 1 }],
        taskPlan: { id: 'p', state, subtasks: [], autoRun: true, createdAt: 0, updatedAt: 0 },
    });

    it('appends the qaap-plan instruction to the planning turn prompt only', () => {
        const planning = withTaskPlanningInstruction(conv('drafting'), { prompt: '[context marker] do it', cwd: '/r' }, 'm1');
        expect(planning.prompt).to.match(/^\[context marker\] do it\n\n\[Qaap task plan instruction\]/).and.to.contain('```qaap-plan');
        expect(withTaskPlanningInstruction(conv('drafting'), { prompt: 'more', cwd: '/r' }, 'm2').prompt).to.equal('more');
        expect(withTaskPlanningInstruction(conv('awaiting-approval'), { prompt: 'do it', cwd: '/r' }, 'm1').prompt).to.equal('do it');
    });
});
