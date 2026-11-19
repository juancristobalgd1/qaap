// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveTaskBaselineCommit, resolveTurnCheckpointStats, type QaapTurnDiffConversationLike } from './qaap-turn-diff-stats';

const conversation: QaapTurnDiffConversationLike = {
    messages: [
        { id: 'u1', role: 'user' },
        { id: 'a1', role: 'agent' },
        { id: 'u2', role: 'user' },
        { id: 'a2', role: 'agent' },
    ],
    checkpoints: [
        { messageId: 'u1', commit: 'base', kind: 'pre-turn' },
        { messageId: 'u1', commit: 'turn1', added: 3, removed: 2 },
        { messageId: 'u2', commit: 'before2', kind: 'pre-turn' },
        { messageId: 'u2', commit: 'turn2', added: 4, removed: 0 },
    ],
};

describe('qaap-turn-diff-stats', () => {
    describe('resolveTaskBaselineCommit', () => {
        it('is the first pre-turn snapshot of the first user message, the same rule as the backend', () => {
            expect(resolveTaskBaselineCommit(conversation)).to.equal('base');
        });

        it('is undefined when the first user message has no pre-turn snapshot', () => {
            expect(resolveTaskBaselineCommit({ messages: [{ id: 'u1', role: 'user' }], checkpoints: [] })).to.equal(undefined);
            expect(resolveTaskBaselineCommit({ messages: [], checkpoints: [] })).to.equal(undefined);
        });
    });

    describe('resolveTurnCheckpointStats', () => {
        it('reads the turn\'s own totals from the post-turn checkpoint of the user message before its reply', () => {
            expect(resolveTurnCheckpointStats(conversation, 'a1')).to.deep.equal({ added: 3, removed: 2 });
            expect(resolveTurnCheckpointStats(conversation, 'a2')).to.deep.equal({ added: 4, removed: 0 });
        });

        it('never reads a pre-turn snapshot as the turn\'s totals', () => {
            const onlyPreTurn: QaapTurnDiffConversationLike = {
                messages: [{ id: 'u1', role: 'user' }, { id: 'a1', role: 'agent' }],
                checkpoints: [{ messageId: 'u1', commit: 'before', kind: 'pre-turn' }],
            };
            expect(resolveTurnCheckpointStats(onlyPreTurn, 'a1')).to.equal(undefined);
        });

        it('takes the last settled checkpoint when a turn was retried', () => {
            const retried: QaapTurnDiffConversationLike = {
                messages: [{ id: 'u1', role: 'user' }, { id: 'a1', role: 'agent' }],
                checkpoints: [
                    { messageId: 'u1', commit: 'x', added: 1, removed: 0 },
                    { messageId: 'u1', commit: 'y', added: 5, removed: 1 },
                ],
            };
            expect(resolveTurnCheckpointStats(retried, 'a1')).to.deep.equal({ added: 5, removed: 1 });
        });

        it('is undefined for an unknown agent message', () => {
            expect(resolveTurnCheckpointStats(conversation, 'missing')).to.equal(undefined);
        });
    });
});
