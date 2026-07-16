// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentApprovalPolicyId } from '@theia/qaap-mobile-shell/lib/common/qaap-sticky-composer-approval-policy';
import {
    formatQaiqInteractionFlags,
    qaiqCommandUsesInteractionFlags,
    type QaapQaiqInteractionFlagOptions,
} from '@theia/qaap-mobile-shell/lib/common/qaap-qaiq-interaction-flags';
import {
    applyAutoApproveToCommand,
    commandHasAutoApproveFlags,
} from './qaap-agent-auto-approve';
import { QAAP_QAIQ_BLOCKED_HEADLESS_TOOLS } from './qaap-agent-subagent-policy';
import {
    formatQaiqCoreToolsFlag,
} from './qaap-qaiq-tool-policy';
import type { QaapAgentToolApprovalRules } from './qaap-agent-conversation';

export type { QaapAgentToolApprovalRules };

export const DEFAULT_APPROVE_FOR_ME_TOOL_RULES: QaapAgentToolApprovalRules = {
    shell: true,
    network: false,
};

export interface QaapAgentApprovalFlagOptions {
    readonly agentId: string | undefined;
    readonly approvalPolicyId?: QaapAgentApprovalPolicyId;
    readonly autoApprove?: boolean;
    readonly interactionModeId?: string;
    readonly toolApprovalRules?: QaapAgentToolApprovalRules;
}

export function resolveEffectiveToolApprovalRules(
    policyId: QaapAgentApprovalPolicyId | undefined,
    rules: QaapAgentToolApprovalRules | undefined,
): QaapAgentToolApprovalRules | undefined {
    const policy = policyId ?? 'approve-for-me';
    if (policy === 'request-approval') {
        return { shell: false, network: false };
    }
    if (policy === 'full-access') {
        return { shell: true, network: true };
    }
    return {
        shell: rules?.shell ?? DEFAULT_APPROVE_FOR_ME_TOOL_RULES.shell,
        network: rules?.network ?? DEFAULT_APPROVE_FOR_ME_TOOL_RULES.network,
    };
}

/** Whether the VPS task should stay interactive (stdin y/n) for this preset. */
export function shouldUseInteractiveAgentApprovals(options: QaapAgentApprovalFlagOptions): boolean {
    return options.autoApprove === false || options.approvalPolicyId === 'request-approval';
}

/** QAIQ stdio pause-and-wait is only for explicit interactive presets — not default headless runs. */
export function shouldUseQaiqStdioApprovals(options: QaapAgentApprovalFlagOptions): boolean {
    return options.autoApprove === false || options.approvalPolicyId === 'request-approval';
}

/**
 * Infer the agent id from the command's leading executable. Anchored to the start of the (trimmed)
 * command — the executable is always the first token in every built-in template — so a quoted prompt
 * argument that happens to mention another agent's name (e.g. workflow instructions describing
 * subagent types) can never be mistaken for the invoked CLI. Only used as a fallback when
 * {@link QaapAgentApprovalFlagOptions.agentId} is not supplied, e.g. legacy persisted tasks.
 */
function inferAgentIdFromCommand(command: string): string | undefined {
    const trimmed = command.trimStart();
    if (/^(?:qaiq|openclaude)\b/.test(trimmed)) {
        return 'qaiq';
    }
    if (/^claude\b/.test(trimmed)) {
        return 'claude';
    }
    if (/^codex\b/.test(trimmed)) {
        return 'codex';
    }
    if (/^opencode(?:\s+run)?\b/.test(trimmed)) {
        return 'opencode';
    }
    return undefined;
}

/**
 * Apply composer approval presets to an agent command. Replaces the old binary auto-approve injection
 * so {@code approve-for-me} can auto-approve edits while still prompting for shell/network when configured.
 *
 * QAIQ headless runs use {@code --dangerously-skip-permissions} (OpenCode-style) plus
 * {@link QAAP_QAIQ_BLOCKED_HEADLESS_TOOLS} — Qaap only launches, enriches the prompt, and paints stream-json.
 *
 * Dispatch is by {@code options.agentId} whenever it is known — never by scanning the command text, which
 * also contains the (quoted) prompt and can otherwise mention another agent's name and misroute the whole
 * command to the wrong CLI's flags. Command-text sniffing via {@link inferAgentIdFromCommand} is only a
 * fallback for legacy persisted tasks that predate {@code agentId} being recorded.
 */
