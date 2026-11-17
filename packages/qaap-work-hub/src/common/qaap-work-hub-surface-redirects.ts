// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * While the Work Hub is the active surface, upstream commands that open an IDE view are answered by the Work Hub
 * equivalent instead. This module holds the pure part of that mapping (no DOM, no DI), so it can be tested in node.
 */

/** Prefix of a Work Hub Settings query that names a section id. Plain queries stay search terms. */
export const WORK_HUB_SETTINGS_SECTION_QUERY_PREFIX = 'section:';

/** Builds the Settings query that opens the given Work Hub Settings section (`general`, `keybindings`, ...). */
export function workHubSettingsSectionQuery(sectionId: string): string {
    return `${WORK_HUB_SETTINGS_SECTION_QUERY_PREFIX}${sectionId}`;
}

/**
 * The section id a Settings query names, or `undefined` when the query is not a section query
 * (no query, a plain search term such as `ai-features`, or an empty section id).
 */
export function parseWorkHubSettingsSectionQuery(query?: string): string | undefined {
    if (typeof query !== 'string' || !query.startsWith(WORK_HUB_SETTINGS_SECTION_QUERY_PREFIX)) {
        return undefined;
    }
    const sectionId = query.slice(WORK_HUB_SETTINGS_SECTION_QUERY_PREFIX.length).trim();
    return sectionId || undefined;
}

/**
 * Work Hub Settings sections that the desktop app (Electron) does not offer. Plan shows the web and mobile
 * billing page; the desktop app has no plan page of its own.
 */
export const WORK_HUB_DESKTOP_HIDDEN_SETTINGS_SECTION_IDS: readonly string[] = ['plan-usage'];

/** The General section id: where a hidden section falls back to, so no deep link lands on an empty page. */
export const WORK_HUB_SETTINGS_DEFAULT_SECTION_ID = 'general';

/**
 * Whether a Work Hub Settings section is offered in the given runtime. Desktop hides Plan; web and mobile
 * offer every section.
 */
export function isWorkHubSettingsSectionVisible(sectionId: string, desktop: boolean): boolean {
    return !desktop || !WORK_HUB_DESKTOP_HIDDEN_SETTINGS_SECTION_IDS.includes(sectionId);
}

/**
 * The section id to show for a requested one: the id itself when it is visible in this runtime, otherwise
 * General (a deep link to Plan on desktop redirects instead of opening an empty page).
 */
export function resolveWorkHubSettingsSectionId(sectionId: string, desktop: boolean): string {
    return isWorkHubSettingsSectionVisible(sectionId, desktop) ? sectionId : WORK_HUB_SETTINGS_DEFAULT_SECTION_ID;
}

export interface WorkHubSettingsCommandRedirect {
    /** Upstream command id, for example `preferences:open` (`CommonCommands.OPEN_PREFERENCES`). */
    readonly commandId: string;
    /** Work Hub Settings section that answers the command. */
    readonly sectionId: string;
}

/**
 * Upstream commands answered by the Work Hub Settings page while the Work Hub is active.
 * - `preferences:open` (Settings, ⌘,) opens General.
 * - `keymaps:open` (Keyboard Shortcuts) opens Keybindings.
 * - `workbench.action.selectTheme` (Color Theme) opens Appearance, which has the theme picker.
 * `workbench.action.selectIconTheme` has no Work Hub equivalent: it is removed from the native menu instead.
 */
export const WORK_HUB_SETTINGS_COMMAND_REDIRECTS: readonly WorkHubSettingsCommandRedirect[] = [
    { commandId: 'preferences:open', sectionId: 'general' },
    { commandId: 'keymaps:open', sectionId: 'keybindings' },
    { commandId: 'workbench.action.selectTheme', sectionId: 'appearance' },
];

/**
 * Upstream sample updater command behind the native "Check for Updates..." item (`@theia/api-samples`).
 * While the Work Hub is active it runs the Work Hub update flow instead of the sample updater.
 */
export const WORK_HUB_CHECK_FOR_UPDATES_COMMAND_ID = 'electron-sample:check-for-updates';
