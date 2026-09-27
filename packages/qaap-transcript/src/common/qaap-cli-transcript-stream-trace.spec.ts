// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapCodexStreamAccumulator } from '@theia/qaap-shared-core/lib/common/qaap-codex-stream';
import { mergeAccumulatorTraceEvents } from '@theia/qaap-shared-core/lib/common/qaap-cli-transcript-stream';

describe('qaap-cli-transcript-stream trace', () => {
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
