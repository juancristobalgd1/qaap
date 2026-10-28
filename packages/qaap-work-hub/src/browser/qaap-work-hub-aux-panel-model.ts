// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// DOM-free state of the desktop Work Hub auxiliary (right) panel: its tabs, the
// recently closed list, width/maximized/open flags and their per-browser-tab
// persistence. The DOM component lives in `qaap-work-hub-aux-panel.ts`.

/** A view the right panel can host. `launcher` is the "New tab" page. */
export type QaapWorkHubAuxPanelViewKind = 'launcher' | 'preview' | 'files' | 'terminal';

/**
 * Views backed by an existing execution surface (everything but the launcher).
 * Review (Changes) is not a view of its own: it is the Files view's Changes mode.
 */
export type QaapWorkHubAuxPanelSurfaceKind = Exclude<QaapWorkHubAuxPanelViewKind, 'launcher'>;

export const QAAP_WORK_HUB_AUX_PANEL_SURFACE_KINDS: readonly QaapWorkHubAuxPanelSurfaceKind[] = ['preview', 'files', 'terminal'];

export interface QaapWorkHubAuxPanelTab {
    readonly id: string;
    readonly kind: QaapWorkHubAuxPanelViewKind;
}

export interface QaapWorkHubAuxPanelClosedTab {
    readonly kind: QaapWorkHubAuxPanelSurfaceKind;
    readonly closedAt: number;
}

/** Shape written to `sessionStorage` (one entry per browser tab, never `localStorage`). */
export interface QaapWorkHubAuxPanelSnapshot {
    open: boolean;
    width: number;
    maximized: boolean;
    tabs: QaapWorkHubAuxPanelViewKind[];
    activeIndex: number;
    recentlyClosed: QaapWorkHubAuxPanelClosedTab[];
}

export const QAAP_WORK_HUB_AUX_PANEL_STORAGE_KEY = 'qaap.workHub.auxPanel';
export const QAAP_WORK_HUB_AUX_PANEL_DEFAULT_WIDTH = 480;
export const QAAP_WORK_HUB_AUX_PANEL_MIN_WIDTH = 320;
/** The chat column never shrinks below this while the panel is docked (not maximized). */
export const QAAP_WORK_HUB_AUX_PANEL_MIN_CHAT_WIDTH = 360;
export const QAAP_WORK_HUB_AUX_PANEL_RECENT_LIMIT = 8;

const VIEW_KINDS: readonly QaapWorkHubAuxPanelViewKind[] = ['launcher', ...QAAP_WORK_HUB_AUX_PANEL_SURFACE_KINDS];

/** Narrow storage contract so specs can pass an in-memory map. */
export interface QaapWorkHubAuxPanelStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

/** Clamp a requested panel width so both the panel and the chat column stay usable. */
export function clampQaapWorkHubAuxPanelWidth(width: number, availableWidth: number): number {
    const max = Math.max(QAAP_WORK_HUB_AUX_PANEL_MIN_WIDTH, availableWidth - QAAP_WORK_HUB_AUX_PANEL_MIN_CHAT_WIDTH);
    if (!Number.isFinite(width)) {
        return Math.min(QAAP_WORK_HUB_AUX_PANEL_DEFAULT_WIDTH, max);
    }
    return Math.round(Math.min(max, Math.max(QAAP_WORK_HUB_AUX_PANEL_MIN_WIDTH, width)));
}

/** Tab list, active tab and recently-closed history of the desktop right panel. */
export class QaapWorkHubAuxPanelModel {
    protected tabList: QaapWorkHubAuxPanelTab[] = [];
    protected activeTabId: string | undefined;
    protected closed: QaapWorkHubAuxPanelClosedTab[] = [];
    protected nextId = 1;

    open = false;
    width = QAAP_WORK_HUB_AUX_PANEL_DEFAULT_WIDTH;
    maximized = false;

    constructor(protected readonly now: () => number = () => Date.now()) { }

    get tabs(): readonly QaapWorkHubAuxPanelTab[] {
        return this.tabList;
    }

    get activeTab(): QaapWorkHubAuxPanelTab | undefined {
        return this.tabList.find(tab => tab.id === this.activeTabId);
    }

    get recentlyClosed(): readonly QaapWorkHubAuxPanelClosedTab[] {
        return this.closed;
    }

    /** Opening an empty panel shows the launcher, like a fresh "New tab". */
    ensureTab(): QaapWorkHubAuxPanelTab {
        return this.activeTab ?? this.tabList[0] ?? this.addLauncher();
    }

    /** Focus the existing "New tab" or add one; there is never more than one launcher. */
    addLauncher(): QaapWorkHubAuxPanelTab {
        const existing = this.tabList.find(candidate => candidate.kind === 'launcher');
        if (existing) {
            this.activeTabId = existing.id;
            return existing;
        }
        const tab = this.createTab('launcher');
        this.tabList.push(tab);
        this.activeTabId = tab.id;
        return tab;
    }

