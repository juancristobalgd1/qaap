// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { getThemeMode, type Theme } from '@theia/core/lib/common/theme';
import {
    QAAP_APPEARANCE_DEFAULT_DARK_THEME_ID,
    QAAP_APPEARANCE_DEFAULT_LIGHT_THEME_ID,
    QaapAppearanceMode,
    QaapAppearanceThemePair,
    prefersDarkColorScheme,
    readQaapAppearanceMode,
    readQaapAppearanceThemePair,
    resolveQaapAppearanceThemeId,
    writeQaapAppearanceMode,
    writeQaapAppearancePreferredTheme,
} from '../common/qaap-appearance-mode';

/**
 * Light / Dark / System control for the avatar account menu.
 *
 * Light and Dark navigate the remembered theme pair (preferred light theme ↔
 * preferred dark theme). Picking a color theme elsewhere updates the matching
 * side of that pair, so the switch never snaps back to built-in Qaap Light/Dark
 * unless those are still the remembered preferences. System follows the OS
 * between the same pair.
 */
@injectable()
export class QaapAppearanceModeService implements FrontendApplicationContribution {

    @inject(ThemeService)
    protected readonly themeService: ThemeService;

    protected mode: QaapAppearanceMode = 'system';
    protected hasExplicitMode = false;
    protected applyingTheme = false;
    protected pair: QaapAppearanceThemePair = {
        lightThemeId: QAAP_APPEARANCE_DEFAULT_LIGHT_THEME_ID,
        darkThemeId: QAAP_APPEARANCE_DEFAULT_DARK_THEME_ID,
    };
    protected readonly onDidChangeModeEmitter = new Emitter<QaapAppearanceMode>();
    protected readonly toDispose = new DisposableCollection();
    protected mediaListener = Disposable.NULL;
    protected started = false;

    readonly onDidChangeMode: Event<QaapAppearanceMode> = this.onDidChangeModeEmitter.event;

    onStart(): void {
        if (this.started) {
            return;
        }
        this.started = true;
        this.pair = readQaapAppearanceThemePair();
        const stored = readQaapAppearanceMode();
        this.hasExplicitMode = stored !== undefined;
        this.mode = stored ?? this.inferModeFromCurrentTheme();
        void this.themeService.initialized.then(() => {
            this.rememberCurrentThemeInPair();
            if (!this.hasExplicitMode) {
                this.mode = this.inferModeFromCurrentTheme();
                this.onDidChangeModeEmitter.fire(this.mode);
                return;
            }
            this.applyResolvedTheme();
            this.syncMediaListener();
        });
        this.toDispose.push(this.themeService.onDidColorThemeChange(() => {
            if (this.applyingTheme) {
                return;
            }
            this.rememberCurrentThemeInPair();
            this.syncModeFromActiveTheme();
        }));
    }

    onStop(): void {
        this.mediaListener.dispose();
        this.mediaListener = Disposable.NULL;
        this.toDispose.dispose();
        this.onDidChangeModeEmitter.dispose();
        this.started = false;
    }

    getMode(): QaapAppearanceMode {
        if (this.hasExplicitMode && this.mode === 'system') {
            return 'system';
        }
        if (this.hasExplicitMode && (this.mode === 'light' || this.mode === 'dark')) {
            return this.mode;
        }
        return this.inferModeFromCurrentTheme();
    }

    setMode(mode: QaapAppearanceMode): void {
        this.mode = mode;
        this.hasExplicitMode = true;
        writeQaapAppearanceMode(mode);
        this.applyResolvedTheme();
        this.syncMediaListener();
        this.onDidChangeModeEmitter.fire(mode);
    }

    protected inferModeFromCurrentTheme(): QaapAppearanceMode {
        const theme = this.themeService.getCurrentTheme();
        return this.themeSide(theme) === 'light' ? 'light' : 'dark';
    }

    protected themeSide(theme: Theme | undefined): 'light' | 'dark' {
        if (!theme) {
            return 'dark';
        }
        if (theme.id === this.pair.lightThemeId) {
            return 'light';
        }
        if (theme.id === this.pair.darkThemeId) {
            return 'dark';
        }
        return getThemeMode(theme.type) === 'light' ? 'light' : 'dark';
    }

    /** When the user picks a color theme, remember it as this pair's light or dark side. */
    protected rememberCurrentThemeInPair(): void {
        const theme = this.themeService.getCurrentTheme();
        if (!theme?.id) {
            return;
        }
        const side = getThemeMode(theme.type) === 'light' ? 'light' : 'dark';
        if (side === 'light') {
            this.pair = { ...this.pair, lightThemeId: theme.id };
        } else {
            this.pair = { ...this.pair, darkThemeId: theme.id };
        }
        writeQaapAppearancePreferredTheme(side, theme.id);
    }

    /**
     * Keep Light/Dark selection aligned with the active theme when the user changes
     * color theme elsewhere. System stays selected until they explicitly pick Light/Dark.
     */
    protected syncModeFromActiveTheme(): void {
        if (this.mode === 'system' && this.hasExplicitMode) {
            return;
        }
        const next = this.inferModeFromCurrentTheme();
        if (next === this.mode && this.hasExplicitMode) {
            return;
        }
        this.mode = next;
        if (this.hasExplicitMode) {
            writeQaapAppearanceMode(next);
        }
        this.onDidChangeModeEmitter.fire(this.getMode());
    }

    protected applyResolvedTheme(): void {
        const requestedId = resolveQaapAppearanceThemeId(this.mode, this.pair);
        const themeId = this.resolveExistingThemeId(requestedId);
        this.applyingTheme = true;
        try {
            this.themeService.setCurrentTheme(themeId, true);
            try {
                window.localStorage.setItem(ThemeService.STORAGE_KEY, themeId);
            } catch {
                // ignore
            }
        } finally {
            this.applyingTheme = false;
        }
    }

    protected resolveExistingThemeId(themeId?: string): string {
        const themes = this.themeService.getThemes();
        if (themeId && themes.some(theme => theme.id === themeId)) {
            return themeId;
        }
        const wantLight = this.mode === 'light'
            || (this.mode === 'system' && !prefersDarkColorScheme());
        const fallback = wantLight
            ? QAAP_APPEARANCE_DEFAULT_LIGHT_THEME_ID
            : QAAP_APPEARANCE_DEFAULT_DARK_THEME_ID;
        return themes.some(theme => theme.id === fallback)
            ? fallback
            : (themes[0]?.id ?? themeId ?? '');
    }

    protected syncMediaListener(): void {
        this.mediaListener.dispose();
        this.mediaListener = Disposable.NULL;
        if (this.mode !== 'system'
            || typeof window === 'undefined'
            || typeof window.matchMedia !== 'function') {
            return;
        }
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = (): void => this.applyResolvedTheme();
        mediaQuery.addEventListener('change', onChange);
        this.mediaListener = Disposable.create(() => mediaQuery.removeEventListener('change', onChange));
    }
}
