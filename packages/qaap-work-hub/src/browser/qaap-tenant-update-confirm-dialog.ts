// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { nls } from '@theia/core/lib/common/nls';

/** Asks before "Update now" interrupts agent turns. Uses the product's own confirm dialog, never `window.confirm`. */
@injectable()
export class QaapTenantUpdateConfirmDialog {

    /** Resolves `true` only when the user explicitly accepts the interruption. */
    async confirm(runningTasks: number): Promise<boolean> {
        // Loaded on first use: the dialog module touches the DOM while loading, and the service stays DOM-free until then.
        const { ConfirmDialog } = await import('@theia/core/lib/browser/dialogs');
        const dialog = new ConfirmDialog({
            title: nls.localize('qaap/tenantUpdate/confirmTitle', 'Update Qaap now?'),
            msg: nls.localize('qaap/tenantUpdate/confirmMessage',
                'This will stop {0} running agent turn(s). Update anyway?', runningTasks),
            ok: nls.localize('qaap/tenantUpdate/confirmOk', 'Update anyway'),
            cancel: nls.localizeByDefault('Cancel'),
        });
        return await dialog.open() === true;
    }
}
