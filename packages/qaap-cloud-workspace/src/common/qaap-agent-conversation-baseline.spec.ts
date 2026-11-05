// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversation, QaapConversationCheckpoint } from './qaap-agent-conversation';
import { resolveBaselineCommit } from './qaap-agent-conversation';

function checkpoint(id: string, kind: 'pre-turn' | undefined, messageId: string, commit: string): QaapConversationCheckpoint {
    return { id, ...(kind ? { kind } : {}), messageId, label: id, commit, ref: `refs/qaap/checkpoints/c1/${id}`, capturedAt: 1 };
}

function conversation(checkpoints: QaapConversationCheckpoint[]): Pick<QaapAgentConversation, 'checkpoints' | 'messages'> {
    return {
        checkpoints,
        messages: [
            { id: 'u1', role: 'user', content: 'first', createdAt: 1 },
            { id: 'a1', role: 'agent', content: 'done', createdAt: 2 },
            { id: 'u2', role: 'user', content: 'second', createdAt: 3 },
        ],
    } as unknown as Pick<QaapAgentConversation, 'checkpoints' | 'messages'>;
}

describe('resolveBaselineCommit', () => {
    it('is undefined when the conversation has no pre-turn snapshot of its first message', () => {
        expect(resolveBaselineCommit(conversation([]))).to.equal(undefined);
        expect(resolveBaselineCommit(conversation([checkpoint('pre2', 'pre-turn', 'u2', 'b'.repeat(40))]))).to.equal(undefined);
    });

    it('takes the first pre-turn snapshot, not the newest, when a retry adds another for the same message', () => {
        const first = 'a'.repeat(40);
        const retry = 'b'.repeat(40);
        expect(resolveBaselineCommit(conversation([
            checkpoint('pre-1', 'pre-turn', 'u1', first),
            checkpoint('pre-1-retry', 'pre-turn', 'u1', retry),
        ]))).to.equal(first);
    });

    it('a rewind undo point of the first message is never the baseline, even when it is the only checkpoint', () => {
        expect(resolveBaselineCommit(conversation([checkpoint('undo-1', undefined, 'u1', 'e'.repeat(40))]))).to.equal(undefined);
    });

    it('ignores non pre-turn checkpoints such as rewind undo points', () => {
        const pre = 'c'.repeat(40);
        expect(resolveBaselineCommit(conversation([
            checkpoint('undo-1', undefined, 'u1', 'd'.repeat(40)),
            checkpoint('pre-1', 'pre-turn', 'u1', pre),
        ]))).to.equal(pre);
    });
});
