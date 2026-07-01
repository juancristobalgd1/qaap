// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export const SUBAGENT_POLICY_MARKER = '[QAAP direct execution policy]';

import { isBlockedHeadlessTool, isBlockedTheiaTool } from './qaap-qaiq-tool-policy';

export {
    QAAP_QAIQ_BLOCKED_HEADLESS_TOOLS,
    isBlockedDelegationTool,
    isBlockedHeadlessTool,
    isBlockedTheiaTool,
} from './qaap-qaiq-tool-policy';

/** @deprecated Use {@link QAAP_QAIQ_BLOCKED_HEADLESS_TOOLS} from qaap-qaiq-tool-policy. */
export { QAAP_QAIQ_BLOCKED_HEADLESS_TOOLS as QAAP_QAIQ_BLOCKED_DELEGATION_TOOLS } from './qaap-qaiq-tool-policy';

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
        'QAIQ is a Claude Code / OpenClaude CLI on the VPS — not the in-browser Theia Coder agent.',
        'Never use Theia Coder functions (~{getFileContent}, ~{runTask}, qaap_bootstrap_*, launch configs, IDE skills, or MCP bridges).',
        'Qaap runs a single headless conversation — Task subagents, Skill, and AskUserQuestion are not available.',
        'The Agent tool IS available but ONLY with subagent_type="verification" — use it to verify non-trivial work (3+ file edits, backend/API changes) before reporting completion. Never call Agent with any other subagent_type (web-dev, react-debug, explore, claude-code-guide, etc.) — they are not available.',
        'Never call Skill to load skill packs (claude-code-guide, cursor-guide, etc.) — they are not mounted in VPS runs.',
        'Never call AskUserQuestion — there is no interactive question UI mid-turn. Make reasonable assumptions from the user prompt and continue.',
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

export function buildSubagentDeniedMessage(
    toolName: string,
    toolInput?: Record<string, unknown>,
): string {
    const normalizedToolName = toolName.trim();
    if (isBlockedTheiaTool(normalizedToolName)) {
        return `${toolName} is a Theia Coder / IDE tool and is not available to QAIQ on the VPS. `
            + 'Use Read, Write, Edit, Grep, Glob, and Bash directly — do not retry IDE bridge tools.';
    }
    if (normalizedToolName === 'AskUserQuestion') {
        return 'AskUserQuestion is not available in Qaap VPS runs. '
            + 'There is no interactive question UI mid-turn — make reasonable assumptions from the user prompt '
            + 'and continue with Read, Write, Edit, and Bash; do not retry AskUserQuestion.';
    }
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
    if (normalizedToolName === 'Agent' && subagentType === 'verification') {
        // Allowed — should not reach here, but return a non-blocking message just in case.
        return '';
    }
    if (normalizedToolName === 'Agent' && subagentType && subagentType !== 'verification') {
        return `${toolName} subagent "${subagentType}" is not available in Qaap. `
            + 'The only allowed subagent_type is "verification" — use it to verify non-trivial work before reporting completion. '
            + 'Do not retry Agent with any other subagent_type.';
    }
    if (subagentType && isKnownUnavailableSubagentType(subagentType)) {
        return `${toolName} subagent "${subagentType}" is not available in Qaap. `
            + 'Implement the landing page directly with Read/Write/Edit and one-shot Bash — do not retry Agent/Task.';
    }
    if (subagentType) {
        return `${toolName} subagent "${subagentType}" is not available in Qaap. `
            + 'Do the work directly in this conversation with Read, Write, Edit, and Bash; do not retry the call unchanged.';
    }
    if (isBlockedHeadlessTool(normalizedToolName)) {
        return `${toolName} is not available in Qaap VPS runs. `
            + 'Do the work directly in this conversation instead of delegating or prompting the user mid-turn, and do not retry the call unchanged.';
    }
    return `${toolName} is not available in this run. `
        + 'Continue with direct tools (Read, Write, Edit, Bash) instead.';
}
