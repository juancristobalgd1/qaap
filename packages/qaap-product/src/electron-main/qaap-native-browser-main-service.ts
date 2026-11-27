// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { BrowserWindow, shell, webContents, WebContentsView } from 'electron';
import { injectable } from '@theia/core/shared/inversify';
import type { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import {
    isAllowedQaapNativeBrowserUrl,
    QAAP_NATIVE_BROWSER_MIN_VISIBLE_PX,
    sanitizeQaapNativeBrowserBounds,
    type QaapNativeBrowserBounds,
    type QaapNativeBrowserClient,
    type QaapNativeBrowserEnsureOptions,
    type QaapNativeBrowserService,
    type QaapNativeBrowserStateEvent,
} from '@theia/qaap-adapters/lib/common/qaap-native-browser-protocol';

interface ManagedNativeBrowserView {
    readonly viewId: string;
    readonly ownerWebContentsId: number;
    readonly window: BrowserWindow;
    readonly view: WebContentsView;
    readonly shellOrigin?: string;
    url: string;
    title?: string;
    loading: boolean;
    focused: boolean;
    visible: boolean;
    bounds: QaapNativeBrowserBounds;
    destroyed: boolean;
}

/**
 * Manages Electron native `WebContentsView` instances backing Qaap's embedded Browser tabs.
 *
 * Each view lives outside the renderer DOM, so React/Theia re-renders, SSE updates, and background
 * preview probes never reload the page or wipe user form input. Views use Electron's default
 * session (so Qaap preview auth cookies and site logins persist) with strict sandboxing
 * (`contextIsolation: true, nodeIntegration: false, sandbox: true`).
 */
@injectable()
export class QaapNativeBrowserMainService implements QaapNativeBrowserService, ElectronMainApplicationContribution {

    protected client: QaapNativeBrowserClient | undefined;
    protected readonly views = new Map<string, ManagedNativeBrowserView>();
    protected readonly windowCleanupWired = new Set<number>();

    setClient(client: QaapNativeBrowserClient | undefined): void {
        this.client = client;
        if (!client) {
            // Renderer disconnected (e.g. window closed or F5 reload): tear down orphaned native views.
            void this.destroyAllForOwner();
        }
    }

    dispose(): void {
        void this.destroyAllForOwner();
    }

    onStop(): void {
        void this.destroyAllForOwner();
    }

    protected resolveOwnerWindow(ownerWebContentsId?: number): BrowserWindow | undefined {
        if (ownerWebContentsId !== undefined) {
            const wc = webContents.fromId(ownerWebContentsId);
            if (wc && !wc.isDestroyed()) {
                const win = BrowserWindow.fromWebContents(wc);
                if (win && !win.isDestroyed()) {
                    return win;
                }
            }
        }
        const focused = BrowserWindow.getFocusedWindow();
        if (focused && !focused.isDestroyed()) {
            return focused;
        }
        return BrowserWindow.getAllWindows().find(win => !win.isDestroyed());
    }

    protected emitState(entry: ManagedNativeBrowserView, error?: QaapNativeBrowserStateEvent['error']): QaapNativeBrowserStateEvent {
        const wc = entry.view.webContents;
        const alive = !entry.destroyed && !wc.isDestroyed();
        const history = alive ? wc.navigationHistory : undefined;
        const event: QaapNativeBrowserStateEvent = {
            viewId: entry.viewId,
            url: entry.url,
            ...(entry.title ? { title: entry.title } : {}),
            loading: entry.loading,
            canGoBack: history ? history.canGoBack() : false,
            canGoForward: history ? history.canGoForward() : false,
            focused: entry.focused,
            ...(error ? { error } : {}),
        };
        try {
            this.client?.onStateChanged(event);
        } catch {
            // Renderer may be mid-reload.
        }
        return event;
    }

    protected ensureWindowCleanup(win: BrowserWindow, ownerWebContentsId: number): void {
        if (this.windowCleanupWired.has(win.id)) {
            return;
        }
        this.windowCleanupWired.add(win.id);
        win.once('closed', () => {
            this.windowCleanupWired.delete(win.id);
            void this.destroyAllForOwner(ownerWebContentsId);
        });
    }

    async ensureView(options: QaapNativeBrowserEnsureOptions): Promise<QaapNativeBrowserStateEvent> {
        const existing = this.views.get(options.viewId);
        if (existing && !existing.destroyed && !existing.window.isDestroyed() && !existing.view.webContents.isDestroyed()) {
            if (options.url && isAllowedQaapNativeBrowserUrl(options.url, existing.shellOrigin) && options.url !== existing.url) {
                await this.navigate(options.viewId, options.url);
            }
            return this.emitState(existing);
        }
        if (existing) {
            this.destroyEntry(existing);
        }

        const win = this.resolveOwnerWindow(options.ownerWebContentsId);
        if (!win) {
            return {
                viewId: options.viewId,
                url: options.url ?? '',
                loading: false,
                canGoBack: false,
                canGoForward: false,
            };
        }

        const ownerWebContentsId = options.ownerWebContentsId ?? win.webContents.id;
        this.ensureWindowCleanup(win, ownerWebContentsId);

        const view = new WebContentsView({
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
            },
        });
        view.setVisible(false);
        view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        win.contentView.addChildView(view);

        const entry: ManagedNativeBrowserView = {
            viewId: options.viewId,
            ownerWebContentsId,
            window: win,
            view,
            shellOrigin: options.shellOrigin,
            url: '',
            loading: false,
            focused: false,
            visible: false,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            destroyed: false,
        };
        this.views.set(options.viewId, entry);

        const wc = view.webContents;
        wc.setWindowOpenHandler(({ url }) => {
            if (isAllowedQaapNativeBrowserUrl(url, entry.shellOrigin)) {
                void shell.openExternal(url);
            }
            return { action: 'deny' };
        });

        wc.on('did-start-loading', () => {
            if (entry.destroyed) {
                return;
            }
            entry.loading = true;
            this.emitState(entry);
        });
        wc.on('did-stop-loading', () => {
            if (entry.destroyed) {
                return;
            }
            entry.loading = false;
            const current = wc.getURL();
            if (current && current !== 'about:blank') {
                entry.url = current;
            }
            this.emitState(entry);
        });
        wc.on('did-navigate', (_event, url) => {
            if (entry.destroyed) {
                return;
            }
            if (url && url !== 'about:blank') {
                entry.url = url;
            }
            this.emitState(entry);
        });
        wc.on('did-navigate-in-page', (_event, url) => {
            if (entry.destroyed) {
                return;
            }
            if (url && url !== 'about:blank') {
                entry.url = url;
            }
            this.emitState(entry);
        });
        wc.on('page-title-updated', (_event, title) => {
            if (entry.destroyed) {
                return;
            }
            entry.title = title;
            this.emitState(entry);
        });
        wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
            // ERR_ABORTED (-3) happens normally during rapid redirects/reloads; ignore it.
            if (entry.destroyed || !isMainFrame || errorCode === -3) {
                return;
            }
            entry.loading = false;
            this.emitState(entry, { code: errorCode, description: errorDescription, url: validatedURL });
        });
        wc.on('focus', () => {
            if (entry.destroyed) {
                return;
            }
            entry.focused = true;
            this.emitState(entry);
        });
        wc.on('blur', () => {
            if (entry.destroyed) {
                return;
            }
            entry.focused = false;
            this.emitState(entry);
        });

        if (options.url && isAllowedQaapNativeBrowserUrl(options.url, entry.shellOrigin)) {
            await this.navigate(options.viewId, options.url);
        }

        return this.emitState(entry);
    }

    async navigate(viewId: string, url: string, options?: { readonly hard?: boolean }): Promise<void> {
        const entry = this.views.get(viewId);
        if (!entry || entry.destroyed || entry.view.webContents.isDestroyed()) {
            return;
        }
        if (!isAllowedQaapNativeBrowserUrl(url, entry.shellOrigin)) {
            return;
        }
        entry.url = url;
        entry.loading = true;
        this.emitState(entry);
        const target = options?.hard
            ? (url.includes('?') ? `${url}&_qaap_cache_bust=${Date.now()}` : `${url}?_qaap_cache_bust=${Date.now()}`)
            : url;
        try {
            await entry.view.webContents.loadURL(target);
        } catch {
            // `did-fail-load` already reports real errors; aborted navigations throw harmlessly.
        }
    }

    async setBounds(viewId: string, bounds: QaapNativeBrowserBounds, visible: boolean): Promise<void> {
        const entry = this.views.get(viewId);
        if (!entry || entry.destroyed || entry.window.isDestroyed() || entry.view.webContents.isDestroyed()) {
            return;
        }
        const safe = sanitizeQaapNativeBrowserBounds(bounds);
        const shouldShow = visible
            && safe.width >= QAAP_NATIVE_BROWSER_MIN_VISIBLE_PX
            && safe.height >= QAAP_NATIVE_BROWSER_MIN_VISIBLE_PX;
        entry.bounds = safe;
        entry.visible = shouldShow;
        if (!shouldShow) {
            entry.view.setVisible(false);
            return;
        }
        entry.view.setBounds(safe);
        entry.view.setVisible(true);
    }

    async goBack(viewId: string): Promise<void> {
        const entry = this.views.get(viewId);
        if (!entry || entry.destroyed || entry.view.webContents.isDestroyed()) {
            return;
        }
        if (entry.view.webContents.navigationHistory.canGoBack()) {
            entry.view.webContents.navigationHistory.goBack();
        }
    }

    async goForward(viewId: string): Promise<void> {
        const entry = this.views.get(viewId);
        if (!entry || entry.destroyed || entry.view.webContents.isDestroyed()) {
            return;
        }
        if (entry.view.webContents.navigationHistory.canGoForward()) {
            entry.view.webContents.navigationHistory.goForward();
        }
    }

    async reload(viewId: string, hard?: boolean): Promise<void> {
        const entry = this.views.get(viewId);
        if (!entry || entry.destroyed || entry.view.webContents.isDestroyed()) {
            return;
        }
        if (hard) {
            entry.view.webContents.reloadIgnoringCache();
        } else {
            entry.view.webContents.reload();
        }
    }

    async focus(viewId: string): Promise<void> {
        const entry = this.views.get(viewId);
        if (!entry || entry.destroyed || !entry.visible || entry.view.webContents.isDestroyed()) {
            return;
        }
        entry.view.webContents.focus();
    }

    async openDevTools(viewId: string): Promise<void> {
        const entry = this.views.get(viewId);
        if (!entry || entry.destroyed || entry.view.webContents.isDestroyed()) {
            return;
        }
        entry.view.webContents.openDevTools({ mode: 'detach' });
    }

    async destroyView(viewId: string): Promise<void> {
        const entry = this.views.get(viewId);
        if (entry) {
            this.destroyEntry(entry);
        }
    }

    async destroyAllForOwner(ownerWebContentsId?: number): Promise<void> {
        for (const entry of [...this.views.values()]) {
            if (ownerWebContentsId === undefined || entry.ownerWebContentsId === ownerWebContentsId) {
                this.destroyEntry(entry);
            }
        }
    }

    protected destroyEntry(entry: ManagedNativeBrowserView): void {
        if (entry.destroyed) {
            return;
        }
        entry.destroyed = true;
        this.views.delete(entry.viewId);
        try {
            if (!entry.window.isDestroyed()) {
                entry.window.contentView.removeChildView(entry.view);
            }
        } catch {
            // Window may already be tearing down.
        }
        try {
            if (!entry.view.webContents.isDestroyed()) {
                entry.view.webContents.close();
            }
        } catch {
            // Ignore close errors during shutdown.
        }
    }
}
