// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    QAAP_DEV_PREVIEW_CURRENT_PATH,
    QAAP_DEV_PREVIEW_PROBE_PATH,
    QAAP_IDENTITY_PREVIEW_PROBE_PATH,
    buildQaapDevPreviewOpenUrl,
    buildQaapIdentityPreviewUrl,
    isQaapDevPreviewClaimState,
    type QaapDevPreviewClaimState,
    type QaapDevPreviewProbeResponse,
} from '../common/qaap-dev-preview';

const PROBE_TIMEOUT_MS = 2500;

/** Per-request timeout, combined with the caller's optional cancellation signal. */
function probeSignal(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
    if (!signal) {
        return timeout;
    }
    if (typeof AbortSignal.any === 'function') {
        return AbortSignal.any([signal, timeout]);
    }
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    timeout.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
        abort();
    }
    return controller.signal;
}

/** Origin of the Qaap IDE (e.g. `http://161.97.69.219:3000` on a VPS). */
export function getQaapPublicOrigin(): string {
    if (typeof window === 'undefined' || !window.location?.origin) {
        return '';
    }
    return window.location.origin.replace(/\/+$/, '');
}

/** Preview URL for the current host via the same-origin `/qaap-dev/:port/` proxy. */
export function toDevPreviewUrl(port: number, origin: string = getQaapPublicOrigin()): string {
    if (!origin) {
        return buildQaapDevPreviewOpenUrl(`http://127.0.0.1:${port}`, port);
    }
    return buildQaapDevPreviewOpenUrl(origin, port);
}

/**
 * Asks the Qaap backend whether a dev server is listening inside the workspace host.
 * Never uses `127.0.0.1` from the browser (that would target the user's device, not the VPS).
 */
export interface WaitForDevPreviewOptions {
    readonly maxAttempts?: number;
    readonly intervalMs?: number;
    /** Stops polling and aborts the in-flight probe. */
    readonly signal?: AbortSignal;
    /** Jitter source in [0, 1); injectable for deterministic tests. */
    readonly random?: () => number;
}

const MAX_PROBE_BACKOFF_MS = 4000;

/**
 * Sleep schedule between probes: starts at `intervalMs`, grows ×1.5 up to 4 s (or `intervalMs`
 * if larger), each step jittered ±20%, and keeps the caller's historical sleep budget of `(maxAttempts - 1) × intervalMs`
 * — the last sleep is clamped so the final probe lands where the fixed schedule's would.
 */
export function devPreviewProbeBackoffDelays(maxAttempts: number, intervalMs: number, random: () => number = Math.random): number[] {
    const delays: number[] = [];
    let remaining = Math.max(0, maxAttempts - 1) * Math.max(0, intervalMs);
    let delay = intervalMs;
    const maxDelay = Math.max(intervalMs, MAX_PROBE_BACKOFF_MS);
    while (remaining > 0 && delay > 0) {
        // ±20% jitter keeps several preview surfaces from probing in lockstep.
        const next = Math.min(delay * (0.8 + 0.4 * random()), remaining);
        delays.push(next);
        remaining -= next;
        delay = Math.min(delay * 1.5, maxDelay);
    }
    return delays;
}

/** Polls the backend probe with backoff until the dev server responds or the budget is spent. */
export async function waitForQaapDevPreviewPort(
    port: number,
    options: WaitForDevPreviewOptions = {},
): Promise<QaapDevPreviewProbeResponse | undefined> {
    const signal = options.signal;
    if ((options.maxAttempts ?? 30) <= 0) {
        return undefined;
    }
    const delays = devPreviewProbeBackoffDelays(options.maxAttempts ?? 30, options.intervalMs ?? 500, options.random);
    for (let attempt = 0; attempt <= delays.length && !signal?.aborted; attempt++) {
        const probe = await probeQaapDevPreviewPort(port, signal);
        if (probe.ready) {
            return probe;
        }
        if (attempt < delays.length && !signal?.aborted) {
            await new Promise<void>(resolve => {
                const onAbort = (): void => {
                    clearTimeout(timer);
                    resolve();
                };
                const timer = setTimeout(() => {
                    signal?.removeEventListener('abort', onAbort);
                    resolve();
                }, delays[attempt]);
                signal?.addEventListener('abort', onAbort, { once: true });
            });
        }
    }
    return undefined;
}

/** `signal` aborts the in-flight probe; an aborted probe resolves to the not-ready fallback. */
export async function probeQaapDevPreviewPort(port: number, signal?: AbortSignal): Promise<QaapDevPreviewProbeResponse> {
    const origin = getQaapPublicOrigin();
    const fallback: QaapDevPreviewProbeResponse = {
        ready: false,
        previewUrl: toDevPreviewUrl(port, origin),
    };
    if (!origin) {
        return fallback;
    }
    try {
        const response = await fetch(`${origin}${QAAP_DEV_PREVIEW_PROBE_PATH}/${port}`, {
            cache: 'no-store',
            signal: probeSignal(signal),
        });
        if (!response.ok) {
            return fallback;
        }
        const body = await response.json() as QaapDevPreviewProbeResponse;
        return {
            ready: !!body.ready,
            readiness: body.ready ? 'transport_ready' : body.readiness === 'failed' ? 'failed' : undefined,
            previewUrl: body.previewUrl || fallback.previewUrl,
            previewId: typeof body.previewId === 'string' ? body.previewId : undefined,
            workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : undefined,
            projectId: typeof body.projectId === 'string' ? body.projectId : undefined,
            processId: typeof body.processId === 'string' ? body.processId : undefined,
        };
    } catch {
        return fallback;
    }
}

