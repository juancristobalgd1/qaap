// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { Widget as LuminoWidget } from '@lumino/widgets';
import { MessageLoop } from '@lumino/messaging';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import type { TerminalBlock } from '@theia/terminal/lib/browser/base/terminal-widget';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { resolveTranscriptWorkspaceRootUri } from './qaap-transcript-file-open';
import { resolveWorkspaceHostFsPath } from './qaap-project-bootstrap-shell';
import type { TranscriptTerminalSurface } from './qaap-transcript-surface-types';
import {
    restoreOrCreateTranscriptTerminal,
    sanitizeTranscriptTerminalPersistedWorkspace,
    type TranscriptTerminalPersistedTerminal,
    type TranscriptTerminalPersistedWorkspace,
} from './qaap-transcript-terminal-restore';

export interface TranscriptTerminalViewServices {
    resolveCwd(cwd: string): string;
    createTerminal(cwd: string): Promise<TerminalWidget>;
    restoreTerminal(cwd: string, state: TranscriptTerminalPersistedTerminal): Promise<TerminalWidget>;
    loadWorkspaceState(workspaceKey: string): Promise<TranscriptTerminalPersistedWorkspace | undefined>;
    saveWorkspaceState(workspaceKey: string, state: TranscriptTerminalPersistedWorkspace | undefined): Promise<void>;
    localize(key: string, defaultValue: string, ...args: string[]): string;
}

export type { TranscriptTerminalSurface } from './qaap-transcript-surface-types';
export {
    restoreOrCreateTranscriptTerminal,
    sanitizeTranscriptTerminalPersistedWorkspace,
    type TranscriptTerminalPersistedTerminal,
    type TranscriptTerminalPersistedWorkspace,
} from './qaap-transcript-terminal-restore';

const WORK_HUB_TERMINALS_STORAGE_KEY = 'qaap.workHub.terminals.v1';

interface TranscriptTerminalPersistedStore {
    readonly version: 1;
    readonly workspaces: Record<string, TranscriptTerminalPersistedWorkspace | undefined>;
}

interface TerminalStateStore {
    storeState(): object;
}

const transcriptTerminalStagingHosts = new WeakMap<TranscriptTerminalSurface, HTMLElement>();
const TRANSCRIPT_TERMINAL_CONTEXT_LIMIT = 8000;

function markTerminalRestorable(terminal: TerminalWidget): void {
    const storeState = (terminal as unknown as Partial<TerminalStateStore>).storeState;
    if (typeof storeState === 'function') {
        storeState.call(terminal);
    }
}

/** Persists terminal widget state before a same-tab reload (F5). */
export function markTranscriptTerminalRestorable(terminal: TerminalWidget): void {
    markTerminalRestorable(terminal);
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
    if (terminal.isDisposed) {
        return;
    }
    terminal.update();
    requestAnimationFrame(() => {
        if (!terminal.isDisposed && terminal.isAttached) {
            MessageLoop.sendMessage(terminal, LuminoWidget.ResizeMessage.UnknownSize);
            terminal.update();
        }
    });
}

/** Returns the recent output of one Work Hub terminal for the composer hand-off. */
export function getTranscriptTerminalContext(terminal: TerminalWidget): string {
    const history = terminal.commandHistoryState?.commandHistory ?? [];
    if (history.length > 0) {
        const blocks: string[] = [];
        let remaining = TRANSCRIPT_TERMINAL_CONTEXT_LIMIT;
        for (let index = history.length - 1; index >= 0 && remaining > 0; index--) {
            const block = history[index] as TerminalBlock;
            const text = [
                nls.localize('qaap/mobileProjects/terminalContextCommand', '### Terminal Command:'),
                block.command,
                '',
                nls.localize('qaap/mobileProjects/terminalContextOutput', '### Terminal Output:'),
                block.output,
            ].join('\n');
            const excerpt = text.length > remaining ? text.slice(-remaining) : text;
            blocks.unshift(excerpt);
            remaining -= excerpt.length;
        }
        return blocks.join('\n\n').trim();
    }

    const bufferLength = terminal.buffer.length;
    return terminal.buffer.getLines(
        Math.max(0, bufferLength - 100),
        bufferLength,
    ).join('\n').trim();
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

    let surface: TranscriptTerminalSurface;
    const toDispose = new DisposableCollection(
        installTranscriptTerminalWheelScrollBridge(mountHost),
        Disposable.create(() => {
            window.removeEventListener('beforeunload', markForReload);
        }),
        Disposable.create(() => {
            const stagingHost = transcriptTerminalStagingHosts.get(surface);
            if (stagingHost?.isConnected && mountHost.parentElement !== stagingHost) {
                stagingHost.append(mountHost);
            }
            if (terminal.isAttached && !terminal.node.isConnected && document.body) {
                document.body.append(mountHost);
            }
            if (terminal.isAttached && terminal.node.isConnected) {
                try {
                    LuminoWidget.detach(terminal);
                } catch {
                    // The terminal can already be detached by a concurrent surface teardown.
                }
            }
            if (!terminal.isDisposed) {
                terminal.dispose();
            }
            mountHost.remove();
            stagingHost?.remove();
            transcriptTerminalStagingHosts.delete(surface);
        }),
    );
    const markForReload = (): void => markTerminalRestorable(terminal);
    window.addEventListener('beforeunload', markForReload);

    surface = { terminal, mountHost, dispose: toDispose };
    if (mountTarget.classList.contains('theia-mobile-transcript-terminal-staging')) {
        transcriptTerminalStagingHosts.set(surface, mountTarget);
    }
    return surface;
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
    const stagingHost = transcriptTerminalStagingHosts.get(surface);
    if (stagingHost?.isConnected) {
        stagingHost.append(surface.mountHost);
        return;
    }
    if (surface.mountHost.parentElement === host) {
        if (surface.terminal.isAttached && surface.terminal.node.isConnected) {
            try {
                LuminoWidget.detach(surface.terminal);
            } catch {
                // The terminal can already be detached by a concurrent surface teardown.
            }
        }
        surface.mountHost.remove();
    }
}

/** Keeps a cached terminal node connected while its visible slide is rebuilt. */
export function parkTranscriptTerminalSurface(surface: TranscriptTerminalSurface): void {
    const stagingHost = transcriptTerminalStagingHosts.get(surface);
    if (stagingHost?.isConnected && surface.mountHost.parentElement !== stagingHost) {
        stagingHost.append(surface.mountHost);
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
                return resolveWorkspaceHostFsPath(root);
            }
            return cwd;
        },
        createTerminal: async cwd => terminalService.newTerminal(defaultTerminalOptions(cwd)),
        restoreTerminal: async (cwd, state) => restoreOrCreateTranscriptTerminal(
            () => terminalService.newTerminal(defaultTerminalOptions(cwd)),
            state,
        ),
        loadWorkspaceState: async workspaceKey => {
            const store = await loadStore();
            return sanitizeTranscriptTerminalPersistedWorkspace(store.workspaces[workspaceKey]);
        },
        saveWorkspaceState: async (workspaceKey, state) => {
            const store = await loadStore();
            const workspaces = { ...store.workspaces };
            const sanitized = sanitizeTranscriptTerminalPersistedWorkspace(state);
            if (sanitized && sanitized.terminals.length > 0) {
                workspaces[workspaceKey] = sanitized;
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
