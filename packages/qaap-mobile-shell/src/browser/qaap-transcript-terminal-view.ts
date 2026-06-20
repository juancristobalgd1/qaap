// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FileUri } from '@theia/core/lib/common/file-uri';
import { nls } from '@theia/core/lib/common/nls';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { Widget as LuminoWidget } from '@lumino/widgets';
import { MessageLoop } from '@lumino/messaging';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { resolveTranscriptWorkspaceRootUri } from './qaap-transcript-file-open';
import type { TranscriptTerminalSurface } from './qaap-transcript-surface-types';

export interface TranscriptTerminalViewServices {
    resolveCwd(cwd: string): string;
    createTerminal(cwd: string): Promise<TerminalWidget>;
    restoreTerminal(cwd: string, state: TranscriptTerminalPersistedTerminal): Promise<TerminalWidget>;
    loadWorkspaceState(workspaceKey: string): Promise<TranscriptTerminalPersistedWorkspace | undefined>;
    saveWorkspaceState(workspaceKey: string, state: TranscriptTerminalPersistedWorkspace | undefined): Promise<void>;
    localize(key: string, defaultValue: string, ...args: string[]): string;
}

export type { TranscriptTerminalSurface } from './qaap-transcript-surface-types';

const WORK_HUB_TERMINALS_STORAGE_KEY = 'qaap.workHub.terminals.v1';

export interface TranscriptTerminalPersistedTerminal {
    readonly terminalId: number;
    readonly titleLabel?: string;
}

export interface TranscriptTerminalPersistedWorkspace {
    readonly activeIndex: number;
    readonly terminals: TranscriptTerminalPersistedTerminal[];
}

interface TranscriptTerminalPersistedStore {
    readonly version: 1;
    readonly workspaces: Record<string, TranscriptTerminalPersistedWorkspace | undefined>;
}

interface TerminalStateStore {
    storeState(): object;
}

function markTerminalRestorable(terminal: TerminalWidget): void {
    const storeState = (terminal as unknown as Partial<TerminalStateStore>).storeState;
    if (typeof storeState === 'function') {
        storeState.call(terminal);
    }
}

function installTranscriptTerminalWheelScrollBridge(mountHost: HTMLElement): Disposable {
    const onWheel = (event: WheelEvent): void => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
            return;
        }
        const viewport = mountHost.querySelector<HTMLElement>('.xterm-viewport');
        if (!viewport || viewport.scrollHeight <= viewport.clientHeight + 1) {
            return;
        }
        const maxScrollTop = viewport.scrollHeight - viewport.clientHeight;
        const canScrollUp = viewport.scrollTop > 0;
        const canScrollDown = viewport.scrollTop < maxScrollTop;
        if ((event.deltaY < 0 && !canScrollUp) || (event.deltaY > 0 && !canScrollDown)) {
            return;
        }
        event.stopPropagation();
    };
    mountHost.addEventListener('wheel', onWheel, { passive: false });
    return Disposable.create(() => mountHost.removeEventListener('wheel', onWheel));
}

export function scheduleTranscriptTerminalResize(terminal: TerminalWidget): void {
    terminal.update();
    requestAnimationFrame(() => {
        if (terminal.isAttached) {
            MessageLoop.sendMessage(terminal, LuminoWidget.ResizeMessage.UnknownSize);
            terminal.update();
        }
    });
}

/**
 * Creates a connected DOM staging parent so {@link LuminoWidget.attach} does not throw
 * ("Host is not attached") while the surface waits in the workspace cache.
 */
export function createTranscriptTerminalStagingHost(): HTMLElement {
    const staging = document.createElement('div');
    staging.className = 'theia-mobile-transcript-terminal-staging';
    staging.hidden = true;
    staging.setAttribute('aria-hidden', 'true');
    document.body.append(staging);
    return staging;
}

/**
 * Creates one integrated terminal for a workspace ({@link TerminalService#newTerminal}).
 * `mountTarget` must already be in the document (Lumino requirement).
 */
