// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { Disposable } from '@theia/core/lib/common/disposable';
import { QAAP_FRAME_CHECK_API_PATH, QaapFrameCheckResult } from '../common/qaap-frame-check';
import {
    isQaapExternalPreviewUrl,
    QAAP_BLOCKED_FRAME_TIMEOUT_MS,
    QAAP_EXTERNAL_FRAME_SANDBOX_TOKENS,
} from './qaap-mini-browser-blocked-frame';

export interface QaapPreviewBlockedFrameGuardOptions {
    readonly frame: HTMLIFrameElement;
    /** Positioned element the "can't be embedded" card overlays; defaults to the frame's parent. */
    readonly getCardHost?: () => HTMLElement | null | undefined;
    readonly openExternal: (url: string) => void;
    /** Backend preflight; defaults to `GET /qaap/api/frame-check`. `undefined` = unknown. */
    readonly checkFrame?: (url: string) => Promise<QaapFrameCheckResult | undefined>;
    readonly ideOrigin?: string;
    readonly timeoutMs?: number;
}

/**
 * Detects external sites that refuse to be framed (`X-Frame-Options` / CSP `frame-ancestors`) and
 * replaces the browser's blank/error frame with an "Open in new tab" card. Never proxies the site:
 * the frame keeps loading the real origin, so Qaap cookies and the tenant network stay out of reach.
 *
 * Signals, strongest first: the backend header preflight (SSRF-guarded) shows the card as soon as it
 * answers "blocked"; otherwise a missing `load` after {@link QAAP_BLOCKED_FRAME_TIMEOUT_MS} shows it,
 * and a late `load` hides it again.
 */
export class QaapPreviewBlockedFrameGuard implements Disposable {

    protected armedUrl: string | undefined;
    protected timer: number | undefined;
    protected card: HTMLElement | undefined;
    protected loadListener: (() => void) | undefined;
    protected disposed = false;

    constructor(protected readonly options: QaapPreviewBlockedFrameGuardOptions) { }

    /** URL whose card is currently shown, if any. */
    get blockedUrl(): string | undefined {
        return this.card ? this.armedUrl : undefined;
    }

    /**
     * Call right before (or right after) pointing the frame at `url`. Same-origin previews only reset
     * the guard; external origins widen the sandbox and start detection.
     */
    arm(url: string): void {
        this.clear();
        if (this.disposed) {
            return;
        }
        const external = !!url && isQaapExternalPreviewUrl(url, this.ideOrigin());
        for (const token of QAAP_EXTERNAL_FRAME_SANDBOX_TOKENS) {
            if (external) {
                this.options.frame.sandbox.add(token);
            } else {
                this.options.frame.sandbox.remove(token);
            }
        }
        if (!external) {
            return;
        }
        this.armedUrl = url;
        const onLoad = (): void => {
            this.cancelTimer();
            this.detachLoadListener();
            this.card?.remove();
            this.card = undefined;
        };
        this.loadListener = onLoad;
        this.options.frame.addEventListener('load', onLoad);
        void this.preflight(url);
        this.timer = this.view().setTimeout(() => {
            this.timer = undefined;
            // The load listener stays: a slow but embeddable site that finally loads hides the card.
            this.showCard(url);
        }, this.options.timeoutMs ?? QAAP_BLOCKED_FRAME_TIMEOUT_MS);
    }

    clear(): void {
        this.cancelTimer();
        this.detachLoadListener();
        this.card?.remove();
        this.card = undefined;
        this.armedUrl = undefined;
    }

    dispose(): void {
        this.clear();
        this.disposed = true;
    }

    protected async preflight(url: string): Promise<void> {
        let result: QaapFrameCheckResult | undefined;
        try {
            result = await (this.options.checkFrame ?? (target => this.fetchFrameCheck(target)))(url);
        } catch {
            return;
        }
        if (result?.embeddable !== false || this.armedUrl !== url || this.disposed) {
            return;
        }
        // The browser fires `load` for its own "refused to connect" page; the header answer wins.
        this.cancelTimer();
        this.detachLoadListener();
        this.showCard(url);
    }

    protected async fetchFrameCheck(url: string): Promise<QaapFrameCheckResult | undefined> {
        const response = await fetch(`${this.ideOrigin()}${QAAP_FRAME_CHECK_API_PATH}?url=${encodeURIComponent(url)}`, { cache: 'no-store' });
        return response.ok ? await response.json() as QaapFrameCheckResult : undefined;
    }

    protected showCard(url: string): void {
        if (this.card || this.disposed || this.armedUrl !== url) {
            return;
        }
        const host = this.options.getCardHost?.() ?? this.options.frame.parentElement;
        if (!host) {
            return;
        }
        const doc = host.ownerDocument;
        const card = doc.createElement('div');
        card.className = 'qaap-preview-blocked-frame';
        card.setAttribute('role', 'status');
        const title = doc.createElement('p');
        title.className = 'qaap-preview-blocked-frame-title';
        title.textContent = nls.localize('qaap/preview/blockedFrameTitle', "This site doesn't allow being shown inside Qaap");
        const text = doc.createElement('p');
        text.className = 'qaap-preview-blocked-frame-text';
        text.textContent = nls.localize(
            'qaap/preview/blockedFrameDetail',
            '{0} blocks embedding in other apps. Open it in a new tab to keep browsing.',
            hostLabel(url),
        );
        const open = doc.createElement('button');
        open.type = 'button';
        open.className = 'theia-button main qaap-preview-blocked-frame-open';
        open.textContent = nls.localize('qaap/preview/openInNewTab', 'Open in new tab');
        open.addEventListener('click', () => this.options.openExternal(url));
        card.append(title, text, open);
        host.append(card);
        this.card = card;
    }

    protected cancelTimer(): void {
        if (this.timer !== undefined) {
            this.view().clearTimeout(this.timer);
            this.timer = undefined;
        }
    }

    protected detachLoadListener(): void {
        if (this.loadListener) {
            this.options.frame.removeEventListener('load', this.loadListener);
            this.loadListener = undefined;
        }
    }

    protected view(): Window {
        return this.options.frame.ownerDocument.defaultView ?? window;
    }

    protected ideOrigin(): string {
        return this.options.ideOrigin ?? this.view().location.origin;
    }
}

function hostLabel(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}
