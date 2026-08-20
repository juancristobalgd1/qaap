// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Build a preference markdown `command:` link that opens AI Configuration on a tab.
 * Query is JSON-encoded so {@link CommandOpenHandler} passes a single string arg.
 */
export function buildAiConfigurationCommandLink(tabId: string): string {
    return `command:aiConfiguration:open?${encodeURIComponent(JSON.stringify(tabId))}`;
}

/**
 * Normalize the first argument from `aiConfiguration:open` (string, array, or URI query residue).
 */
export function resolveAiConfigurationTabArg(
    tabId: unknown,
    fallback: string,
): string {
    if (typeof tabId === 'string' && tabId.trim().length > 0) {
        const trimmed = tabId.trim();
        // Guard against accidental JSON quotes in the raw query.
        if ((trimmed.startsWith('"') && trimmed.endsWith('"'))
            || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
            try {
                const parsed = JSON.parse(trimmed.startsWith("'")
                    ? `"${trimmed.slice(1, -1)}"`
                    : trimmed);
                if (typeof parsed === 'string' && parsed.trim().length > 0) {
                    return parsed.trim();
                }
            } catch {
                // fall through
            }
        }
        return trimmed;
    }
    if (Array.isArray(tabId) && typeof tabId[0] === 'string' && tabId[0].trim().length > 0) {
        return tabId[0].trim();
    }
    return fallback;
}
