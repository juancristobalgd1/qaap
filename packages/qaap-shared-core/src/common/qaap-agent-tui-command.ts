// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QAAP_BUILTIN_AGENT_DEFINITIONS } from './qaap-builtin-agents';
import { OPENCLAUDE_AGENT_ID, QAIQ_AGENT_ID, migrateQaapProductAgentId } from './qaap-agent-task-client';
import { resolveAgentLoginCliCommand } from './qaap-agent-auth-login';
import { isAgentHiddenOnHostedRuntime } from './qaap-hosted-agent-auth-policy';

/**
 * Interactive TUI CLI binary for an agent id — the bare executable to type into a PTY,
 * not the headless `--print` / `exec --json` templates used by background task runs.
 *
 * Antigravity is special: the product agent id is `antigravity`, but the CLI on PATH is
 * usually Google's `agy` (then community `antigravity`, then legacy `gemini`).
 */
export function resolveInteractiveAgentCliBin(agentId: string | undefined): string | undefined {
    const normalized = migrateQaapProductAgentId(agentId?.trim());
    if (!normalized) {
        return undefined;
    }
    if (normalized === QAIQ_AGENT_ID || normalized === OPENCLAUDE_AGENT_ID) {
        return normalized;
    }
    if (normalized === 'antigravity' || normalized === 'gemini') {
        return 'agy';
    }
    const builtin = QAAP_BUILTIN_AGENT_DEFINITIONS.find(definition => definition.id === normalized);
    return builtin?.bin;
}

/**
 * Text to send into the transcript terminal to start an agent connection.
 * Prefer a dedicated device/OAuth command; for harnesses without one, launch the
 * interactive CLI so its own login/onboarding flow is available in the terminal.
 *
 * QAIQ is the only Settings/BYOK harness and therefore remains the sole exception.
 */
export function resolveInteractiveAgentLoginCommand(agentId: string | undefined): string | undefined {
    const normalized = migrateQaapProductAgentId(agentId?.trim());
    if (!normalized || normalized === QAIQ_AGENT_ID || isAgentHiddenOnHostedRuntime(normalized)) {
        return undefined;
    }
    return resolveAgentLoginCliCommand(normalized) ?? resolveInteractiveAgentCliBin(normalized);
}
