// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QAAP_BUILTIN_AGENT_DEFINITIONS } from './qaap-builtin-agents';
import { OPENCLAUDE_AGENT_ID, QAIQ_AGENT_ID, migrateQaapProductAgentId } from './qaap-agent-task-client';
import { resolveAgentLoginCliCommand } from './qaap-agent-auth-login';

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
 * Text to send into the transcript terminal to start CLI session login
 * (device-auth / OAuth), matching the agent TUI login flow.
 *
 * Returns `undefined` for BYOK / Settings-catalog agents (qaiq and any agent
 * without a dedicated login subcommand). We deliberately do NOT fall back to the
 * bare interactive binary: launching the agent TUI does not sign anyone in and
 * only confuses the user. The caller should instead surface a "configure the API
 * key in Settings" affordance (see {@link agentHasCliOAuthLogin}).
 */
export function resolveInteractiveAgentLoginCommand(agentId: string | undefined): string | undefined {
    return resolveAgentLoginCliCommand(agentId);
}
