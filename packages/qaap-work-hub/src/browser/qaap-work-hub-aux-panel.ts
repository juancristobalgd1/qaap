// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { matchesMobileOneColumnLayout } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { peekPreferDesktopIde } from '@theia/qaap-shared-core/lib/browser/mobile-projects-open';
import { installMobilePanelResizeDrag } from '@theia/qaap-mobile-shell/lib/browser/mobile-panel-resize-drag';
import { isDesktopSessionsSidebarLayout, QAAP_DESKTOP_SESSIONS_SIDEBAR_MEDIA_QUERY } from './mobile-work-hub-sessions-sidebar';
import {
    clampQaapWorkHubAuxPanelWidth,
    QAAP_WORK_HUB_AUX_PANEL_SURFACE_KINDS,
    QaapWorkHubAuxPanelModel,
    type QaapWorkHubAuxPanelStorage,
    type QaapWorkHubAuxPanelSurfaceKind,
    type QaapWorkHubAuxPanelTab,
    type QaapWorkHubAuxPanelViewKind,
} from './qaap-work-hub-aux-panel-model';

/** The execution surface (live widget host) a panel view is backed by. */
export type QaapWorkHubAuxPanelSurface = 'preview' | 'files' | 'terminal';

/** What the panel needs from the Work Hub execution surfaces. */
export interface QaapWorkHubAuxPanelHost {
    /** `true` while a task is open, i.e. while surfaces can be mounted. */
    canShowSurfaces(): boolean;
    /** Activate `kind`; the surface arrives later through {@link QaapWorkHubAuxPanel.dockSurface}. */
    showSurface(kind: QaapWorkHubAuxPanelSurfaceKind): void;
    /** Hand the docked surface back to the transcript. `userClosed` records a closed Preview. */
    releaseSurface(userClosed: boolean): void;
}

/** `true` where the chevron opens the docked right panel instead of the views menu. */
export function isQaapWorkHubAuxPanelLayout(): boolean {
    return typeof document !== 'undefined'
        && isDesktopSessionsSidebarLayout()
        && !matchesMobileOneColumnLayout()
        && !peekPreferDesktopIde()
        && !document.body.classList.contains('theia-mobile-mod-desktop-ide');
}

export function qaapWorkHubAuxPanelSurfaceOf(kind: QaapWorkHubAuxPanelSurfaceKind): QaapWorkHubAuxPanelSurface {
    return kind === 'review' ? 'files' : kind;
}

interface ViewSpec {
    label: string;
    description: string;
    icon: string;
}

function viewSpec(kind: QaapWorkHubAuxPanelViewKind): ViewSpec {
    switch (kind) {
        case 'preview':
            return {
                label: nls.localizeByDefault('Browser'),
                description: nls.localize('qaap/workHubAuxPanel/browserDescription', 'Browse websites and preview apps.'),
                icon: 'codicon-globe',
            };
        case 'files':
            return {
                label: nls.localizeByDefault('Files'),
                description: nls.localize('qaap/workHubAuxPanel/filesDescription', 'Browse and open the project files.'),
                icon: 'codicon-files',
            };
        case 'terminal':
            return {
                label: nls.localizeByDefault('Terminal'),
                description: nls.localize('qaap/workHubAuxPanel/terminalDescription', 'Run commands and view output.'),
                icon: 'codicon-terminal',
            };
        case 'review':
            return {
                label: nls.localizeByDefault('Review'),
                description: nls.localize('qaap/workHubAuxPanel/reviewDescription', 'Review code changes and diffs.'),
                icon: 'codicon-diff',
            };
        default:
            return {
                label: nls.localize('qaap/workHubAuxPanel/newTab', 'New tab'),
                description: '',
                icon: 'codicon-file',
            };
    }
}

function codiconButton(className: string, icon: string, label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = label;
    button.setAttribute('aria-label', label);
    const glyph = document.createElement('span');
    glyph.className = `codicon ${icon}`;
    glyph.setAttribute('aria-hidden', 'true');
    button.append(glyph);
    return button;
}

function formatClosedAgo(closedAt: number, now: number): string {
    const minutes = Math.max(0, Math.floor((now - closedAt) / 60000));
    if (minutes < 1) {
        return nls.localizeByDefault('now');
    }
    if (minutes < 60) {
        return nls.localizeByDefault('{0}m', minutes);
    }
    const hours = Math.floor(minutes / 60);
    return hours < 24
        ? nls.localize('qaap/workHubAuxPanel/hoursAgo', '{0}h', hours)
        : nls.localize('qaap/workHubAuxPanel/daysAgo', '{0}d', Math.floor(hours / 24));
}

