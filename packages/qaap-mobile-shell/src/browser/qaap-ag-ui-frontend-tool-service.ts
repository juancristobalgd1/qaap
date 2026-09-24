// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { ToolInvocationRegistry } from '@theia/ai-core/lib/common/tool-invocation-registry';
import { executeQaapAgUiFrontendTool, isQaapFrontendAgUiTool, resolveQaapAgUiToolByName, toQaapAgUiToolDefinitions, type QaapAgUiToolDefinition } from '../common/qaap-ag-ui-tool-registry';

/** Exposes Work Hub frontend tools to AG-UI RunAgentInput and executes client-side tool calls. */
@injectable()
export class QaapAgUiFrontendToolService {
    @inject(ToolInvocationRegistry)
    protected readonly tools: ToolInvocationRegistry;

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

}
