// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QAAP_BUILTIN_AGENT_DEFINITIONS } from './qaap-builtin-agents';
import { OPENCLAUDE_AGENT_ID, QAIQ_AGENT_ID, migrateQaapProductAgentId } from './qaap-agent-task-client';
import {
    agentNeedsSettingsApiKeyPath,
    QAAP_AI_FEATURES_SETTINGS_QUERY,
    resolveAgentLoginCliCommand,
} from './qaap-agent-auth-login';
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

/** A deliberate route for the Work Hub Connect action. */
export type QaapAgentConnectionFlow =
    | { readonly kind: 'cli-login'; readonly command: string }
    | { readonly kind: 'settings-api-key'; readonly settingsQuery: string }
    | { readonly kind: 'tenant-terminal'; readonly command: string }
    | { readonly kind: 'hosted-restricted' }
    | { readonly kind: 'unsupported' };

/**
 * Resolve a usable connect route. A hidden terminal is only used for CLIs with a dedicated
 * login command that prints a device/OAuth challenge. Interactive onboarding stays visible
 * to the user by returning instructions for the tenant terminal instead of launching a TUI
 * in an inaccessible staging surface.
 */
export function resolveAgentConnectionFlow(agentId: string | undefined): QaapAgentConnectionFlow {
    const normalized = migrateQaapProductAgentId(agentId?.trim());
    if (!normalized) {
        return { kind: 'unsupported' };
    }
    if (isAgentHiddenOnHostedRuntime(normalized)) {
        return { kind: 'hosted-restricted' };
    }
    const loginCommand = resolveAgentLoginCliCommand(normalized);
    if (loginCommand) {
        return { kind: 'cli-login', command: loginCommand };
    }
    // OpenCode's own credential manager is the connect route; BYOK settings only feed its background runner.
    if (normalized !== 'opencode' && agentNeedsSettingsApiKeyPath(normalized)) {
        return { kind: 'settings-api-key', settingsQuery: QAAP_AI_FEATURES_SETTINGS_QUERY };
    }
    const bin = resolveInteractiveAgentCliBin(normalized);
    if (!bin) {
        return { kind: 'unsupported' };
    }
    const tenantCommand = normalized === 'opencode'
        ? 'opencode auth login'
        : normalized === 'openclaw'
            ? 'openclaw onboard'
            : bin;
    return { kind: 'tenant-terminal', command: tenantCommand };
}

/** Device/OAuth command to send to the background transcript terminal, when supported. */
export function resolveInteractiveAgentLoginCommand(agentId: string | undefined): string | undefined {
    const normalized = migrateQaapProductAgentId(agentId?.trim());
    if (!normalized || normalized === QAIQ_AGENT_ID || isAgentHiddenOnHostedRuntime(normalized)) {
        return undefined;
    }
    return resolveAgentLoginCliCommand(normalized);
}
