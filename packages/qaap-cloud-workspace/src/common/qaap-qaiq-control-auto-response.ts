// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QaapBashReadOnlyClassifier } from '@theia/qaap-shared-core/lib/common/qaap-bash-readonly-classifier';
import { findQaiqDestructiveCommandGuardDenial } from './qaap-agent-destructive-command-guard';
import { findQaiqDevServerGuardDenial } from './qaap-agent-dev-server-guard';
import { buildSubagentDeniedMessage, extractRequestedSubagentType, isBlockedHeadlessTool } from './qaap-agent-subagent-policy';
import { parseQaiqCoreTools } from './qaap-qaiq-tool-policy';
import type { QaapQaiqPendingControlRequest } from './qaap-qaiq-stdio-approvals';

const VERIFICATION_SUBAGENT_TYPE = 'verification';

/** True when the tool call is Agent with a subagent_type other than "verification". */
function isNonVerificationAgentCall(toolName: string, request: QaapQaiqPendingControlRequest): boolean {
    if (toolName.trim() !== 'Agent') {
        return false;
    }
    const subagentType = extractRequestedSubagentType(request.toolInput);
    return subagentType !== VERIFICATION_SUBAGENT_TYPE;
}

export type QaapQaiqControlAutoAction = 'allow' | 'deny' | 'queue';

/** Why a control request was answered without asking; only set for the read-only shell shortcut today. */
export type QaapQaiqControlAutoReason = 'read-only-shell';

export interface QaapQaiqControlAutoDecision {
    readonly action: QaapQaiqControlAutoAction;
    readonly reason?: QaapQaiqControlAutoReason;
    /** Classifier explanation when {@link reason} is `read-only-shell`. */
    readonly detail?: string;
    /** Set when a read-only shell command was NOT auto-approved because of a runtime safety check. */
    readonly readOnlyBlockedReason?: string;
}

export interface QaapQaiqControlAutoOptions {
    /** User preference `ai-features.agentApprovals.autoApproveReadOnlyShell` (default on). */
    readonly autoApproveReadOnlyShell?: boolean;
    /** Task working directory; absolute path arguments are read-only only inside it. */
    readonly cwd?: string;
    /**
     * Returns a reason when the effective git config could make git run a program (fsmonitor, pager,
     * external diff/textconv, filters). Required for read-only auto-approval of commands that use git:
     * when absent, such commands fall back to the preset rules.
     */
    readonly checkGitExecConfig?: () => string | undefined;
}

const NETWORK_TOOL_NAMES = new Set(['WebSearch', 'WebFetch', 'Fetch']);
const SHELL_TOOL_NAMES = new Set(['Bash', 'Shell', 'ShellCommand', 'run_terminal_cmd']);

function parseAllowedTools(command: string): Set<string> | undefined {
    const match = /--allowed-tools\s+([^\s-][^\s]*)/.exec(command);
    if (!match?.[1]) {
        return undefined;
    }
    return new Set(match[1].split(',').map(tool => tool.trim()).filter(Boolean));
}

function isNetworkTool(toolName: string): boolean {
    return NETWORK_TOOL_NAMES.has(toolName.trim());
}

function isShellTool(toolName: string): boolean {
    return SHELL_TOOL_NAMES.has(toolName.trim());
}

/**
 * Resolve a QAIQ stdio `control_request` against the spawned CLI flags.
 *
 * Tools the policy auto-allows resolve immediately; gated shell/network tools are
 * queued to the approvals UI so the user can grant them mid-turn (the runner applies
 * a grace timeout so an unattended run still finishes). Headless-blocked tools (Agent/Task/Skill/AskUserQuestion)
 * and the dev-server guard auto-deny and can never be approved. The destructive-command guard only
 * blocks AUTO-approval: under request-approval it queues like any shell call, because an explicit
 * human approval is precisely the consent the destructive-command policy asks for.
 */
export function resolveQaiqControlRequestAutoAction(
    command: string,
    autoApprove: boolean | undefined,
    request: QaapQaiqPendingControlRequest,
    options: QaapQaiqControlAutoOptions = {},
): QaapQaiqControlAutoAction {
    return resolveQaiqControlRequestAutoDecision(command, autoApprove, request, options).action;
}

/**
 * {@link resolveQaiqControlRequestAutoAction} plus the reason for an automatic answer, so the runner can
 * record "auto-approved: read-only" for shell commands the read-only classifier proved harmless.
 *
 * Precedence: dev-server deny > destructive guard > core `--tools` allowlist deny > read-only shell
 * auto-approval (when the preference is on, even under request-approval) > the preset rules below.
 */
export function resolveQaiqControlRequestAutoDecision(
    command: string,
    autoApprove: boolean | undefined,
    request: QaapQaiqPendingControlRequest,
    options: QaapQaiqControlAutoOptions = {},
): QaapQaiqControlAutoDecision {
    // Dev servers break the preview even when a human approves them (shell tools time out ~30s),
    // so this guard denies BEFORE the manual-approval queue — it can never be approved.
    if (findQaiqDevServerGuardDenial(request)) {
        return { action: 'deny' };
    }
    const readOnly = classifyReadOnlyShellRequest(command, request, options);
    if (readOnly?.allowed) {
        return { action: 'allow', reason: 'read-only-shell', detail: readOnly.detail };
    }
    return {
        action: resolvePresetAutoAction(command, autoApprove, request),
        ...(readOnly ? { readOnlyBlockedReason: readOnly.detail } : {}),
    };
}

