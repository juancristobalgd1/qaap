// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, interfaces } from '@theia/core/shared/inversify';
import { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { ShellLayoutRestorer } from '@theia/core/lib/browser/shell/shell-layout-restorer';
import { QaapPluginHostFrontend } from './qaap-phone-debug-service';

/**
 * `ShellLayoutRestorer` for the phone entry (bundle.mobile.js), which only shows the Work Hub.
 *
 * The phone entry has none of the IDE-only modules, so its shell layout is not an IDE layout. It
 * shares `localStorage` with the desktop entry: a narrow window that is widened reloads into
 * bundle.js in the same tab (qaap-login-gate.js). When the phone entry stored its layout on that
 * unload, the desktop entry restored it instead of building the default IDE layout and never finished
 * starting (no keybindings, no command palette, "Open IDE" did nothing). Phones neither store nor
 * restore the layout. The active surface survives reloads through sessionStorage, not the layout.
 */
@injectable()
export class QaapPhoneShellLayoutRestorer extends ShellLayoutRestorer {

    override storeLayout(_app: FrontendApplication): void {
        // Never persist the Work Hub-only shell (see the class comment).
    }

    override async restoreLayout(_app: FrontendApplication): Promise<boolean> {
        // A layout stored by the desktop entry references IDE widgets this entry cannot build.
        return false;
    }
}

export namespace QaapPhoneShellLayoutRestorer {
    /**
     * Rebinds `ShellLayoutRestorer` on the phone entry only, i.e. when `qaap-product-plugin-frontend-module`
     * (desktop only, loaded earlier) did not bind {@link QaapPluginHostFrontend}.
     */
    export function rebindOnPhoneEntry(bind: interfaces.Bind, isBound: interfaces.IsBound, rebind: interfaces.Rebind): void {
        if (isBound(QaapPluginHostFrontend)) {
            return;
        }
        bind(QaapPhoneShellLayoutRestorer).toSelf().inSingletonScope();
        rebind(ShellLayoutRestorer).toService(QaapPhoneShellLayoutRestorer);
    }
}
