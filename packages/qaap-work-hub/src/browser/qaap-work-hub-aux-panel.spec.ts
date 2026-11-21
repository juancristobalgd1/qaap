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
import { isQaapWorkHubAuxPanelLayout, QAAP_WORK_HUB_AUX_PANEL_TOGGLE_CLASS, QaapWorkHubAuxPanel, type QaapWorkHubAuxPanelHost } from './qaap-work-hub-aux-panel';
import type { QaapWorkHubPullRequestTarget } from './qaap-work-hub-aux-pull-request-model';
import { QaapWorkHubAuxPullRequestView } from './qaap-work-hub-aux-pull-request-view';
import { QaapWorkHubAuxSideChatView, type QaapWorkHubAuxSideChatHost } from './qaap-work-hub-aux-side-chat-view';
import { Disposable } from '@theia/core/lib/common/disposable';

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
    function createHarness(options: {
        canShow?: boolean;
        storage?: QaapWorkHubAuxPanelStorage;
        /** The surface the host reports when it docks a requested view (defaults to the view itself). */
        dockAs?: (kind: QaapWorkHubAuxPanelSurfaceKind) => QaapWorkHubAuxPanelSurfaceKind;
        /** The pull request the host reports for the "Pull request" view (no project when unset). */
        pullRequest?: QaapWorkHubPullRequestTarget;
        pullRequestView?: QaapWorkHubAuxPullRequestView;
        /** The side chat's Work Hub hooks; a parent is open when set. */
        sideChat?: QaapWorkHubAuxSideChatHost;
        sideChatView?: QaapWorkHubAuxSideChatView;
    } = {}): {
        panel: QaapWorkHubAuxPanel;
        shown: QaapWorkHubAuxPanelSurfaceKind[];
        released: boolean[];
    } {
        const shown: QaapWorkHubAuxPanelSurfaceKind[] = [];
        const released: boolean[] = [];
        let docked: HTMLElement | undefined;
        const host: QaapWorkHubAuxPanelHost = {
            canShowSurfaces: () => options.canShow ?? true,
            resolvePullRequestTarget: () => options.pullRequest,
            openExternal: () => undefined,
            showSurface: kind => {
                shown.push(kind);
                docked = document.createElement('section');
                docked.className = 'fake-surface';
                docked.dataset.kind = kind;
                panel.dockSurface(options.dockAs?.(kind) ?? kind, docked);
            },
            releaseSurface: userClosed => {
                released.push(userClosed);
                if (docked) {
                    panel.undockSurface(docked);
                    docked = undefined;
                }
            },
        };
        const panel = new QaapWorkHubAuxPanel({ ...host, sideChat: options.sideChat }, options.storage ?? memoryStorage(), options.pullRequestView, options.sideChatView);
        panels.push(panel);
        return { panel, shown, released };
    }

    const reviewedTarget: QaapWorkHubPullRequestTarget = { owner: 'acme', repo: 'app', branch: 'qaap/task/7', scope: 'task:7' };

    function tabKinds(panel: QaapWorkHubAuxPanel): string[] {
        return Array.from(panel.element.querySelectorAll<HTMLElement>('.qaap-work-hub-aux-panel-tab')).map(tab => tab.dataset.kind!);
    }

    function launcherOpen(panel: QaapWorkHubAuxPanel, kind: string): HTMLButtonElement {
        // The whole launcher row is the button; there is no separate "Open" pill.
        return panel.element.querySelector<HTMLButtonElement>(`button.qaap-work-hub-aux-panel-launcher-item[data-kind="${kind}"]`)!;
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
        expect(names).to.deep.equal(['Browser', 'Changes', 'Files', 'Terminal', 'Pull request', 'Side chat']);

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

    it('offers Changes and Files as separate views over the files surface', () => {
        const { panel, shown } = createHarness();
        panel.show();
        expect(panel.element.querySelector('button.qaap-work-hub-aux-panel-launcher-item[data-kind="changes"]')).to.not.equal(null);
        expect(panel.element.querySelector('button.qaap-work-hub-aux-panel-launcher-item[data-kind="files"]')).to.not.equal(null);
        launcherOpen(panel, 'changes').click();
        expect(shown).to.deep.equal(['changes']);
        // The files surface docks under the view whose mode it shows.
        panel.dockSurface('changes', document.createElement('section'));
        expect(tabKinds(panel)).to.deep.equal(['changes']);
    });

    it('docks the files surface under the view it asked for, even while the surface reports the other mode', () => {
        // The surface arrives as Files because its pending Changes mode is not applied yet.
        const { panel } = createHarness({ dockAs: kind => kind === 'changes' ? 'files' : kind });
        panel.show();
        launcherOpen(panel, 'changes').click();
        expect(tabKinds(panel)).to.deep.equal(['changes']);
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

    it('re-fits its width when the sessions sidebar takes room, without forgetting the chosen width', () => {
        const storage = memoryStorage();
        const { panel } = createHarness({ storage });
        panel.show();
        const handle = panel.element.querySelector<HTMLElement>('.qaap-work-hub-aux-panel-resize-handle')!;
        for (let i = 0; i < 5; i++) {
            handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        }
        const chosen = panel.model.width;
        const width = (): string => document.documentElement.style.getPropertyValue('--qaap-work-hub-aux-panel-width');
        expect(width()).to.equal(`${chosen}px`);

        const sidebar = document.createElement('aside');
        sidebar.className = 'theia-mobile-work-hub-sessions-sidebar theia-mod-visible';
        sidebar.getBoundingClientRect = () => ({ width: window.innerWidth - 400 } as DOMRect);
        document.body.append(sidebar);
        window.dispatchEvent(new window.Event('resize'));
        // 400px left: the chat keeps its minimum, the panel takes the rest (never under its minimum).
        expect(width()).to.equal('320px');

        sidebar.remove();
        window.dispatchEvent(new window.Event('resize'));
        expect(width()).to.equal(`${chosen}px`);
        expect(JSON.parse(storage.entries.get(QAAP_WORK_HUB_AUX_PANEL_STORAGE_KEY)!).width).to.equal(chosen);
    });

    it('keeps the chat-header toggles\' aria-expanded in sync however the panel opens or closes', () => {
        const toggle = document.createElement('button');
        toggle.className = QAAP_WORK_HUB_AUX_PANEL_TOGGLE_CLASS;
        document.body.append(toggle);
        const { panel } = createHarness();

        panel.dockSurface('terminal', document.createElement('section'));
        expect(toggle.getAttribute('aria-expanded')).to.equal('true');

        panel.element.querySelector<HTMLButtonElement>('.qaap-work-hub-aux-panel-tab-close')!.click();
        expect(panel.isOpen).to.equal(false);
        expect(toggle.getAttribute('aria-expanded')).to.equal('false');
    });

    it('fires onDidChangeOpenState once per real change of the open state', () => {
        const { panel } = createHarness();
        const states: boolean[] = [];
        panel.onDidChangeOpenState(open => states.push(open));

        panel.toggle();
        panel.show();
        panel.toggle();
        panel.hide();
        panel.hide();
        expect(states).to.deep.equal([true, false]);
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

    it('requests the Browser again when its docked element was torn down elsewhere (IDE and back)', () => {
        const { panel, shown } = createHarness();
        panel.show();
        launcherOpen(panel, 'preview').click();
        expect(shown).to.deep.equal(['preview']);
        // Switching to the IDE tore the surface down outside the Work Hub layout, without undocking it.
        panel.element.querySelector('.qaap-work-hub-aux-panel-surface .fake-surface')!.remove();

        panel.syncWithOpenTask();

        expect(shown).to.deep.equal(['preview', 'preview']);
        expect(panel.element.querySelector('.qaap-work-hub-aux-panel-surface .fake-surface')).to.exist;
        // Still no loop once it is docked again.
        panel.syncWithOpenTask();
        expect(shown).to.deep.equal(['preview', 'preview']);
    });

    it('offers the pull request view from the launcher and renders it without requesting a surface', async () => {
        let lookups = 0;
        const view = new QaapWorkHubAuxPullRequestView({
            lookup: async () => {
                lookups++;
                return {
                    kind: 'found',
                    pullRequest: {
                        owner: 'acme', repo: 'app', number: 7, title: 'Fix the login redirect', branch: 'qaap/task/7', base: 'main',
                        author: 'jc', files: 2, adds: 10, dels: 3, tests: 'unknown', state: 'open', draft: false,
                        htmlUrl: 'https://github.com/acme/app/pull/7', filesPreview: [], updatedAt: '2026-11-17T10:00:00Z',
                    },
                };
            },
            refreshMs: 1_000_000,
        });
        const { panel, shown } = createHarness({ pullRequest: reviewedTarget, pullRequestView: view });
        panel.show();
        const item = launcherOpen(panel, 'pull-request');
        expect(item.disabled).to.equal(false);
        item.click();
        // Surfaces are not involved: the view renders itself.
        expect(shown).to.deep.equal([]);
        expect(panel.element.dataset.view).to.equal('pull-request');
        expect(view.element.hidden).to.equal(false);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(lookups).to.equal(1);
        expect(view.element.querySelector('.qaap-work-hub-aux-pr-title')?.textContent).to.equal('Fix the login redirect');
        view.dispose();
    });

    it('opens the Pull request tab on a specific pull request, then goes back to the branch one', async () => {
        const looked: Array<QaapWorkHubPullRequestTarget> = [];
        const view = new QaapWorkHubAuxPullRequestView({
            lookup: async target => {
                looked.push(target);
                return { kind: 'none' };
            },
            refreshMs: 1_000_000,
        });
        const { panel, shown } = createHarness({ pullRequest: reviewedTarget, pullRequestView: view });
        expect(panel.openPullRequest({ owner: 'zed', repo: 'lib', number: 117 })).to.equal(true);
        expect(shown).to.deep.equal([]);
        expect(panel.element.dataset.view).to.equal('pull-request');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(looked[0]).to.deep.include({ owner: 'zed', repo: 'lib', number: 117 });
        expect(view.element.querySelector('.qaap-work-hub-aux-pr-pinned-label')?.textContent).to.contain('zed/lib#117');

        view.element.querySelector<HTMLButtonElement>('.qaap-work-hub-aux-pr-back')!.click();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(looked[1]).to.deep.include({ owner: 'acme', repo: 'app', branch: 'qaap/task/7' });
        expect(view.element.querySelector('.qaap-work-hub-aux-pr-pinned')).to.equal(null);
        view.dispose();
    });

    it('disables the pull request row when no project is open', () => {
        const { panel } = createHarness({ canShow: false });
        panel.show();
        const prItem = launcherOpen(panel, 'pull-request');
        expect(prItem.disabled).to.equal(true);
        expect(prItem.title).to.equal('Requires an open project with a Git repository.');
        expect(prItem.getAttribute('aria-description')).to.equal('Requires an open project with a Git repository.');
    });

    it('shows a hint instead of views while no task is open', () => {
        const { panel, shown } = createHarness({ canShow: false });
        panel.show();
        const previewItem = launcherOpen(panel, 'preview');
        expect(previewItem.disabled).to.equal(true);
        expect(previewItem.title).to.equal('Open a task to use these views.');
        expect(panel.element.querySelector('.qaap-work-hub-aux-panel-hint')).to.not.equal(null);
        expect(shown).to.deep.equal([]);
    });

    it('closing the panel hands the view back as a user close', () => {
        const { panel, released } = createHarness();
        panel.show();
        launcherOpen(panel, 'preview').click();
        expect(panel.element.querySelector('.qaap-work-hub-aux-panel-close')).to.equal(null);
        panel.toggle();
        expect(released).to.deep.equal([true]);
        expect(panel.isOpen).to.equal(false);
        expect(panel.element.querySelector('.fake-surface')).to.equal(null);
    });

    it('fades the tab strip only on the edges where tabs are hidden', () => {
        const { panel } = createHarness();
        panel.show();
        const tabs = panel.element.querySelector<HTMLElement>('.qaap-work-hub-aux-panel-tabs')!;
        const measure = (scrollLeft: number, clientWidth: number, scrollWidth: number): void => {
            Object.defineProperty(tabs, 'scrollLeft', { configurable: true, value: scrollLeft });
            Object.defineProperty(tabs, 'clientWidth', { configurable: true, value: clientWidth });
            Object.defineProperty(tabs, 'scrollWidth', { configurable: true, value: scrollWidth });
            tabs.dispatchEvent(new window.Event('scroll'));
        };
        const edges = (): string[] => ['theia-mod-overflow-start', 'theia-mod-overflow-end'].filter(name => tabs.classList.contains(name));

        measure(0, 200, 200);
        expect(edges()).to.deep.equal([]);
        measure(0, 200, 500);
        expect(edges()).to.deep.equal(['theia-mod-overflow-end']);
        measure(150, 200, 500);
        expect(edges()).to.deep.equal(['theia-mod-overflow-start', 'theia-mod-overflow-end']);
        measure(300, 200, 500);
        expect(edges()).to.deep.equal(['theia-mod-overflow-start']);
        measure(0, 200, 201);
        expect(edges()).to.deep.equal([]);
    });

    it('Bring back opens the side chat in the main area, closes its tab, and the + button still adds a tab', async () => {
        const opened: string[] = [];
        const sideChat: QaapWorkHubAuxSideChatHost = {
            resolveParent: () => ({ id: 'parent-1', title: 'Fix login', cwd: '/workspace/repos/users/alice/o/r', agentId: 'opencode' }),
            resolveComposerSelection: () => undefined,
            listModels: async () => [],
            pickAttachments: async () => [],
            prepareOutbound: async draft => draft,
            startSignIn: () => undefined,
            openInMainArea: async id => { opened.push(id); },
            subscribeLive: () => Disposable.NULL,
        };
        // The view's close goes to the panel's own close path, wired once the panel exists.
        let closeFromView: () => void = () => undefined;
        const view = new QaapWorkHubAuxSideChatView({
            host: sideChat,
            api: {
                create: async () => ({ id: 'side-1', cwd: '/w', agentId: 'opencode', title: 'x', status: 'idle', messages: [] }) as never,
                post: async () => ({}),
                get: async () => { throw new Error('not used'); },
                remove: async () => undefined,
            },
            onTitle: () => undefined,
            onClose: () => closeFromView(),
            refreshMs: 1_000_000,
        });
        const { panel } = createHarness({ sideChat, sideChatView: view });
        closeFromView = () => (panel as unknown as { closeSideChatTab(): void }).closeSideChatTab();
        panel.show();
        launcherOpen(panel, 'side-chat').click();
        expect(panel.element.dataset.view).to.equal('side-chat');
        const input = view.element.querySelector('textarea') as HTMLTextAreaElement;
        input.value = 'responde solo: ok';
        await view.send();
        expect(view.conversation).to.equal('side-1');

        await view.bringBack();

        expect(opened).to.deep.equal(['side-1']);
        expect(tabKinds(panel)).to.not.include('side-chat');
        expect(view.conversation).to.equal(undefined);
        expect(view.element.hidden).to.equal(true);

        panel.element.querySelector<HTMLButtonElement>('.qaap-work-hub-aux-panel-add')!.click();
        expect(panel.element.dataset.view).to.equal('launcher');
        expect(tabKinds(panel)).to.include('launcher');
        view.dispose();
    });

    it('lists the side chat in the launcher only while a task is open', () => {
        const { panel } = createHarness({ canShow: false });
        panel.show();
        const sideChatItem = launcherOpen(panel, 'side-chat');
        expect(sideChatItem.disabled).to.equal(true);
        expect(sideChatItem.title).to.equal('Requires an active task conversation.');
        expect(sideChatItem.getAttribute('aria-description')).to.equal('Requires an active task conversation.');
    });
});
