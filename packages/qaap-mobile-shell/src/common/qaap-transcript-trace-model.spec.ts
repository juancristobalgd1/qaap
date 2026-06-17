// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { mergeSegmentTraceEvents } from './qaap-transcript-trace-model';

describe('qaap-transcript-trace-model', () => {
    it('mergeSegmentTraceEvents keeps lifecycle rows after segment sync', () => {
        const merged = mergeSegmentTraceEvents([
            {
                type: 'tool_call',
                id: 'tool-1',
                name: 'bash',
                args: '{}',
                status: 'running',
            },
            {
                type: 'checkpoint',
                id: 'cp-1',
                label: 'Saved',
                commit: 'abc',
                capturedAt: 1,
            },
        ], [
            {
                type: 'tool',
                toolUseId: 'tool-1',
                name: 'bash',
                args: '{}',
                finished: true,
                result: 'ok',
            },
        ]);
        expect(merged).to.have.length(2);
        expect(merged[0]).to.deep.include({ type: 'tool_call', id: 'tool-1', status: 'completed' });
        expect(merged[1]).to.deep.include({ type: 'checkpoint', id: 'cp-1' });
    });
});
