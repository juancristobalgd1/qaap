// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export const QAAP_CLIENT_ERROR_API_PATH = '/qaap/api/client-errors';

/** Per-context reports sent per rolling minute; extra ones are dropped client-side. */
const MAX_REPORTS_PER_CONTEXT_PER_MINUTE = 5;
const RATE_WINDOW_MS = 60_000;
const MAX_MESSAGE_LENGTH = 600;

const reportWindows = new Map<string, { windowStart: number; count: number }>();

/** Deployed build SHA, stamped once by whoever fetches the auth config (see sessions sidebar). */
let reportedBuildSha: string | undefined;

export function setQaapClientErrorBuild(build: string | undefined): void {
    reportedBuildSha = build?.trim() || undefined;
}

/**
 * Fire-and-forget client failure breadcrumb → `POST /qaap/api/client-errors` → one-line
 * `[qaap-client-error]` entry in the backend log. Use it wherever a user-facing flow dies
 * CLIENT-side (before any request reaches the backend), so production diagnosis does not
 * depend on asking the user what their screen said. Never throws, never awaited, throttled
 * per context so a render-loop failure cannot flood the server.
 */
export function reportQaapClientError(context: string, error: unknown, extra?: { path?: string }): void {
    try {
        if (!admitReport(context)) {
            return;
        }
        const message = error instanceof Error ? error.message : String(error ?? '');
        void fetch(QAAP_CLIENT_ERROR_API_PATH, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                context,
                message: message.slice(0, MAX_MESSAGE_LENGTH),
                build: reportedBuildSha,
                path: extra?.path ?? (typeof window !== 'undefined' ? window.location.hash.slice(0, 200) : undefined),
            }),
        }).catch(() => undefined);
    } catch {
        // Reporting must never break the flow it is observing.
    }
}

function admitReport(context: string): boolean {
    const now = Date.now();
    const window = reportWindows.get(context);
    if (!window || now - window.windowStart >= RATE_WINDOW_MS) {
        reportWindows.set(context, { windowStart: now, count: 1 });
        return true;
    }
    if (window.count >= MAX_REPORTS_PER_CONTEXT_PER_MINUTE) {
        return false;
    }
    window.count++;
    return true;
}
