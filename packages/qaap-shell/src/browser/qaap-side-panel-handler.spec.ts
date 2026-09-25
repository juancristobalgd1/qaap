// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { useSuiteAnimationFrameStub, useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
// The shell modules touch the DOM while loading; give them one only for the import.
const disableImportJSDOM = enableJSDOM();
import '@theia/core/lib/browser';
import { Widget } from '@lumino/widgets';
import { SidePanel } from '@theia/core/lib/browser/shell/side-panel-handler';
import { MOBILE_ONE_COLUMN_LAYOUT_CLASS } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { QaapSidePanelHandler } from './qaap-side-panel-handler';
disableImportJSDOM();

const COLLAPSED_CLASS = 'theia-mod-collapsed';

interface FakeTabBar {
    currentIndex: number;
    currentTitle: { owner: Widget } | null | undefined;
    titles: unknown[];
    hidden?: boolean;
    revealed: number[];
    setHidden(hidden: boolean): void;
    revealTab(index: number): void;
}

interface TestableHandler {
    side: 'left' | 'right';
    container: Widget;
    tabBar: FakeTabBar;
    dockPanel: { hidden?: boolean; selected?: Widget; setHidden(hidden: boolean): void; selectWidget(widget: Widget): void };
    additionalViewsMenu: { calls: unknown[]; updateAdditionalViews(sender: unknown, event: unknown): void } | undefined;
    state: { expansion: SidePanel.ExpansionState; empty: boolean; lastPanelSize?: number; pendingUpdate: Promise<void> };
    options: { emptySize: number; initialSizeRatio: number };
    panelSizes: number[];
    relayouts: number;
    refreshes: number;
    collapse(): Promise<void>;
    refresh(): void;
    getDefaultPanelSize(): number | undefined;
    onTabsOverflowChanged(sender: FakeTabBar, event: { titles: unknown[]; startIndex: number }): void;
}

