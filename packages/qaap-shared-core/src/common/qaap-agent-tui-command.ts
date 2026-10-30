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

/**
 * One keystroke batch the Connect dialog types into an interactive CLI it runs in the hidden
 * sign-in terminal. Patterns are case-insensitive regular-expression sources (this is data that
 * crosses module boundaries, so it is kept serializable).
 */
export interface QaapAgentLoginInputStep {
    /** Written to the CLI's stdin as is (`\r` is Enter). */
    readonly text: string;
    /** Sent only once the output printed since the previous step matches this pattern. */
    readonly waitFor?: string;
    /** With `waitFor`: send anyway after this long without a match (a marker the CLI may omit). */
    readonly fallbackMs?: number;
    /** Skipped when the output since the previous step already matches this pattern. */
    readonly skipWhen?: string;
}

/** Provider Pi signs in to when the Connect action does not name one. */
export const QAAP_PI_DEFAULT_LOGIN_PROVIDER = 'openrouter';
/**
 * Pi 1.4 has no non-interactive provider login, only the TUI `/login`. Regular (non-fullscreen)
 * mode keeps the output scrapeable, `--no-session` writes no session file and `--no-approve`
 * answers the project-trust question (only asked for folders with `.pi` resources) with "no"
 * without asking, so nothing but the login dialog can take the keystrokes.
 */
export const QAAP_PI_TUI_LOGIN_COMMAND = 'pi --tui-mode regular --no-session --no-approve';
/** Pi's startup header (version, `/ commands` hint, onboarding line): the editor takes input. */
const PI_READY_PATTERN = '\\bv\\d+\\.\\d+\\.\\d+\\b|\\bcommands\\b|Pi can explain';
/** `Select authentication method for OpenRouter:` (Sign in with OpenRouter / with an API key). */
const PI_AUTH_METHOD_PICKER_PATTERN = 'Select authentication method';
/** Pi provider ids are plain slugs; anything else must never be typed into the TUI. */
const PI_PROVIDER_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/**
 * Keystrokes that take Pi from its editor to the provider's browser sign-in (verified against
 * Pi 1.4.0 in a PTY): `/login <provider>` + Enter shows the autocomplete row, a second Enter opens
 * the method picker, a third picks its default "Sign in with <Provider>" entry. Pi then prints the
 * authorization URL and `…paste the authorization code / redirect URL here:`.
 */
export function resolvePiTuiLoginInput(provider: string): readonly QaapAgentLoginInputStep[] {
    return [
        { text: `/login ${provider}`, waitFor: PI_READY_PATTERN, fallbackMs: 8_000 },
        { text: '\r' },
        { text: '\r', skipWhen: PI_AUTH_METHOD_PICKER_PATTERN },
        { text: '\r', waitFor: PI_AUTH_METHOD_PICKER_PATTERN },
    ];
}

/** A deliberate route for the Work Hub Connect action. */
export type QaapAgentConnectionFlow =
    | { readonly kind: 'cli-login'; readonly command: string }
    /**
     * Interactive CLI without a login subcommand (Pi): `command` starts it in the hidden sign-in
     * terminal and `input` drives it to the sign-in link. `fallbackCommand` + `followUp` are the
     * manual route the dialog still offers through "Open terminal".
     */
    | {
        readonly kind: 'tui-login';
        readonly command: string;
        readonly provider: string;
        readonly input: readonly QaapAgentLoginInputStep[];
        readonly fallbackCommand: string;
        readonly followUp: string;
    }
    | { readonly kind: 'settings-api-key'; readonly settingsQuery: string }
    /** `followUp`: what to type inside the CLI once it starts (e.g. Pi's `/login`). */
    | { readonly kind: 'tenant-terminal'; readonly command: string; readonly followUp?: string }
    | { readonly kind: 'hosted-restricted' }
    | { readonly kind: 'unsupported' };

/**
 * Resolve a usable connect route. A hidden terminal is only used for CLIs with a dedicated
 * login command that prints a device/OAuth challenge, or (Pi) a TUI whose `/login` dialog is
 * driven by verified keystrokes up to its link and paste-back prompt. Other interactive
 * onboarding stays visible to the user by returning instructions for the tenant terminal
 * instead of launching a TUI in an inaccessible staging surface.
 *
 * `provider` only applies to Pi (`/login <provider>`); it defaults to OpenRouter.
 */
export function resolveAgentConnectionFlow(
    agentId: string | undefined,
    options?: { readonly provider?: string },
): QaapAgentConnectionFlow {
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
    if (agentNeedsSettingsApiKeyPath(normalized)) {
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
    if (normalized === 'pi') {
        const requested = options?.provider?.trim().toLowerCase();
        const provider = requested && PI_PROVIDER_ID_RE.test(requested) ? requested : QAAP_PI_DEFAULT_LOGIN_PROVIDER;
        return {
            kind: 'tui-login',
            command: QAAP_PI_TUI_LOGIN_COMMAND,
            provider,
            input: resolvePiTuiLoginInput(provider),
            fallbackCommand: tenantCommand,
            followUp: '/login',
        };
    }
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
