// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    shouldApplyTranscriptMarkdownWorkerResult,
    type TranscriptMarkdownWorkerRequest,
    type TranscriptMarkdownWorkerResponse,
    type TranscriptMarkdownWorkerStreamResponse,
} from './qaap-transcript-markdown-worker-protocol';
import {
    TRANSCRIPT_STREAM_STABLE_LENGTH_DATA,
    TRANSCRIPT_STREAM_TOTAL_LENGTH_DATA,
    type StreamingMarkdownHtmlPatch,
} from '@theia/qaap-transcript-overlay/lib/browser/qaap-transcript-streaming-markdown-view';
import { recordTranscriptRenderMetric } from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-render-metrics';

export type TranscriptMarkdownApplyFn = (host: HTMLElement, html: string, cleanLength: number) => void;
export type TranscriptMarkdownSyncParseFn = (host: HTMLElement, content: string) => void;
export type TranscriptStreamingMarkdownApplyFn = (
    host: HTMLElement,
    patch: StreamingMarkdownHtmlPatch,
    cleanLength: number,
) => void;
export type TranscriptStreamingPlainTextFallbackFn = (host: HTMLElement, content: string) => void;

interface PendingParseRequest {
    readonly kind: 'parse';
    readonly host: HTMLElement;
    readonly generation: number;
    readonly content: string;
    readonly apply: TranscriptMarkdownApplyFn;
    readonly fallbackSync: TranscriptMarkdownSyncParseFn;
}

interface PendingStreamRequest {
    readonly kind: 'stream';
    readonly host: HTMLElement;
    readonly generation: number;
    readonly content: string;
    readonly previousStableLength: number;
    readonly previousTotalLength: number;
    readonly apply: TranscriptStreamingMarkdownApplyFn;
    readonly fallbackPlainText: TranscriptStreamingPlainTextFallbackFn;
}

type PendingRequest = PendingParseRequest | PendingStreamRequest;

/**
 * Upper bound on one worker round-trip. A worker that loads but never answers (a crashed
 * `onmessage`, a stalled thread) must not leave settled text as raw markdown: after this
 * long the request falls back to the main-thread parser.
 */
export const TRANSCRIPT_MARKDOWN_WORKER_RESPONSE_TIMEOUT_MS = 4000;

const TRANSCRIPT_MARKDOWN_WORKER_SCRIPT = './qaap-transcript-markdown-worker.js';

/**
 * Bundler output name of the markdown worker. Webpack emits it beside `bundle.js`, so resolve it
 * against the bundle's public path (the frontend output directory), not against whatever page URL
 * the app is currently showing: a deep route such as `/some/path` would otherwise request
 * `/some/path/qaap-transcript-markdown-worker.js` and 404.
 */
declare const __webpack_public_path__: string | undefined;

function readBundlePublicPath(): string | undefined {
    return typeof __webpack_public_path__ === 'string' && __webpack_public_path__ ? __webpack_public_path__ : undefined;
}

function readPageBase(): string {
    return typeof document !== 'undefined' && document.baseURI ? document.baseURI : location.href;
}

/**
 * Absolute URL of the markdown worker script. Parameters default to the running bundle and page;
 * they are explicit so unit tests can pin the resolution rules.
 */
export function resolveTranscriptMarkdownWorkerUrl(
    bundlePublicPath: string | undefined = readBundlePublicPath(),
    pageBase: string = readPageBase(),
): URL {
    const base = bundlePublicPath ? new URL(bundlePublicPath, pageBase).href : pageBase;
    return new URL(TRANSCRIPT_MARKDOWN_WORKER_SCRIPT, base);
}

export class QaapTranscriptMarkdownWorkerClient {
    protected static instance: QaapTranscriptMarkdownWorkerClient | undefined;
    protected static responseTimeoutMs = TRANSCRIPT_MARKDOWN_WORKER_RESPONSE_TIMEOUT_MS;

