// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Appearance mode for the Work Hub switch.
 * Light/Dark map to the active Qaap product themes; System picks between those via the OS.
 */
export type QaapAppearanceMode = 'light' | 'dark' | 'system';

/** Persists Light / Dark / System across reloads. */
export const QAAP_APPEARANCE_MODE_KEY = 'qaap.appearance.mode';

/** Qaap product theme ids (`QaapBuiltinThemeBrandingContribution` — Light/Dark (Qaap)). */
export const QAAP_APPEARANCE_LIGHT_THEME_ID = 'light';
export const QAAP_APPEARANCE_DARK_THEME_ID = 'dark';

export function isQaapAppearanceMode(value: unknown): value is QaapAppearanceMode {
    return value === 'light' || value === 'dark' || value === 'system';
}

/** Returns the stored mode, or `undefined` when the user has never used the appearance switch. */
export function readQaapAppearanceMode(
    storage: Pick<Storage, 'getItem'> | undefined = defaultStorage(),
): QaapAppearanceMode | undefined {
    if (!storage) {
        return undefined;
    }
    try {
        const raw = storage.getItem(QAAP_APPEARANCE_MODE_KEY);
        return isQaapAppearanceMode(raw) ? raw : undefined;
    } catch {
        return undefined;
    }
}

/** Stored mode, or `system` as the UI default before the user picks. */
export function readQaapAppearanceModeOrDefault(
    storage: Pick<Storage, 'getItem'> | undefined = defaultStorage(),
): QaapAppearanceMode {
    return readQaapAppearanceMode(storage) ?? 'system';
}

export function writeQaapAppearanceMode(
    mode: QaapAppearanceMode,
    storage: Pick<Storage, 'setItem'> | undefined = defaultStorage(),
): void {
    if (!storage) {
        return;
    }
    try {
        storage.setItem(QAAP_APPEARANCE_MODE_KEY, mode);
    } catch {
        // Quota / private mode — ignore; in-memory mode still applies for the session.
    }
}

/** Resolve the Qaap Light/Dark theme id for a mode (System follows `prefers-color-scheme`). */
export function resolveQaapAppearanceThemeId(
    mode: QaapAppearanceMode,
    prefersDark: boolean = prefersDarkColorScheme(),
): typeof QAAP_APPEARANCE_LIGHT_THEME_ID | typeof QAAP_APPEARANCE_DARK_THEME_ID {
    if (mode === 'light') {
        return QAAP_APPEARANCE_LIGHT_THEME_ID;
    }
    if (mode === 'dark') {
        return QAAP_APPEARANCE_DARK_THEME_ID;
    }
    return prefersDark ? QAAP_APPEARANCE_DARK_THEME_ID : QAAP_APPEARANCE_LIGHT_THEME_ID;
}

export function prefersDarkColorScheme(
    matchMedia: ((query: string) => MediaQueryList) | undefined = defaultMatchMedia(),
): boolean {
    if (!matchMedia) {
        return false;
    }
    try {
        return matchMedia('(prefers-color-scheme: dark)').matches === true;
    } catch {
        return false;
    }
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
    if (typeof window === 'undefined' || !window.localStorage) {
        return undefined;
    }
    return window.localStorage;
}

function defaultMatchMedia(): ((query: string) => MediaQueryList) | undefined {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return undefined;
    }
    return query => window.matchMedia(query);
}
