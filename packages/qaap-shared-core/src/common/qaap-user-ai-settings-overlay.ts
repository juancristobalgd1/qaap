// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { usesSharedAiSettingsFallback } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';

/**
 * Authenticated tenants must not write AI/BYOK prefs into Theia's process-wide User
 * `settings.json`. That file is one backend and would leak User A's keys into User B's
 * Settings UI. Spawn already reads `~/.qaap/users/{login}/settings.json`.
 */
export function shouldInterceptSharedUserAiPrefWrites(userLogin: string | undefined): boolean {
    return !usesSharedAiSettingsFallback(userLogin);
}

export function applyAiSettingsOverlay(
    overlay: Map<string, unknown>,
    settings: Record<string, unknown>,
    isAiPrefKey: (name: string) => boolean,
): string[] {
    const applied: string[] = [];
    for (const [key, value] of Object.entries(settings)) {
        if (!isAiPrefKey(key)) {
            continue;
        }
        overlay.set(key, value);
        applied.push(key);
    }
    return applied;
}

export function collectAiSettingsForPersist(
    overlay: ReadonlyMap<string, unknown>,
    keys: Iterable<string>,
    fallback: (key: string) => unknown,
): Record<string, unknown> {
    const settings: Record<string, unknown> = {};
    for (const key of keys) {
        const value = overlay.has(key) ? overlay.get(key) : fallback(key);
        if (value !== undefined) {
            settings[key] = value;
        }
    }
    return settings;
}

export function overlayPrefGet<T>(
    overlay: ReadonlyMap<string, unknown>,
    preferenceName: string,
    fallback: () => T,
): T {
    if (overlay.has(preferenceName)) {
        return overlay.get(preferenceName) as T;
    }
    return fallback();
}
