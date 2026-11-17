// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { isWorkHubNativeMenuNodeVisible } from './qaap-work-hub-native-menu-filter';

describe('isWorkHubNativeMenuNodeVisible', () => {

    describe('top level', () => {
        it('keeps File, Edit, View and Help', () => {
            for (const id of ['1_file', '2_edit', '4_view', '9_help']) {
                expect(isWorkHubNativeMenuNodeVisible(['menubar', id], id, false), id).to.equal(true);
            }
        });

        it('hides Selection, Go, Run and Terminal', () => {
            for (const id of ['3_selection', '5_go', '6_debug', '7_terminal']) {
                expect(isWorkHubNativeMenuNodeVisible(['menubar', id], id, false), id).to.equal(false);
            }
        });

        it('hides top-level menus this list does not name', () => {
            expect(isWorkHubNativeMenuNodeVisible(['menubar', '8_plugin'], '8_plugin', false)).to.equal(false);
        });

        it('keeps the menu bar root', () => {
            expect(isWorkHubNativeMenuNodeVisible(['menubar'], 'menubar', false)).to.equal(true);
        });
    });

    describe('File', () => {
        it('keeps the settings section and its submenus', () => {
            expect(isWorkHubNativeMenuNodeVisible(['menubar', '1_file', '5_settings'], '5_settings', false)).to.equal(true);
            expect(isWorkHubNativeMenuNodeVisible(
                ['menubar', '1_file', '5_settings', '1_settings_submenu', 'core.openPreferences'],
                'core.openPreferences',
                true
            )).to.equal(true);
        });

        it('hides the editor items (new, open, save, close)', () => {
            expect(isWorkHubNativeMenuNodeVisible(['menubar', '1_file', '1_new'], '1_new', false)).to.equal(false);
            expect(isWorkHubNativeMenuNodeVisible(['menubar', '1_file', '3_save', 'core.save'], 'core.save', true)).to.equal(false);
            expect(isWorkHubNativeMenuNodeVisible(['menubar', '1_file', '6_close', 'core.close'], 'core.close', true)).to.equal(false);
        });
    });

    describe('Settings submenu', () => {
        const themeSubmenu = ['menubar', '1_file', '5_settings', '1_settings_submenu', '2_settings_submenu_theme'];
        const updateSubmenu = ['menubar', '1_file', '5_settings', '1_settings_submenu', '3_settings_submenu_update'];

        it('keeps Settings, Keyboard Shortcuts, Color Theme and Check for Updates (answered by the Work Hub)', () => {
            expect(isWorkHubNativeMenuNodeVisible([...themeSubmenu, 'workbench.action.selectTheme'],
                'workbench.action.selectTheme', true)).to.equal(true);
            expect(isWorkHubNativeMenuNodeVisible(['menubar', '1_file', '5_settings', '1_settings_submenu', '1_settings_submenu_open', 'keymaps:open'],
                'keymaps:open', true)).to.equal(true);
            expect(isWorkHubNativeMenuNodeVisible(['menubar', '1_file', '5_settings', '1_settings_submenu', '1_settings_submenu_open', 'preferences:open'],
                'preferences:open', true)).to.equal(true);
            expect(isWorkHubNativeMenuNodeVisible([...updateSubmenu, 'electron-sample:check-for-updates'],
                'electron-sample:check-for-updates', true)).to.equal(true);
        });

        it('removes File Icon Theme, which the Work Hub has no equivalent for', () => {
            expect(isWorkHubNativeMenuNodeVisible([...themeSubmenu, 'workbench.action.selectIconTheme'],
                'workbench.action.selectIconTheme', true)).to.equal(false);
        });

        it('keeps the theme submenu group itself', () => {
            expect(isWorkHubNativeMenuNodeVisible(['menubar', '1_file', '5_settings', '1_settings_submenu', '2_settings_submenu_theme'],
                '2_settings_submenu_theme', false)).to.equal(true);
        });
    });

    describe('Edit', () => {
        it('keeps the native undo, redo and clipboard commands', () => {
            for (const id of ['core.undo', 'core.redo', 'core.cut', 'core.copy', 'core.paste', 'core.selectAll']) {
                expect(isWorkHubNativeMenuNodeVisible(['menubar', '2_edit', '2_clipboard', id], id, true), id).to.equal(true);
            }
        });

        it('hides other Edit commands but keeps the groups that hold the kept ones', () => {
            expect(isWorkHubNativeMenuNodeVisible(['menubar', '2_edit', '3_find', 'editor.action.startFindAction'],
                'editor.action.startFindAction', true)).to.equal(false);
            expect(isWorkHubNativeMenuNodeVisible(['menubar', '2_edit', '2_clipboard'], '2_clipboard', false)).to.equal(true);
        });
    });

    describe('View', () => {
        it('keeps Toggle Full Screen only', () => {
            expect(isWorkHubNativeMenuNodeVisible(['menubar', '4_view', 'workbench.action.toggleFullScreen'],
                'workbench.action.toggleFullScreen', true)).to.equal(true);
            expect(isWorkHubNativeMenuNodeVisible(['menubar', '4_view', '0_primary', 'workbench.action.splitEditorRight'],
                'workbench.action.splitEditorRight', true)).to.equal(false);
        });

        it('keeps submenus so the filter can reach their children', () => {
            expect(isWorkHubNativeMenuNodeVisible(['menubar', '4_view', '1_appearance'], '1_appearance', false)).to.equal(true);
        });
    });

    describe('other trees', () => {
        it('does not filter context menus or any non-menubar path', () => {
            expect(isWorkHubNativeMenuNodeVisible(['editor/context', 'core.cut'], 'core.cut', true)).to.equal(true);
            expect(isWorkHubNativeMenuNodeVisible(['editor/context', '3_selection'], '3_selection', false)).to.equal(true);
        });

        it('keeps Help unfiltered', () => {
            expect(isWorkHubNativeMenuNodeVisible(['menubar', '9_help', 'z_toggle', 'toggle.devtools'], 'toggle.devtools', true)).to.equal(true);
        });
    });
});
