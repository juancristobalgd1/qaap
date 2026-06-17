// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentMessageDTO } from './qaap-agent-conversation-client';
import {
    hasActiveQaapTraceWork,
    resolveQaapTranscriptTrace,
} from './qaap-transcript-trace-model';

const agentMessage = (partial: Partial<QaapAgentMessageDTO>): QaapAgentMessageDTO => ({
    id: 'a1',
    role: 'agent',
    content: '',
    createdAt: 1,
    ...partial,
});

describe('qaap-transcript-trace-model', () => {
    it('prefers structured traceEvents over content and legacy segments', () => {
        const trace = resolveQaapTranscriptTrace(agentMessage({
            content: '[thinking] raw legacy text',
            segments: [{ type: 'text', content: 'legacy segment' }],
            traceEvents: [{
                type: 'tool_call',
                id: 'tool-1',
                name: 'Bash',
                args: '{"command":"npm test"}',
                status: 'running',
            }],
        }), { agentId: 'qaiq', allowLegacyContentParse: true });

        expect(trace.source).to.equal('trace-events');
        expect(trace.segments).to.deep.equal([{
            type: 'tool',
            toolUseId: 'tool-1',
            name: 'Bash',
            args: '{"command":"npm test"}',
            finished: false,
        }]);
    });

    it('detects active work from traceEvents without reading content', () => {
        expect(hasActiveQaapTraceWork(agentMessage({
            traceEvents: [{
                type: 'tool_call',
                id: 'tool-1',
                name: 'Read',
                args: '{}',
                status: 'running',
            }],
        }))).to.equal(true);
        expect(hasActiveQaapTraceWork(agentMessage({
            traceEvents: [{
                type: 'assistant_text',
                id: 'text-1',
                content: 'Done',
                status: 'completed',
            }],
        }))).to.equal(false);
    });
});