export function applyAgentApprovalPolicyToCommand(
    command: string,
    options: QaapAgentApprovalFlagOptions,
): string {
    if (shouldUseInteractiveAgentApprovals(options)) {
        return stripNonInteractiveApprovalFlags(command, options.agentId);
    }
    if (commandHasAutoApproveFlags(command) && options.approvalPolicyId === 'full-access') {
        return command;
    }
    const agentId = options.agentId?.trim().toLowerCase();
    const policyId = options.approvalPolicyId ?? 'approve-for-me';
    const rules = resolveEffectiveToolApprovalRules(policyId, options.toolApprovalRules);
    const effectiveId = agentId || inferAgentIdFromCommand(command);
    if (effectiveId === 'qaiq') {
        return applyQaiqApprovalFlags(command, options, policyId, rules);
    }
    if (effectiveId === 'claude') {
        return applyClaudeApprovalFlags(command, policyId, rules);
    }
    if (effectiveId === 'codex') {
        return applyCodexApprovalFlags(command, policyId, rules);
    }
    if (effectiveId === 'opencode') {
        return applyOpencodeApprovalFlags(command, policyId, rules);
    }
    if (policyId === 'full-access' || rules?.network) {
        return applyAutoApproveToCommand(command, agentId);
    }
    return command;
}

function applyQaiqApprovalFlags(
    command: string,
    options: QaapAgentApprovalFlagOptions,
    policyId: QaapAgentApprovalPolicyId,
    rules: QaapAgentToolApprovalRules | undefined,
): string {
    const withoutLegacy = stripQaiqPermissionFlags(command);
    let next: string;
    if (policyId === 'approve-for-me' && rules) {
        next = injectAfterPattern(withoutLegacy, /\b(qaiq|openclaude)\b/, formatQaiqApproveForMeFlags(rules));
    } else {
        const qaiqOptions: QaapQaiqInteractionFlagOptions = {
            interactionModeId: options.interactionModeId,
            approvalPolicyId: policyId,
            autoApprove: true,
        };
        const flags = formatQaiqInteractionFlags(qaiqOptions);
        next = flags
            ? injectAfterPattern(withoutLegacy, /\b(qaiq|openclaude)\b/, flags)
            : withoutLegacy;
    }
    return ensureQaiqCoreTools(ensureQaiqBlockedHeadlessTools(next), policyId, rules);
}

function ensureQaiqCoreTools(
    command: string,
    policyId: QaapAgentApprovalPolicyId,
    rules: QaapAgentToolApprovalRules | undefined,
): string {
    // Read-only web tools (WebSearch/WebFetch) are always in the allowlist now — no `network` gate.
    const shell = policyId !== 'request-approval' && rules?.shell !== false;
    const flag = formatQaiqCoreToolsFlag({ shell });
    const existing = /--tools\s+[^\s-][^\s]*/.exec(command);
    if (existing) {
        return command.replace(existing[0], flag);
    }
    return injectAfterPattern(command, /\b(qaiq|openclaude)\b/, flag);
}

function formatQaiqApproveForMeFlags(_rules: QaapAgentToolApprovalRules): string {
    // Headless VPS runs match OpenCode: auto-approve real tools, block delegation noise at CLI.
    return '--dangerously-skip-permissions';
}

function ensureQaiqBlockedHeadlessTools(command: string): string {
    const required = QAAP_QAIQ_BLOCKED_HEADLESS_TOOLS.split(',');
    const match = /--disallowed-tools\s+([^\s-][^\s]*)/.exec(command);
    if (!match) {
        return injectAfterPattern(command, /\b(qaiq|openclaude)\b/, `--disallowed-tools ${QAAP_QAIQ_BLOCKED_HEADLESS_TOOLS}`);
    }
    const existing = new Set(match[1].split(',').map(tool => tool.trim()).filter(Boolean));
    let changed = false;
    for (const tool of required) {
        if (!existing.has(tool)) {
            existing.add(tool);
            changed = true;
        }
    }
    if (!changed) {
        return command;
    }
    return command.replace(match[0], `--disallowed-tools ${[...existing].join(',')}`);
}

function applyClaudeApprovalFlags(
    command: string,
    policyId: QaapAgentApprovalPolicyId,
    rules: QaapAgentToolApprovalRules | undefined,
): string {
    let next = stripClaudeApprovalFlags(command);
    if (policyId === 'full-access' || rules?.network) {
        return injectAfterExecutable(next, 'claude', '--dangerously-skip-permissions');
    }
    if (policyId === 'approve-for-me' && rules?.shell) {
        return injectAfterExecutable(next, 'claude', '--permission-mode default --allowed-tools Edit Write NotebookEdit Bash');
    }
    if (policyId === 'approve-for-me') {
        return injectAfterExecutable(next, 'claude', '--permission-mode acceptEdits');
    }
    return injectAfterExecutable(next, 'claude', '--permission-mode default');
}

