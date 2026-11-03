// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { isStaleComposerConversationTarget } from './qaap-composer-stale-target';

function summary(id: string, source?: 'theia-chat'): QaapAgentConversationSummaryDTO {
    return {
        id,
        cwd: '/repo',
        workspacePath: '/repo',
        agentId: 'task',
        title: id,
        status: 'settled',
        createdAt: 0,
        updatedAt: 0,
        messageCount: 1,
        source,
    } as QaapAgentConversationSummaryDTO;
}

describe('isStaleComposerConversationTarget', () => {
    it('treats a composer summary that is not the open transcript as stale (after New task)', () => {
        expect(isStaleComposerConversationTarget(undefined, summary('task-a'))).to.equal(true);
        expect(isStaleComposerConversationTarget(summary('task-b'), summary('task-a'))).to.equal(true);
    });

    it('keeps a follow-up routed to the task that is open in the transcript', () => {
        expect(isStaleComposerConversationTarget(summary('task-a'), summary('task-a'))).to.equal(false);
    });

    it('never flags pending new-chat placeholders or legacy Theia chat', () => {
        expect(isStaleComposerConversationTarget(undefined, summary('pending-new-chat-p1-1'))).to.equal(false);
        expect(isStaleComposerConversationTarget(undefined, summary('chat-1', 'theia-chat'))).to.equal(false);
    });
});
