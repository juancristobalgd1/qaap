// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import {
    QAAP_AGENT_PREVIEW_UNTRUSTED_NOTE,
    type QaapAgentPreviewSnapshotResult,
    type QaapPreviewSnapshotRequest,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-preview-protocol';
import {
    inspectQaapHeadlessPage,
    loadPlaywrightCore,
    prepareHeadlessChromiumLaunchEnv,
    resolveHeadlessChromiumExecutable,
} from './qaap-headless-visual-capture';

/** Visible text returned by a snapshot, at most. */
export const QAAP_PREVIEW_SNAPSHOT_TEXT_MAX_CHARS = 4000;
/** A full-page screenshot above this size falls back to the viewport only. */
export const QAAP_PREVIEW_SNAPSHOT_IMAGE_MAX_BYTES = 1_000_000;
const DESKTOP_VIEWPORT = { width: 1280, height: 900 } as const;
const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
const DEFAULT_SETTLE_MS = 700;

/** Collapses whitespace runs and truncates visible page text for a tool result. */
export function boundQaapSnapshotText(text: string, max: number = QAAP_PREVIEW_SNAPSHOT_TEXT_MAX_CHARS): string {
    const collapsed = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    return collapsed.length > max ? `${collapsed.slice(0, max)}…(truncated)` : collapsed;
}

/**
 * `preview_snapshot`: loads one page of a running preview in headless Chromium, read-only (mutating requests are
 * aborted by {@link inspectQaapHeadlessPage}), and returns its title, visible text and runtime diagnostics, plus a
 * PNG only when asked. One snapshot runs at a time per backend; the browser is closed after each one.
 */
@injectable()
export class QaapPreviewPageInspector {

    protected queue: Promise<unknown> = Promise.resolve();

    snapshot(url: string, request: QaapPreviewSnapshotRequest, httpStatus?: number): Promise<QaapAgentPreviewSnapshotResult> {
        const run = this.queue.then(() => this.doSnapshot(url, request, httpStatus), () => this.doSnapshot(url, request, httpStatus));
        this.queue = run.catch(() => undefined);
        return run;
    }

    protected async doSnapshot(url: string, request: QaapPreviewSnapshotRequest, httpStatus?: number): Promise<QaapAgentPreviewSnapshotResult> {
        const { chromium } = loadPlaywrightCore();
        const launchEnv = await prepareHeadlessChromiumLaunchEnv();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let browser: any;
        try {
            browser = await chromium.launch({
                executablePath: resolveHeadlessChromiumExecutable(),
                headless: true,
                args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
                env: launchEnv.env,
            });
            const mobile = request.viewport === 'mobile';
            const context = await browser.newContext({
                viewport: { ...(mobile ? MOBILE_VIEWPORT : DESKTOP_VIEWPORT) },
                ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
            });
            const page = await context.newPage();
            const result = await inspectQaapHeadlessPage(page, url, request.waitMs ?? DEFAULT_SETTLE_MS);
            const title = String(await page.title().catch(() => '') ?? '');
            const text = String(await page.evaluate('(document.body && (document.body.innerText || document.body.textContent)) || ""').catch(() => '') ?? '');
            let image: QaapAgentPreviewSnapshotResult['image'];
            if (request.screenshot) {
                let png: Buffer = await page.screenshot({ fullPage: request.fullPage === true, type: 'png' });
                if (png.length > QAAP_PREVIEW_SNAPSHOT_IMAGE_MAX_BYTES && request.fullPage) {
                    png = await page.screenshot({ fullPage: false, type: 'png' });
                }
                image = { data: png.toString('base64'), mimeType: 'image/png' };
            }
            return {
                url,
                ...(httpStatus !== undefined ? { httpStatus } : {}),
                ...(title ? { title } : {}),
                readiness: result.readiness ?? (result.status === 'passed' ? 'render_ready' : 'failed'),
                summary: result.summary,
                issues: [...result.issues],
                text: boundQaapSnapshotText(text),
                note: QAAP_AGENT_PREVIEW_UNTRUSTED_NOTE,
                ...(image ? { image } : {}),
            };
        } finally {
            await browser?.close().catch(() => undefined);
            await launchEnv.cleanup();
        }
    }
}
