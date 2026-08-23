// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** User preference containing the Work Hub harness ids that are disabled. */
export const QAAP_DISABLED_HARNESSES_PREF = 'ai-features.harness.disabledAgents';

export function readDisabledHarnessIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return [...new Set(value
        .filter((entry): entry is string => typeof entry === 'string')
        .map(entry => entry.trim().toLowerCase())
        .filter(entry => entry.length > 0))];
}

export function isQaapHarnessEnabled(harnessId: string, disabledIds: readonly string[]): boolean {
    const normalizedId = harnessId.trim().toLowerCase();
    return normalizedId.length > 0 && !disabledIds.some(id => id.trim().toLowerCase() === normalizedId);
}

export function withQaapHarnessEnabled(
    disabledIds: readonly string[],
    harnessId: string,
    enabled: boolean,
): string[] {
    const normalizedId = harnessId.trim().toLowerCase();
    const withoutHarness = disabledIds
        .filter(id => id.trim().toLowerCase() !== normalizedId)
        .map(id => id.trim().toLowerCase())
        .filter(id => id.length > 0);
    if (enabled) {
        return [...new Set(withoutHarness)].sort((a, b) => a.localeCompare(b));
    }
    return [...new Set([...withoutHarness, normalizedId])].sort((a, b) => a.localeCompare(b));
}
