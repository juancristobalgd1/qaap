// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { Widget } from '@theia/core/lib/browser/widgets';
import { NavigatableWidget } from '@theia/core/lib/browser/navigatable-types';
import { Saveable } from '@theia/core/lib/browser/saveable';
import { WindowTitleUpdater } from '@theia/core/lib/browser/window/window-title-updater';
import { isQaapPreviewWidgetUri } from './qaap-preview-widget-uri';
import { qaapPreviewWindowTitle } from './qaap-preview-window-title';

/**
 * Keeps preview tabs out of the window title.
 *
 * Preview widgets are navigatable with a synthetic URI whose last segment is the project digest,
 * so the upstream updater would show that id (e.g. `10e08g01li1muu - qaap`). Preview tabs get a
 * readable label instead; every other widget keeps the upstream behavior.
 */
@injectable()
export class QaapWindowTitleUpdater extends WindowTitleUpdater {

    protected override updateTitleWidget(widget?: Widget): void {
        if (!isQaapPreviewWidgetUri(NavigatableWidget.getUri(widget))) {
            super.updateTitleWidget(widget);
            return;
        }
        const label = qaapPreviewWindowTitle();
        this.windowTitleService.update({
            activeEditorLong: label,
            activeEditorMedium: label,
            activeEditorShort: label,
            activeFolderLong: undefined,
            activeFolderMedium: undefined,
            activeFolderShort: undefined,
            dirty: Saveable.isDirty(widget) ? '●' : undefined,
        });
    }

}
