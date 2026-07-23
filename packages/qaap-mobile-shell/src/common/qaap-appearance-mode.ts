// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Appearance mode for the Work Hub switch.
 *
 * Light/Dark toggle the light vs dark side of the user's current theme pair
 * (preferred light / preferred dark). They do not force the built-in Qaap
 * `light`/`dark` ids unless those are still the remembered pair. System picks
 * between the same preferred pair via the OS color scheme.
 */
export type QaapAppearanceMode = 'light' | 'dark' | 'system';

/** Persists Light / Dark / System across reloads. */
export const QAAP_APPEARANCE_MODE_KEY = 'qaap.appearance.mode';

/** Last light-side theme id chosen for the appearance pair. */
export const QAAP_APPEARANCE_PREFERRED_LIGHT_THEME_KEY = 'qaap.appearance.preferredLightTheme';

/** Last dark-side theme id chosen for the appearance pair. */
export const QAAP_APPEARANCE_PREFERRED_DARK_THEME_KEY = 'qaap.appearance.preferredDarkTheme';

/** Built-in fallbacks when the user has not picked a custom pair yet. */
export const QAAP_APPEARANCE_DEFAULT_LIGHT_THEME_ID = 'light';
export const QAAP_APPEARANCE_DEFAULT_DARK_THEME_ID = 'dark';

export interface QaapAppearanceThemePair {
    readonly lightThemeId: string;
    readonly darkThemeId: string;
}

export function isQaapAppearanceMode(value: unknown): value is QaapAppearanceMode {
    return typeof value === 'string' && (value === 'light' || value === 'dark' || value === 'system');
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

export function readQaapAppearanceThemePair(
    storage: Pick<Storage, 'getItem'> | undefined = defaultStorage(),
): QaapAppearanceThemePair {
    return {
        lightThemeId: readStoredThemeId(storage, QAAP_APPEARANCE_PREFERRED_LIGHT_THEME_KEY)
            ?? QAAP_APPEARANCE_DEFAULT_LIGHT_THEME_ID,
        darkThemeId: readStoredThemeId(storage, QAAP_APPEARANCE_PREFERRED_DARK_THEME_KEY)
            ?? QAAP_APPEARANCE_DEFAULT_DARK_THEME_ID,
    };
}

export function writeQaapAppearancePreferredTheme(
    mode: 'light' | 'dark',
    themeId: string,
    storage: Pick<Storage, 'setItem'> | undefined = defaultStorage(),
): void {
    if (!storage || !themeId.trim()) {
        return;
    }
    const key = mode === 'light'
        ? QAAP_APPEARANCE_PREFERRED_LIGHT_THEME_KEY
        : QAAP_APPEARANCE_PREFERRED_DARK_THEME_KEY;
    try {
        storage.setItem(key, themeId);
    } catch {
        // ignore
    }
}

/**
 * Resolve which concrete theme id to activate for a mode, using the remembered
 * light/dark pair (not hard-coded Qaap ids).
 */
export function resolveQaapAppearanceThemeId(
    mode: QaapAppearanceMode,
    pair: QaapAppearanceThemePair = readQaapAppearanceThemePair(),
    prefersDark: boolean = prefersDarkColorScheme(),
): string {
    if (mode === 'light') {
        return pair.lightThemeId;
    }
    if (mode === 'dark') {
        return pair.darkThemeId;
    }
    return prefersDark ? pair.darkThemeId : pair.lightThemeId;
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

function readStoredThemeId(
    storage: Pick<Storage, 'getItem'> | undefined,
    key: string,
): string | undefined {
    if (!storage) {
        return undefined;
    }
    try {
        const raw = storage.getItem(key)?.trim();
        return raw || undefined;
    } catch {
        return undefined;
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