    protected worker: Worker | undefined;
    protected workerFailed = false;
    protected nextRequestId = 0;
    protected nextStreamId = 0;
    /** Per in-flight request watchdog; cleared on any response, failure or dispose. */
    protected readonly responseTimers = new Map<number, ReturnType<typeof setTimeout>>();
    protected readonly hostGenerations = new WeakMap<HTMLElement, number>();
    /** Generation of the last result painted per host; stream results only ever move forward. */
    protected readonly appliedGenerations = new WeakMap<HTMLElement, number>();
    /** Stable per-host stream id so the worker can accumulate frozen HTML across streaming ticks. */
    protected readonly hostStreamIds = new WeakMap<HTMLElement, number>();
    protected readonly pendingRequests = new Map<number, PendingRequest>();
    /** One queued snapshot per host; a newer stream tick replaces an older one before dispatch. */
    protected readonly latestRequests = new Map<HTMLElement, PendingRequest>();
    /** Keep at most one request in the worker per host so the queue cannot grow with SSE ticks. */
    protected readonly inFlightRequestIds = new Map<HTMLElement, number>();

    static get(): QaapTranscriptMarkdownWorkerClient {
        if (!QaapTranscriptMarkdownWorkerClient.instance) {
            QaapTranscriptMarkdownWorkerClient.instance = new QaapTranscriptMarkdownWorkerClient();
        }
        return QaapTranscriptMarkdownWorkerClient.instance;
    }

    /** Visible for unit tests. */
    static resetForTests(): void {
        QaapTranscriptMarkdownWorkerClient.instance?.dispose();
        QaapTranscriptMarkdownWorkerClient.instance = undefined;
        QaapTranscriptMarkdownWorkerClient.responseTimeoutMs = TRANSCRIPT_MARKDOWN_WORKER_RESPONSE_TIMEOUT_MS;
    }

    /** Visible for unit tests: shorten the watchdog so timeout fallbacks run without real waits. */
    static setResponseTimeoutForTests(ms: number): void {
        QaapTranscriptMarkdownWorkerClient.responseTimeoutMs = ms;
    }

    requestParse(
        host: HTMLElement,
        content: string,
        apply: TranscriptMarkdownApplyFn,
        fallbackSync: TranscriptMarkdownSyncParseFn,
    ): void {
        const generation = this.bumpHostGeneration(host);

        if (this.workerFailed || typeof Worker === 'undefined') {
            fallbackSync(host, content);
            return;
        }

        const worker = this.ensureWorker();
        if (!worker) {
            fallbackSync(host, content);
            return;
        }

        this.enqueueLatestRequest({ kind: 'parse', host, generation, content, apply, fallbackSync });
    }

    requestStreamingPatch(
        host: HTMLElement,
        content: string,
        previousStableLength: number,
        previousTotalLength: number,
        apply: TranscriptStreamingMarkdownApplyFn,
        fallbackPlainText: TranscriptStreamingPlainTextFallbackFn,
    ): void {
        const generation = this.bumpHostGeneration(host);

        if (this.workerFailed || typeof Worker === 'undefined') {
            fallbackPlainText(host, content);
            return;
        }

        const worker = this.ensureWorker();
        if (!worker) {
            fallbackPlainText(host, content);
            return;
        }

        this.enqueueLatestRequest({
            kind: 'stream',
            host,
            generation,
            content,
            previousStableLength,
            previousTotalLength,
            apply,
            fallbackPlainText,
        });
    }

    protected enqueueLatestRequest(request: PendingRequest): void {
        if (this.latestRequests.has(request.host) || this.inFlightRequestIds.has(request.host)) {
            recordTranscriptRenderMetric('markdown_worker_coalesced');
        }
        this.latestRequests.set(request.host, request);
        this.dispatchLatestRequest(request.host);
    }