export async function createTranscriptTerminalSurface(
    mountTarget: HTMLElement,
    cwd: string,
    services: TranscriptTerminalViewServices,
    restoredState?: TranscriptTerminalPersistedTerminal,
): Promise<TranscriptTerminalSurface> {
    if (!mountTarget.isConnected) {
        throw new Error('Host is not attached.');
    }
    const resolvedCwd = services.resolveCwd(cwd);
    const terminal = restoredState
        ? await services.restoreTerminal(resolvedCwd, restoredState)
        : await services.createTerminal(resolvedCwd);
    const mountHost = document.createElement('div');
    mountHost.className = 'theia-mobile-transcript-terminal-mount';
    mountTarget.replaceChildren();
    mountTarget.append(mountHost);

    terminal.node.classList.add('theia-mobile-transcript-terminal-embed');
    LuminoWidget.attach(terminal, mountHost);
    if (!restoredState) {
        await terminal.start();
    }
    scheduleTranscriptTerminalResize(terminal);

    const toDispose = new DisposableCollection(
        installTranscriptTerminalWheelScrollBridge(mountHost),
        Disposable.create(() => {
            window.removeEventListener('beforeunload', markForReload);
        }),
        Disposable.create(() => {
            if (terminal.isAttached && terminal.node.parentElement) {
                LuminoWidget.detach(terminal);
            }
            if (!terminal.isDisposed) {
                terminal.dispose();
            }
            mountHost.remove();
        }),
    );
    const markForReload = (): void => markTerminalRestorable(terminal);
    window.addEventListener('beforeunload', markForReload);

    return { terminal, mountHost, dispose: toDispose };
}

/** Mounts a cached terminal surface into the transcript tab host. */
export function attachTranscriptTerminalSurface(
    host: HTMLElement,
    surface: TranscriptTerminalSurface,
): Disposable {
    if (!host.isConnected) {
        throw new Error('Host is not attached.');
    }
    host.replaceChildren();
    host.classList.add('theia-mobile-transcript-terminal');
    host.append(surface.mountHost);
    scheduleTranscriptTerminalResize(surface.terminal);

    const resizeObserver = typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            if (surface.terminal.isAttached && !host.hidden) {
                MessageLoop.sendMessage(surface.terminal, LuminoWidget.ResizeMessage.UnknownSize);
                surface.terminal.update();
            }
        })
        : undefined;
    resizeObserver?.observe(surface.mountHost);

    return Disposable.create(() => {
        resizeObserver?.disconnect();
        detachTranscriptTerminalSurface(host, surface);
    });
}

/** Detaches the surface from the sheet without killing the PTY (for reuse / cache). */
export function detachTranscriptTerminalSurface(host: HTMLElement, surface: TranscriptTerminalSurface): void {
    if (surface.mountHost.parentElement === host) {
        surface.mountHost.remove();
    }
}

export function createTranscriptTerminalViewServices(
    terminalService: TerminalService,
    workspaceService: WorkspaceService,
    storageService: StorageService,
): TranscriptTerminalViewServices {
    const defaultTerminalOptions = (cwd: string) => ({
        title: nls.localizeByDefault('Terminal'),
        cwd,
        destroyTermOnClose: true,
        useServerTitle: true,
    });
    const loadStore = async (): Promise<TranscriptTerminalPersistedStore> => {
        const stored = await storageService.getData<TranscriptTerminalPersistedStore>(
            WORK_HUB_TERMINALS_STORAGE_KEY,
            { version: 1, workspaces: {} },
        );
        return stored?.version === 1 ? stored : { version: 1, workspaces: {} };
    };
    return {
        resolveCwd: cwd => {
            const root = resolveTranscriptWorkspaceRootUri(cwd, workspaceService);
            if (root) {
                return FileUri.fsPath(root.toString());
            }
            return cwd;
        },
        createTerminal: async cwd => terminalService.newTerminal(defaultTerminalOptions(cwd)),
        restoreTerminal: async (cwd, state) => {
            const terminal = await terminalService.newTerminal(defaultTerminalOptions(cwd));
            if (state.titleLabel) {
                terminal.title.label = state.titleLabel;
                terminal.title.caption = state.titleLabel;
            }
            await terminal.start(state.terminalId);
            return terminal;
        },
        loadWorkspaceState: async workspaceKey => {
            const store = await loadStore();
            return store.workspaces[workspaceKey];
        },
        saveWorkspaceState: async (workspaceKey, state) => {
            const store = await loadStore();
            const workspaces = { ...store.workspaces };
            if (state && state.terminals.length > 0) {
                workspaces[workspaceKey] = state;
            } else {
                delete workspaces[workspaceKey];
            }
            await storageService.setData<TranscriptTerminalPersistedStore>(
                WORK_HUB_TERMINALS_STORAGE_KEY,
                { version: 1, workspaces },
            );
        },
        localize: (key, defaultValue, ...args) => nls.localize(key, defaultValue, ...args),
    };
}
