// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO } from './qaap-agent-conversation-client';
import {
    annotateTranscriptActivityCheckpointIds,
    canRestoreConversationCheckpoint,
    resolveLatestRestorableCheckpoint,
} from './qaap-transcript-checkpoint-restore';

const conv = (
    overrides: Partial<Pick<QaapAgentConversationDTO, 'status' | 'checkpoints'>>,
): Pick<QaapAgentConversationDTO, 'status' | 'checkpoints'> => ({
    status: 'idle',
    checkpoints: [],
    ...overrides,
});

describe('qaap-transcript-checkpoint-restore', () => {

    it('resolveLatestRestorableCheckpoint returns the newest checkpoint with a commit', () => {
        const latest = resolveLatestRestorableCheckpoint(conv({
            checkpoints: [
                { id: 'c1', messageId: 'u1', label: 'Turn 1', commit: 'aaa', ref: 'r1', capturedAt: 1 },
                { id: 'c2', messageId: 'u2', label: 'Turn 2', commit: 'bbb', ref: 'r2', capturedAt: 2 },
            ],
        }));
        expect(latest?.id).to.equal('c2');
    });

    it('resolveLatestRestorableCheckpoint skips streaming conversations', () => {
        expect(resolveLatestRestorableCheckpoint(conv({
            status: 'streaming',
            checkpoints: [
                { id: 'c1', messageId: 'u1', label: 'Turn 1', commit: 'aaa', ref: 'r1', capturedAt: 1 },
            ],
        }))).to.equal(undefined);
    });

    it('canRestoreConversationCheckpoint validates checkpoint id and commit', () => {
        const conversation = conv({
            checkpoints: [
                { id: 'c1', messageId: 'u1', label: 'Turn 1', commit: 'aaa', ref: 'r1', capturedAt: 1 },
            ],
        });
        expect(canRestoreConversationCheckpoint(conversation, 'c1')).to.equal(true);
        expect(canRestoreConversationCheckpoint(conversation, 'missing')).to.equal(false);
        expect(canRestoreConversationCheckpoint(conv({ status: 'streaming' }), 'c1')).to.equal(false);
    });

    it('annotateTranscriptActivityCheckpointIds attaches prior checkpoint to error rows', () => {
        const conversation = conv({
            checkpoints: [
                { id: 'c1', messageId: 'u1', label: 'Turn 1', commit: 'aaa', ref: 'r1', capturedAt: 10 },
                { id: 'c2', messageId: 'u2', label: 'Turn 2', commit: 'bbb', ref: 'r2', capturedAt: 20 },
            ],
        });
        const annotated = annotateTranscriptActivityCheckpointIds([
            { state: 'success', checkpointId: 'c1' },
            { state: 'error', errorSummary: 'Tool failed', timestamp: 15 },
            { state: 'success', checkpointId: 'c2' },
            { state: 'error', errorSummary: 'Later failure', timestamp: 25 },
        ], conversation);
        expect(annotated[1]?.checkpointId).to.equal('c1');
        expect(annotated[3]?.checkpointId).to.equal('c2');
    });
});
