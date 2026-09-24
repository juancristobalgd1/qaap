// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { applyQaapJsonPatch } from './qaap-ag-ui-json-patch';
import {
    QAAP_AG_UI_AGENT_TRACE_ACTIVITY_TYPE,
    buildAgentMessageFromAgUiStructuredLog,
    createQaapAgUiTraceReducer,
    reduceQaapAgUiTranscriptEvent,
} from './qaap-ag-ui-transcript-adapter';

describe('qaap-ag-ui-json-patch', () => {
    it('applies add/replace/remove on nested objects and arrays', () => {
        const next = applyQaapJsonPatch({ events: [{ id: 't1', status: 'running' }] }, [
            { op: 'replace', path: '/events/0/status', value: 'completed' },
            { op: 'add', path: '/events/-', value: { id: 't2', status: 'running' } },
        ]);
        expect(next).to.deep.equal({
            events: [{ id: 't1', status: 'completed' }, { id: 't2', status: 'running' }],
        });
    });
});

describe('qaap-ag-ui-transcript-adapter', () => {
    const options = {
        agentMessageId: 'agent-1',
        createdAt: 1,
        agentId: 'qaiq',
    };

    it('reduceQaapAgUiTranscriptEvent emits message_start for the first TOOL_CALL_START', () => {
        const { delta } = reduceQaapAgUiTranscriptEvent(undefined, {
            type: 'TOOL_CALL_START',
            toolCallId: 'tool-1',
            toolCallName: 'Read',
        }, options);
        expect(delta.kind).to.equal('message_start');
        if (delta.kind === 'message_start') {
            expect(delta.message.traceEvents?.[0]).to.deep.equal({
                type: 'tool_call',
                id: 'tool-1',
                name: 'Read',
                args: '',
                status: 'running',
            });
        }
    });

    it('reduceQaapAgUiTranscriptEvent emits patch_trace_event for TOOL_CALL_RESULT', () => {
        let state = createQaapAgUiTraceReducer('agent-1');
        ({ next: state } = reduceQaapAgUiTranscriptEvent(state, {
            type: 'TOOL_CALL_START',
            toolCallId: 'tool-1',
            toolCallName: 'Bash',
        }, options));
        const { delta } = reduceQaapAgUiTranscriptEvent(state, {
            type: 'TOOL_CALL_RESULT',
            toolCallId: 'tool-1',
            result: 'ok',
        }, options);
        expect(delta).to.deep.equal({
            kind: 'patch_trace_event',
            messageId: 'agent-1',
            eventId: 'tool-1',
            resultAppend: 'ok',
            resultBaseLength: 0,
            status: 'completed',
        });
    });

    it('maps ActivitySnapshot qaap-agent-trace to traceEvents', () => {
        const { next, delta } = reduceQaapAgUiTranscriptEvent(undefined, {
            type: 'ACTIVITY_SNAPSHOT',
            messageId: 'activity-1',
            activityType: QAAP_AG_UI_AGENT_TRACE_ACTIVITY_TYPE,
            content: {
                events: [{
                    type: 'tool_call',
                    id: 'tool-9',
                    name: 'Glob',
                    args: '*.ts',
                    status: 'running',
                }],
            },
        }, options);
        expect(next.traceEvents).to.have.length(1);
        expect(delta.kind).to.equal('message_start');
    });

    it('maps ActivityDelta JSON patch onto qaap-agent-trace activity', () => {
        let state = createQaapAgUiTraceReducer('agent-1');
        ({ next: state } = reduceQaapAgUiTranscriptEvent(state, {
            type: 'ACTIVITY_SNAPSHOT',
            messageId: 'activity-1',
            activityType: QAAP_AG_UI_AGENT_TRACE_ACTIVITY_TYPE,
            content: {
                events: [{
                    type: 'tool_call',
                    id: 'tool-9',
                    name: 'Glob',
                    args: '*.ts',
                    status: 'running',
                }],
            },
        }, options));
        const { next, delta } = reduceQaapAgUiTranscriptEvent(state, {
            type: 'ACTIVITY_DELTA',
            messageId: 'activity-1',
            activityType: QAAP_AG_UI_AGENT_TRACE_ACTIVITY_TYPE,
            patch: [{ op: 'replace', path: '/events/0/status', value: 'completed' }],
        }, options);
        expect(next.traceEvents[0]).to.deep.equal({
            type: 'tool_call',
            id: 'tool-9',
            name: 'Glob',
            args: '*.ts',
            status: 'completed',
        });
        expect(delta.kind).to.equal('patch_trace_event');
    });

    it('patchTraceToolCall keeps reducer identity for empty TOOL_CALL_ARGS deltas', () => {
        let state = createQaapAgUiTraceReducer('agent-1');
        ({ next: state } = reduceQaapAgUiTranscriptEvent(state, {
            type: 'TOOL_CALL_START',
            toolCallId: 'tool-1',
            toolCallName: 'Read',
        }, options));
        const patched = reduceQaapAgUiTranscriptEvent(state, {
            type: 'TOOL_CALL_ARGS',
            toolCallId: 'tool-1',
            delta: '',
        }, options);
        expect(patched.next).to.equal(state);
        expect(patched.delta.kind).to.equal('noop');
    });

    it('buildAgentMessageFromAgUiStructuredLog replays mock QAIQ assistant NDJSON', () => {
        const log = [
            '{"type":"system","subtype":"init","cwd":"/tmp/ws","session_id":"mock","tools":["Write"],"model":"mock"}',
            '{"type":"assistant","timestamp_ms":1,"message":{"content":[{"type":"thinking","thinking":"Plan"}]}}',
            '{"type":"assistant","timestamp_ms":2,"message":{"content":[{"type":"tool_use","id":"tu1","name":"Write","input":{"file_path":"index.html"}}]}}',
            '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu1","content":"ok"}]}}',
            '{"type":"assistant","timestamp_ms":3,"message":{"content":[{"type":"text","text":"Hecho."}]}}',
        ].join('\n');
        const message = buildAgentMessageFromAgUiStructuredLog('qaiq', 'agent-1', 1, log);
        expect(message?.content).to.equal('Hecho.');
        expect(message?.traceEvents?.some(event => event.type === 'tool_call' && event.name === 'Write')).to.equal(true);
    });
});
