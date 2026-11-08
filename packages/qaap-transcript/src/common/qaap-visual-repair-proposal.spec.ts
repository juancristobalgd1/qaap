// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { isVisualRepairInstructionMessage, resolveVisualRepairProposalMessage } from './qaap-visual-repair-proposal';

const user = { id: 'u1', role: 'user' as const, content: 'Build the app', createdAt: 1 };
const evidence = { id: 'a1', role: 'agent' as const, content: 'Done. [QAAP repair required]', createdAt: 2, visualRepairProposedAt: 5 };
const conv = (messages: QaapAgentConversationDTO['messages'], status: QaapAgentConversationDTO['status'] = 'idle'): Pick<QaapAgentConversationDTO, 'status' | 'messages'> => ({ status, messages });

describe('resolveVisualRepairProposalMessage', () => {
    it('offers the failed evidence message as a proposal when it is the last message', () => {
        expect(resolveVisualRepairProposalMessage(conv([user, evidence]))?.id).to.equal('a1');
    });

    it('stays hidden while the turn runs', () => {
        expect(resolveVisualRepairProposalMessage(conv([user, evidence], 'streaming'))).to.equal(undefined);
    });

    it('stays hidden once the user accepted the repair', () => {
        const repairTurn = { id: 'u2', role: 'user' as const, content: 'repair', createdAt: 3, visualRepairSourceAgentMessageId: 'a1' };
        expect(resolveVisualRepairProposalMessage(conv([user, evidence, repairTurn]))).to.equal(undefined);
    });

    it('is not offered for an evidence message that never got a proposal (automatic repair)', () => {
        const auto = { ...evidence, visualRepairProposedAt: undefined };
        expect(resolveVisualRepairProposalMessage(conv([user, auto]))).to.equal(undefined);
    });

    it('is not offered when a newer message follows the evidence', () => {
        expect(resolveVisualRepairProposalMessage(conv([user, evidence, { id: 'u3', role: 'user' as const, content: 'next', createdAt: 4 }]))).to.equal(undefined);
    });
});

describe('isVisualRepairInstructionMessage', () => {
    it('marks only backend repair instructions, never typed user messages', () => {
        expect(isVisualRepairInstructionMessage({ role: 'user', visualRepairSourceAgentMessageId: 'a1' })).to.equal(true);
        expect(isVisualRepairInstructionMessage({ role: 'user' })).to.equal(false);
        expect(isVisualRepairInstructionMessage({ role: 'agent', visualRepairSourceAgentMessageId: 'a1' })).to.equal(false);
    });
});
