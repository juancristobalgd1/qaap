// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** The executables the Antigravity harness can run as. */
export type QaapAntigravityCliBin = 'gemini' | 'agy' | 'antigravity';

/**
 * Preference order shared by every Antigravity path (headless task template, interactive TUI, Connect
 * login and status probe). `agy` (Google's Antigravity CLI) comes first: Google retired the "Login with
 * Google" sign-in of individual accounts in Gemini CLI on 18 Jun 2026 (the server answers
 * `IneligibleTierError` / `UNSUPPORTED_CLIENT`), so `agy` is the supported client. It has no login
 * subcommand, so Connect hands its sign-in to the user's own terminal. `gemini` stays as a fallback only
 * on hosts where `agy` is not installed. `antigravity` is the community CLI that drives a running desktop
 * app; it is the last resort.
 */
export const QAAP_ANTIGRAVITY_CLI_BIN_PREFERENCE: readonly QaapAntigravityCliBin[] = ['agy', 'gemini', 'antigravity'];

/** The bin the host should use: the first preferred CLI for which `isOnPath` answers true, else `undefined`. */
export function resolveAntigravityCliBin(isOnPath: (bin: string) => boolean): QaapAntigravityCliBin | undefined {
    return QAAP_ANTIGRAVITY_CLI_BIN_PREFERENCE.find(bin => isOnPath(bin));
}

/** Narrows a binary name reported by the server (agent descriptor / harness status) to a known Antigravity CLI. */
export function normalizeAntigravityCliBin(value: string | undefined): QaapAntigravityCliBin | undefined {
    const trimmed = value?.trim();
    return QAAP_ANTIGRAVITY_CLI_BIN_PREFERENCE.find(bin => bin === trimmed);
}

/**
 * Headless task template for a resolved Antigravity CLI. Gemini takes `{model_flags}` (`-m`). `agy` and
 * the community CLI read their model from `~/.gemini/antigravity-cli/settings.json` (qaap-antigravity-settings),
 * so they take no model flag. `{prompt}` is the placeholder the transport fills: the quoted prompt in argv for agy,
 * which reads nothing from stdin in text mode (see resolveAgentPromptTransport).
 */
export function resolveAntigravityCliTemplate(bin: QaapAntigravityCliBin): string {
    return bin === 'gemini'
        ? 'gemini --approval-mode=yolo {model_flags} -p {prompt}'
        : `${bin} -p {prompt}`;
}
