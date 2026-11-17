// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ElectronMainMenuFactory } from '@theia/core/lib/electron-browser/menu/electron-main-menu-factory';
import { peekPreferDesktopIde } from '@theia/qaap-shared-core/lib/common/qaap-mobile-work-surface-preference';

/**
 * Rebuilds the native menu bar when the active surface flips between the Work Hub and the classic IDE.
 *
 * Every surface change goes through `markPreferDesktopIde` / `clearPreferDesktopIde`, and both sync the
 * {@link QAAP_MOBILE_DESKTOP_IDE_BODY_CLASS} class on `body`. Watching that class therefore catches
 * the switch, the reload restore and the narrow-viewport reset without touching their callers.
 */
@injectable()
export class QaapWorkHubNativeMenuContribution implements FrontendApplicationContribution {

    @inject(ElectronMainMenuFactory)
    protected readonly menuFactory: ElectronMainMenuFactory;

    protected lastIdeSurface = false;
    protected observer: MutationObserver | undefined;

    onStart(): void {
        this.lastIdeSurface = peekPreferDesktopIde();
        if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
            this.observer = new MutationObserver(() => this.onSurfaceClassMaybeChanged());
            this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        }
        this.menuFactory.setMenuBar();
    }

    protected onSurfaceClassMaybeChanged(): void {
        const ideSurface = peekPreferDesktopIde();
        if (ideSurface !== this.lastIdeSurface) {
            this.lastIdeSurface = ideSurface;
            this.menuFactory.setMenuBar();
        }
    }
}
