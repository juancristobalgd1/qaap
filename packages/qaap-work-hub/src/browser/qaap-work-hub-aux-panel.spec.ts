// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { clearPreferDesktopIde, markPreferDesktopIde } from '@theia/qaap-shared-core/lib/browser/mobile-projects-open';
import { QAAP_DESKTOP_SESSIONS_SIDEBAR_MEDIA_QUERY } from './mobile-work-hub-sessions-sidebar';
import { QAAP_WORK_HUB_AUX_PANEL_STORAGE_KEY, type QaapWorkHubAuxPanelStorage, type QaapWorkHubAuxPanelSurfaceKind } from './qaap-work-hub-aux-panel-model';
import { isQaapWorkHubAuxPanelLayout, QaapWorkHubAuxPanel, type QaapWorkHubAuxPanelHost } from './qaap-work-hub-aux-panel';

disableImportJSDOM();

describe('qaap-work-hub-aux-panel', () => {

    let disableJSDOM: (() => void) | undefined;
    let originalMatchMedia: typeof window.matchMedia | undefined;
    let desktop = true;
    const panels: QaapWorkHubAuxPanel[] = [];

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    beforeEach(() => {
        desktop = true;
        clearPreferDesktopIde();
        originalMatchMedia = window.matchMedia;
        window.matchMedia = ((query: string) => ({
            matches: desktop && query === QAAP_DESKTOP_SESSIONS_SIDEBAR_MEDIA_QUERY,
            media: query,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
        })) as unknown as typeof window.matchMedia;
        document.body.className = '';
        document.body.innerHTML = '';
    });

    afterEach(() => {
        panels.splice(0).forEach(panel => panel.dispose());
        window.matchMedia = originalMatchMedia!;
        clearPreferDesktopIde();
        document.documentElement.style.removeProperty('--qaap-work-hub-aux-panel-width');
    });

    function memoryStorage(): QaapWorkHubAuxPanelStorage & { entries: Map<string, string> } {
        const entries = new Map<string, string>();
        return {
            entries,
            getItem: key => entries.get(key) ?? null,
            setItem: (key, value) => { entries.set(key, value); },
        };
    }

    /** A host that docks a fake surface element synchronously, like the execution-surface UI. */
    function createHarness(options: { canShow?: boolean; storage?: QaapWorkHubAuxPanelStorage } = {}): {
        panel: QaapWorkHubAuxPanel;
        shown: QaapWorkHubAuxPanelSurfaceKind[];
        released: boolean[];
    } {
        const shown: QaapWorkHubAuxPanelSurfaceKind[] = [];
        const released: boolean[] = [];
        let docked: HTMLElement | undefined;
        const host: QaapWorkHubAuxPanelHost = {
            canShowSurfaces: () => options.canShow ?? true,
            showSurface: kind => {
                shown.push(kind);
                docked = document.createElement('section');
                docked.className = 'fake-surface';
                docked.dataset.kind = kind;
                panel.dockSurface(kind, docked);
            },
            releaseSurface: userClosed => {
                released.push(userClosed);
                if (docked) {
                    panel.undockSurface(docked);
                    docked = undefined;
                }
            },
        };
        const panel = new QaapWorkHubAuxPanel(host, options.storage ?? memoryStorage());
        panels.push(panel);
        return { panel, shown, released };
    }

    function tabKinds(panel: QaapWorkHubAuxPanel): string[] {
        return Array.from(panel.element.querySelectorAll<HTMLElement>('.qaap-work-hub-aux-panel-tab')).map(tab => tab.dataset.kind!);
    }

    function launcherOpen(panel: QaapWorkHubAuxPanel, kind: string): HTMLButtonElement {
        return panel.element.querySelector<HTMLButtonElement>(`.qaap-work-hub-aux-panel-launcher-item[data-kind="${kind}"] .qaap-work-hub-aux-panel-launcher-open`)!;
    }

    it('is only active on the desktop Work Hub', () => {
        expect(isQaapWorkHubAuxPanelLayout()).to.equal(true);
        desktop = false;
        expect(isQaapWorkHubAuxPanelLayout()).to.equal(false);
        desktop = true;
        markPreferDesktopIde();
        expect(isQaapWorkHubAuxPanelLayout()).to.equal(false);
        clearPreferDesktopIde();
        expect(isQaapWorkHubAuxPanelLayout()).to.equal(true);
    });

    it('toggles open on the "New tab" launcher and closes again', () => {
        const { panel } = createHarness();
        panel.toggle();
        expect(panel.isOpen).to.equal(true);
        expect(panel.element.isConnected).to.equal(true);
        expect(document.body.classList.contains('qaap-mod-work-hub-aux-panel-open')).to.equal(true);
        expect(tabKinds(panel)).to.deep.equal(['launcher']);
        const names = Array.from(panel.element.querySelectorAll('.qaap-work-hub-aux-panel-launcher-name')).map(name => name.textContent);
        expect(names).to.deep.equal(['Browser', 'Files', 'Terminal']);

        panel.toggle();
        expect(panel.isOpen).to.equal(false);
        expect(document.body.classList.contains('qaap-mod-work-hub-aux-panel-open')).to.equal(false);
    });

    it('does nothing outside the desktop layout', () => {
        desktop = false;
        const { panel } = createHarness();
        panel.toggle();
        expect(panel.isOpen).to.equal(false);
        expect(panel.dockSurface('preview', document.createElement('section'))).to.equal(false);
    });

    it('opens a view from the launcher and docks its surface in the panel', () => {
        const { panel, shown } = createHarness();
        panel.show();
        launcherOpen(panel, 'preview').click();
        expect(shown).to.deep.equal(['preview']);
        expect(tabKinds(panel)).to.deep.equal(['preview']);
        const slot = panel.element.querySelector<HTMLElement>('.qaap-work-hub-aux-panel-surface')!;
        expect(slot.hidden).to.equal(false);
        expect(slot.querySelector('.fake-surface')?.getAttribute('data-kind')).to.equal('preview');
    });

    it('switches surfaces by handing the previous one back first', () => {
        const { panel, shown, released } = createHarness();
        panel.show();
        launcherOpen(panel, 'preview').click();
        panel.element.querySelector<HTMLButtonElement>('.qaap-work-hub-aux-panel-add')!.click();
        expect(released).to.deep.equal([false]);
        launcherOpen(panel, 'terminal').click();
        expect(shown).to.deep.equal(['preview', 'terminal']);
        expect(tabKinds(panel)).to.deep.equal(['preview', 'terminal']);

        panel.element.querySelector<HTMLButtonElement>('.qaap-work-hub-aux-panel-tab[data-kind="preview"] .qaap-work-hub-aux-panel-tab-select')!.click();
        expect(shown).to.deep.equal(['preview', 'terminal', 'preview']);
        expect(panel.element.querySelector('.fake-surface')?.getAttribute('data-kind')).to.equal('preview');
    });

    it('has no standalone Review view: Changes is the Files view\'s mode', () => {
        const { panel } = createHarness();
        panel.show();
        expect(panel.element.querySelector('.qaap-work-hub-aux-panel-launcher-item[data-kind="review"]')).to.equal(null);
        // A Changes request from the composer arrives as the Files surface.
        panel.dockSurface('files', document.createElement('section'));
        expect(tabKinds(panel)).to.deep.equal(['files']);
    });

    it('opens the tab menu from a double-chevron button', () => {
        const { panel } = createHarness();
        panel.show();
        const menuButton = panel.element.querySelector<HTMLButtonElement>('.qaap-work-hub-aux-panel-menu-button')!;
        expect(menuButton.querySelector('.qaap-work-hub-aux-panel-double-chevron path')?.getAttribute('d')).to.equal('M3 4.5 8 9.5l5-5 M3 8 8 13l5-5');
    });

    it('adopts a surface opened elsewhere (e.g. a preview that became ready)', () => {
        const { panel } = createHarness();
        const surface = document.createElement('section');
        expect(panel.dockSurface('terminal', surface)).to.equal(true);
        expect(panel.isOpen).to.equal(true);
        expect(tabKinds(panel)).to.deep.equal(['terminal']);
        expect(surface.parentElement?.classList.contains('qaap-work-hub-aux-panel-surface')).to.equal(true);
    });

    it('closing the active tab closes its view as a user decision and moves to its neighbour', () => {
        const { panel, released } = createHarness();
        panel.show();
        launcherOpen(panel, 'preview').click();
        panel.element.querySelector<HTMLButtonElement>('.qaap-work-hub-aux-panel-add')!.click();
        launcherOpen(panel, 'files').click();
        released.splice(0);

        panel.element.querySelector<HTMLButtonElement>('.qaap-work-hub-aux-panel-tab[data-kind="files"] .qaap-work-hub-aux-panel-tab-close')!.click();
        expect(released[0]).to.equal(true);
        expect(tabKinds(panel)).to.deep.equal(['preview']);
        expect(panel.model.activeTab?.kind).to.equal('preview');

        panel.element.querySelector<HTMLButtonElement>('.qaap-work-hub-aux-panel-tab-close')!.click();
        expect(panel.isOpen).to.equal(false);
    });

    it('lists open and recently closed tabs in a searchable menu', () => {
        const { panel } = createHarness();
        panel.show();
        launcherOpen(panel, 'preview').click();
        panel.element.querySelector<HTMLButtonElement>('.qaap-work-hub-aux-panel-add')!.click();
        launcherOpen(panel, 'terminal').click();
        panel.element.querySelector<HTMLButtonElement>('.qaap-work-hub-aux-panel-tab[data-kind="terminal"] .qaap-work-hub-aux-panel-tab-close')!.click();

        const menuButton = panel.element.querySelector<HTMLButtonElement>('.qaap-work-hub-aux-panel-menu-button')!;
        menuButton.click();
        const menu = panel.element.querySelector<HTMLElement>('.qaap-work-hub-aux-panel-menu')!;
        expect(menu.hidden).to.equal(false);
        const headings = (): string[] => Array.from(menu.querySelectorAll('.qaap-work-hub-aux-panel-menu-heading')).map(heading => heading.textContent!);
        const items = (): string[] => Array.from(menu.querySelectorAll('.qaap-work-hub-aux-panel-menu-item-label')).map(label => label.textContent!);
        expect(headings()).to.deep.equal(['Open tabs', 'Recently closed tabs']);
        expect(items()).to.deep.equal(['Browser', 'Terminal']);

        const search = menu.querySelector<HTMLInputElement>('.qaap-work-hub-aux-panel-menu-search')!;
        search.value = 'term';
        search.dispatchEvent(new window.Event('input'));
        expect(headings()).to.deep.equal(['Recently closed tabs']);

        menu.querySelector<HTMLButtonElement>('.qaap-work-hub-aux-panel-menu-item')!.click();
        expect(menu.hidden).to.equal(true);
        expect(tabKinds(panel)).to.deep.equal(['preview', 'terminal']);
        expect(panel.model.recentlyClosed).to.have.length(0);
    });

    it('maximizes over the chat column and restores', () => {
        const { panel } = createHarness();
        panel.show();
        const maximize = panel.element.querySelector<HTMLButtonElement>('.qaap-work-hub-aux-panel-maximize')!;
        maximize.click();
        expect(document.body.classList.contains('qaap-mod-work-hub-aux-panel-maximized')).to.equal(true);
        expect(maximize.getAttribute('aria-pressed')).to.equal('true');
        maximize.click();
        expect(document.body.classList.contains('qaap-mod-work-hub-aux-panel-maximized')).to.equal(false);
    });

    it('resizes with the keyboard and remembers the width per browser tab', () => {
        const storage = memoryStorage();
        const { panel } = createHarness({ storage });
        panel.show();
        const before = panel.model.width;
        const handle = panel.element.querySelector<HTMLElement>('.qaap-work-hub-aux-panel-resize-handle')!;
        handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(panel.model.width).to.equal(before + 16);
        expect(document.documentElement.style.getPropertyValue('--qaap-work-hub-aux-panel-width')).to.equal(`${before + 16}px`);
        expect(JSON.parse(storage.entries.get(QAAP_WORK_HUB_AUX_PANEL_STORAGE_KEY)!).width).to.equal(before + 16);
    });

    it('restores the open panel and its active view after a reload', () => {
        const storage = memoryStorage();
        const first = createHarness({ storage });
        first.panel.show();
        launcherOpen(first.panel, 'terminal').click();
        first.panel.dispose();

        const second = createHarness({ storage });
        expect(second.panel.isOpen).to.equal(false);
        second.panel.syncWithOpenTask();
        expect(second.panel.isOpen).to.equal(true);
        expect(second.shown).to.deep.equal(['terminal']);
        // Header rebuilds must not re-request the same view in a loop.
        second.panel.syncWithOpenTask();
        expect(second.shown).to.deep.equal(['terminal']);
    });

    it('shows a hint instead of views while no task is open', () => {
        const { panel, shown } = createHarness({ canShow: false });
        panel.show();
        expect(launcherOpen(panel, 'preview').disabled).to.equal(true);
        expect(panel.element.querySelector('.qaap-work-hub-aux-panel-hint')).to.not.equal(null);
        expect(shown).to.deep.equal([]);
    });

    it('closing the panel hands the view back as a user close', () => {
        const { panel, released } = createHarness();
        panel.show();
        launcherOpen(panel, 'preview').click();
        panel.element.querySelector<HTMLButtonElement>('.qaap-work-hub-aux-panel-close')!.click();
        expect(released).to.deep.equal([true]);
        expect(panel.isOpen).to.equal(false);
        expect(panel.element.querySelector('.fake-surface')).to.equal(null);
    });
});
