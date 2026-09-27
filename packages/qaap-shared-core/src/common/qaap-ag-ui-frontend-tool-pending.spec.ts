// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    collectQaapFrontendToolNames,
    findPendingQaapFrontendToolCalls,
} from './qaap-ag-ui-frontend-tool-pending';

describe('qaap-ag-ui-frontend-tool-pending', () => {
    const names = collectQaapFrontendToolNames([{
        function: { name: 'qaap_bootstrap_status' },
    }]);

    it('finds trace tool calls awaiting a browser result', () => {
        const pending = findPendingQaapFrontendToolCalls({
            id: 'a1',
            role: 'agent',
            content: '',
            createdAt: 1,
            traceEvents: [{
                type: 'tool_call',
                id: 'tool-1',
                name: 'qaap_bootstrap_status',
                args: '{}',
                status: 'running',
            }],
        }, names);
        expect(pending).to.deep.equal([{
            toolCallId: 'tool-1',
            name: 'qaap_bootstrap_status',
            args: '{}',
        }]);
    });

    it('ignores tools that already have results', () => {
        const pending = findPendingQaapFrontendToolCalls({
            id: 'a1',
            role: 'agent',
            content: '',
            createdAt: 1,
            traceEvents: [{
                type: 'tool_call',
                id: 'tool-1',
                name: 'qaap_bootstrap_status',
                args: '{}',
                status: 'completed',
                result: 'ok',
            }],
        }, names);
        expect(pending).to.have.length(0);
    });
});
