// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentMessageDTO } from './qaap-agent-conversation-client';
import {
    findQaapClosingReport,
    isQaapClosingReportTraceEvent,
    mergeSegmentTraceEvents,
    sanitizeQaapTraceEchoes,
    traceEventsToSegments,
    type QaapTranscriptTraceEventDTO,
} from './qaap-transcript-trace-model';

function message(traceEvents: QaapTranscriptTraceEventDTO[]): QaapAgentMessageDTO {
    return { id: 'm1', content: '', traceEvents } as QaapAgentMessageDTO;
}

/** One save/load cycle: the segment-derived rows are merged back over the stored trace. */
function roundTrip(events: readonly QaapTranscriptTraceEventDTO[]): QaapTranscriptTraceEventDTO[] {
    return mergeSegmentTraceEvents(events, traceEventsToSegments(events));
}

describe('qaap-transcript-trace-model closing reports', () => {
    describe('traceEventsToSegments', () => {
        it('drops a closing-report error event', () => {
            const segments = traceEventsToSegments([{ type: 'error', id: 'closing-report-1', message: 'Blocked — needs your input: x' }]);
            expect(segments).to.deep.equal([]);
        });

        it('treats the legacy blocked-signal note as a closing report, echoes included', () => {
            const blocked: QaapTranscriptTraceEventDTO = { type: 'error', id: 'blocked-1', message: 'Blocked — needs your input: x' };
            const echo: QaapTranscriptTraceEventDTO = { type: 'assistant_text', id: 'text-0', content: 'Error: Blocked — needs your input: x', status: 'completed' };
            expect(isQaapClosingReportTraceEvent(blocked)).to.equal(true);
            expect(traceEventsToSegments([echo, echo, blocked])).to.deep.equal([]);
            expect(findQaapClosingReport(message([echo, blocked]))).to.equal('Blocked — needs your input: x');
        });

        it('keeps a normal error event as an error text segment', () => {
            const segments = traceEventsToSegments([{ type: 'error', id: 'error-1', message: 'boom' }]);
            expect(segments).to.deep.equal([{ type: 'text', content: 'Error: boom' }]);
        });

        it('strips machine sentinels from assistant text', () => {
            const segments = traceEventsToSegments([{ type: 'assistant_text', id: 'text-1', content: '@@QAAP:BLOCKED@@ hola', status: 'completed' }]);
            expect(segments).to.deep.equal([{ type: 'text', content: 'hola' }]);
        });

        it('drops assistant text that is only a sentinel', () => {
            const segments = traceEventsToSegments([{ type: 'assistant_text', id: 'text-1', content: '@@QAAP:BLOCKED@@', status: 'completed' }]);
            expect(segments).to.deep.equal([]);
        });
    });

    describe('segment round-trip idempotence', () => {
        it('keeps a closing report stable over repeated saves', () => {
            let events: QaapTranscriptTraceEventDTO[] = [
                { type: 'assistant_text', id: 'text-0', content: 'hola', status: 'completed' },
                { type: 'error', id: 'closing-report-1', message: 'Blocked — needs your input: X' },
            ];
            for (let save = 0; save < 2; save++) {
                events = roundTrip(events);
                expect(events).to.have.length(2);
            }
            expect(events.some(event => isQaapClosingReportTraceEvent(event))).to.equal(true);
            expect(events.some(event => event.type === 'assistant_text' && event.content.startsWith('Error:'))).to.equal(false);
        });

        it('keeps a non-closing error as one error row and no growing echo text', () => {
            let events: QaapTranscriptTraceEventDTO[] = [
                { type: 'assistant_text', id: 'text-0', content: 'hola', status: 'completed' },
                { type: 'error', id: 'preview-failed-1', message: 'boom' },
            ];
            for (let save = 0; save < 2; save++) {
                events = roundTrip(events);
                expect(events).to.have.length(2);
            }
            expect(events.filter(event => event.type === 'error')).to.have.length(1);
            const texts = events.flatMap(event => event.type === 'assistant_text' ? [event.content] : []);
            expect(texts).to.deep.equal(['hola']);
        });
    });

    describe('sanitizeQaapTraceEchoes', () => {
        it('removes error echoes and closing-outcome echoes, keeping real text and the closing report', () => {
            const realText: QaapTranscriptTraceEventDTO = { type: 'assistant_text', id: 'text-0', content: 'texto real', status: 'completed' };
            const closing: QaapTranscriptTraceEventDTO = { type: 'error', id: 'closing-report-1', message: 'Blocked — needs your input: X' };
            const echoes: QaapTranscriptTraceEventDTO[] = [0, 1, 2, 3, 4].map(index => ({
                type: 'assistant_text' as const,
                id: `text-echo-${index}`,
                content: 'Error: Blocked — needs your input: X',
                status: 'completed' as const,
            }));
            const input = [...echoes, realText, closing];
            expect(sanitizeQaapTraceEchoes(input)).to.deep.equal([realText, closing]);
            expect(input).to.have.length(7);
        });

        it('keeps ordinary assistant text that merely starts with "Error"', () => {
            const ordinary: QaapTranscriptTraceEventDTO = { type: 'assistant_text', id: 'text-0', content: 'Error handling is fine', status: 'completed' };
            const closing: QaapTranscriptTraceEventDTO = { type: 'error', id: 'closing-report-1', message: 'Blocked — needs your input: X' };
            expect(sanitizeQaapTraceEchoes([ordinary, closing])).to.deep.equal([ordinary, closing]);
        });
    });

    describe('findQaapClosingReport', () => {
        it('returns the most recent closing report', () => {
            const report = findQaapClosingReport(message([
                { type: 'error', id: 'closing-report-1', message: 'Done.' },
                { type: 'error', id: 'error-2', message: 'not a report' },
                { type: 'error', id: 'closing-report-3', message: 'Blocked — needs your input: y' },
            ]));
            expect(report).to.equal('Blocked — needs your input: y');
        });

        it('returns undefined when there is no closing report', () => {
            expect(findQaapClosingReport(message([{ type: 'error', id: 'error-1', message: 'boom' }]))).to.equal(undefined);
            expect(findQaapClosingReport(undefined)).to.equal(undefined);
        });
    });
});