/**
 * Desktop Work Hub right panel: a third column beside the sessions sidebar and
 * the chat, with its own tab bar, a "New tab" launcher, a searchable tab menu,
 * a resize handle and maximize/close controls. The views themselves are the
 * existing execution surfaces, docked here by the execution-surface tabs UI.
 */
export class QaapWorkHubAuxPanel {
    readonly element: HTMLElement;
    readonly model: QaapWorkHubAuxPanelModel;

    protected readonly tabStrip: HTMLElement;
    protected readonly maximizeButton: HTMLButtonElement;
    protected readonly launcher: HTMLElement;
    protected readonly surfaceSlot: HTMLElement;
    protected readonly emptyState: HTMLElement;
    protected readonly menuButton: HTMLButtonElement;
    protected readonly menu: HTMLElement;
    protected readonly menuSearch: HTMLInputElement;
    protected readonly menuList: HTMLElement;
    protected readonly resizeHandle: HTMLElement;
    protected readonly toDispose = new DisposableCollection();
    protected menuDispose: Disposable = Disposable.NULL;

    protected dockedElement: HTMLElement | undefined;
    protected dockedSurface: QaapWorkHubAuxPanelSurface | undefined;
    /** The view the panel asked the host for; disambiguates Files vs Review (same surface). */
    protected requestedKind: QaapWorkHubAuxPanelSurfaceKind | undefined;
    /** Tab id whose surface was already re-requested, so header rebuilds cannot loop. */
    protected restoredTabId: string | undefined;
    /** Set while the panel itself swaps or closes the docked surface. */
    protected releasing = false;

