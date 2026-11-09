// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';

/**
 * Identity of a process as recorded when a preview registers it: on Linux, `starttime` (field 22 of
 * `/proc/<pid>/stat`, in clock ticks since boot). A pid alone is reused after the process exits, and a
 * backend restart gives a new PID namespace; the start time tells the original process from a stranger.
 * Returns `undefined` where `/proc` is unavailable or unreadable: no fingerprint, pid-only liveness.
 */
export function readQaapPreviewProcessFingerprint(pid: number, readFile: (file: string) => string = file => fs.readFileSync(file, 'utf8')): string | undefined {
    try {
        const stat = readFile(`/proc/${pid}/stat`);
        // The command name (field 2) is wrapped in parentheses and may contain spaces: count fields after it.
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        // Field 3 (state) is the first entry after the command name, so field 22 (starttime) is index 19.
        const starttime = fields[19];
        return starttime !== undefined && /^\d+$/.test(starttime) ? starttime : undefined;
    } catch {
        return undefined;
    }
}

/** Identity check for a pid probe: the fingerprint recorded at registration and the reader used now. */
export interface QaapPreviewPidIdentity {
    /** Fingerprint stored at registration. Without one, the probe is pid-only. */
    readonly fingerprint?: string;
    /** Seam for reading the current fingerprint of a pid. */
    readonly readFingerprint?: (pid: number) => string | undefined;
}

/**
 * `alive`: the pid exists (EPERM means it exists but is not ours to signal). `dead`: ESRCH, the process is gone.
 * `unknown`: no pid to ask about, or the probe failed for another reason. Only `dead` proves a server stopped.
 */
export type QaapPreviewPidLiveness = 'alive' | 'dead' | 'unknown';

/** Probes a pid with signal 0. `kill` is the seam; the default is `process.kill`. */
export function probeQaapPreviewPidLiveness(
    pid: number,
    kill: (pid: number, signal: 0) => boolean = (target, signal) => process.kill(target, signal),
    identity: QaapPreviewPidIdentity = {},
): QaapPreviewPidLiveness {
    try {
        kill(pid, 0);
        if (identity.fingerprint !== undefined) {
            const current = (identity.readFingerprint ?? readQaapPreviewProcessFingerprint)(pid);
            // A different start time means the pid now belongs to another process: the recorded one is gone.
            // An unreadable current fingerprint proves nothing and keeps the pid-only answer.
            if (current !== undefined && current !== identity.fingerprint) {
                return 'dead';
            }
        }
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
        readonly previewPidLiveness: (record: { readonly osProcessId?: number; readonly osProcessFingerprint?: string; readonly port?: number; readonly ownerLogin?: string; readonly adopted?: true }) => QaapPreviewPidLiveness;
        readonly portRegistry: { releasePreview(previewId: string, ownerLogin: string, options?: { readonly keepAccessToken?: boolean }): boolean };
    },
    record: { readonly previewId: string; readonly ownerLogin: string; readonly osProcessId?: number; readonly osProcessFingerprint?: string; readonly port?: number; readonly adopted?: true },
    options?: { readonly keepAccessToken?: boolean },
): boolean {
    if (ctx.previewPidLiveness(record) === 'alive') {
        console.warn('[qaap-preview] kept the registration: its dev server is still running', { previewId: record.previewId, port: record.port });
        return false;
    }
    ctx.portRegistry.releasePreview(record.previewId, record.ownerLogin, options);
    return true;
}
