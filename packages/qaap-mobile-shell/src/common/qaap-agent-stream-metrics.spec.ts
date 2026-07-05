// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    QaapConversationStreamMetricsCollector,
    formatQaapStreamMetricsLog,
} from './qaap-agent-stream-metrics';

describe('QaapConversationStreamMetricsCollector', () => {
    const previous = process.env.QAAP_STREAM_METRICS;

    beforeEach(() => {
        process.env.QAAP_STREAM_METRICS = '1';
    });

    afterEach(() => {
        process.env.QAAP_STREAM_METRICS = previous;
    });

    it('summarizes events, bytes, and deltas for a streaming turn', () => {
        const collector = new QaapConversationStreamMetricsCollector('server');
        collector.setTransport('conv-1', 'ws');
        collector.recordWireEvent('conv-1', 'message_delta', {
            type: 'message_delta',
            conversationId: 'conv-1',
            delta: { kind: 'append_content', messageId: 'm1', text: 'hello' },
        });
        collector.recordWireEvent('conv-1', 'updated', {
            type: 'updated',
            conversation: { id: 'conv-1', status: 'idle' },
        });
        const snapshot = collector.finishTurn('conv-1');
        expect(snapshot).to.not.equal(undefined);
        expect(snapshot?.eventsTotal).to.equal(2);
        expect(snapshot?.messageDeltaEvents).to.equal(1);
        expect(snapshot?.updatedEvents).to.equal(1);
        expect(snapshot?.transport).to.equal('ws');
        expect(snapshot?.bytesTotal).to.be.greaterThan(0);
        expect(formatQaapStreamMetricsLog(snapshot!)).to.include('[Qaap stream metrics/server]');
    });

    it('records latency marks relative to submit click', () => {
        const collector = new QaapConversationStreamMetricsCollector('client');
        collector.recordLatencyMark('conv-1', 'ui_submit_clicked', 1_000);
        collector.recordLatencyMark('conv-1', 'optimistic_render_done', 1_016);
        collector.recordLatencyMark('conv-1', 'first_transcript_delta_rendered', 1_240);
        collector.recordWireEvent('conv-1', 'updated', {
            type: 'updated',
            conversation: { id: 'conv-1', status: 'idle' },
        });

        const snapshot = collector.finishTurn('conv-1');
        expect(snapshot?.latencyMarks.ui_submit_clicked).to.equal(0);
        expect(snapshot?.latencyMarks.optimistic_render_done).to.equal(16);
        expect(snapshot?.latencyMarks.first_transcript_delta_rendered).to.equal(240);
        expect(formatQaapStreamMetricsLog(snapshot!)).to.include('first_transcript_delta_rendered:240ms');
    });

    it('tracks the full submit-to-first-output latency chain', () => {
        const collector = new QaapConversationStreamMetricsCollector('server');
        const marks = [
            'ui_submit_clicked',
            'optimistic_render_done',
            'pre_post_get_start',
            'pre_post_get_end',
            'post_message_start',
            'post_message_end',
            'backend_user_message_persisted',
            'task_created',
            'build_agent_command_start',
            'build_agent_command_end',
            'spawn_start',
            'spawn_end',
            'first_stdout_chunk',
            'first_transcript_delta_rendered',
        ] as const;

        marks.forEach((mark, index) => {
            collector.recordLatencyMark('conv-1', mark, 10_000 + index * 10);
        });
        collector.recordWireEvent('conv-1', 'updated', {
            type: 'updated',
            conversation: { id: 'conv-1', status: 'idle' },
        });

        const snapshot = collector.finishTurn('conv-1');
        for (const [index, mark] of marks.entries()) {
            expect(snapshot?.latencyMarks[mark]).to.equal(index * 10);
        }
    });
});
