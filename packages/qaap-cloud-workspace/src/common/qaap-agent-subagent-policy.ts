// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export const SUBAGENT_POLICY_MARKER = '[QAAP direct execution policy]';

const SUBAGENT_TOOL_NAMES = new Set(['Agent', 'Task']);

/** Common hallucinated subagent types that Qaap/QAIQ never exposes in cloud runs. */
const UNAVAILABLE_SUBAGENT_TYPES = new Set([
    'web-dev',
    'react-debug',
    'frontend-dev',
    'fullstack-dev',
    'ui-dev',
    'vite-dev',
]);

export function buildAgentDirectExecutionPromptBlock(): string {
    return [
        SUBAGENT_POLICY_MARKER,
        'Qaap runs a single agent conversation — Agent/Task subagents are not available.',
        'Never call Agent or Task with subagent_type (web-dev, react-debug, explore, etc.).',
        'Do the work directly with Read, Grep, Glob, Write, Edit, and one-shot Bash instead of delegating.',
    ].join('\n');
}

export function extractRequestedSubagentType(toolInput: Record<string, unknown> | undefined): string | undefined {
    if (!toolInput) {
        return undefined;
    }
    const raw = toolInput.subagent_type ?? toolInput.subagentType ?? toolInput.agent_type ?? toolInput.agentType;
    if (typeof raw !== 'string') {
        return undefined;
    }
    const trimmed = raw.trim();
    return trimmed || undefined;
}

export function isKnownUnavailableSubagentType(subagentType: string | undefined): boolean {
    if (!subagentType) {
        return false;
    }
    return UNAVAILABLE_SUBAGENT_TYPES.has(subagentType.toLowerCase());
}

export function buildSubagentDeniedMessage(
    toolName: string,
    toolInput?: Record<string, unknown>,
): string {
    const subagentType = extractRequestedSubagentType(toolInput);
    if (subagentType && isKnownUnavailableSubagentType(subagentType)) {
        return `${toolName} subagent "${subagentType}" is not available in Qaap. `
            + 'Implement the landing page directly with Read/Write/Edit and one-shot Bash — do not retry Agent/Task.';
    }
    if (subagentType) {
        return `${toolName} subagent "${subagentType}" is not available in Qaap. `
            + 'Do the work directly in this conversation with Read, Write, Edit, and Bash; do not retry the call unchanged.';
    }
    if (SUBAGENT_TOOL_NAMES.has(toolName.trim())) {
        return `${toolName} subagents are not available in Qaap. `
            + 'Do the work directly in this conversation instead of delegating to a subagent, and do not retry the call unchanged.';
    }
    return `${toolName} is not available in this run. `
        + 'Continue with direct tools (Read, Write, Edit, Bash) instead.';
}
