// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import { buildAgentClosingReport } from '../common/qaap-agent-closing-report';
import { appendClosingReportTrace } from './qaap-agent-conversation-store-helpers';
import { recordTurnVerdict } from './qaap-agent-conversation-store-activity2';

function conversation(): QaapAgentConversation {
    return {
        id: 'c1',
        cwd: '/repo',
        agentId: 'qaiq',
        title: 't',
        status: 'idle',
        createdAt: 1,
        updatedAt: 1,
        messages: [
            { id: 'u1', role: 'user', content: 'do it', createdAt: 1 },
            { id: 'a1', role: 'agent', content: 'done', createdAt: 2 },
        ],
    };
}

describe('conversation store closing report', () => {

    it('appends the whole report as one trace on the agent message', () => {
        const report = buildAgentClosingReport({
            state: 'blocked',
            verification: { status: 'failed', command: 'npm run build', attempts: 1, summary: 'red' },
            review: undefined,
            blockedNeed: 'Which DB?',
            diff: { files: 1, added: 2, removed: 0 },
        })!;
        const next = appendClosingReportTrace(conversation(), 'a1', report);
        const events = next.messages.find(message => message.id === 'a1')?.traceEvents ?? [];
        expect(events).to.have.length(1);
        expect(events[0].type).to.equal('error');
        expect(events[0].id.startsWith('closing-report-')).to.equal(true);
        expect((events[0] as { message: string }).message).to.equal([
            'Blocked — needs your input: Which DB?',
            'Checks: failing (npm run build) after 1 fix turn. red',
            'Independent review: not run.',
            'Changes: 1 file, +2 −0 lines.',
        ].join('\n'));
        expect(next.messages.find(message => message.id === 'a1')?.error).to.equal(undefined);
    });

    it('persists the report on the turn verdict so it outlives the task', () => {
        const report = buildAgentClosingReport({ state: 'completed', diff: { added: 0, removed: 0 } })!;
        const next = recordTurnVerdict(conversation(), 'u1', { state: 'completed' }, undefined, 9, report);
        expect(next.messages[0].turnVerdict).to.deep.equal({ taskState: 'completed', closingReport: report, settledAt: 9 });
    });
});
