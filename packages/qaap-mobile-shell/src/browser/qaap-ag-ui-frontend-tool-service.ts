// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { ToolInvocationRegistry } from '@theia/ai-core/lib/common/tool-invocation-registry';
import type { QaapAgUiEvent } from '../common/qaap-ag-ui-transcript-adapter';
import { normalizeQaapAgUiEventType } from '../common/qaap-ag-ui-transcript-adapter';
import {
    buildQaapAgUiToolCallResultEvent,
    executeQaapAgUiFrontendTool,
    isQaapFrontendAgUiTool,
    resolveQaapAgUiToolByName,
    toQaapAgUiToolDefinitions,
    type QaapAgUiToolDefinition,
} from '../common/qaap-ag-ui-tool-registry';
import { postAgUiTranscriptEvent } from '../common/qaap-agent-conversation-client';

/** Exposes Work Hub frontend tools to AG-UI RunAgentInput and executes client-side tool calls. */
@injectable()
export class QaapAgUiFrontendToolService {

    @inject(ToolInvocationRegistry)
    protected readonly tools: ToolInvocationRegistry;

    listToolDefinitions(): QaapAgUiToolDefinition[] {
        return toQaapAgUiToolDefinitions(this.tools.getAllFunctions());
    }

    listFrontendToolDefinitions(): QaapAgUiToolDefinition[] {
        return toQaapAgUiToolDefinitions(
            this.tools.getAllFunctions().filter(tool => isQaapFrontendAgUiTool([tool], tool.name)),
        );
    }

    async executeFrontendToolCall(toolName: string, argsJson: string): Promise<string | undefined> {
        const tool = resolveQaapAgUiToolByName(this.tools.getAllFunctions(), toolName);
        if (!tool || !isQaapFrontendAgUiTool([tool], tool.name)) {
            return undefined;
        }
        return executeQaapAgUiFrontendTool(tool, argsJson);
    }

    /**
     * When an AG-UI provider emits TOOL_CALL_END for a Qaap frontend tool, run it locally and
     * push TOOL_CALL_RESULT back into the open conversation via the VPS store.
     */
    async maybeHandleFrontendToolEnd(
        conversationId: string,
        event: QaapAgUiEvent,
        argsByToolCallId: Readonly<Record<string, string>>,
    ): Promise<boolean> {
        const type = normalizeQaapAgUiEventType(String(event.type ?? ''));
        if (type !== 'TOOL_CALL_END') {
            return false;
        }
        const toolCallId = readAgUiString(event, 'toolCallId', 'tool_call_id');
        const toolName = readAgUiString(event, 'toolCallName', 'tool_call_name', 'name');
        if (!toolCallId || !toolName) {
            return false;
        }
        const result = await this.executeFrontendToolCall(toolName, argsByToolCallId[toolCallId] ?? '{}');
        if (result === undefined) {
            return false;
        }
        await postAgUiTranscriptEvent(conversationId, buildQaapAgUiToolCallResultEvent(toolCallId, result));
        return true;
    }
}

function readAgUiString(event: QaapAgUiEvent, ...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = event[key];
        if (typeof value === 'string' && value.length > 0) {
            return value;
        }
    }
    return undefined;
}