describe('QaapSidePanelHandler', () => {
    useSuiteJSDOM();
    useSuiteAnimationFrameStub();

    function fakeTabBar(patch: Partial<FakeTabBar> = {}): FakeTabBar {
        const tabBar: FakeTabBar = {
            currentIndex: -1,
            currentTitle: null,
            titles: [],
            revealed: [],
            setHidden: hidden => { tabBar.hidden = hidden; },
            revealTab: index => { tabBar.revealed.push(index); },
            ...patch,
        };
        return tabBar;
    }

    function createHandler(side: 'left' | 'right' = 'left'): TestableHandler {
        const handler = Object.create(QaapSidePanelHandler.prototype) as TestableHandler;
        const dockPanel: TestableHandler['dockPanel'] = {
            setHidden: hidden => { dockPanel.hidden = hidden; },
            selectWidget: selected => { dockPanel.selected = selected; },
        };
        Object.assign(handler, {
            side,
            container: new Widget(),
            tabBar: fakeTabBar(),
            dockPanel,
            additionalViewsMenu: undefined,
            state: { expansion: SidePanel.ExpansionState.expanded, empty: false, pendingUpdate: Promise.resolve() },
            options: { emptySize: 140, initialSizeRatio: 0.2 },
            panelSizes: [],
            relayouts: 0,
            refreshes: 0,
            updateSashState: () => undefined,
            getPanelSize: () => 260,
            setPanelSize: (size: number) => {
                handler.panelSizes.push(size);
                return Promise.resolve();
            },
            scheduleContentRelayout: () => { handler.relayouts++; },
        });
        return handler;
    }

    function attachToShell(handler: TestableHandler, mobileOneColumn: boolean): void {
        const shell = document.createElement('div');
        shell.id = 'theia-app-shell';
        if (mobileOneColumn) {
            shell.classList.add(MOBILE_ONE_COLUMN_LAYOUT_CLASS);
        }
        shell.appendChild(handler.container.node);
        document.body.appendChild(shell);
    }

    afterEach(() => {
        document.body.replaceChildren();
    });

    describe('collapse', () => {
        function withCountedRefresh(handler: TestableHandler): TestableHandler {
            Object.assign(handler, { refresh: () => { handler.refreshes++; } });
            return handler;
        }

        it('clears the tab selection and relayouts on the mobile one-column shell', async () => {
            const handler = withCountedRefresh(createHandler());
            handler.tabBar.currentIndex = 2;
            attachToShell(handler, true);
            await handler.collapse();
            expect(handler.tabBar.currentIndex).to.equal(-1);
            expect(handler.refreshes).to.equal(1);
            expect(handler.relayouts).to.equal(1);
        });

        it('keeps the desktop collapse behaviour elsewhere', async () => {
            const handler = withCountedRefresh(createHandler());
            handler.tabBar.currentIndex = 2;
            attachToShell(handler, false);
            await handler.collapse();
            expect(handler.tabBar.currentIndex).to.equal(2);
            expect(handler.relayouts).to.equal(0);
        });
    });

    describe('refresh', () => {
        it('hides and collapses the left panel when no tab is selected, remembering its size', () => {
            const handler = createHandler('left');
            handler.tabBar.titles = [{}];
            handler.refresh();
            expect(handler.container.hasClass(COLLAPSED_CLASS)).to.equal(true);
            expect(handler.container.isHidden).to.equal(true);
            expect(handler.tabBar.hidden).to.equal(true);
            expect(handler.dockPanel.hidden).to.equal(true);
            expect(handler.state.expansion).to.equal(SidePanel.ExpansionState.collapsed);
            expect(handler.state.lastPanelSize).to.equal(260);
            expect(handler.panelSizes).to.deep.equal([0]);
        });

        it('expands a selected tab to the remembered size and shows its widget', async () => {
            const handler = createHandler('left');
            const owner = new Widget();
            handler.tabBar = fakeTabBar({ currentIndex: 0, currentTitle: { owner }, titles: [{}] });
            handler.state.expansion = SidePanel.ExpansionState.collapsed;
            handler.state.lastPanelSize = 320;
            handler.refresh();
            expect(handler.container.hasClass(COLLAPSED_CLASS)).to.equal(false);
            expect(handler.container.isHidden).to.equal(false);
            expect(handler.dockPanel.hidden).to.equal(false);
            expect(handler.dockPanel.selected).to.equal(owner);
            expect(handler.panelSizes).to.deep.equal([320]);
            expect(handler.state.expansion).to.equal(SidePanel.ExpansionState.expanding);
            await Promise.resolve();
            expect(handler.state.expansion).to.equal(SidePanel.ExpansionState.expanded);
        });

        it('hides the right activity strip only when it has no tabs', () => {
            const handler = createHandler('right');
            const owner = new Widget();
            handler.tabBar = fakeTabBar({ currentIndex: 0, currentTitle: { owner }, titles: [{}] });
            handler.refresh();
            expect(handler.tabBar.hidden).to.equal(false);
            expect(handler.state.empty).to.equal(false);
        });
    });

    describe('default panel size', () => {
        it('is undefined before the panel is attached to a parent', () => {
            expect(createHandler().getDefaultPanelSize()).to.equal(undefined);
        });

        it('uses the parent width ratio and never goes below the empty size', () => {
            const handler = createHandler();
            const measure = (width: number): number | undefined => {
                Object.defineProperty(handler.container, 'parent', {
                    configurable: true,
                    value: { node: { clientWidth: width } },
                });
                return handler.getDefaultPanelSize();
            };
            expect(measure(1000)).to.equal(200);
            expect(measure(400)).to.equal(140);
        });
    });

    describe('tab overflow', () => {
        it('reveals the current tab when it scrolled into the overflow', () => {
            const handler = createHandler();
            const calls: unknown[] = [];
            handler.additionalViewsMenu = { calls, updateAdditionalViews: (...args: unknown[]) => { calls.push(args); } };
            const sender = fakeTabBar({ currentIndex: 3 });
            handler.onTabsOverflowChanged(sender, { titles: [], startIndex: 2 });
            expect(sender.revealed).to.deep.equal([3]);
            expect(calls).to.have.length(0);
        });

        it('lists overflowing tabs in the additional views menu otherwise', () => {
            const handler = createHandler();
            const calls: unknown[] = [];
            handler.additionalViewsMenu = { calls, updateAdditionalViews: (...args: unknown[]) => { calls.push(args); } };
            const sender = fakeTabBar({ currentIndex: 0 });
            handler.onTabsOverflowChanged(sender, { titles: [], startIndex: 2 });
            expect(sender.revealed).to.deep.equal([]);
            expect(calls).to.have.length(1);
        });
    });
});
