// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { getThemeMode, type Theme } from '@theia/core/lib/common/theme';

/**
 * Toggles `qaap-theme-light` / `qaap-theme-dark` on `document.body` when the
 * branded "Light (Qaap)" / "Dark (Qaap)" themes are active. All Qaap palette /
 * radius / shadow overrides live behind these classes in
 * `style/qaap-tokens.css`, so:
 *
 *  - Marketplace themes, High Contrast and any custom user theme keep their
 *    own colors untouched.
 *  - Switching from `Dark (Qaap)` to e.g. `One Dark Pro` cleanly removes the
 *    Qaap graphite accent and warm hairlines, no leftovers.
 *
 * The Qaap built-in themes are registered by
 * {@link QaapBuiltinThemeBrandingContribution} with ids `light` / `dark`,
 * matching Theia's upstream BuiltinThemeProvider — that's what we match on.
 */
@injectable()
export class QaapThemeContribution implements FrontendApplicationContribution {

    /** Theme ids that should receive Qaap styling (kept in sync with the
     * `QaapBuiltinThemeBrandingContribution` registrations). */
    protected static readonly QAAP_THEME_IDS: ReadonlyMap<string, readonly string[]> = new Map([
        ['light', ['qaap-theme-light']],
        ['dark', ['qaap-theme-dark']],
        // High Contrast keeps its own canvas (black / white); `qaap-theme-hc` only swaps the VS Code
        // HC blues and cyans for neutral greys, like the Qaap dark / light accents.
        ['hc-theia', ['qaap-theme-hc', 'qaap-theme-hc-dark']],
        ['hc-theia-light', ['qaap-theme-hc', 'qaap-theme-hc-light']]
    ]);

    @inject(ThemeService)
    protected readonly themeService: ThemeService;

    onStart(): void {
        this.applyTheme(this.themeService.getCurrentTheme());
        this.themeService.onDidColorThemeChange(event => {
            this.applyTheme(event.newTheme);
        });
    }

    protected applyTheme(theme: Theme): void {
        const body = document.body;
        body.dataset.theiaThemeMode = getThemeMode(theme.type);
        // Clear any previous Qaap class so theme switches don't leave both on.
        for (const cssClasses of QaapThemeContribution.QAAP_THEME_IDS.values()) {
            body.classList.remove(...cssClasses);
        }
        const next = QaapThemeContribution.QAAP_THEME_IDS.get(theme.id);
        if (next) {
            body.classList.add(...next);
        }
    }
}