    /**
     * Show a surface. Each surface is a single live widget, so a kind appears at
     * most once: an open tab of that kind is focused, an active launcher turns
     * into the view (like picking from a browser's new-tab page), and otherwise
     * a tab is appended.
     */
    openView(kind: QaapWorkHubAuxPanelSurfaceKind): QaapWorkHubAuxPanelTab {
        this.closed = this.closed.filter(entry => entry.kind !== kind);
        const existing = this.tabList.find(candidate => candidate.kind === kind);
        if (existing) {
            this.activeTabId = existing.id;
            return existing;
        }
        const tab = this.createTab(kind);
        const active = this.activeTab;
        if (active?.kind === 'launcher') {
            this.tabList.splice(this.tabList.indexOf(active), 1, tab);
        } else {
            this.tabList.push(tab);
        }
        this.activeTabId = tab.id;
        return tab;
    }

    activate(id: string): QaapWorkHubAuxPanelTab | undefined {
        const tab = this.tabList.find(entry => entry.id === id);
        if (tab) {
            this.activeTabId = tab.id;
        }
        return tab;
    }

    /**
     * Close a tab and return the tab that becomes active (the right neighbour,
     * else the left one), or `undefined` when the panel ran out of tabs.
     */
    closeTab(id: string): QaapWorkHubAuxPanelTab | undefined {
        const index = this.tabList.findIndex(tab => tab.id === id);
        if (index < 0) {
            return this.activeTab;
        }
        const [removed] = this.tabList.splice(index, 1);
        if (removed.kind !== 'launcher') {
            this.closed = [
                { kind: removed.kind, closedAt: this.now() },
                ...this.closed.filter(entry => entry.kind !== removed.kind),
            ].slice(0, QAAP_WORK_HUB_AUX_PANEL_RECENT_LIMIT);
        }
        if (this.activeTabId === id) {
            const next = this.tabList[Math.min(index, this.tabList.length - 1)];
            this.activeTabId = next?.id;
        }
        return this.activeTab;
    }

    /** Reopen the most recently closed tab of `kind` (or the latest one). */
    reopenClosed(kind?: QaapWorkHubAuxPanelSurfaceKind): QaapWorkHubAuxPanelTab | undefined {
        const entry = kind ? this.closed.find(candidate => candidate.kind === kind) : this.closed[0];
        return entry ? this.openView(entry.kind) : undefined;
    }

    /** Case-insensitive match of open and recently closed tabs against their labels. */
    search(query: string, labelOf: (kind: QaapWorkHubAuxPanelViewKind) => string): {
        open: QaapWorkHubAuxPanelTab[];
        recentlyClosed: QaapWorkHubAuxPanelClosedTab[];
    } {
        const needle = query.trim().toLocaleLowerCase();
        const matches = (kind: QaapWorkHubAuxPanelViewKind): boolean => !needle || labelOf(kind).toLocaleLowerCase().includes(needle);
        return {
            open: this.tabList.filter(tab => matches(tab.kind)),
            recentlyClosed: this.closed.filter(entry => matches(entry.kind)),
        };
    }

    snapshot(): QaapWorkHubAuxPanelSnapshot {
        const active = this.activeTab;
        return {
            open: this.open,
            width: this.width,
            maximized: this.maximized,
            tabs: this.tabList.map(tab => tab.kind),
            activeIndex: active ? this.tabList.indexOf(active) : -1,
            recentlyClosed: [...this.closed],
        };
    }

    restore(snapshot: Partial<QaapWorkHubAuxPanelSnapshot> | undefined): void {
        if (!snapshot || typeof snapshot !== 'object') {
            return;
        }
        this.open = snapshot.open === true;
        this.maximized = snapshot.maximized === true;
        if (typeof snapshot.width === 'number' && Number.isFinite(snapshot.width)) {
            this.width = snapshot.width;
        }
        const seen = new Set<QaapWorkHubAuxPanelViewKind>();
        const kinds = Array.isArray(snapshot.tabs) ? snapshot.tabs : [];
        this.tabList = [];
        for (const kind of kinds) {
            if (VIEW_KINDS.includes(kind) && !seen.has(kind)) {
                seen.add(kind);
                this.tabList.push(this.createTab(kind));
            }
        }
        const activeIndex = typeof snapshot.activeIndex === 'number' ? snapshot.activeIndex : -1;
        this.activeTabId = (this.tabList[activeIndex] ?? this.tabList[0])?.id;
        const closed = Array.isArray(snapshot.recentlyClosed) ? snapshot.recentlyClosed : [];
        this.closed = closed
            .filter(entry => !!entry && QAAP_WORK_HUB_AUX_PANEL_SURFACE_KINDS.includes(entry.kind) && typeof entry.closedAt === 'number')
            .slice(0, QAAP_WORK_HUB_AUX_PANEL_RECENT_LIMIT);
    }

    save(storage: QaapWorkHubAuxPanelStorage | undefined): void {
        try {
            storage?.setItem(QAAP_WORK_HUB_AUX_PANEL_STORAGE_KEY, JSON.stringify(this.snapshot()));
        } catch {
            /* private browsing / quota */
        }
    }

    load(storage: QaapWorkHubAuxPanelStorage | undefined): void {
        try {
            const raw = storage?.getItem(QAAP_WORK_HUB_AUX_PANEL_STORAGE_KEY);
            if (raw) {
                this.restore(JSON.parse(raw));
            }
        } catch {
            /* corrupt entry: keep defaults */
        }
    }

    protected createTab(kind: QaapWorkHubAuxPanelViewKind): QaapWorkHubAuxPanelTab {
        return { id: `aux-${this.nextId++}`, kind };
    }
}
