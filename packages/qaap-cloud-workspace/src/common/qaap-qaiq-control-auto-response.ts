// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { findQaiqDevServerGuardDenial } from './qaap-agent-dev-server-guard';
import { buildSubagentDeniedMessage, isBlockedHeadlessTool } from './qaap-agent-subagent-policy';
import type { QaapQaiqPendingControlRequest } from './qaap-qaiq-stdio-approvals';

export type QaapQaiqControlAutoAction = 'allow' | 'deny' | 'queue';

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
 * and the dev-server guard auto-deny — those can never be approved interactively.
 */
export function resolveQaiqControlRequestAutoAction(
    command: string,
    autoApprove: boolean | undefined,
    request: QaapQaiqPendingControlRequest,
): QaapQaiqControlAutoAction {
    if (autoApprove === false) {
        return 'queue';
    }
    if (findQaiqDevServerGuardDenial(request)) {
        return 'deny';
    }
    const toolName = request.toolName?.trim() ?? '';
    // Headless-blocked tools bypass useful stdio control once running — deny even in bypassPermissions.
    if (toolName && isBlockedHeadlessTool(toolName)) {
        return 'deny';
    }
    if (/(?:^|\s)--permission-mode\s+bypassPermissions(?:\s|$)/.test(command)) {
        return 'allow';
    }
    if (!toolName) {
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