function applyCodexApprovalFlags(
    command: string,
    policyId: QaapAgentApprovalPolicyId,
    rules: QaapAgentToolApprovalRules | undefined,
): string {
    let next = stripCodexApprovalFlags(command);
    if (policyId === 'full-access' || rules?.network) {
        return injectAfterExecutable(next, 'codex', '--dangerously-bypass-approvals-and-sandbox');
    }
    if (policyId === 'approve-for-me' && rules?.shell) {
        return injectAfterExecutable(next, 'codex', '--sandbox workspace-write --ask-for-approval untrusted');
    }
    if (policyId === 'approve-for-me') {
        return injectAfterExecutable(next, 'codex', '--full-auto');
    }
    return next;
}

function applyOpencodeApprovalFlags(
    command: string,
    policyId: QaapAgentApprovalPolicyId,
    rules: QaapAgentToolApprovalRules | undefined,
): string {
    const next = stripFlagToken(command, '--dangerously-skip-permissions');
    if (policyId === 'full-access' || rules?.network || rules?.shell) {
        return injectAfterPattern(next, /\bopencode(?:\s+run)?\b/, '--dangerously-skip-permissions');
    }
    return next;
}

function stripNonInteractiveApprovalFlags(command: string, agentId: string | undefined): string {
    const effectiveId = agentId?.trim().toLowerCase() || inferAgentIdFromCommand(command);
    if (effectiveId === 'qaiq') {
        if (qaiqCommandUsesInteractionFlags(command)) {
            return injectAfterPattern(
                stripFlagToken(command, '--dangerously-skip-permissions'),
                /\b(qaiq|openclaude)\b/,
                '--permission-mode default',
            );
        }
        return command;
    }
    if (effectiveId === 'claude') {
        return injectAfterExecutable(stripClaudeApprovalFlags(command), 'claude', '--permission-mode default');
    }
    if (effectiveId === 'codex') {
        return stripCodexApprovalFlags(command);
    }
    return command;
}

function stripClaudeApprovalFlags(command: string): string {
    return stripFlagTokens(command, [
        '--dangerously-skip-permissions',
        /--permission-mode\s+(?:default|acceptEdits|bypassPermissions|plan|dontAsk)\b/g,
        /--allowed-tools\s+[^\s]+(?:\s+[^\s-][^\s]*)*/g,
        /--disallowed-tools\s+[^\s]+(?:\s+[^\s-][^\s]*)*/g,
    ]);
}

function stripQaiqPermissionFlags(command: string): string {
    return stripFlagTokens(command, [
        '--dangerously-skip-permissions',
        /--permission-mode\s+(?:default|acceptEdits|bypassPermissions|plan|dontAsk)\b/g,
        /--allowed-tools\s+[^\s-][^\s]*/g,
        /--disallowed-tools\s+[^\s-][^\s]*/g,
        /--tools\s+[^\s-][^\s]*/g,
    ]);
}

function stripCodexApprovalFlags(command: string): string {
    return stripFlagTokens(command, [
        '--full-auto',
        '--dangerously-bypass-approvals-and-sandbox',
        '--yolo',
        /--sandbox\s+(?:read-only|workspace-write|danger-full-access)\b/g,
        /--ask-for-approval\s+(?:untrusted|on-request|never|unless-trusted)\b/g,
    ]);
}

function stripFlagToken(command: string, flag: string): string {
    const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(flag)}(?=\\s|$)`, 'g');
    return command.replace(pattern, ' ').replace(/\s{2,}/g, ' ').trim();
}

function stripFlagTokens(command: string, patterns: Array<string | RegExp>): string {
    let next = command;
    for (const pattern of patterns) {
        next = typeof pattern === 'string'
            ? stripFlagToken(next, pattern)
            : next.replace(pattern, ' ').replace(/\s{2,}/g, ' ').trim();
    }
    return next;
}

function injectAfterExecutable(command: string, executable: string, flag: string): string {
    return injectAfterPattern(command, new RegExp(`\\b${escapeRegExp(executable)}\\b`), flag);
}

function injectAfterPattern(command: string, executablePattern: RegExp, flag: string): string {
    const match = executablePattern.exec(command);
    if (!match || match.index === undefined) {
        return command;
    }
    const insertAt = match.index + match[0].length;
    return `${command.slice(0, insertAt)} ${flag}${command.slice(insertAt)}`;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
