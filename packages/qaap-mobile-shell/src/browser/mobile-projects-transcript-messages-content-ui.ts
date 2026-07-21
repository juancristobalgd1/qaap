// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as DOMPurify from '@theia/core/shared/dompurify';
import { nls } from '@theia/core/lib/common/nls';
import {
    applyStreamingMarkdownHtmlPatch,
    TRANSCRIPT_STREAM_PLAIN_PREVIEW_CLASS,
    updateStreamingPlainPreview,
    type StreamingMarkdownHtmlPatch,
} from '@theia/qaap-transcript-overlay/lib/browser/qaap-transcript-streaming-markdown-view';
import { QaapTranscriptMarkdownWorkerClient } from './qaap-transcript-markdown-worker-client';
import { normalizePreviewUrlForSameOrigin } from '@theia/qaap-adapters/lib/browser/qaap-preview-url-utils';
import { extractDevPreviewPortFromUrl } from './qaap-transcript-preview-bootstrap';
import { probeQaapDevPreviewPort, probeQaapIdentityPreview } from './qaap-dev-preview-client';
import {
    parseQaapIdentityPreviewRequestPath,
    type QaapDevPreviewProbeResponse,
} from '../common/qaap-dev-preview';
import { collapseExactRepeatedText } from '../common/qaap-qaiq-stream';
import { prefersReducedMotion } from '../common/qaap-prefers-reduced-motion';
import { nextStreamSmoothRevealLength } from '../common/qaap-transcript-stream-smooth';
import {
    registerDeferredTranscriptMarkdown,
    type TranscriptDeferredMarkdownHydrate,
} from './qaap-transcript-row-defer';
import { MobileSnackbar } from './mobile-snackbar';
import type { MobileProjectsTranscriptMessagesHost } from './mobile-projects-transcript-messages-ui';
import { enhanceTranscriptMarkdownRichContent } from './qaap-transcript-rich-content-ui';
import { enhanceTranscriptCaptureDirectives } from './qaap-transcript-capture-pending-ui';
import { textContainsQaapCaptureDirective } from '../common/qaap-visual-verification';

/** Monospace plain-text preview while worker markdown is in flight (short streams stay here). */
export const TRANSCRIPT_STREAMING_PLAIN_TEXT_CLASS = 'theia-mod-streaming-plain-text';
/** Frozen/tail markdown from the worker while a long agent turn streams. */
export const TRANSCRIPT_STREAMING_INCREMENTAL_MARKDOWN_CLASS = 'theia-mod-streaming-incremental-markdown';
/** Worker HTML plus a live plain-text suffix while the stream outruns the worker. */
export const TRANSCRIPT_STREAMING_HYBRID_CLASS = 'theia-mod-streaming-hybrid';
/** Below this length streaming stays plain text; above it uses worker frozen/tail markdown. */
export const TRANSCRIPT_STREAMING_INCREMENTAL_MIN_CHARS = 480;

