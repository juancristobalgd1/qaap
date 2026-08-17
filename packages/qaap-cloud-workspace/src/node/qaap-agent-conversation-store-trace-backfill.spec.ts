// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { materializeAgentMessageForApi } from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-trace-backfill';
import { backfillAgentMessageFromStructuredLogExtracted } from './qaap-agent-conversation-store-activity2';
import { parseStructuredLog } from './qaap-agent-conversation-store-helpers';
import { resolveStructuredParsedTraceEvents } from './qaap-agent-conversation-store-utils';
import type { QaapAgentMessage } from '../common/qaap-agent-conversation';

const QAIQ_TOOL_LOG = [
    '{"type":"assistant","timestamp_ms":1,"message":{"content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"a.ts"}}]}}',
    '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}',
    '{"type":"assistant","timestamp_ms":2,"message":{"content":[{"type":"text","text":"Done."}]}}',
].join('\n');

describe('QA-003 backfill placeholder agent rows from structured logs', () => {

    const ctx = {
        parseStructuredLog,
        resolveStructuredParsedTraceEvents,
    };

    it('replays QAIQ tool segments when the agent row only has placeholder content', () => {
        const message: QaapAgentMessage = {
            id: 'a1',
            role: 'agent',
            content: '…',
            createdAt: 1,
        };
        const next = backfillAgentMessageFromStructuredLogExtracted(ctx, message, 'qaiq', QAIQ_TOOL_LOG);
        const materialized = materializeAgentMessageForApi(next);
        expect(materialized.traceEvents?.length ?? 0).to.be.greaterThan(0);
        expect((materialized.segments ?? []).some(segment => segment.type === 'tool' && segment.name === 'Read'))
            .to.equal(true);
    });

    it('does not clobber a row that already has real content', () => {
        const message: QaapAgentMessage = {
            id: 'a1',
            role: 'agent',
            content: 'Already answered.',
            createdAt: 1,
        };
        const next = backfillAgentMessageFromStructuredLogExtracted(ctx, message, 'qaiq', QAIQ_TOOL_LOG);
        expect(next).to.equal(message);
    });
});
