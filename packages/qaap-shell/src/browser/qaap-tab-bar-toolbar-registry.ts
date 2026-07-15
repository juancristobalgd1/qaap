// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { ReactTabBarToolbarAction, RenderedToolbarAction } from '@theia/core/lib/browser/shell/tab-bar-toolbar/tab-bar-toolbar-types';

/** Tab-bar toolbar items that close the bottom panel for any bottom-area tab. */
export const BOTTOM_PANEL_CLOSE_TOOLBAR_ITEM_IDS = new Set([
    'terminal:manager-close-bottom-panel',
]);

/**
 * Higher priority renders farther right in the bottom-panel tab-bar toolbar.
 *
 * Sort pipeline: `PRIORITY_COMPARATOR` (ascending) → `.reverse()` in
 * `tab-bar-toolbar.tsx` → CSS `flex-direction: row-reverse` on `.lm-TabBar-toolbar`.
 * The JS reverse and CSS row-reverse cancel out, so the type doc applies visually:
 * smaller priority = left, larger priority = right.
 *
 * Output lock/clear use up to 2; debug-console widgets use -3…0. Stay well above those.
 */
export const BOTTOM_PANEL_CLOSE_TOOLBAR_PRIORITY = 1000;

@injectable()
export class QaapTabBarToolbarRegistry extends TabBarToolbarRegistry {

    override registerItem(item: RenderedToolbarAction | ReactTabBarToolbarAction) {
        if (BOTTOM_PANEL_CLOSE_TOOLBAR_ITEM_IDS.has(item.id)) {
            return super.registerItem({
                ...item,
                priority: BOTTOM_PANEL_CLOSE_TOOLBAR_PRIORITY,
            });
        }
        return super.registerItem(item);
    }
}