/** Fenced code or GFM-style tables need incremental markdown even on short streams. */
export function transcriptContentNeedsStreamingMarkdown(content: string): boolean {
    return content.length >= TRANSCRIPT_STREAMING_INCREMENTAL_MIN_CHARS
        || /(?:^|\n)\s{0,3}```/.test(content)
        || /(?:^|\n)\|[^\n]+\|/.test(content);
}

const STREAM_STABLE_LENGTH_DATA = 'qaapStreamStableLength';
const STREAM_TOTAL_LENGTH_DATA = 'qaapStreamTotalLength';

/** Cumulative clean streamed text per host, keyed off the DOM element rather than
 *  a `dataset` attribute so writing it every SSE tick doesn't pay for O(N) DOM
 *  attribute serialization on every frame while a long turn streams. */
const transcriptStreamSourceCache = new WeakMap<HTMLElement, string>();

const QAAP_PREVIEW_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Extracts the execution identity from same-origin proxy and `preview.qaap` URLs. */
export function extractTranscriptPreviewId(href: string, publicOrigin: string): string | undefined {
    try {
        const origin = new URL(publicOrigin);
        const parsed = new URL(href.trim(), origin);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return undefined;
        }
        if (parsed.origin === origin.origin) {
            return parseQaapIdentityPreviewRequestPath(parsed.pathname)?.previewId;
        }
        const labels = parsed.hostname.toLowerCase().split('.');
        const previewId = labels[0];
        if (labels.length >= 3 && labels[1] === 'preview' && QAAP_PREVIEW_ID_PATTERN.test(previewId)) {
            return previewId;
        }
    } catch {
        return undefined;
    }
    return undefined;
}

/** Returns only URLs that Qaap can safely route into the conversation's integrated preview. */
export function normalizeTranscriptPreviewHref(href: string, publicOrigin: string): string | undefined {
    const trimmed = href.trim();
    if (!trimmed) {
        return undefined;
    }
    if (/^\/qaap-dev\/\d{2,5}(?:\/.*)?$/i.test(trimmed)) {
        return new URL(trimmed, publicOrigin).toString();
    }
    if (trimmed.startsWith('/qaap-preview/')) {
        const parsed = new URL(trimmed, publicOrigin);
        return parseQaapIdentityPreviewRequestPath(parsed.pathname) ? parsed.toString() : undefined;
    }
    if (/^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?):\d{2,5}(?:\/.*)?$/i.test(trimmed)) {
        return normalizePreviewUrlForSameOrigin(trimmed, publicOrigin);
    }
    try {
        const parsed = new URL(trimmed, publicOrigin);
        const origin = new URL(publicOrigin);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return undefined;
        }
        if (parsed.origin === origin.origin
            && (/^\/qaap-dev\/\d{2,5}(?:\/.*)?$/i.test(parsed.pathname)
                || !!parseQaapIdentityPreviewRequestPath(parsed.pathname))) {
            return parsed.toString();
        }
        if (extractTranscriptPreviewId(parsed.toString(), publicOrigin)) {
            return parsed.toString();
        }
    } catch {
        return undefined;
    }
    return undefined;
}

/** Per-row token smoothing state: full received text vs. the prefix revealed so far. */
interface TranscriptStreamSmoothEntry {
    target: string;
    revealed: number;
    lastTickAt: number;
    rafHandle: number | undefined;
}

export class MobileProjectsTranscriptMessagesContentUi {

    constructor(protected readonly host: MobileProjectsTranscriptMessagesHost) { }

    protected previewPublicOrigin(): string {
        return window.location.origin;
    }

    protected probePreviewPort(port: number): Promise<QaapDevPreviewProbeResponse> {
        return probeQaapDevPreviewPort(port);
    }

    protected probePreviewIdentity(previewId: string): Promise<QaapDevPreviewProbeResponse> {
        return probeQaapIdentityPreview(previewId);
    }

    normalizeTranscriptPreviewLink(href: string): string | undefined {
        return normalizeTranscriptPreviewHref(href, this.previewPublicOrigin());
    }

    /** Verified identity URL of the bootstrap's live preview claim, if its process answers. */
    protected async resolveClaimPreviewUrlFallback(): Promise<string | undefined> {
        const bootstrap = this.host.projectBootstrap;
        const claimPreviewId = bootstrap?.previewId;
        const claimUrl = bootstrap?.previewClaimUrl;
        if (!claimPreviewId || !claimUrl) {
            return undefined;
        }
        const probe = await this.probePreviewIdentity(claimPreviewId);
        if (!probe.ready || probe.previewId !== claimPreviewId) {
            return undefined;
        }
        return probe.previewUrl || claimUrl;
    }


    async openTranscriptPreviewUrlFromLink(href: string): Promise<boolean> {
        const summary = this.host.transcriptComposerSummary ?? this.host.transcriptOpenSummary;
        const project = this.host.transcriptOpenProject;
        const publicOrigin = this.previewPublicOrigin();
        const previewUrl = normalizeTranscriptPreviewHref(href, publicOrigin);
        if (!previewUrl || !summary || !project) {
            return false;
        }

        const port = extractDevPreviewPortFromUrl(previewUrl);
        const previewId = extractTranscriptPreviewId(previewUrl, publicOrigin);
        let verifiedUrl = previewUrl;
        if (port !== undefined) {
            const probe = await this.probePreviewPort(port);
            if (probe.ready) {
                verifiedUrl = normalizePreviewUrlForSameOrigin(probe.previewUrl, publicOrigin);
            } else {
                // The clicked port is stale more often than not: agents quote the framework's
                // default (5173, 8080) while the allocator ran the server elsewhere, and probes on
                // unclaimed ports fail closed. The live claim's identity URL is the authoritative
                // target — resolve through it before giving up.
                const claimUrl = await this.resolveClaimPreviewUrlFallback();
                if (!claimUrl) {
                    return false;
                }
                verifiedUrl = claimUrl;
            }
        } else if (previewId) {
            const probe = await this.probePreviewIdentity(previewId);
            if (!probe.ready || probe.previewId !== previewId) {
                const claimUrl = await this.resolveClaimPreviewUrlFallback();
                if (!claimUrl) {
                    return false;
                }
                verifiedUrl = claimUrl;
            } else {
                verifiedUrl = probe.previewUrl;
            }
        }
        this.host.transcriptPreviewRequestPending = false;
        this.host.transcriptPreviewRequestRunning = false;
        const latestProject = { ...project, previewUrl: verifiedUrl };
        this.host.transcriptOpenProject = latestProject;
        this.host.projects = this.host.projects.map(candidate => candidate.id === latestProject.id
            ? { ...candidate, previewUrl: verifiedUrl }
            : candidate);
        await this.host.projectsService.recordProjectPreviewUrl(latestProject, verifiedUrl).catch(() => undefined);

        this.host.executionSurfaceTabsUi.selectTranscriptTab('preview', latestProject, summary);
        MobileSnackbar.show(nls.localize('qaap/mobileProjects/previewLinkOpened', 'Preview opened'), { kind: 'success', duration: 1400 });
        return true;
    }


    renderTranscriptMarkdown(host: HTMLElement, content: string, options?: { readonly defer?: boolean }): void {
        const clean = this.cleanTranscriptDisplayText(content).trim();
        if (!clean) {
            host.replaceChildren();
            host.classList.remove('theia-mod-markdown');
            return;
        }
        if (options?.defer) {
            this.renderTranscriptDeferredMarkdownPlaceholder(host, clean);
            return;
        }
        const linked = this.linkifyTranscriptPreviewUrls(clean);
        host.classList.remove(
            TRANSCRIPT_STREAMING_PLAIN_TEXT_CLASS,
            TRANSCRIPT_STREAMING_INCREMENTAL_MARKDOWN_CLASS,
            TRANSCRIPT_STREAMING_HYBRID_CLASS,
        );
        host.classList.add('theia-mod-markdown');
        host.textContent = clean;
        QaapTranscriptMarkdownWorkerClient.get().requestParse(
            host,
            linked,
            (target, html, cleanLength) => this.applyTranscriptMarkdownHtml(target, html, cleanLength),
            (target, linkedContent) => this.renderTranscriptMarkdownSync(target, linkedContent),
        );
    }

    /** Main-thread fallback when the markdown worker is unavailable. */
    protected renderTranscriptMarkdownSync(host: HTMLElement, linkedContent: string): void {
        const html = this.host.transcriptMarkdownIt.render(linkedContent);
        const sanitized = DOMPurify.sanitize(html, {
            ALLOW_UNKNOWN_PROTOCOLS: true,
        });
        this.applyTranscriptMarkdownHtml(host, sanitized, linkedContent.length);
    }

    /** Apply sanitized HTML from the worker (or sync fallback) without re-parsing markdown. */
    protected applyTranscriptMarkdownHtml(host: HTMLElement, html: string, cleanLength: number): void {
        host.classList.remove(
            TRANSCRIPT_STREAMING_PLAIN_TEXT_CLASS,
            TRANSCRIPT_STREAMING_INCREMENTAL_MARKDOWN_CLASS,
            TRANSCRIPT_STREAMING_HYBRID_CLASS,
        );
        host.classList.add('theia-mod-markdown');
        transcriptStreamSourceCache.delete(host);
        host.innerHTML = html;
        host.dataset.transcriptStreamParsedLen = String(cleanLength);
        host.dataset.transcriptStreamParsedAt = String(Date.now());
        enhanceTranscriptMarkdownRichContent(host);
        this.attachTranscriptMarkdownLinkHandler(host);
    }

    /** Synchronous markdown for short fixed rows (user bubbles) — never leave an empty bubble while the worker loads. */
    renderTranscriptMarkdownImmediate(host: HTMLElement, content: string): void {
        const clean = this.cleanTranscriptDisplayText(content).trim();
        if (!clean) {
            host.replaceChildren();
            host.classList.remove('theia-mod-markdown');
            return;
        }
        host.classList.add('theia-mod-markdown');
        this.renderTranscriptMarkdownSync(host, this.linkifyTranscriptPreviewUrls(clean));
    }

    protected renderTranscriptDeferredMarkdownPlaceholder(host: HTMLElement, clean: string): void {
        host.classList.add('theia-mod-markdown', 'theia-mod-deferred-markdown');
        const excerpt = clean.length > 180 ? `${clean.slice(0, 180).trimEnd()}…` : clean;
        host.textContent = excerpt;
        const hydrate: TranscriptDeferredMarkdownHydrate = {
            host,
            content: clean,
        };
        registerDeferredTranscriptMarkdown(hydrate);
    }

    /**
     * Short streams: plain monospace text. Long streams: instant plain preview plus
     * frozen/tail markdown parsed in the markdown worker (main thread only applies HTML).
     * Call {@link settleTranscriptStreamingContent} once the row leaves streaming.
     */
    renderTranscriptStreamingMarkdown(host: HTMLElement, content: string, options?: { readonly defer?: boolean }): void {
        const clean = this.cleanTranscriptDisplayText(content).trim();
        if (options?.defer) {
            this.renderTranscriptDeferredMarkdownPlaceholder(host, clean);
            return;
        }
        if (!clean) {
            this.cancelStreamSmoothing(host);
            this.renderTranscriptStreamingMarkdownNow(host, clean);
            return;
        }
        if (this.shouldBypassStreamSmoothing()) {
            this.cancelStreamSmoothing(host);
            this.renderTranscriptStreamingMarkdownNow(host, clean);
            return;
        }
        const entry = this.streamSmoothEntries.get(host);
        // A rewrite under the already-revealed prefix (same-length correction,
        // reordered paragraphs) must repaint immediately: updating only
        // `entry.target` would never re-render when `revealed` already covers
        // the new length, silently freezing stale text on screen.
        const revealedPrefixChanged = !!entry
            && entry.revealed > 0
            && clean.length >= entry.revealed
            && !clean.startsWith(entry.target.slice(0, entry.revealed));
        if (!entry || clean.length < entry.revealed || revealedPrefixChanged) {
            // First paint of this row (or replaced content): show everything received so far at
            // once — smoothing only paces the deltas that arrive while the row stays mounted.
            this.cancelStreamSmoothing(host);
            this.streamSmoothEntries.set(host, {
                target: clean,
                revealed: clean.length,
                lastTickAt: Date.now(),
                rafHandle: undefined,
            });
            this.renderTranscriptStreamingMarkdownNow(host, clean);
            return;
        }
        entry.target = clean;
        this.ensureStreamSmoothTick(host, entry);
    }

    /** Token smoothing driver: reveal pending stream text at a steady pace via rAF ticks. */
    protected readonly streamSmoothEntries = new WeakMap<HTMLElement, TranscriptStreamSmoothEntry>();

    protected shouldBypassStreamSmoothing(): boolean {
        return typeof window === 'undefined'
            || typeof window.requestAnimationFrame !== 'function'
            || prefersReducedMotion()
            || (typeof document !== 'undefined' && document.hidden);
    }

    protected ensureStreamSmoothTick(host: HTMLElement, entry: TranscriptStreamSmoothEntry): void {
        if (entry.rafHandle !== undefined || entry.revealed >= entry.target.length) {
            return;
        }
        entry.lastTickAt = Date.now();
        entry.rafHandle = window.requestAnimationFrame(() => this.runStreamSmoothTick(host));
    }

    protected runStreamSmoothTick(host: HTMLElement): void {
        const entry = this.streamSmoothEntries.get(host);
        if (!entry) {
            return;
        }
        entry.rafHandle = undefined;
        if (!host.isConnected) {
            this.streamSmoothEntries.delete(host);
            return;
        }
        const now = Date.now();
        const elapsedMs = now - entry.lastTickAt;
        entry.lastTickAt = now;
        if (this.shouldBypassStreamSmoothing()) {
            entry.revealed = entry.target.length;
            this.renderTranscriptStreamingMarkdownNow(host, entry.target);
            return;
        }
        entry.revealed = nextStreamSmoothRevealLength(entry.revealed, entry.target.length, elapsedMs);
        this.renderTranscriptStreamingMarkdownNow(host, entry.target.slice(0, entry.revealed));
        if (entry.revealed < entry.target.length) {
            entry.rafHandle = window.requestAnimationFrame(() => this.runStreamSmoothTick(host));
        }
    }

    protected cancelStreamSmoothing(host: HTMLElement): void {
        const entry = this.streamSmoothEntries.get(host);
        if (!entry) {
            return;
        }
        if (entry.rafHandle !== undefined && typeof window !== 'undefined') {
            window.cancelAnimationFrame(entry.rafHandle);
        }
        this.streamSmoothEntries.delete(host);
    }

    /** Renders streaming content for the already-revealed prefix (no smoothing). */
    protected renderTranscriptStreamingMarkdownNow(host: HTMLElement, clean: string): void {
        if (!clean) {
            host.replaceChildren();
            host.classList.remove(
                'theia-mod-markdown',
                TRANSCRIPT_STREAMING_PLAIN_TEXT_CLASS,
                TRANSCRIPT_STREAMING_INCREMENTAL_MARKDOWN_CLASS,
                TRANSCRIPT_STREAMING_HYBRID_CLASS,
            );
            transcriptStreamSourceCache.delete(host);
            delete host.dataset.transcriptStreamParsedLen;
            delete host.dataset.transcriptStreamParsedAt;
            delete host.dataset[STREAM_STABLE_LENGTH_DATA];
            delete host.dataset[STREAM_TOTAL_LENGTH_DATA];
            return;
        }
        if (!transcriptContentNeedsStreamingMarkdown(clean)) {
            host.classList.remove('theia-mod-markdown', TRANSCRIPT_STREAMING_INCREMENTAL_MARKDOWN_CLASS);
            host.classList.add(TRANSCRIPT_STREAMING_PLAIN_TEXT_CLASS);
            if (textContainsQaapCaptureDirective(clean)) {
                let body = host.querySelector<HTMLElement>('.theia-mobile-agent-transcript-stream-plain-body');
                if (!body) {
                    host.replaceChildren();
                    body = document.createElement('div');
                    body.className = 'theia-mobile-agent-transcript-stream-plain-body';
                    host.append(body);
                }
                body.textContent = clean;
                enhanceTranscriptCaptureDirectives(host);
            } else {
                host.replaceChildren();
                host.textContent = clean;
            }
            transcriptStreamSourceCache.set(host, clean);
            delete host.dataset[STREAM_STABLE_LENGTH_DATA];
            delete host.dataset[STREAM_TOTAL_LENGTH_DATA];
            delete host.dataset.transcriptStreamParsedLen;
            delete host.dataset.transcriptStreamParsedAt;
            return;
        }

        transcriptStreamSourceCache.set(host, clean);
        const linked = this.linkifyTranscriptPreviewUrls(clean);
        const previousStable = Number(host.dataset[STREAM_STABLE_LENGTH_DATA] ?? '-1');
        const previousTotal = Number(host.dataset[STREAM_TOTAL_LENGTH_DATA] ?? '-1');
        const formattedTotal = Math.max(0, previousTotal);

        host.classList.remove(TRANSCRIPT_STREAMING_PLAIN_TEXT_CLASS);
        host.classList.add(TRANSCRIPT_STREAMING_INCREMENTAL_MARKDOWN_CLASS, TRANSCRIPT_STREAMING_HYBRID_CLASS);
        if (formattedTotal === 0 && !host.querySelector(`:scope > .${TRANSCRIPT_STREAM_PLAIN_PREVIEW_CLASS}`)) {
            host.replaceChildren();
        }
        updateStreamingPlainPreview(host, clean, formattedTotal);

        QaapTranscriptMarkdownWorkerClient.get().requestStreamingPatch(
            host,
            linked,
            previousStable,
            previousTotal,
            (target, patch, cleanLength) => this.applyTranscriptStreamingMarkdownHtml(target, patch, cleanLength),
            (target, linkedContent) => this.renderTranscriptMarkdownSync(target, linkedContent),
        );
    }

    protected applyTranscriptStreamingMarkdownHtml(
        host: HTMLElement,
        patch: StreamingMarkdownHtmlPatch,
        cleanLength: number,
    ): void {
        if (!applyStreamingMarkdownHtmlPatch(host, patch)) {
            return;
        }
        updateStreamingPlainPreview(host, transcriptStreamSourceCache.get(host) ?? '', patch.totalLength);
        host.classList.remove(TRANSCRIPT_STREAMING_PLAIN_TEXT_CLASS);
        host.classList.add(
            'theia-mod-markdown',
            TRANSCRIPT_STREAMING_INCREMENTAL_MARKDOWN_CLASS,
            TRANSCRIPT_STREAMING_HYBRID_CLASS,
        );
        host.dataset.transcriptStreamParsedLen = String(cleanLength);
        host.dataset.transcriptStreamParsedAt = String(Date.now());
        enhanceTranscriptMarkdownRichContent(host);
        this.attachTranscriptMarkdownLinkHandler(host);
    }

    protected renderTranscriptStreamingPlainTextFallback(host: HTMLElement, linkedContent: string): void {
        host.classList.remove(
            'theia-mod-markdown',
            TRANSCRIPT_STREAMING_INCREMENTAL_MARKDOWN_CLASS,
            TRANSCRIPT_STREAMING_HYBRID_CLASS,
        );
        host.classList.add(TRANSCRIPT_STREAMING_PLAIN_TEXT_CLASS);
        host.replaceChildren();
        host.textContent = linkedContent;
        transcriptStreamSourceCache.set(host, linkedContent);
        delete host.dataset[STREAM_STABLE_LENGTH_DATA];
        delete host.dataset[STREAM_TOTAL_LENGTH_DATA];
    }

    /** Upgrade every streaming host under `root` to full rendered markdown (turn settled). */
    settleTranscriptStreamingContent(root: ParentNode): void {
        // Claude-Code-style: collapse tool groups once every pill inside finished successfully.
        for (const group of root.querySelectorAll<HTMLDetailsElement>('details.theia-mobile-agent-tool-group[open]')) {
            if (!group.querySelector('.theia-mobile-agent-tool-pill.theia-mod-running, .theia-mobile-agent-tool-pill.theia-mod-failed')) {
                group.open = false;
            }
        }
        const selector = [
            `.${TRANSCRIPT_STREAMING_PLAIN_TEXT_CLASS}`,
            `.${TRANSCRIPT_STREAMING_INCREMENTAL_MARKDOWN_CLASS}`,
        ].join(', ');
        for (const host of root.querySelectorAll<HTMLElement>(selector)) {
            // Prefer the smoother's full received text: the rendered DOM (and its dataset) may
            // still hold only the revealed prefix when the turn settles mid-animation.
            const pendingFullText = this.streamSmoothEntries.get(host)?.target;
            this.cancelStreamSmoothing(host);
            const content = pendingFullText ?? transcriptStreamSourceCache.get(host) ?? host.textContent ?? '';
            this.renderTranscriptMarkdown(host, content);
        }
    }

    /** @deprecated Use {@link settleTranscriptStreamingContent}. */
    settleTranscriptStreamingPlainText(root: ParentNode): void {
        this.settleTranscriptStreamingContent(root);
    }

    protected attachTranscriptMarkdownLinkHandler(host: HTMLElement): void {
        if (host.dataset.transcriptMarkdownLinks === '1') {
            return;
        }
        host.dataset.transcriptMarkdownLinks = '1';
        host.addEventListener('click', event => {
            let target = event.target as HTMLElement | null;
            while (target && target.tagName !== 'A') {
                target = target.parentElement;
            }
            if (!target) {
                return;
            }
            const href = target.getAttribute('href');
            if (!href) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            void this.openTranscriptPreviewUrlFromLink(href).then(handled => {
                if (handled) {
                    return;
                }
                if (this.normalizeTranscriptPreviewLink(href)) {
                    // A dev-preview URL that could not be resolved. Opening it in a new tab would
                    // point the user's OWN machine at localhost:<port> — a guaranteed dead page on
                    // a remote deployment. Explain instead.
                    MobileSnackbar.show(
                        nls.localize(
                            'qaap/mobileProjects/previewLinkUnavailable',
                            'That preview is not running right now. Use the Preview view to start it.'
                        ),
                        { kind: 'warning' },
                    );
                    return;
                }
                window.open(href, '_blank', 'noopener');
            });
        });
    }


    linkifyTranscriptPreviewUrls(content: string | undefined | null): string {
        const text = content ?? '';
        return text.replace(
            /(^|[\s(])((?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?):\d{2,5}(?:\/[^\s\x60<)]*)?|\/qaap-dev\/\d{2,5}(?:\/[^\s\x60<)]*)?|\/qaap-preview\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\/[^\s\x60<)]*)?|https?:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.preview\.[a-z0-9.-]+(?::\d{2,5})?(?:\/[^\s\x60<)]*)?)/gi,
            (match, prefix: string, url: string, offset: number) => {
                const before = text.slice(0, offset);
                if (/\[[^\]]*$/.test(before) || /\]\([^)]*$/.test(before)) {
                    return match;
                }
                return prefix + '[' + url + '](' + url + ')';
            },
        );
    }


    cleanTranscriptDisplayText(content: string | undefined | null): string {
        const text = content ?? '';
        return collapseExactRepeatedText(text
            .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
            .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, ''));
    }

}
