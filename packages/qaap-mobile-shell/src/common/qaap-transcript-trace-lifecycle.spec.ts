// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    agentMessageHasStructuredTrace,
    appendTraceBlockedEvent,
    appendTraceCheckpointEvent,
    appendTraceRunCancelledEvent,
    appendTraceVerificationWarningEvent,
    isPlaceholderAgentContent,
    syncSettledTraceEventsOnMessage,
} from './qaap-transcript-trace-lifecycle';
import type { QaapAgentMessageDTO } from './qaap-agent-conversation-client';

const agentMessage = (partial: Partial<QaapAgentMessageDTO> = {}): QaapAgentMessageDTO => ({
    id: 'agent-1',
    role: 'agent',
    content: '',
    createdAt: 1,
    ...partial,
});

describe('qaap-transcript-trace-lifecycle', () => {
    it('appendTraceRunCancelledEvent cancels in-flight tools and appends run_cancelled', () => {
        const next = appendTraceRunCancelledEvent(agentMessage({
            traceEvents: [{
                type: 'tool_call',
                id: 'tool-1',
                name: 'bash',
                args: '{}',
                status: 'running',
            }],
        }), { reason: 'Turn cancelled.' });
        expect(next.traceEvents?.[0]).to.include({ status: 'cancelled' });
        expect(next.traceEvents?.[1]).to.deep.include({
            type: 'run_cancelled',
            message: 'Turn cancelled.',
        });
    });

    it('appendTraceRunCancelledEvent is idempotent when cancel and task outcome race', () => {
        const once = appendTraceRunCancelledEvent(agentMessage(), {
            id: 'cancel-1',
            reason: 'Turn cancelled.',
            at: 10,
        });
        const twice = appendTraceRunCancelledEvent(once, {
            id: 'cancel-2',
            reason: 'Turn cancelled.',
            at: 20,
        });
        expect(twice.traceEvents?.filter(event => event.type === 'run_cancelled')).to.have.length(1);
        expect(twice.traceEvents?.[0]).to.deep.include({ id: 'cancel-1', startedAt: 10 });
    });

    it('appendTraceVerificationWarningEvent appends an error row without failing the turn', () => {
        const next = appendTraceVerificationWarningEvent(
            agentMessage({ content: 'done' }),
            'Verification checks are still failing after 2 fix attempts.',
        );
        expect(next.traceEvents).to.have.length(1);
        expect(next.traceEvents?.[0]).to.deep.include({
            type: 'error',
            message: 'Verification checks are still failing after 2 fix attempts.',
        });
        // Unlike a preview failure, the turn itself succeeded — message.error must stay unset.
        expect(next.error).to.equal(undefined);
        expect(next.content).to.equal('done');
    });

    it('appendTraceBlockedEvent appends an error row without failing the turn', () => {
        const next = appendTraceBlockedEvent(agentMessage({ content: 'done' }), 'Blocked — needs your input: which DB?');
        expect(next.traceEvents).to.have.length(1);
        expect(next.traceEvents?.[0]).to.deep.include({
            type: 'error',
            message: 'Blocked — needs your input: which DB?',
        });
        expect(next.error).to.equal(undefined);
    });

    it('appendTraceCheckpointEvent appends a checkpoint row once', () => {
        const checkpoint = {
            id: 'ckpt-1',
            messageId: 'user-1',
            label: 'Fix bug',
            commit: 'abc123',
            ref: 'refs/qaap/checkpoints/x',
            capturedAt: 99,
            added: 3,
            removed: 1,
        };
        const once = appendTraceCheckpointEvent(agentMessage(), checkpoint);
        const twice = appendTraceCheckpointEvent(once, checkpoint);
        expect(once.traceEvents).to.have.length(1);
        expect(twice.traceEvents).to.have.length(1);
        expect(once.traceEvents?.[0]).to.deep.include({
            type: 'checkpoint',
            label: 'Fix bug',
            added: 3,
            removed: 1,
        });
    });

    it('agentMessageHasStructuredTrace is true when traceEvents exist', () => {
        expect(agentMessageHasStructuredTrace(agentMessage({
            traceEvents: [{ type: 'assistant_text', id: 't1', content: 'hi', status: 'completed' }],
        }))).to.equal(true);
        expect(agentMessageHasStructuredTrace(agentMessage())).to.equal(false);
    });

    it('isPlaceholderAgentContent treats empty and ellipsis content as replayable', () => {
        expect(isPlaceholderAgentContent(undefined)).to.equal(true);
        expect(isPlaceholderAgentContent('')).to.equal(true);
        expect(isPlaceholderAgentContent('…')).to.equal(true);
        expect(isPlaceholderAgentContent('Done.')).to.equal(false);
    });

    it('syncSettledTraceEventsOnMessage clears streaming tail states', () => {
        const settled = syncSettledTraceEventsOnMessage(agentMessage({
            segments: [{ type: 'text', content: 'Done' }],
            traceEvents: [{
                type: 'assistant_text',
                id: 'text-0',
                content: 'Done',
                status: 'streaming',
            }],
        }));
        expect(settled.traceEvents?.[0]).to.deep.include({ status: 'completed' });
    });
});
