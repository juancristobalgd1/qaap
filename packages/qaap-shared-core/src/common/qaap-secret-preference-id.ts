// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Matches preference ids whose string value is a credential (API keys, tokens, secrets). */
const QAAP_SECRET_PREFERENCE_ID_PATTERN = /(api[_-]?key|token|secret)$/i;

/**
 * Whether a preference id names a credential that must not be shown in plain text in the
 * settings editor (e.g. `ai-features.openrouter.openrouterApiKey`) and must be sealed at rest.
 */
export function isQaapSecretPreferenceId(preferenceId: string): boolean {
    return QAAP_SECRET_PREFERENCE_ID_PATTERN.test(preferenceId);
}
