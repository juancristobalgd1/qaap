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
import type { StreamingMarkdownHtmlPatch } from '@theia/qaap-transcript-overlay/lib/browser/qaap-transcript-streaming-markdown-view';
import { recordTranscriptRenderMetric } from '../common/qaap-transcript-render-metrics';

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

export class QaapTranscriptMarkdownWorkerClient {
    protected static instance: QaapTranscriptMarkdownWorkerClient | undefined;

    protected worker: Worker | undefined;
    protected workerFailed = false;
    protected nextRequestId = 0;
    protected nextStreamId = 0;
    protected readonly hostGenerations = new WeakMap<HTMLElement, number>();
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
        const pending = this.latestRequests.get(host);
        if (!pending) {
            return;
        }
        const worker = this.worker;
        if (!worker) {
            return;
        }

        this.latestRequests.delete(host);
        const requestId = ++this.nextRequestId;
        this.pendingRequests.set(requestId, pending);
        this.inFlightRequestIds.set(host, requestId);
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

    protected ensureWorker(): Worker | undefined {
        if (this.worker) {
            return this.worker;
        }
        try {
            this.worker = new Worker(new URL('./qaap-transcript-markdown-worker.js', location.href));
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
        this.inFlightRequestIds.delete(pending.host);
        this.dispatchLatestRequest(pending.host);
        if (!shouldApplyTranscriptMarkdownWorkerResult(this.hostGenerations.get(pending.host), message.generation)) {
            return;
        }
        if (message.type === 'result' && pending.kind === 'parse') {
            pending.apply(pending.host, message.html, message.cleanLength);
            return;
        }
        if (message.type === 'stream_result' && pending.kind === 'stream') {
            this.applyStreamResult(pending, message);
        }
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
            if (request.kind === 'parse') {
                request.fallbackSync(request.host, request.content);
            } else {
                request.fallbackPlainText(request.host, request.content);
            }
        }
    }

    protected disposeWorkerOnly(): void {
        this.worker?.terminate();
        this.worker = undefined;
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
