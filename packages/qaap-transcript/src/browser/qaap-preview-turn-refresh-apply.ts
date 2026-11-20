// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import type { Event } from '@theia/core/lib/common/event';
import { FileUri } from '@theia/core/lib/common/file-uri';
import type URI from '@theia/core/lib/common/uri';
import type { QaapPreviewSurfaceHandle } from '@theia/qaap-adapters/lib/browser/qaap-preview-surface-registry';
import { readQaapPreviewFrameUrl, rebaseQaapPreviewUrl, withQaapPreviewCacheBust } from '@theia/qaap-adapters/lib/browser/qaap-preview-surface-refresh';
import type { QaapBootstrapStateChange } from '@theia/qaap-shared-core/lib/browser/qaap-project-bootstrap-service';
import type { QaapPreviewTurnRefreshAction } from '@theia/qaap-shared-core/lib/common/qaap-preview-turn-refresh';

/** How long a restarted managed dev server may take to be back before the Browser reloads anyway. */
const RESTARTED_PREVIEW_READY_TIMEOUT_MS = 60_000;
/** Lets the bootstrap's own "open preview" of the restarted run land before the route is restored. */
const RESTARTED_PREVIEW_SETTLE_MS = 800;

/** The slice of the project bootstrap a turn refresh drives. */
export interface QaapPreviewTurnRefreshBootstrap {
    readonly previewUrl: string | undefined;
    readonly previewId: string | undefined;
    readonly onStateChange: Event<QaapBootstrapStateChange>;
    restartManagedDevServer(): Promise<boolean>;
}

/**
 * Applies a turn's refresh: restart the Qaap-managed dev server when asked (a no-op for servers
 * Qaap did not start), then reload every surface on the page it was on — same widget, same route.
 */
export async function applyQaapPreviewTurnRefresh(
    action: QaapPreviewTurnRefreshAction,
    surfaces: readonly QaapPreviewSurfaceHandle[],
    bootstrap: QaapPreviewTurnRefreshBootstrap,
): Promise<void> {
    if (action === 'none') {
        return;
    }
    const pages = surfaces.map(surface => ({ surface, url: readQaapPreviewFrameUrl(surface.frame) }));
    if (action === 'restart' && await bootstrap.restartManagedDevServer()) {
        await waitForQaapRunningPreview(bootstrap.onStateChange);
    }
    const base = bootstrap.previewUrl;
    if (!base) {
        return;
    }
    for (const { surface, url } of pages) {
        if (!surface.isConnected()) {
            continue;
        }
        // Keep the page the user was on: as is for the same URL, rebased when the restart moved the
        // preview to a new hostname / identity prefix.
        const target = url && sameQaapPreviewBase(url, base) ? url : rebaseQaapPreviewUrl(url, base);
        surface.navigate(withQaapPreviewCacheBust(target));
    }
}

/** Same origin and same identity prefix: the frame's URL is still valid on the (re)started preview. */
function sameQaapPreviewBase(url: string, base: string): boolean {
    try {
        const current = new URL(url);
        const next = new URL(base);
        const prefix = (pathname: string): string => pathname.match(/^\/qaap-preview\/[^/]+/)?.[0] ?? '';
        return current.origin === next.origin && prefix(current.pathname) === prefix(next.pathname);
    } catch {
        return false;
    }
}

function waitForQaapRunningPreview(onStateChange: Event<QaapBootstrapStateChange>): Promise<void> {
    return new Promise(resolve => {
        let subscription: Disposable = Disposable.NULL;
        let done = false;
        const finish = (): void => {
            if (done) {
                return;
            }
            done = true;
            subscription.dispose();
            clearTimeout(timeout);
            setTimeout(resolve, RESTARTED_PREVIEW_SETTLE_MS);
        };
        const timeout = setTimeout(finish, RESTARTED_PREVIEW_READY_TIMEOUT_MS);
        subscription = onStateChange(state => {
            if ((state.phase === 'running' && state.previewUrl) || state.phase === 'run-failed') {
                finish();
            }
        });
    });
}

/** The conversation folder and the preview project are the same, or one contains the other. */
export function isQaapPreviewTurnRefreshSameProject(root: URI, cwd: string): boolean {
    if (!cwd) {
        return false;
    }
    const conversationRoot = FileUri.create(cwd);
    return root.isEqualOrParent(conversationRoot) || conversationRoot.isEqualOrParent(root);
}