/**
 * Resolves the caller's newest live claim for a project. Used to reconcile a surface stuck on a
 * superseded `/qaap-preview/<previewId>/` URL (chained dev runs: retry, second tab, backend
 * restart) with the currently registered execution — without requiring a page reload.
 */
export async function fetchQaapCurrentDevPreview(
    projectCandidates: Array<string | undefined>,
    conversationId?: string,
    signal?: AbortSignal,
): Promise<QaapDevPreviewProbeResponse | undefined> {
    const origin = getQaapPublicOrigin();
    const candidates = projectCandidates.filter((value): value is string => !!value?.trim());
    if (!origin || candidates.length === 0) {
        return undefined;
    }
    try {
        const projectQuery = candidates.map(value => `projectId=${encodeURIComponent(value)}`).join('&');
        // Scope to this Work Hub section so it never adopts a sibling section's live claim.
        const conversationQuery = conversationId?.trim()
            ? `&conversationId=${encodeURIComponent(conversationId.trim())}`
            : '';
        const query = `${projectQuery}${conversationQuery}`;
        const response = await fetch(`${origin}${QAAP_DEV_PREVIEW_CURRENT_PATH}?${query}`, {
            cache: 'no-store',
            signal: probeSignal(signal),
        });
        if (!response.ok) {
            return undefined;
        }
        const body = await response.json() as QaapDevPreviewProbeResponse;
        if (typeof body.previewId !== 'string' || typeof body.previewUrl !== 'string' || !body.previewUrl) {
            return undefined;
        }
        return {
            ready: !!body.ready,
            readiness: body.ready ? 'transport_ready' : body.readiness === 'failed' ? 'failed' : undefined,
            previewUrl: body.previewUrl,
            previewId: body.previewId,
            workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : undefined,
            projectId: typeof body.projectId === 'string' ? body.projectId : undefined,
            processId: typeof body.processId === 'string' ? body.processId : undefined,
            port: typeof body.port === 'number' ? body.port : undefined,
            conversationId: typeof body.conversationId === 'string' ? body.conversationId : undefined,
        };
    } catch {
        return undefined;
    }
}

/** Resolves an owner-authorized execution preview without exposing its reserved port. */
/**
 * Maps an identity-probe HTTP outcome to a {@link QaapDevPreviewClaimState}. Only a 403 (no claim
 * for this user) or an explicit backend `state` is definitive; network errors, timeouts and
 * non-403 error statuses (5xx/503 while a tenant backend cold-starts, 404 on an older router)
 * are `unknown` — transient, never evidence that the preview is dead.
 */
export function resolveQaapIdentityProbeState(
    outcome: { readonly status: number; readonly body?: { readonly ready?: unknown; readonly state?: unknown } } | 'network-error',
): QaapDevPreviewClaimState {
    if (outcome === 'network-error') {
        return 'unknown';
    }
    if (outcome.status === 403) {
        return 'gone';
    }
    if (outcome.status < 200 || outcome.status >= 300 || !outcome.body) {
        return 'unknown';
    }
    if (isQaapDevPreviewClaimState(outcome.body.state)) {
        return outcome.body.state;
    }
    // Backends predating `state` answer 200 only for an existing claim.
    return outcome.body.ready ? 'ready' : 'stopped';
}

export async function probeQaapIdentityPreview(previewId: string, signal?: AbortSignal): Promise<QaapDevPreviewProbeResponse> {
    const origin = getQaapPublicOrigin();
    const fallback = (state: QaapDevPreviewClaimState): QaapDevPreviewProbeResponse => ({
        ready: false,
        previewUrl: origin ? buildQaapIdentityPreviewUrl(origin, previewId) : '',
        previewId,
        state,
    });
    if (!origin) {
        return fallback('unknown');
    }
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(previewId)) {
        return fallback('gone');
    }
    let response: Response;
    try {
        response = await fetch(`${origin}${QAAP_IDENTITY_PREVIEW_PROBE_PATH}/${encodeURIComponent(previewId)}`, {
            cache: 'no-store',
            signal: probeSignal(signal),
        });
    } catch {
        return fallback('unknown');
    }
    if (!response.ok) {
        return fallback(resolveQaapIdentityProbeState({ status: response.status }));
    }
    let body: QaapDevPreviewProbeResponse;
    try {
        body = await response.json() as QaapDevPreviewProbeResponse;
    } catch {
        return fallback('unknown');
    }
    const state = resolveQaapIdentityProbeState({ status: response.status, body });
    return {
        ready: state === 'ready',
        readiness: state === 'ready' ? 'transport_ready' : body.readiness === 'failed' ? 'failed' : undefined,
        previewUrl: body.previewUrl || fallback(state).previewUrl,
        previewId: typeof body.previewId === 'string' ? body.previewId : previewId,
        workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : undefined,
        projectId: typeof body.projectId === 'string' ? body.projectId : undefined,
        processId: typeof body.processId === 'string' ? body.processId : undefined,
        state,
    };
}
