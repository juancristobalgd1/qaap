// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export const SUBAGENT_POLICY_MARKER = '[QAAP direct execution policy]';

/** QAIQ CLI {@code --disallowed-tools} list for delegation tools that waste turns in VPS runs. */
export const QAAP_QAIQ_BLOCKED_DELEGATION_TOOLS = 'Agent,Task,Skill';

export const DELEGATION_TOOL_NAMES = new Set(['Agent', 'Task', 'Skill']);

/** Common hallucinated subagent types that Qaap/QAIQ never exposes in cloud runs. */
const UNAVAILABLE_SUBAGENT_TYPES = new Set([
    'web-dev',
    'react-debug',
    'frontend-dev',
    'fullstack-dev',
    'ui-dev',
    'vite-dev',
]);

/** Skill names the model often invents when no skill packs are mounted on the VPS. */
const UNAVAILABLE_SKILL_NAMES = new Set([
    'claude-code-guide',
    'cursor-guide',
    'code-guide',
]);

export function buildAgentDirectExecutionPromptBlock(): string {
    return [
        SUBAGENT_POLICY_MARKER,
        'Qaap runs a single agent conversation — Agent/Task subagents and the Skill tool are not available.',
        'Never call Agent or Task with subagent_type (web-dev, react-debug, explore, claude-code-guide, etc.).',
        'Never call Skill to load skill packs (claude-code-guide, cursor-guide, etc.) — they are not mounted in VPS runs.',
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

export function extractRequestedSkillName(toolInput: Record<string, unknown> | undefined): string | undefined {
    if (!toolInput) {
        return undefined;
    }
    const raw = toolInput.skill ?? toolInput.skill_name ?? toolInput.skillName ?? toolInput.name;
    if (typeof raw !== 'string') {
        return undefined;
    }
    const trimmed = raw.trim();
    return trimmed || undefined;
}

export function isKnownUnavailableSkillName(skillName: string | undefined): boolean {
    if (!skillName) {
        return false;
    }
    return UNAVAILABLE_SKILL_NAMES.has(skillName.toLowerCase());
}

export function isBlockedDelegationTool(toolName: string): boolean {
    return DELEGATION_TOOL_NAMES.has(toolName.trim());
}

export function buildSubagentDeniedMessage(
    toolName: string,
    toolInput?: Record<string, unknown>,
): string {
    const normalizedToolName = toolName.trim();
    if (normalizedToolName === 'Skill') {
        const skillName = extractRequestedSkillName(toolInput);
        if (skillName && isKnownUnavailableSkillName(skillName)) {
            return `Skill "${skillName}" is not available in Qaap. `
                + 'VPS runs do not load skill packs — follow the user request directly with Read, Write, Edit, and Bash; do not retry Skill.';
        }
        if (skillName) {
            return `Skill "${skillName}" is not available in Qaap. `
                + 'Skills are not loaded in VPS runs — continue with direct tools (Read, Write, Edit, Bash) and do not retry Skill.';
        }
        return 'Skill lookups are not available in Qaap. '
            + 'Continue with direct tools (Read, Write, Edit, Bash) instead of loading skills.';
    }
    const subagentType = extractRequestedSubagentType(toolInput);
    if (subagentType && isKnownUnavailableSubagentType(subagentType)) {
        return `${toolName} subagent "${subagentType}" is not available in Qaap. `
            + 'Implement the landing page directly with Read/Write/Edit and one-shot Bash — do not retry Agent/Task.';
    }
    if (subagentType) {
        return `${toolName} subagent "${subagentType}" is not available in Qaap. `
            + 'Do the work directly in this conversation with Read, Write, Edit, and Bash; do not retry the call unchanged.';
    }
    if (isBlockedDelegationTool(normalizedToolName)) {
        return `${toolName} subagents are not available in Qaap. `
            + 'Do the work directly in this conversation instead of delegating to a subagent, and do not retry the call unchanged.';
    }
    return `${toolName} is not available in this run. `
        + 'Continue with direct tools (Read, Write, Edit, Bash) instead.';
}
