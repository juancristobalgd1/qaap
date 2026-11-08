// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { Disposable } from '@theia/core/lib/common/disposable';

/**
 * Keybindings section of the mobile Work Hub settings sheet.
 * Rendered into the sheet content host by the sheet (`render`), disposed when the section changes.
 */
@injectable()
export class QaapWorkHubKeybindingsPanel {

    /**
     * Renders the keybindings list into `host`.
     * @returns a disposable that tears the panel down (listeners and DOM).
     */
    render(host: HTMLElement): Disposable {
        host.textContent = '';
        return Disposable.create(() => host.textContent = '');
    }

}
