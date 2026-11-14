// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentMessageDTO } from './qaap-agent-conversation-client';
import { backfillAgentMessageTraceEvents, materializeAgentMessageForApi } from './qaap-transcript-trace-backfill';
import type { QaapTranscriptTraceEventDTO } from './qaap-transcript-trace-model';

describe('qaap-transcript-trace-backfill echo sanitizing', () => {
    it('strips legacy error echoes from a poisoned trace and reports the message as changed', () => {
        const realText: QaapTranscriptTraceEventDTO = { type: 'assistant_text', id: 'text-0', content: 'texto real', status: 'completed' };
        const closing: QaapTranscriptTraceEventDTO = { type: 'error', id: 'closing-report-1', message: 'Blocked — needs your input: X' };
        const echoes: QaapTranscriptTraceEventDTO[] = [0, 1, 2, 3, 4].map(index => ({
            type: 'assistant_text' as const,
            id: `text-echo-${index}`,
            content: 'Error: Blocked — needs your input: X',
            status: 'completed' as const,
        }));
        const message = {
            id: 'm1',
            role: 'agent',
            content: '',
            traceEvents: [...echoes, realText, closing],
        } as unknown as QaapAgentMessageDTO;

        const result = backfillAgentMessageTraceEvents(message);

        expect(result.changed).to.equal(true);
        expect(result.message.traceEvents).to.deep.equal([realText, closing]);
    });

    it('keeps persisted segments when the trace only has lifecycle events', () => {
        const message: QaapAgentMessageDTO = {
            id: 'a1',
            role: 'agent',
            content: 'respuesta real',
            createdAt: 1,
            segments: [{ type: 'text', content: 'respuesta real' }],
            traceEvents: [{ type: 'error', id: 'preview-failed-1', message: 'boom', startedAt: 1 }],
        };
        const materialized = materializeAgentMessageForApi(message);
        expect(materialized.segments).to.deep.equal([{ type: 'text', content: 'respuesta real' }]);
    });
});