/**
 * `allowed` when the request is a shell tool call whose command is provably read-only and may skip the
 * approval prompt; `allowed: false` when the command is read-only but a runtime check (git config) vetoed
 * it; `undefined` otherwise. The destructive guard and a core `--tools` allowlist that excludes the shell
 * tool always win over the read-only shortcut.
 */
function classifyReadOnlyShellRequest(
    command: string,
    request: QaapQaiqPendingControlRequest,
    options: QaapQaiqControlAutoOptions,
): { readonly allowed: boolean; readonly detail: string } | undefined {
    if (options.autoApproveReadOnlyShell === false) {
        return undefined;
    }
    const toolName = request.toolName?.trim() ?? '';
    if (!toolName || !isShellTool(toolName)) {
        return undefined;
    }
    if (findQaiqDestructiveCommandGuardDenial(request)) {
        return undefined;
    }
    const coreTools = parseQaiqCoreTools(command);
    if (coreTools && !coreTools.has(toolName)) {
        return undefined;
    }
    const shellCommand = typeof request.toolInput?.command === 'string' ? request.toolInput.command : undefined;
    const verdict = QaapBashReadOnlyClassifier.classifyCommand(shellCommand, { cwd: options.cwd });
    if (!verdict.readOnly) {
        return undefined;
    }
    if (verdict.commands?.includes('git')) {
        let gitRisk: string | undefined;
        try {
            gitRisk = options.checkGitExecConfig ? options.checkGitExecConfig() : 'git config not verified';
        } catch (error) {
            gitRisk = `git config check failed: ${error instanceof Error ? error.message : String(error)}`;
        }
        if (gitRisk) {
            return { allowed: false, detail: gitRisk };
        }
    }
    return { allowed: true, detail: verdict.reason };
}

function resolvePresetAutoAction(
    command: string,
    autoApprove: boolean | undefined,
    request: QaapQaiqPendingControlRequest,
): QaapQaiqControlAutoAction {
    if (autoApprove === false) {
        return 'queue';
    }
    // Destructive shell commands (force push, hard reset, rm -rf outside the workspace) are never
    // AUTO-approved. Queue them for the Allow/Deny card (ChatGPT / Claude-style) so the user can
    // explicitly consent. Full-access / bypassPermissions still hard-denies them.
    if (findQaiqDestructiveCommandGuardDenial(request)) {
        if (/(?:^|\s)--permission-mode\s+bypassPermissions(?:\s|$)/.test(command)) {
            return 'deny';
        }
        return 'queue';
    }
    const toolName = request.toolName?.trim() ?? '';
    // Headless-blocked tools bypass useful stdio control once running — deny even in bypassPermissions.
    if (toolName && isBlockedHeadlessTool(toolName)) {
        return 'deny';
    }
    // Agent is allowed only for subagent_type="verification"; all other subagent types are denied.
    if (toolName && isNonVerificationAgentCall(toolName, request)) {
        return 'deny';
    }
    const coreTools = parseQaiqCoreTools(command);
    if (toolName && coreTools && !coreTools.has(toolName)) {
        return 'deny';
    }
    if (/(?:^|\s)--permission-mode\s+bypassPermissions(?:\s|$)/.test(command)) {
        return 'allow';
    }
    if (!toolName) {
        return 'allow';
    }
    // Approve-for-me deliberately omits Bash and Agent from `--allowed-tools` so QAIQ emits a
    // control request and Qaap can apply the guards above. Once those guards pass, the core
    // `--tools` allowlist is the policy signal: safe shell calls and the verification-only
    // subagent must continue immediately instead of entering an approval queue the default UI
    // does not surface.
    if ((isShellTool(toolName) || toolName === 'Agent') && coreTools?.has(toolName)) {
        return 'allow';
    }
    const allowedTools = parseAllowedTools(command);
    if (allowedTools) {
        return allowedTools.has(toolName) ? 'allow' : 'queue';
    }
    if (isNetworkTool(toolName) || isShellTool(toolName)) {
        return 'queue';
    }
    return 'allow';
}

/** Deny guidance for tools that can never be approved mid-turn (headless-blocked tools). */
export function buildQaiqAutoDeniedToolMessage(
    toolName: string,
    toolInput?: Record<string, unknown>,
): string {
    return buildSubagentDeniedMessage(toolName, toolInput);
}

/** Deny guidance when a queued approval expired without a user response. */
export function buildQaiqQueuedApprovalTimeoutMessage(toolName: string): string {
    return `${toolName} was not approved in time under the current approval policy. `
        + 'Continue without it, or tell the user they can enable shell/network access in the '
        + 'composer approval settings or switch to Full access and ask you to retry.';
}
