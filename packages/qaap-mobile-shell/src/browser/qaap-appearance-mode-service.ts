// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { getThemeMode } from '@theia/core/lib/common/theme';
import {
    QAAP_APPEARANCE_DARK_THEME_ID,
    QAAP_APPEARANCE_LIGHT_THEME_ID,
    QaapAppearanceMode,
    readQaapAppearanceMode,
    resolveQaapAppearanceThemeId,
    writeQaapAppearanceMode,
} from '../common/qaap-appearance-mode';

/**
 * Light / Dark / System control for the Work Hub sessions sidebar.
 *
 * Light and Dark are the active Qaap product themes (`light` / `dark` — "Light (Qaap)" /
 * "Dark (Qaap)"), not a parallel skin. System picks between those same two themes using
 * `prefers-color-scheme`.
 *
 * Until the user picks a mode, startup leaves the current Theia theme alone and the switch
 * selection mirrors that theme's light/dark mode.
 */
@injectable()
export class QaapAppearanceModeService implements FrontendApplicationContribution {

    @inject(ThemeService)
    protected readonly themeService: ThemeService;

    protected mode: QaapAppearanceMode = 'system';
    protected hasExplicitMode = false;
    protected applyingTheme = false;
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
        const stored = readQaapAppearanceMode();
        this.hasExplicitMode = stored !== undefined;
        this.mode = stored ?? this.inferModeFromCurrentTheme();
        void this.themeService.initialized.then(() => {
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
            this.syncModeFromActiveQaapTheme();
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
        // No explicit pick yet — selection follows the active Qaap / Theia theme.
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
        if (theme?.id === QAAP_APPEARANCE_LIGHT_THEME_ID) {
            return 'light';
        }
        if (theme?.id === QAAP_APPEARANCE_DARK_THEME_ID) {
            return 'dark';
        }
        const themeMode = getThemeMode(theme?.type ?? 'dark');
        return themeMode === 'light' ? 'light' : 'dark';
    }

    /**
     * Keep Light/Dark selection aligned with the active Qaap theme when the user changes
     * color theme elsewhere (e.g. Color Theme picker). System stays selected until they
     * explicitly pick Light or Dark.
     */
    protected syncModeFromActiveQaapTheme(): void {
        if (this.mode === 'system' && this.hasExplicitMode) {
            return;
        }
        const next = this.inferModeFromCurrentTheme();
        if (next === this.mode && this.hasExplicitMode) {
            return;
        }
        this.mode = next;
        // Mirror an external theme pick into the appearance preference so reload stays consistent.
        if (this.hasExplicitMode) {
            writeQaapAppearanceMode(next);
        }
        this.onDidChangeModeEmitter.fire(this.getMode());
    }

    protected applyResolvedTheme(): void {
        const themeId = resolveQaapAppearanceThemeId(this.mode);
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