    protected dispatchLatestRequest(host: HTMLElement): void {
        if (this.workerFailed || this.inFlightRequestIds.has(host)) {
            return;
        }
        let pending = this.latestRequests.get(host);
        if (!pending) {
            return;
        }
        const worker = this.worker;
        if (!worker) {
            return;
        }

        this.latestRequests.delete(host);
        if (pending.kind === 'stream') {
            pending = this.withCurrentStreamLengths(pending);
        }
        const requestId = ++this.nextRequestId;
        this.pendingRequests.set(requestId, pending);
        this.inFlightRequestIds.set(host, requestId);
        this.armResponseTimer(requestId);
        const request: TranscriptMarkdownWorkerRequest = pending.kind === 'parse'
            ? {
                type: 'parse',
                requestId,
                generation: pending.generation,
                content: pending.content,
            }
            : {
                type: 'parse_stream',
                requestId,
                generation: pending.generation,
                content: pending.content,
                previousStableLength: pending.previousStableLength,
                previousTotalLength: pending.previousTotalLength,
                streamId: this.resolveHostStreamId(host),
            };
        worker.postMessage(request);
    }

    protected bumpHostGeneration(host: HTMLElement): number {
        const generation = (this.hostGenerations.get(host) ?? 0) + 1;
        this.hostGenerations.set(host, generation);
        return generation;
    }

    /** Stable id per host element, so the worker's frozen-HTML accumulator survives across ticks. */
    protected resolveHostStreamId(host: HTMLElement): number {
        let id = this.hostStreamIds.get(host);
        if (id === undefined) {
            id = ++this.nextStreamId;
            this.hostStreamIds.set(host, id);
        }
        return id;
    }

    protected armResponseTimer(requestId: number): void {
        const timeoutMs = QaapTranscriptMarkdownWorkerClient.responseTimeoutMs;
        if (typeof setTimeout !== 'function') {
            return;
        }
        this.responseTimers.set(requestId, setTimeout(() => this.handleResponseTimeout(requestId), timeoutMs));
    }