    constructor(
        protected readonly host: QaapWorkHubAuxPanelHost,
        protected readonly storage: QaapWorkHubAuxPanelStorage | undefined = QaapWorkHubAuxPanel.defaultStorage(),
    ) {
        this.model = new QaapWorkHubAuxPanelModel();
        this.model.load(storage);

        this.element = document.createElement('aside');
        this.element.className = 'qaap-work-hub-aux-panel';
        this.element.setAttribute('aria-label', nls.localizeByDefault('Views'));
        this.element.hidden = true;

        this.resizeHandle = document.createElement('div');
        this.resizeHandle.className = 'qaap-work-hub-aux-panel-resize-handle';
        this.resizeHandle.tabIndex = 0;
        this.resizeHandle.setAttribute('role', 'separator');
        this.resizeHandle.setAttribute('aria-orientation', 'vertical');
        this.resizeHandle.setAttribute('aria-label', nls.localize('qaap/workHubAuxPanel/resize', 'Resize views panel'));

        const bar = document.createElement('header');
        bar.className = 'qaap-work-hub-aux-panel-tabbar';
        const tabsLabel = nls.localize('qaap/workHubAuxPanel/tabs', 'Tabs');
        this.menuButton = codiconButton('qaap-work-hub-aux-panel-action qaap-work-hub-aux-panel-menu-button', 'codicon-chevron-down', tabsLabel);
        this.menuButton.setAttribute('aria-haspopup', 'menu');
        this.menuButton.setAttribute('aria-expanded', 'false');
        this.menuButton.addEventListener('click', event => {
            event.stopPropagation();
            if (this.menu.hidden) {
                this.openMenu();
            } else {
                this.closeMenu();
            }
        });
        this.tabStrip = document.createElement('div');
        this.tabStrip.className = 'qaap-work-hub-aux-panel-tabs';
        this.tabStrip.setAttribute('role', 'tablist');
        this.tabStrip.setAttribute('aria-label', tabsLabel);
        const addButton = codiconButton('qaap-work-hub-aux-panel-action qaap-work-hub-aux-panel-add', 'codicon-add', viewSpec('launcher').label);
        addButton.addEventListener('click', () => this.activateTab(this.model.addLauncher()));
        const spacer = document.createElement('span');
        spacer.className = 'qaap-work-hub-aux-panel-spacer';
        this.maximizeButton = codiconButton('qaap-work-hub-aux-panel-action qaap-work-hub-aux-panel-maximize', 'codicon-screen-full', '');
        this.maximizeButton.addEventListener('click', () => this.setMaximized(!this.model.maximized));
        const closeButton = codiconButton(
            'qaap-work-hub-aux-panel-action qaap-work-hub-aux-panel-close',
            'codicon-layout-sidebar-right-off',
            nls.localize('qaap/workHubAuxPanel/close', 'Close views panel'),
        );
        closeButton.addEventListener('click', () => this.hide());
        bar.append(this.menuButton, this.tabStrip, addButton, spacer, this.maximizeButton, closeButton);

        const body = document.createElement('div');
        body.className = 'qaap-work-hub-aux-panel-body';
        this.launcher = document.createElement('div');
        this.launcher.className = 'qaap-work-hub-aux-panel-launcher';
        this.surfaceSlot = document.createElement('div');
        this.surfaceSlot.className = 'qaap-work-hub-aux-panel-surface';
        this.emptyState = document.createElement('div');
        this.emptyState.className = 'qaap-work-hub-aux-panel-empty';
        body.append(this.launcher, this.surfaceSlot, this.emptyState);

        this.menu = document.createElement('div');
        this.menu.className = 'qaap-work-hub-aux-panel-menu';
        this.menu.hidden = true;
        this.menu.setAttribute('role', 'menu');
        this.menu.setAttribute('aria-label', tabsLabel);
        this.menuSearch = document.createElement('input');
        this.menuSearch.type = 'search';
        this.menuSearch.className = 'qaap-work-hub-aux-panel-menu-search';
        this.menuSearch.placeholder = nls.localize('qaap/workHubAuxPanel/searchTabs', 'Search tabs…');
        this.menuSearch.setAttribute('aria-label', this.menuSearch.placeholder);
        this.menuSearch.addEventListener('input', () => this.renderMenuList());
        this.menuList = document.createElement('div');
        this.menuList.className = 'qaap-work-hub-aux-panel-menu-list';
        this.menu.append(this.menuSearch, this.menuList);

        this.element.append(this.resizeHandle, bar, body, this.menu);
        this.element.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !this.menu.hidden) {
                event.preventDefault();
                event.stopPropagation();
                this.closeMenu();
                this.menuButton.focus();
            }
        });
        this.installResize();
        this.installLayoutListener();
    }

    static defaultStorage(): QaapWorkHubAuxPanelStorage | undefined {
        try {
            return typeof window !== 'undefined' ? window.sessionStorage : undefined;
        } catch {
            return undefined;
        }
    }

    get isOpen(): boolean {
        return this.model.open && !this.element.hidden;
    }

    /** The chevron: open the panel (on its last tab, or the launcher) or close it. */
    toggle(): void {
        if (this.isOpen) {
            this.hide();
        } else {
            this.show();
        }
    }

    show(): void {
        if (!isQaapWorkHubAuxPanelLayout()) {
            return;
        }
        this.attach();
        this.model.open = true;
        this.element.hidden = false;
        document.body.classList.add('qaap-mod-work-hub-aux-panel-open');
        this.applyWidth(this.model.width);
        this.applyMaximized();
        this.restoredTabId = undefined;
        this.activateTab(this.model.ensureTab());
        this.notifyLayout();
    }

    hide(): void {
        this.closeMenu();
        this.releaseDocked(true);
        this.model.open = false;
        this.collapse();
        this.persist();
    }

    /**
     * The execution-surface UI calls this when it mounts a surface while the panel
     * layout is active. Returns `false` when the caller should fall back to the
     * full-screen drawer.
     */
    dockSurface(surface: QaapWorkHubAuxPanelSurface, element: HTMLElement): boolean {
        if (!isQaapWorkHubAuxPanelLayout()) {
            return false;
        }
        const requested = this.requestedKind && qaapWorkHubAuxPanelSurfaceOf(this.requestedKind) === surface ? this.requestedKind : undefined;
        const active = this.model.activeTab;
        const kind: QaapWorkHubAuxPanelSurfaceKind = requested
            ?? (surface === 'files' && active?.kind === 'review' ? 'review' : surface);
        this.requestedKind = undefined;
        if (this.dockedElement && this.dockedElement !== element) {
            this.dockedElement.remove();
        }
        this.dockedElement = element;
        this.dockedSurface = surface;
        const tab = this.model.openView(kind);
        this.restoredTabId = tab.id;
        if (!this.isOpen) {
            this.attach();
            this.model.open = true;
            this.element.hidden = false;
            document.body.classList.add('qaap-mod-work-hub-aux-panel-open');
            this.applyWidth(this.model.width);
            this.applyMaximized();
            this.notifyLayout();
        }
        this.surfaceSlot.replaceChildren(element);
        this.render();
        this.persist();
        return true;
    }

    /** The docked surface left the panel (closed by the panel or by a task/context switch). */
    undockSurface(element: HTMLElement): void {
        if (element !== this.dockedElement) {
            element.remove();
            return;
        }
        element.remove();
        this.dockedElement = undefined;
        this.dockedSurface = undefined;
        if (!this.releasing) {
            // A context switch (another task, project or the Chat surface) took the
            // view away: let the next header build re-request it for the new task.
            this.restoredTabId = undefined;
        }
        this.render();
    }

    /**
     * Called whenever the chat header is (re)built: after a reload or a task
     * switch, re-request the active view once a task can host it.
     */
    syncWithOpenTask(): void {
        if (!this.model.open) {
            return;
        }
        if (!isQaapWorkHubAuxPanelLayout()) {
            return;
        }
        if (this.element.hidden) {
            this.show();
            return;
        }
        const active = this.model.activeTab;
        if (!active || active.kind === 'launcher' || this.dockedElement || this.restoredTabId === active.id) {
            this.render();
            return;
        }
        if (!this.host.canShowSurfaces()) {
            return;
        }
        this.restoredTabId = active.id;
        this.requestSurface(active.kind);
    }

    dispose(): void {
        this.closeMenu();
        this.toDispose.dispose();
        this.collapse();
        this.element.remove();
    }

    protected attach(): void {
        if (!this.element.isConnected) {
            document.body.append(this.element);
        }
    }

    protected collapse(): void {
        this.element.hidden = true;
        document.body.classList.remove('qaap-mod-work-hub-aux-panel-open', 'qaap-mod-work-hub-aux-panel-maximized');
        this.notifyLayout();
    }

    protected activateTab(tab: QaapWorkHubAuxPanelTab): void {
        this.model.activate(tab.id);
        this.closeMenu();
        if (tab.kind === 'launcher') {
            this.releaseDocked(false);
        } else if (!this.dockedSurface || this.dockedSurface !== qaapWorkHubAuxPanelSurfaceOf(tab.kind) || tab.kind === 'review' || tab.kind === 'files') {
            this.restoredTabId = tab.id;
            this.requestSurface(tab.kind);
        }
        this.render();
        this.persist();
    }

    protected closeTab(tab: QaapWorkHubAuxPanelTab): void {
        const wasActive = this.model.activeTab?.id === tab.id;
        const next = this.model.closeTab(tab.id);
        if (!wasActive) {
            this.render();
            this.persist();
            return;
        }
        this.releaseDocked(true);
        if (next) {
            this.activateTab(next);
        } else {
            this.hide();
        }
    }

    protected requestSurface(kind: QaapWorkHubAuxPanelSurfaceKind): void {
        if (!this.host.canShowSurfaces()) {
            this.render();
            return;
        }
        if (this.dockedSurface && this.dockedSurface !== qaapWorkHubAuxPanelSurfaceOf(kind)) {
            this.releaseDocked(false);
        }
        this.requestedKind = kind;
        this.host.showSurface(kind);
    }

    protected releaseDocked(userClosed: boolean): void {
        if (!this.dockedElement) {
            return;
        }
        this.releasing = true;
        try {
            this.host.releaseSurface(userClosed);
        } finally {
            this.releasing = false;
        }
        if (this.dockedElement) {
            this.undockSurface(this.dockedElement);
        }
    }

    protected render(): void {
        this.renderTabs();
        const active = this.model.activeTab;
        const showLauncher = !active || active.kind === 'launcher';
        this.launcher.hidden = !showLauncher;
        this.surfaceSlot.hidden = showLauncher || !this.dockedElement;
        this.emptyState.hidden = showLauncher || !!this.dockedElement;
        this.element.dataset.view = active?.kind ?? 'launcher';
        if (showLauncher) {
            this.renderLauncher();
        } else if (!this.dockedElement && active) {
            this.renderEmptyState(active.kind as QaapWorkHubAuxPanelSurfaceKind);
        }
        this.maximizeButton.title = this.model.maximized
            ? nls.localize('qaap/workHubAuxPanel/restore', 'Restore views panel')
            : nls.localize('qaap/workHubAuxPanel/maximize', 'Maximize views panel');
        this.maximizeButton.setAttribute('aria-label', this.maximizeButton.title);
        this.maximizeButton.setAttribute('aria-pressed', String(this.model.maximized));
        const glyph = this.maximizeButton.querySelector('.codicon');
        glyph?.classList.toggle('codicon-screen-full', !this.model.maximized);
        glyph?.classList.toggle('codicon-screen-normal', this.model.maximized);
    }

    protected renderTabs(): void {
        const active = this.model.activeTab;
        const closeLabel = nls.localize('qaap/workHubAuxPanel/closeTab', 'Close tab');
        this.tabStrip.replaceChildren(...this.model.tabs.map(tab => {
            const spec = viewSpec(tab.kind);
            const item = document.createElement('div');
            item.className = 'qaap-work-hub-aux-panel-tab';
            item.dataset.kind = tab.kind;
            item.classList.toggle('theia-mod-active', tab.id === active?.id);
            const select = document.createElement('button');
            select.type = 'button';
            select.className = 'qaap-work-hub-aux-panel-tab-select';
            select.setAttribute('role', 'tab');
            select.setAttribute('aria-selected', String(tab.id === active?.id));
            select.title = spec.label;
            const icon = document.createElement('span');
            icon.className = `codicon ${spec.icon}`;
            icon.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.className = 'qaap-work-hub-aux-panel-tab-label';
            label.textContent = spec.label;
            select.append(icon, label);
            select.addEventListener('click', () => this.activateTab(tab));
            const close = codiconButton('qaap-work-hub-aux-panel-tab-close', 'codicon-close', `${closeLabel}: ${spec.label}`);
            close.addEventListener('click', event => {
                event.stopPropagation();
                this.closeTab(tab);
            });
            item.addEventListener('auxclick', event => {
                if (event.button === 1) {
                    event.preventDefault();
                    this.closeTab(tab);
                }
            });
            item.append(select, close);
            return item;
        }));
    }

    protected renderLauncher(): void {
        const title = document.createElement('h2');
        title.className = 'qaap-work-hub-aux-panel-launcher-title';
        title.textContent = viewSpec('launcher').label;
        const list = document.createElement('div');
        list.className = 'qaap-work-hub-aux-panel-launcher-list';
        list.setAttribute('role', 'list');
        const enabled = this.host.canShowSurfaces();
        for (const kind of QAAP_WORK_HUB_AUX_PANEL_SURFACE_KINDS) {
            const spec = viewSpec(kind);
            const row = document.createElement('div');
            row.className = 'qaap-work-hub-aux-panel-launcher-item';
            row.dataset.kind = kind;
            row.setAttribute('role', 'listitem');
            // The tile centers the glyph; the codicon itself keeps its own inline box.
            const icon = document.createElement('span');
            icon.className = 'qaap-work-hub-aux-panel-launcher-icon';
            icon.setAttribute('aria-hidden', 'true');
            const glyph = document.createElement('span');
            glyph.className = `codicon ${spec.icon}`;
            icon.append(glyph);
            const text = document.createElement('div');
            text.className = 'qaap-work-hub-aux-panel-launcher-text';
            const name = document.createElement('span');
            name.className = 'qaap-work-hub-aux-panel-launcher-name';
            name.textContent = spec.label;
            const description = document.createElement('span');
            description.className = 'qaap-work-hub-aux-panel-launcher-description';
            description.textContent = spec.description;
            text.append(name, description);
            const open = document.createElement('button');
            open.type = 'button';
            open.className = 'qaap-work-hub-aux-panel-launcher-open';
            open.textContent = nls.localizeByDefault('Open');
            open.setAttribute('aria-label', `${open.textContent} ${spec.label}`);
            open.disabled = !enabled;
            open.addEventListener('click', () => this.activateTab(this.model.openView(kind)));
            row.append(icon, text, open);
            list.append(row);
        }
        const children: HTMLElement[] = [title, list];
        if (!enabled) {
            children.push(this.createHint());
        }
        this.launcher.replaceChildren(...children);
    }

    protected renderEmptyState(kind: QaapWorkHubAuxPanelSurfaceKind): void {
        const spec = viewSpec(kind);
        const icon = document.createElement('span');
        icon.className = `qaap-work-hub-aux-panel-empty-icon codicon ${spec.icon}`;
        icon.setAttribute('aria-hidden', 'true');
        const title = document.createElement('p');
        title.className = 'qaap-work-hub-aux-panel-empty-title';
        title.textContent = spec.label;
        const children: HTMLElement[] = [icon, title];
        if (this.host.canShowSurfaces()) {
            const open = document.createElement('button');
            open.type = 'button';
            open.className = 'qaap-work-hub-aux-panel-launcher-open';
            open.textContent = nls.localizeByDefault('Open');
            open.addEventListener('click', () => {
                this.restoredTabId = this.model.activeTab?.id;
                this.requestSurface(kind);
            });
            children.push(open);
        } else {
            children.push(this.createHint());
        }
        this.emptyState.replaceChildren(...children);
    }

    protected createHint(): HTMLElement {
        const hint = document.createElement('p');
        hint.className = 'qaap-work-hub-aux-panel-hint';
        hint.textContent = nls.localize('qaap/workHubAuxPanel/openTaskHint', 'Open a task to use these views.');
        return hint;
    }

    protected openMenu(): void {
        this.menuSearch.value = '';
        this.renderMenuList();
        this.menu.hidden = false;
        this.menuButton.setAttribute('aria-expanded', 'true');
        this.menuSearch.focus();
        const view = this.element.ownerDocument.defaultView ?? window;
        const onDismiss = (event: Event): void => {
            const target = event.target;
            if (target instanceof Node && (this.menu.contains(target) || this.menuButton.contains(target))) {
                return;
            }
            this.closeMenu();
        };
        const timer = view.setTimeout(() => view.addEventListener('pointerdown', onDismiss, true), 0);
        this.menuDispose.dispose();
        this.menuDispose = Disposable.create(() => {
            view.clearTimeout(timer);
            view.removeEventListener('pointerdown', onDismiss, true);
        });
    }

    protected closeMenu(): void {
        this.menuDispose.dispose();
        this.menuDispose = Disposable.NULL;
        this.menu.hidden = true;
        this.menuButton.setAttribute('aria-expanded', 'false');
    }

    protected renderMenuList(): void {
        const { open, recentlyClosed } = this.model.search(this.menuSearch.value, kind => viewSpec(kind).label);
        const active = this.model.activeTab;
        const now = Date.now();
        const sections: HTMLElement[] = [];
        const heading = (text: string): HTMLElement => {
            const element = document.createElement('div');
            element.className = 'qaap-work-hub-aux-panel-menu-heading';
            element.textContent = text;
            return element;
        };
        const row = (kind: QaapWorkHubAuxPanelViewKind, meta: string | undefined, onClick: () => void, current: boolean): HTMLElement => {
            const spec = viewSpec(kind);
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'qaap-work-hub-aux-panel-menu-item';
            item.setAttribute('role', 'menuitem');
            item.classList.toggle('theia-mod-active', current);
            const icon = document.createElement('span');
            icon.className = `codicon ${spec.icon}`;
            icon.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.className = 'qaap-work-hub-aux-panel-menu-item-label';
            label.textContent = spec.label;
            item.append(icon, label);
            if (meta) {
                const time = document.createElement('span');
                time.className = 'qaap-work-hub-aux-panel-menu-item-meta';
                time.textContent = meta;
                item.append(time);
            }
            item.addEventListener('click', onClick);
            return item;
        };
        if (open.length) {
            sections.push(heading(nls.localize('qaap/workHubAuxPanel/openTabs', 'Open tabs')));
            for (const tab of open) {
                sections.push(row(tab.kind, undefined, () => this.activateTab(tab), tab.id === active?.id));
            }
        }
        if (recentlyClosed.length) {
            sections.push(heading(nls.localize('qaap/workHubAuxPanel/recentlyClosed', 'Recently closed tabs')));
            for (const entry of recentlyClosed) {
                sections.push(row(entry.kind, formatClosedAgo(entry.closedAt, now), () => {
                    const tab = this.model.reopenClosed(entry.kind);
                    if (tab) {
                        this.activateTab(tab);
                    }
                }, false));
            }
        }
        if (!sections.length) {
            const empty = document.createElement('div');
            empty.className = 'qaap-work-hub-aux-panel-menu-empty';
            empty.textContent = nls.localize('qaap/workHubAuxPanel/noTabsFound', 'No tabs found');
            sections.push(empty);
        }
        this.menuList.replaceChildren(...sections);
    }

    protected setMaximized(maximized: boolean): void {
        this.model.maximized = maximized;
        this.applyMaximized();
        this.render();
        this.persist();
        this.notifyLayout();
    }

    protected applyMaximized(): void {
        document.body.classList.toggle('qaap-mod-work-hub-aux-panel-maximized', this.model.maximized && !this.element.hidden);
    }

    protected availableWidth(): number {
        const view = this.element.ownerDocument.defaultView;
        const viewport = view?.innerWidth ?? 0;
        const sidebar = document.querySelector('.theia-mobile-work-hub-sessions-sidebar.theia-mod-visible');
        return viewport - (sidebar instanceof HTMLElement ? sidebar.getBoundingClientRect().width : 0);
    }

    protected applyWidth(width: number): void {
        const clamped = clampQaapWorkHubAuxPanelWidth(width, this.availableWidth());
        document.documentElement.style.setProperty('--qaap-work-hub-aux-panel-width', `${clamped}px`);
        this.resizeHandle.setAttribute('aria-valuenow', String(clamped));
    }

    protected setWidth(width: number): void {
        const clamped = clampQaapWorkHubAuxPanelWidth(width, this.availableWidth());
        this.model.width = clamped;
        this.applyWidth(clamped);
        this.persist();
        this.notifyLayout();
    }

    protected installResize(): void {
        this.toDispose.push(installMobilePanelResizeDrag({
            handle: this.resizeHandle,
            enabled: () => this.isOpen && !this.model.maximized,
            onStart: () => document.body.classList.add('qaap-mod-work-hub-aux-panel-resizing'),
            onMove: ({ clientX }) => {
                const view = this.element.ownerDocument.defaultView;
                this.setWidth((view?.innerWidth ?? 0) - clientX);
            },
            onEnd: () => document.body.classList.remove('qaap-mod-work-hub-aux-panel-resizing'),
        }));
        const onKeyDown = (event: KeyboardEvent): void => {
            if (!this.isOpen || this.model.maximized) {
                return;
            }
            // The handle sits on the panel's left edge: moving it left widens the panel.
            const step = event.key === 'ArrowLeft' ? 16 : event.key === 'ArrowRight' ? -16 : 0;
            if (!step) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            this.setWidth(this.model.width + step);
        };
        this.resizeHandle.addEventListener('keydown', onKeyDown);
        this.toDispose.push(Disposable.create(() => this.resizeHandle.removeEventListener('keydown', onKeyDown)));
    }

    /** Leaving the desktop layout (narrow window, touch, IDE) hands the view back and hides the panel. */
    protected installLayoutListener(): void {
        const view = this.element.ownerDocument.defaultView;
        const query = view?.matchMedia?.(QAAP_DESKTOP_SESSIONS_SIDEBAR_MEDIA_QUERY);
        const onResize = (): void => {
            if (this.isOpen) {
                this.applyWidth(this.model.width);
            }
        };
        view?.addEventListener('resize', onResize);
        this.toDispose.push(Disposable.create(() => view?.removeEventListener('resize', onResize)));
        if (!query || typeof query.addEventListener !== 'function') {
            return;
        }
        const onChange = (): void => {
            if (isQaapWorkHubAuxPanelLayout()) {
                this.syncWithOpenTask();
                return;
            }
            if (!this.element.hidden) {
                const open = this.model.open;
                this.releaseDocked(false);
                this.collapse();
                // Keep the remembered state: back on desktop, the panel reopens.
                this.model.open = open;
                this.persist();
            }
        };
        query.addEventListener('change', onChange);
        this.toDispose.push(Disposable.create(() => query.removeEventListener('change', onChange)));
    }

    protected persist(): void {
        this.model.save(this.storage);
    }

    /** Theia split panels size themselves from window `resize`; the grid column just changed. */
    protected notifyLayout(): void {
        const view = this.element.ownerDocument.defaultView;
        if (!view || typeof view.requestAnimationFrame !== 'function') {
            return;
        }
        view.requestAnimationFrame(() => view.dispatchEvent(new Event('resize')));
    }
}
