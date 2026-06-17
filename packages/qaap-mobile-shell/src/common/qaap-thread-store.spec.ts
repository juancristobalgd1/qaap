// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    computeSummaryChangedFields,
    isPreviewOnlySummaryChange,
    streamingSortOrderMayChange,
} from './qaap-conversation-change';
import type { QaapAgentConversationSummaryDTO } from './qaap-agent-conversation-client';
import { QaapThreadStore, sortConversationSummaries } from './qaap-thread-store';

function summary(overrides: Partial<QaapAgentConversationSummaryDTO> = {}): QaapAgentConversationSummaryDTO {
    return {
        id: 'conv-1',
        cwd: '/workspace/demo',
        agentId: 'qaiq',
        title: 'Demo',
        status: 'idle',
        createdAt: 1,
        updatedAt: 1,
        messageCount: 1,
        ...overrides,
    };
}

describe('qaap-conversation-change', () => {
    it('computeSummaryChangedFields detects preview-only deltas', () => {
        const previous = summary({ lastMessagePreview: 'hello', turnProgressCurrent: 1 });
        const next = summary({ lastMessagePreview: 'hello world', turnProgressCurrent: 2, updatedAt: 2 });
        const fields = computeSummaryChangedFields(previous, next);
        expect(fields).to.include.members(['lastMessagePreview', 'turnProgress', 'updatedAt']);
        expect(isPreviewOnlySummaryChange(fields)).to.equal(true);
    });

    it('streamingSortOrderMayChange is true when status flips', () => {
        expect(streamingSortOrderMayChange(summary({ status: 'idle' }), summary({ status: 'streaming' }))).to.equal(true);
        expect(streamingSortOrderMayChange(
            summary({ lastMessagePreview: 'a' }),
            summary({ lastMessagePreview: 'b' }),
        )).to.equal(false);
    });
});

describe('qaap-thread-store', () => {
    it('sortConversationSummaries keeps streaming threads above idle', () => {
        const sorted = sortConversationSummaries([
            summary({ id: 'idle', status: 'idle', updatedAt: 10 }),
            summary({ id: 'live', status: 'streaming', updatedAt: 1 }),
        ]);
        expect(sorted.map(entry => entry.id)).to.deep.equal(['live', 'idle']);
    });

    it('applyWireDelta patches a cached document message', () => {
        const store = new QaapThreadStore();
        store.setDocument({
            id: 'conv-1',
            cwd: '/workspace/demo',
            agentId: 'qaiq',
            title: 'Demo',
            status: 'streaming',
            createdAt: 1,
            updatedAt: 1,
            messages: [{
                id: 'agent-1',
                role: 'agent',
                content: '',
                createdAt: 1,
                traceEvents: [{
                    type: 'assistant_text',
                    id: 'text-1',
                    content: 'hi',
                    status: 'streaming',
                }],
            }],
        });
        const next = store.applyWireDelta('conv-1', 'agent-1', {
            kind: 'patch_trace_event',
            messageId: 'agent-1',
            eventId: 'text-1',
            contentAppend: '!',
            status: 'streaming',
        });
        expect(next?.messages[0].traceEvents?.[0]).to.deep.equal({
            type: 'assistant_text',
            id: 'text-1',
            content: 'hi!',
            status: 'streaming',
        });
    });

    it('getVariantsForBaseCwd groups parallel-run threads under the base repo', () => {
        const store = new QaapThreadStore();
        store.applySummarySnapshot([
            {
                cwd: '/tmp/qaap-parallel-abc',
                conversations: [
                    summary({
                        id: 'variant',
                        cwd: '/tmp/qaap-parallel-abc',
                        parallelBaseCwd: '/workspace/demo',
                        title: 'Variant',
                    }),
                ],
            },
            {
                cwd: '/workspace/demo',
                conversations: [summary({ id: 'main', cwd: '/workspace/demo' })],
            },
        ]);
        expect(store.getVariantsForBaseCwd('/workspace/demo').map(entry => entry.id)).to.deep.equal(['variant']);
        expect(store.getSummariesForCwd('/workspace/demo').map(entry => entry.id)).to.deep.equal(['main']);
    });

    it('subscribe selector skips duplicate emissions', () => {
        const store = new QaapThreadStore();
        store.upsertSummary(summary());
        let calls = 0;
        const disposable = store.subscribe(
            () => { calls++; },
            snapshot => snapshot.summariesById.get('conv-1')?.title,
            'conv-1',
        );
        store.upsertSummary(summary({ title: 'Renamed' }));
        store.upsertSummary(summary({ title: 'Renamed' }));
        disposable.dispose();
        expect(calls).to.equal(2);
    });
});
