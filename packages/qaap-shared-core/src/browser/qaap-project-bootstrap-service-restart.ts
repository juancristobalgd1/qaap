// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { probeQaapDevPreviewPort } from './qaap-dev-preview-client';
import type { QaapProjectBootstrapServiceContext } from './qaap-project-bootstrap-service-context';

/** How long a managed restart waits for the previous dev server to release its port. */
export const MANAGED_DEV_SERVER_STOP_TIMEOUT_MS = 5000;
const MANAGED_DEV_SERVER_STOP_POLL_MS = 250;

/**
 * Restarts the dev server Qaap started for this project (its managed terminal), keeping the
 * preview identity (same processId → same previewId, same project widget). Returns false — and
 * touches nothing — when the preview is not a running Qaap-managed process.
 */
export async function restartManagedDevServerExtracted(
    ctx: QaapProjectBootstrapServiceContext,
    probePort: typeof probeQaapDevPreviewPort = probeQaapDevPreviewPort,
): Promise<boolean> {
    const plan = ctx.resolveDevPlan();
    const descriptor = ctx._descriptor;
    const terminal = ctx.devTerminal;
    if (ctx._phase !== 'running' || !plan || !descriptor || !terminal || terminal.isDisposed) {
        return false;
    }
    const port = ctx.activePreviewClaim?.port ?? ctx._lastPort;
    ctx.cancelDevPreviewHealthMonitor();
    ctx.cleanupDevTerminal();
    // The stopped server's URL must go with it: the start below treats a known preview URL as
    // "already attached" and returns without reserving or spawning anything, which left the
    // project stuck in `starting` with no dev server (and the Browser rediscovering in a loop).
    ctx._previewUrl = undefined;
    ctx._previewReadiness = undefined;
    ctx._previewWaitTimedOut = false;
    // Wait for the old process to free its port, so the new run reclaims it instead of racing a
    // server that is still shutting down.
    if (port !== undefined) {
        const deadline = Date.now() + MANAGED_DEV_SERVER_STOP_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const probe = await probePort(port).catch(() => undefined);
            if (!probe || (!probe.ready && !probe.listening)) {
                break;
            }
            await ctx.delay(MANAGED_DEV_SERVER_STOP_POLL_MS);
        }
    }
    await ctx.startDevServer(plan, descriptor);
    return true;
}
