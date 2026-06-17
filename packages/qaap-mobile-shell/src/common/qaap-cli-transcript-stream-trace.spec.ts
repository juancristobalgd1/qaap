// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapCodexStreamAccumulator } from './qaap-codex-stream';
import { getAccumulatorTraceEvents, mergeAccumulatorTraceEvents } from './qaap-cli-transcript-stream';
import { QaapQaiqStreamAccumulator } from './qaap-qaiq-stream';

describe('qaap-cli-transcript-stream trace', () => {
    it('getAccumulatorTraceEvents exposes streaming tail states from QAIQ segments', () => {
        const acc = new QaapQaiqStreamAccumulator();
        acc.push(`${JSON.stringify({
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'Hi' }] },
        })}\n`);
        const events = getAccumulatorTraceEvents(acc);
        expect(events).to.have.length(1);
        expect(events[0]).to.deep.include({ type: 'assistant_text', status: 'streaming' });
    });

    it('mergeAccumulatorTraceEvents preserves checkpoint lifecycle rows', () => {
        const acc = new QaapCodexStreamAccumulator();
        acc.push('{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Done."}}\n');
        const merged = mergeAccumulatorTraceEvents([
            {
                type: 'checkpoint',
                id: 'cp-1',
                label: 'Saved',
                commit: 'abc',
                capturedAt: 1,
            },
        ], acc);
        expect(merged.at(-1)).to.deep.include({ type: 'checkpoint', id: 'cp-1' });
    });
});
