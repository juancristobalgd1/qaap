// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    filterOptimisticallyResolvedApprovals,
    markAgentApprovalOptimisticallyResolved,
    resetOptimisticallyResolvedApprovalsForTests,
    unmarkAgentApprovalOptimisticallyResolved,
    type QaapAgentApprovalRequestDTO,
} from './qaap-agent-approval-client';

function makeApproval(id: string): QaapAgentApprovalRequestDTO {
    return {
        id,
        conversationId: 'conv-1',
        cwd: '/tmp/repo',
        agentId: 'antigravity',
        conversationTitle: 'Levanta la app',
        kind: 'tool',
        toolName: 'Bash',
        summary: 'Bash · pnpm run typecheck',
        createdAt: 1000,
    };
}

describe('qaap-agent-approval-client optimistic dismissal', () => {
    beforeEach(() => {
        resetOptimisticallyResolvedApprovalsForTests();
    });

    afterEach(() => {
        resetOptimisticallyResolvedApprovalsForTests();
    });

    it('suppresses optimistically resolved approvals across overlapping polls until rollback or TTL expiry', () => {
        const a1 = makeApproval('approval-1');
        const a2 = makeApproval('approval-2');
        markAgentApprovalOptimisticallyResolved('approval-1', 1_000);

        expect(filterOptimisticallyResolvedApprovals([a1, a2], 2_000).map(item => item.id)).to.deep.equal(['approval-2']);

        unmarkAgentApprovalOptimisticallyResolved('approval-1');
        expect(filterOptimisticallyResolvedApprovals([a1, a2], 2_000).map(item => item.id)).to.deep.equal(['approval-1', 'approval-2']);

        markAgentApprovalOptimisticallyResolved('approval-1', 1_000);
        expect(filterOptimisticallyResolvedApprovals([a1, a2], 20_000).map(item => item.id)).to.deep.equal(['approval-1', 'approval-2']);
    });
});
