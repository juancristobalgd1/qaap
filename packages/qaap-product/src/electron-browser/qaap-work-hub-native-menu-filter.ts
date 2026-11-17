// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { MAIN_MENU_BAR } from '@theia/core/lib/common/menu/menu-types';

/**
 * Native (Electron) menu-bar filter for the Work Hub surface.
 *
 * With the Work Hub active the native menu bar keeps only the entries that make sense there:
 * - top level: File (settings group only), Edit, View and Help. Selection, Go, Run and Terminal are hidden,
 *   and so is any top-level menu this list does not name (plugin or product menus).
 * - Edit: the native clipboard and undo roles only, so they keep working in the Work Hub inputs.
 * - View: Toggle Full Screen only.
 *
 * Ids are the literal menu and command ids of `@theia/core` (`CommonMenus`, `CommonCommands`,
 * `ElectronCommands`); they are spelled out here so this module stays free of browser imports.
 * The IDE surface never uses this filter.
 */

/** Top-level menubar children (`CommonMenus.FILE`, `EDIT`, `VIEW`, `HELP`) kept on the Work Hub. */
export const WORK_HUB_NATIVE_TOP_LEVEL_MENU_IDS: ReadonlySet<string> = new Set<string>([
    '1_file',
    '2_edit',
    '4_view',
    '9_help'
]);

/** Section of the File menu that stays on the Work Hub (`CommonMenus.FILE_SETTINGS`). */
export const WORK_HUB_NATIVE_FILE_SECTION_ID = '1_file';
export const WORK_HUB_NATIVE_FILE_SETTINGS_SECTION_ID = '5_settings';

/** Edit commands whose native roles are kept on the Work Hub (`CommonCommands.UNDO`, ...). */
export const WORK_HUB_NATIVE_EDIT_COMMAND_IDS: ReadonlySet<string> = new Set<string>([
    'core.undo',
    'core.redo',
    'core.cut',
    'core.copy',
    'core.paste',
    'core.selectAll'
]);

/** View commands kept on the Work Hub (`ElectronCommands.TOGGLE_FULL_SCREEN`). */
export const WORK_HUB_NATIVE_VIEW_COMMAND_IDS: ReadonlySet<string> = new Set<string>([
    'workbench.action.toggleFullScreen'
]);

/**
 * Commands removed from the native menu on the Work Hub wherever they sit, because the Work Hub has no equivalent.
 * `workbench.action.selectIconTheme` (File Icon Theme) is the only one. Settings, Keyboard Shortcuts, Color Theme and
 * Check for Updates stay in the menu: their commands are answered by the Work Hub
 * (`qaap-work-hub-surface-redirects.ts` in `@theia/qaap-work-hub`).
 */
export const WORK_HUB_NATIVE_HIDDEN_COMMAND_IDS: ReadonlySet<string> = new Set<string>([
    'workbench.action.selectIconTheme'
]);

const EDIT_MENU_ID = '2_edit';
const VIEW_MENU_ID = '4_view';

/**
 * Whether a node of the native menu tree is shown while the Work Hub is the active surface.
 *
 * @param menuPath the path the node is rendered at, ending with the node id (as the menu factory builds it).
 * @param nodeId the id of the node itself.
 * @param isCommand whether the node is a command item (leaf) rather than a group or submenu.
 * @returns `false` when the node must be left out of the native menu.
 */
export function isWorkHubNativeMenuNodeVisible(menuPath: readonly string[], nodeId: string, isCommand: boolean): boolean {
    if (menuPath.length < 2 || menuPath[0] !== MAIN_MENU_BAR[0]) {
        return true;
    }
    if (isCommand && WORK_HUB_NATIVE_HIDDEN_COMMAND_IDS.has(nodeId)) {
        return false;
    }
    const top = menuPath[1];
    if (menuPath.length === 2) {
        return WORK_HUB_NATIVE_TOP_LEVEL_MENU_IDS.has(top);
    }
    switch (top) {
        case WORK_HUB_NATIVE_FILE_SECTION_ID:
            return menuPath[2] === WORK_HUB_NATIVE_FILE_SETTINGS_SECTION_ID;
        case EDIT_MENU_ID:
            return !isCommand || WORK_HUB_NATIVE_EDIT_COMMAND_IDS.has(nodeId);
        case VIEW_MENU_ID:
            return !isCommand || WORK_HUB_NATIVE_VIEW_COMMAND_IDS.has(nodeId);
        default:
            return true;
    }
}
