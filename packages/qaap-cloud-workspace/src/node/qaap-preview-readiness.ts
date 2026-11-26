// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as http from 'http';
import { findListeningPidsOnPort, readProcessGroupId } from '@theia/qaap-shared-core/lib/node/qaap-dev-preview-port-listener';

/**
 * Readiness of a supervised preview, as the agent tools report it: the app must answer HTTP on the port Qaap gave
 * it, and the answer must come from the supervised process tree (not from a stale server that happens to hold the
 * port). Shared by the agent preview service and the headless visual capture.
 */

/** Result of one HTTP probe. Redirects are never followed: a 3xx is an answer. */
export type QaapPreviewHttpProbe =
    | { readonly kind: 'answered'; readonly status: number }
    | { readonly kind: 'refused' | 'timeout' | 'failed' };

export const QAAP_PREVIEW_HTTP_PROBE_TIMEOUT_MS = 3000;

/** One GET of `path` on `host:port` (Host header `localhost:<port>`, like the preview proxy). */
export function probeQaapPreviewHttp(options: {
    readonly host: string;
    readonly port: number;
    readonly path?: string;
    readonly timeoutMs?: number;
    readonly agent?: http.Agent;
}): Promise<QaapPreviewHttpProbe> {
    const timeoutMs = options.timeoutMs ?? QAAP_PREVIEW_HTTP_PROBE_TIMEOUT_MS;
    return new Promise<QaapPreviewHttpProbe>(resolve => {
        let settled = false;
        let request: http.ClientRequest | undefined;
        const settle = (result: QaapPreviewHttpProbe): void => {
            if (!settled) {
                settled = true;
                clearTimeout(deadline);
                request?.destroy();
                resolve(result);
            }
        };
        const deadline = setTimeout(() => settle({ kind: 'timeout' }), timeoutMs);
        try {
            request = http.request({
                host: options.host,
                port: options.port,
                path: options.path ?? '/',
                method: 'GET',
                headers: { host: `localhost:${options.port}`, accept: 'text/html,*/*' },
                timeout: timeoutMs,
                ...(options.agent ? { agent: options.agent } : {}),
            }, response => {
                response.resume();
                settle({ kind: 'answered', status: response.statusCode ?? 0 });
            });
        } catch {
            settle({ kind: 'failed' });
            return;
        }
        request.on('error', error => settle({ kind: (error as NodeJS.ErrnoException).code === 'ECONNREFUSED' ? 'refused' : 'failed' }));
        request.on('timeout', () => settle({ kind: 'timeout' }));
        request.end();
    });
}

/**
 * What an HTTP status means for the agent's verdict. 2xx/3xx: ready. 4xx: ready with a warning (an API without a
 * `/` route still runs). 5xx: the server runs but the app is broken, which is not "it's up".
 */
export function classifyQaapPreviewHttpStatus(status: number): 'ready' | 'ready-4xx' | 'server-error' {
    if (status >= 500 || status < 100) {
        return 'server-error';
    }
    return status >= 400 ? 'ready-4xx' : 'ready';
}

export type QaapPreviewPortOwnership = 'owned' | 'foreign' | 'unknown';

export interface QaapPreviewPortOwnershipDeps {
    readonly listeningPids: (port: number) => number[];
    readonly processGroupOf: (pid: number) => number | undefined;
}

const DEFAULT_OWNERSHIP_DEPS: QaapPreviewPortOwnershipDeps = {
    listeningPids: findListeningPidsOnPort,
    processGroupOf: readProcessGroupId,
};

/**
 * Whether the process listening on `port` belongs to the supervised child `childPid` (started as the leader of its
 * own process group). `unknown` when the listener cannot be seen from here (task sandbox, another uid without
 * `/proc` access, no `lsof`): the caller then trusts the probe, as before. `foreign` only on positive evidence.
 */
export function resolveQaapPreviewPortOwnership(
    port: number,
    childPid: number | undefined,
    deps: QaapPreviewPortOwnershipDeps = DEFAULT_OWNERSHIP_DEPS,
): QaapPreviewPortOwnership {
    if (!childPid || childPid <= 0) {
        return 'unknown';
    }
    let pids: number[];
    try {
        pids = deps.listeningPids(port);
    } catch {
        return 'unknown';
    }
    if (pids.length === 0) {
        return 'unknown';
    }
    for (const pid of pids) {
        if (pid === childPid) {
            return 'owned';
        }
        const group = deps.processGroupOf(pid);
        if (group === childPid) {
            return 'owned';
        }
    }
    return 'foreign';
}

/** Outcome of {@link waitForQaapPreviewServer}. */
export type QaapPreviewServerWait =
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: 'exited' | 'timeout' };

/**
 * Polls `answers()` until it is true, `exited()` reports the process gone, or `timeoutMs` passes. The probe runs
 * before the exit check in each round so a server that answered just before exiting is still seen.
 */
export async function waitForQaapPreviewServer(options: {
    readonly answers: () => Promise<boolean>;
    readonly exited: () => boolean;
    readonly timeoutMs: number;
    readonly intervalMs: number;
    readonly now?: () => number;
    readonly sleep?: (ms: number) => Promise<void>;
}): Promise<QaapPreviewServerWait> {
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
    const deadline = now() + options.timeoutMs;
    for (;;) {
        if (await options.answers()) {
            return { ok: true };
        }
        if (options.exited()) {
            return { ok: false, reason: 'exited' };
        }
        if (now() >= deadline) {
            return { ok: false, reason: 'timeout' };
        }
        await sleep(options.intervalMs);
    }
}

const URL_PORT_RE = /\b(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})\b/gi;

/** Ports a dev server announced in its output (`http://localhost:5173`, `0.0.0.0:8080`), newest first, unique. */
export function extractQaapAnnouncedPorts(lines: readonly string[]): number[] {
    const found: number[] = [];
    for (let i = lines.length - 1; i >= 0; i--) {
        for (const match of lines[i].matchAll(URL_PORT_RE)) {
            const port = Number(match[1]);
            if (port >= 1024 && port <= 65535 && !found.includes(port)) {
                found.push(port);
            }
        }
    }
    return found;
}
