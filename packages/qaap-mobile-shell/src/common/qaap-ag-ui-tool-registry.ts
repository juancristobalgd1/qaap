// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { ToolRequest } from '@theia/ai-core/lib/common/language-model';

/** AG-UI tool definition shape for RunAgentInput.tools (OpenAI-compatible JSON schema). */
export interface QaapAgUiToolDefinition {
    readonly type: 'function';
    readonly function: {
        readonly name: string;
        readonly description?: string;
        readonly parameters: ToolRequest['parameters'];
    };
}

/** Serialize Theia {@link ToolRequest}s into AG-UI / OpenAI function tool definitions. */
export function toQaapAgUiToolDefinitions(tools: readonly ToolRequest[]): QaapAgUiToolDefinition[] {
    return tools.map(tool => ({
        type: 'function',
        function: {
            name: tool.name,
            ...(tool.description ? { description: tool.description } : {}),
            parameters: tool.parameters ?? { type: 'object', properties: {} },
        },
    }));
}

export function resolveQaapAgUiToolByName(
    tools: readonly ToolRequest[],
    toolName: string,
): ToolRequest | undefined {
    return tools.find(tool => tool.name === toolName || tool.id === toolName);
}

/** Execute a registered frontend tool and return the string result for AG-UI TOOL_CALL_RESULT. */
export async function executeQaapAgUiFrontendTool(
    tool: ToolRequest,
    argsJson: string,
): Promise<string> {
    const result = await tool.handler(argsJson);
    if (typeof result === 'string') {
        return result;
    }
    if (result && typeof result === 'object' && 'content' in result) {
        const content = (result as { content?: unknown }).content;
        return typeof content === 'string' ? content : JSON.stringify(content ?? result);
    }
    return JSON.stringify(result ?? '');
}

/** Build a TOOL_CALL_RESULT AG-UI event after a frontend tool finishes. */
export function buildQaapAgUiToolCallResultEvent(
    toolCallId: string,
    result: string,
): Record<string, unknown> {
    return {
        type: 'TOOL_CALL_RESULT',
        toolCallId,
        result,
    };
}

/** True when the tool name resolves to a Qaap frontend {@link ToolProvider} entry. */
export function isQaapFrontendAgUiTool(
    tools: readonly ToolRequest[],
    toolName: string,
): boolean {
    const tool = resolveQaapAgUiToolByName(tools, toolName);
    return !!tool && (tool.providerName === 'qaap' || tool.name.startsWith('qaap_'));
}
