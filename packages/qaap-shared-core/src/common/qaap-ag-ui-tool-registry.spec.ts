// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { ToolRequest } from '@theia/ai-core/lib/common/language-model';
import {
    buildQaapAgUiToolCallResultEvent,
    isQaapFrontendAgUiTool,
    toQaapAgUiToolDefinitions,
} from './qaap-ag-ui-tool-registry';

describe('qaap-ag-ui-tool-registry', () => {
    const sampleTool: ToolRequest = {
        id: 'qaap_bootstrap_status',
        name: 'qaap_bootstrap_status',
        providerName: 'qaap',
        description: 'Bootstrap status',
        parameters: { type: 'object', properties: {} },
        handler: async () => '{"ok":true}',
    };

    it('toQaapAgUiToolDefinitions maps ToolRequest to AG-UI function tools', () => {
        expect(toQaapAgUiToolDefinitions([sampleTool])).to.deep.equal([{
            type: 'function',
            function: {
                name: 'qaap_bootstrap_status',
                description: 'Bootstrap status',
                parameters: { type: 'object', properties: {} },
            },
        }]);
    });

    it('isQaapFrontendAgUiTool detects qaap provider tools', () => {
        expect(isQaapFrontendAgUiTool([sampleTool], 'qaap_bootstrap_status')).to.equal(true);
        expect(isQaapFrontendAgUiTool([sampleTool], 'bash')).to.equal(false);
    });

    it('buildQaapAgUiToolCallResultEvent wraps results for the wire adapter', () => {
        expect(buildQaapAgUiToolCallResultEvent('call-1', 'done')).to.deep.equal({
            type: 'TOOL_CALL_RESULT',
            toolCallId: 'call-1',
            result: 'done',
        });
    });
});
