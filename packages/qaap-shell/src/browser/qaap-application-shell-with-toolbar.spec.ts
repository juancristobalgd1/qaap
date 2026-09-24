// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { useSuiteJSDOM } from './test/qaap-jsdom-suite';
import { useAnimationFrameStub } from './test/qaap-animation-frame-stub';
// The shell modules touch the DOM while loading; give them one only for the import.
const disableImportJSDOM = enableJSDOM();
import '@theia/core/lib/browser';
import { Panel, Widget } from '@lumino/widgets';
import { MAXIMIZED_CLASS } from '@theia/core/lib/browser';
import { SidePanel } from '@theia/core/lib/browser/shell/side-panel-handler';
import { QaapApplicationShellWithToolbar } from './qaap-application-shell-with-toolbar';
disableImportJSDOM();

interface TestableShell {
    topPanel: Panel;
    bottomPanel: Widget;
    bottomPanelState: { expansion: SidePanel.ExpansionState; lastPanelSize?: number };
    unmaximize?: () => void;
    statusBar: { removeElement(id: string): void };
    getBottomPanelSize(): number | undefined;
    setTopPanelVisibility(preference: string): void;
    collapseBottomPanel(): Promise<void>;
    refreshBottomPanelToggleButton(): void;
    createTopPanel(): Panel;
}

describe('QaapApplicationShellWithToolbar', () => {
    useSuiteJSDOM();
    useAnimationFrameStub();

    function createShell(): TestableShell {
        return Object.create(QaapApplicationShellWithToolbar.prototype) as TestableShell;
    }

    function widget(id: string): Widget {
        const created = new Widget();
        created.id = id;
        return created;
    }

    describe('top panel visibility', () => {
        function shellWithTopPanel(...ids: string[]): { shell: TestableShell; widgets: Widget[] } {
            const shell = createShell();
            shell.topPanel = shell.createTopPanel();
            const widgets = ids.map(widget);
            widgets.forEach(item => shell.topPanel.addWidget(item));
            return { shell, widgets };
        }

        it('creates the top panel with its stable id', () => {
            expect(createShell().createTopPanel().id).to.equal('theia-top-panel');
        });

        for (const preference of ['compact', 'hidden']) {
            it(`hides the menu bar and the empty top panel for "${preference}"`, () => {
                const { shell, widgets: [menuBar] } = shellWithTopPanel('theia:menubar');
                shell.setTopPanelVisibility(preference);
                expect(menuBar.isHidden).to.equal(true);
                expect(shell.topPanel.isHidden).to.equal(true);
            });
        }

        it('keeps the top panel when another widget in it is still visible', () => {
            const { shell, widgets: [menuBar] } = shellWithTopPanel('theia:menubar', 'qaap-workbench-top-bar');
            shell.setTopPanelVisibility('compact');
            expect(menuBar.isHidden).to.equal(true);
            expect(shell.topPanel.isHidden).to.equal(false);
        });

        it('shows the menu bar and the top panel again for "visible"', () => {
            const { shell, widgets: [menuBar] } = shellWithTopPanel('theia:menubar');
            shell.setTopPanelVisibility('hidden');
            shell.setTopPanelVisibility('visible');
            expect(menuBar.isHidden).to.equal(false);
            expect(shell.topPanel.isHidden).to.equal(false);
        });
    });

    describe('bottom panel', () => {
        function shellWithBottomPanel(size: number | undefined): TestableShell {
            const shell = createShell();
            shell.bottomPanel = widget('theia-bottom-content-panel');
            shell.bottomPanelState = { expansion: SidePanel.ExpansionState.expanded };
            shell.getBottomPanelSize = () => size;
            return shell;
        }

        it('remembers the expanded size, collapses and hides the panel', async () => {
            const shell = shellWithBottomPanel(240);
            await shell.collapseBottomPanel();
            expect(shell.bottomPanel.isHidden).to.equal(true);
            expect(shell.bottomPanelState.expansion).to.equal(SidePanel.ExpansionState.collapsed);
            expect(shell.bottomPanelState.lastPanelSize).to.equal(240);
        });

        it('restores a maximized bottom panel before collapsing it', async () => {
            const shell = shellWithBottomPanel(240);
            let unmaximized = 0;
            shell.bottomPanel.addClass(MAXIMIZED_CLASS);
            shell.unmaximize = () => { unmaximized++; };
            await shell.collapseBottomPanel();
            expect(unmaximized).to.equal(1);
            expect(shell.unmaximize).to.equal(undefined);
        });

        it('leaves an already hidden bottom panel untouched', async () => {
            const shell = shellWithBottomPanel(240);
            shell.bottomPanel.hide();
            await shell.collapseBottomPanel();
            expect(shell.bottomPanelState.expansion).to.equal(SidePanel.ExpansionState.expanded);
            expect(shell.bottomPanelState.lastPanelSize).to.equal(undefined);
        });

        it('removes the bottom panel toggle from the status bar', () => {
            const shell = createShell();
            const removed: string[] = [];
            shell.statusBar = { removeElement: id => { removed.push(id); } };
            shell.refreshBottomPanelToggleButton();
            expect(removed).to.deep.equal(['bottom-panel-toggle']);
        });
    });
});
