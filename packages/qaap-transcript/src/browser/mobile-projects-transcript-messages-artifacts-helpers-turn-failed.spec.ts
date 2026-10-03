// *****************************************************************************
// Copyright (C) 2026 Qaap and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO, QaapAgentMessageDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { isAgentMessageFailed } from './mobile-projects-transcript-messages-artifacts-helpers';

function message(id: string, role: string, error?: string): QaapAgentMessageDTO {
    return { id, role, content: '', createdAt: 0, ...(error ? { error } : {}) } as unknown as QaapAgentMessageDTO;
}

function conversation(status: string, messages: QaapAgentMessageDTO[]): QaapAgentConversationDTO {
    return { id: 'c', status, messages } as unknown as QaapAgentConversationDTO;
}

describe('isAgentMessageFailed', () => {
    const failedTurn = message('a1', 'agent', 'PermissionDenied');
    const okTurn = message('a2', 'agent');

    it('does not mark a successful turn as failed because an earlier turn failed', () => {
        const conv = conversation('idle', [message('u1', 'user'), failedTurn, message('u2', 'user'), okTurn]);
        expect(isAgentMessageFailed(conv, okTurn)).to.equal(false);
        expect(isAgentMessageFailed(conv, failedTurn)).to.equal(true);
    });

    it('marks only the last agent turn of a failed conversation', () => {
        const earlier = message('a0', 'agent');
        const conv = conversation('failed', [message('u0', 'user'), earlier, message('u1', 'user'), okTurn]);
        expect(isAgentMessageFailed(conv, okTurn)).to.equal(true);
        expect(isAgentMessageFailed(conv, earlier)).to.equal(false);
    });

    it('falls back to the conversation state when the row has no resolved message', () => {
        expect(isAgentMessageFailed(conversation('failed', []), undefined)).to.equal(true);
        expect(isAgentMessageFailed(conversation('idle', []), undefined)).to.equal(false);
    });
});
