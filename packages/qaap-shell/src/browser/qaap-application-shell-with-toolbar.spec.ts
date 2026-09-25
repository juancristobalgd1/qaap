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
import { BoxLayout, BoxPanel, Layout, Panel, SplitPanel, Widget } from '@lumino/widgets';
import { MAXIMIZED_CLASS, TheiaSplitPanel } from '@theia/core/lib/browser';
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
    createLayout(): Layout;
    mainPanel: Widget;
    toolbar: Widget;
    leftPanelHandler: { container: Widget };
    rightPanelHandler: { container: Widget };
    leftRightSplitPanel: TheiaSplitPanel;
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

    /**
     * `createLayout` only arranges widgets the shell already owns, so the regions are plain lumino
     * widgets here. Building a real ApplicationShell through DI would need ~15 core services plus
     * the toolbar's for no extra coverage of this arrangement.
     */
    describe('layout', () => {
        function shellWithRegions(): TestableShell & Record<'regions', Record<string, Widget>> {
            const shell = createShell() as TestableShell & Record<'regions', Record<string, Widget>>;
            const regions = {
                top: widget('theia-top-panel'),
                toolbar: widget('main-toolbar'),
                main: widget('theia-main-content-panel'),
                bottom: widget('theia-bottom-content-panel'),
                left: widget('theia-left-content-panel'),
                right: widget('theia-right-content-panel'),
                status: widget('theia-statusBar'),
            };
            Object.assign(shell, {
                regions,
                topPanel: regions.top,
                toolbar: regions.toolbar,
                mainPanel: regions.main,
                bottomPanel: regions.bottom,
                leftPanelHandler: { container: regions.left },
                rightPanelHandler: { container: regions.right },
                statusBar: regions.status,
            });
            return shell;
        }

        it('stacks top panel, toolbar, the side split and the status bar, stretching only the split', () => {
            const shell = shellWithRegions();
            const layout = shell.createLayout() as BoxLayout;
            expect(layout).to.be.instanceOf(BoxLayout);
            expect(layout.direction).to.equal('top-to-bottom');
            expect(layout.widgets.map(item => item.id)).to.deep.equal([
                'theia-top-panel', 'main-toolbar', 'theia-left-right-split-panel', 'theia-statusBar',
            ]);
            expect(layout.widgets.map(item => BoxPanel.getStretch(item))).to.deep.equal([0, 0, 1, 0]);
        });

        it('splits left | main+bottom | right horizontally and exposes it as leftRightSplitPanel', () => {
            const shell = shellWithRegions();
            const layout = shell.createLayout() as BoxLayout;
            const sides = shell.leftRightSplitPanel;
            // The mobile one-column layout drives this exact panel (QaapShellWithLeftRightSplit).
            expect(sides).to.be.instanceOf(TheiaSplitPanel);
            expect(layout.widgets[2]).to.equal(sides);
            expect(sides.orientation).to.equal('horizontal');
            expect(sides.spacing).to.equal(0);
            expect(sides.widgets.map(item => item.id)).to.deep.equal([
                'theia-left-content-panel', 'theia-bottom-split-panel', 'theia-right-content-panel',
            ]);
            expect(sides.widgets.map(item => SplitPanel.getStretch(item))).to.deep.equal([0, 1, 0]);
        });

        it('stacks the main area over the bottom panel in a vertical split', () => {
            const shell = shellWithRegions();
            shell.createLayout();
            const mainAndBottom = shell.leftRightSplitPanel.widgets[1] as SplitPanel;
            expect(mainAndBottom).to.be.instanceOf(TheiaSplitPanel);
            expect(mainAndBottom.orientation).to.equal('vertical');
            expect(mainAndBottom.widgets).to.deep.equal([shell.regions.main, shell.regions.bottom]);
            expect(mainAndBottom.widgets.map(item => SplitPanel.getStretch(item))).to.deep.equal([1, 0]);
        });
    });
});

