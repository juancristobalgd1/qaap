// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** The executables the Antigravity harness can run as. */
export type QaapAntigravityCliBin = 'gemini' | 'agy' | 'antigravity';

/**
 * Preference order shared by every Antigravity path (headless task template, interactive TUI, Connect
 * login and status probe). `gemini` comes first: it signs in from the Connect dialog ("Login with
 * Google") and runs headless `-p`. `agy` (Google's Antigravity CLI) has no login subcommand, so Connect
 * hands its sign-in to the user's own terminal. `antigravity` is the community CLI that drives a running
 * desktop app; it is the last resort.
 */
export const QAAP_ANTIGRAVITY_CLI_BIN_PREFERENCE: readonly QaapAntigravityCliBin[] = ['gemini', 'agy', 'antigravity'];

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
 * Headless task template for a resolved Antigravity CLI. Gemini takes `{model_flags}` (`-m`); `agy` and
 * the community CLI read their model from settings, so they take no model flag.
 */
export function resolveAntigravityCliTemplate(bin: QaapAntigravityCliBin): string {
    return bin === 'gemini'
        ? 'gemini --approval-mode=yolo {model_flags} -p {prompt}'
        : `${bin} -p {prompt}`;
}
