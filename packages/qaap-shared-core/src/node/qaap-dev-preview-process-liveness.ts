// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * `alive`: the pid exists (EPERM means it exists but is not ours to signal). `dead`: ESRCH, the process is gone.
 * `unknown`: no pid to ask about, or the probe failed for another reason. Only `dead` proves a server stopped.
 */
export type QaapPreviewPidLiveness = 'alive' | 'dead' | 'unknown';

/** Probes a pid with signal 0. `kill` is the seam; the default is `process.kill`. */
export function probeQaapPreviewPidLiveness(
    pid: number,
    kill: (pid: number, signal: 0) => boolean = (target, signal) => process.kill(target, signal),
): QaapPreviewPidLiveness {
    try {
        kill(pid, 0);
        return 'alive';
    } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === 'ESRCH') {
            return 'dead';
        }
        if (code === 'EPERM') {
            return 'alive';
        }
        return 'unknown';
    }
}

export type QaapPreviewProbeState = 'ready' | 'booting' | 'stopped';

/**
 * Readiness classification for a preview claim. A live process that does not answer yet is `booting`
 * however long it takes; only a dead process is `stopped` outright. Without a pid, the start grace decides.
 */
export function classifyQaapPreviewProbeState(input: {
    readonly ready: boolean;
    readonly withinStartGrace: boolean;
    readonly liveness: QaapPreviewPidLiveness;
}): QaapPreviewProbeState {
    if (input.ready) {
        return 'ready';
    }
    if (input.liveness === 'dead') {
        return 'stopped';
    }
    if (input.liveness === 'alive') {
        return 'booting';
    }
    return input.withinStartGrace ? 'booting' : 'stopped';
}

/**
 * Drops a preview registration only once its process is confirmed gone. A live process keeps its
 * registration (and port) until the reaper sees it dead. Returns whether the registration was released.
 */
export function releaseStoppedPreviewExtracted(
    ctx: {
        readonly previewPidLiveness: (record: { readonly osProcessId?: number; readonly port?: number; readonly ownerLogin?: string; readonly adopted?: true }) => QaapPreviewPidLiveness;
        readonly portRegistry: { releasePreview(previewId: string, ownerLogin: string, options?: { readonly keepAccessToken?: boolean }): boolean };
    },
    record: { readonly previewId: string; readonly ownerLogin: string; readonly osProcessId?: number; readonly port?: number; readonly adopted?: true },
    options?: { readonly keepAccessToken?: boolean },
): boolean {
    if (ctx.previewPidLiveness(record) === 'alive') {
        console.warn('[qaap-preview] kept the registration: its dev server is still running', { previewId: record.previewId, port: record.port });
        return false;
    }
    ctx.portRegistry.releasePreview(record.previewId, record.ownerLogin, options);
    return true;
}