    protected clearResponseTimer(requestId: number): void {
        const timer = this.responseTimers.get(requestId);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.responseTimers.delete(requestId);
        }
    }

    /** A worker that never answers: settle this host on the main thread and keep the worker for others. */
    protected handleResponseTimeout(requestId: number): void {
        this.responseTimers.delete(requestId);
        const pending = this.pendingRequests.get(requestId);
        if (!pending) {
            return;
        }
        this.pendingRequests.delete(requestId);
        this.inFlightRequestIds.delete(pending.host);
        recordTranscriptRenderMetric('markdown_worker_timeout');
        try {
            if (shouldApplyTranscriptMarkdownWorkerResult(this.hostGenerations.get(pending.host), pending.generation)) {
                this.applyFallback(pending);
            }
        } finally {
            this.dispatchLatestRequest(pending.host);
        }
    }

    protected applyFallback(request: PendingRequest): void {
        if (request.kind === 'parse') {
            request.fallbackSync(request.host, request.content);
        } else {
            request.fallbackPlainText(request.host, request.content);
        }
    }

    protected ensureWorker(): Worker | undefined {
        if (this.worker) {
            return this.worker;
        }
        try {
            this.worker = new Worker(resolveTranscriptMarkdownWorkerUrl());
            this.worker.onmessage = (event: MessageEvent<TranscriptMarkdownWorkerResponse>) => {
                this.handleWorkerMessage(event.data);
            };
            this.worker.onerror = () => {
                this.failWorkerAndFallbackPending();
            };
            return this.worker;
        } catch {
            this.workerFailed = true;
            return undefined;
        }
    }

    protected handleWorkerMessage(message: TranscriptMarkdownWorkerResponse | undefined): void {
        if (!message) {
            return;
        }
        const pending = this.pendingRequests.get(message.requestId);
        if (!pending) {
            return;
        }
        this.pendingRequests.delete(message.requestId);
        this.clearResponseTimer(message.requestId);
        this.inFlightRequestIds.delete(pending.host);
        try {
            if (!this.shouldApplyResult(pending, message.generation)) {
                return;
            }
            this.appliedGenerations.set(pending.host, message.generation);
            if (message.type === 'result' && pending.kind === 'parse') {
                pending.apply(pending.host, message.html, message.cleanLength);
                return;
            }
            if (message.type === 'stream_result' && pending.kind === 'stream') {
                this.applyStreamResult(pending, message);
            }
        } finally {
            // Dispatch after painting, so the next stream request diffs against what is shown.
            this.dispatchLatestRequest(pending.host);
        }
    }

    /**
     * The latest generation always applies. While a turn streams, the smooth reveal requests a
     * new snapshot every frame, so whenever the worker round-trip outlasts a frame (a long tail,
     * a slow phone) the in-flight result is already superseded on arrival. Dropping it then
     * starves the host: nothing ever paints and the answer freezes until the turn settles.
     * A superseded stream result is still a newer prefix than what the DOM shows, so it paints
     * (generations only move forward), unless a final parse is queued behind it.
     */
    protected shouldApplyResult(pending: PendingRequest, generation: number): boolean {
        if (shouldApplyTranscriptMarkdownWorkerResult(this.hostGenerations.get(pending.host), generation)) {
            return true;
        }
        if (pending.kind !== 'stream' || this.latestRequests.get(pending.host)?.kind === 'parse') {
            return false;
        }
        return generation > (this.appliedGenerations.get(pending.host) ?? 0);
    }

    /** A queued stream request diffs against the DOM as of dispatch, not as of its enqueue. */
    protected withCurrentStreamLengths(pending: PendingStreamRequest): PendingStreamRequest {
        const dataset = (pending.host as Partial<HTMLElement>).dataset;
        const stable = dataset?.[TRANSCRIPT_STREAM_STABLE_LENGTH_DATA];
        const total = dataset?.[TRANSCRIPT_STREAM_TOTAL_LENGTH_DATA];
        if (stable === undefined || total === undefined) {
            return pending;
        }
        return { ...pending, previousStableLength: Number(stable), previousTotalLength: Number(total) };
    }

    protected applyStreamResult(
        pending: PendingStreamRequest,
        message: TranscriptMarkdownWorkerStreamResponse,
    ): void {
        if (message.noop || message.tailHtml === undefined) {
            return;
        }
        pending.apply(pending.host, {
            stableLength: message.stableLength,
            totalLength: message.totalLength,
            ...(message.frozenHtml !== undefined ? { frozenHtml: message.frozenHtml } : {}),
            ...(message.frozenHtmlAppend !== undefined ? { frozenHtmlAppend: message.frozenHtmlAppend } : {}),
            tailHtml: message.tailHtml,
        }, message.cleanLength);
    }

    protected failWorkerAndFallbackPending(): void {
        this.workerFailed = true;
        const pendingByHost = new Map<HTMLElement, PendingRequest>();
        for (const request of this.pendingRequests.values()) {
            pendingByHost.set(request.host, request);
        }
        for (const request of this.latestRequests.values()) {
            // The queued snapshot is newer than the in-flight request for the same host.
            pendingByHost.set(request.host, request);
        }
        this.disposeWorkerOnly();
        for (const request of pendingByHost.values()) {
            if (!shouldApplyTranscriptMarkdownWorkerResult(this.hostGenerations.get(request.host), request.generation)) {
                continue;
            }
            // One failing fallback must not strand the hosts queued after it as raw markdown.
            try {
                this.applyFallback(request);
            } catch (error) {
                console.error('[qaap-transcript] markdown fallback failed', error);
            }
        }
    }

    protected disposeWorkerOnly(): void {
        this.worker?.terminate();
        this.worker = undefined;
        for (const timer of this.responseTimers.values()) {
            clearTimeout(timer);
        }
        this.responseTimers.clear();
        this.pendingRequests.clear();
        this.latestRequests.clear();
        this.inFlightRequestIds.clear();
    }

    dispose(): void {
        this.disposeWorkerOnly();
        this.workerFailed = false;
        this.nextRequestId = 0;
    }
}
