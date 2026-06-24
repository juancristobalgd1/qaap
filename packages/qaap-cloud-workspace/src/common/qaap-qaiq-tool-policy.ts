// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * QAIQ is a Claude Code / OpenClaude CLI — not the in-browser Theia {@code Coder} agent.
 * VPS runs expose only the built-in coding tools below; Coder skills, IDE functions, and MCP
 * mounts are never available.
 */

/** Built-in Claude Code tools QAIQ may use on VPS (no delegation, no IDE bridge). */
export const QAAP_QAIQ_CORE_CODING_TOOLS = [
    'Read',
    'Write',
    'Edit',
    'Bash',
    'Grep',
    'Glob',
    'NotebookEdit',
    'TodoWrite',
] as const;

/** Optional network tools when the composer policy grants network access. */
export const QAAP_QAIQ_NETWORK_TOOLS = ['WebFetch', 'WebSearch'] as const;

/**
 * QAIQ CLI {@code --disallowed-tools} backup list — delegation, skills, plan/worktree noise,
 * and task-board tools that are not part of a single headless coding turn.
 */
export const QAAP_QAIQ_BLOCKED_HEADLESS_TOOLS = [
    'Agent',
    'Task',
    'Skill',
    'AskUserQuestion',
    'TaskCreate',
    'TaskGet',
    'TaskUpdate',
    'TaskList',
    'TaskStop',
    'TaskOutput',
    'EnterPlanMode',
    'ExitPlanMode',
    'EnterWorktree',
    'ExitWorktree',
    'Brief',
    'Workflow',
    'TeamCreate',
    'TeamDelete',
].join(',');

const BLOCKED_HEADLESS_TOOL_NAMES = new Set(QAAP_QAIQ_BLOCKED_HEADLESS_TOOLS.split(','));

/** Theia {@code Coder} / Qaap IDE tool ids — hallucinated when the model confuses agents. */
const BLOCKED_THEIA_TOOL_NAMES = new Set([
    'qaap_bootstrap_status',
    'qaap_bootstrap_install',
    'qaap_bootstrap_run_dev',
    'qaap_bootstrap_open_preview',
    'qaap_deploy_vercel',
    'qaap_deploy_cloudflare',
    'context_addFile',
    'context_ListChatContext',
    'context_ResolveChatContext',
    'getFileContent',
    'getWorkspaceFileList',
    'getWorkspaceDirectoryStructure',
    'searchInWorkspace',
    'findFilesByPattern',
    'listTasks',
    'runTask',
    'listLaunchConfigurations',
    'runLaunchConfiguration',
    'stopLaunchConfiguration',
    'getSkillFileContent',
    'todoWrite',
    'userInteraction',
    'createTaskContext',
    'getTaskContext',
    'editTaskContext',
    'listTaskContexts',
    'rewriteTaskContext',
    'launchBrowser',
    'isBrowserRunning',
    'closeBrowser',
    'queryDom',
    'Coder',
]);

export interface QaapQaiqCoreToolsOptions {
    readonly network?: boolean;
    readonly shell?: boolean;
}

export function resolveQaiqCoreToolNames(options: QaapQaiqCoreToolsOptions = {}): readonly string[] {
    const tools = QAAP_QAIQ_CORE_CODING_TOOLS.filter(tool => options.shell !== false || tool !== 'Bash');
    if (options.network) {
        return [...tools, ...QAAP_QAIQ_NETWORK_TOOLS];
    }
    return tools;
}

/** {@code --tools} allowlist injected on every QAIQ VPS launch. */
export function formatQaiqCoreToolsFlag(options: QaapQaiqCoreToolsOptions = {}): string {
    return `--tools ${resolveQaiqCoreToolNames(options).join(',')}`;
}

export function parseQaiqCoreTools(command: string): Set<string> | undefined {
    const match = /--tools\s+([^\s-][^\s]*)/.exec(command);
    if (!match?.[1]) {
        return undefined;
    }
    return new Set(match[1].split(',').map(tool => tool.trim()).filter(Boolean));
}

export function isBlockedTheiaTool(toolName: string): boolean {
    const normalized = toolName.trim();
    if (!normalized) {
        return false;
    }
    if (BLOCKED_THEIA_TOOL_NAMES.has(normalized)) {
        return true;
    }
    const lower = normalized.toLowerCase();
    if (lower.startsWith('qaap_') || lower.startsWith('mcp__')) {
        return true;
    }
    return false;
}

export function isBlockedHeadlessTool(toolName: string): boolean {
    const normalized = toolName.trim();
    return BLOCKED_HEADLESS_TOOL_NAMES.has(normalized) || isBlockedTheiaTool(normalized);
}

/** @deprecated Use {@link isBlockedHeadlessTool}. */
export function isBlockedDelegationTool(toolName: string): boolean {
    return isBlockedHeadlessTool(toolName);
}
