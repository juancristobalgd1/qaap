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
 * Headless task template for a resolved Antigravity CLI. Gemini (`-m`) and `agy` (`--model`) take
 * `{model_flags}`; the template only carries a flag the host can fill, so `auto` or an unset model adds
 * none. The community CLI reads its model from its own settings and takes no model flag. `{prompt}` is
 * the placeholder the transport fills (stdin `-` for agy and the others, see resolveAgentPromptTransport).
 */
export function resolveAntigravityCliTemplate(bin: QaapAntigravityCliBin): string {
    if (bin === 'gemini') {
        return 'gemini --approval-mode=yolo {model_flags} -p {prompt}';
    }
    if (bin === 'agy') {
        return 'agy {model_flags} -p {prompt}';
    }
    return `${bin} -p {prompt}`;
}
