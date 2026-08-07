// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as markdownit from '@theia/core/shared/markdown-it';
import * as markdownitemoji from '@theia/core/shared/markdown-it-emoji';
import { parseHTML } from 'linkedom';
import { computeTranscriptStreamingMarkdownPatch, type TranscriptStreamingFrozenCache } from './qaap-transcript-markdown-worker-stream';
import type {
    TranscriptMarkdownWorkerRequest,
    TranscriptMarkdownWorkerResponse,
} from './qaap-transcript-markdown-worker-protocol';

const { window } = parseHTML('<!DOCTYPE html><html><body></body></html>');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const createDOMPurify = require('dompurify') as (window: Window) => ReturnType<typeof require>;
const DOMPurify = createDOMPurify(window as unknown as Window);
const markdownIt = markdownit({ linkify: true }).use(markdownitemoji.full);

/**
 * Accumulated frozen-prefix HTML per live stream, so each streaming tick parses only the newly
 * frozen segment instead of the whole prefix (O(n) vs O(n²) markdown-it+DOMPurify cost). Capped
 * because a stream that ends never sends a close signal; oldest entries are evicted first.
 */
const STREAM_FROZEN_CACHE_LIMIT = 64;
const streamFrozenCaches = new Map<number, TranscriptStreamingFrozenCache>();

function rememberStreamFrozenCache(streamId: number, cache: TranscriptStreamingFrozenCache): void {
    // Re-insert to keep Map iteration order = LRU; evict the oldest when over the cap.
    streamFrozenCaches.delete(streamId);
    streamFrozenCaches.set(streamId, cache);
    while (streamFrozenCaches.size > STREAM_FROZEN_CACHE_LIMIT) {
        const oldest = streamFrozenCaches.keys().next().value;
        if (oldest === undefined) {
            break;
        }
        streamFrozenCaches.delete(oldest);
    }
}

function renderSanitizedMarkdown(markdown: string): string {
    const html = markdownIt.render(markdown);
    return DOMPurify.sanitize(html, {
        ALLOW_UNKNOWN_PROTOCOLS: true,
    }) as string;
}

self.onmessage = (event: MessageEvent<TranscriptMarkdownWorkerRequest>): void => {
    const message = event.data;
    if (!message) {
        return;
    }
    if (message.type === 'parse') {
        const html = renderSanitizedMarkdown(message.content);
        const response: TranscriptMarkdownWorkerResponse = {
            type: 'result',
            requestId: message.requestId,
            generation: message.generation,
            html,
            cleanLength: message.content.length,
        };
        self.postMessage(response);
        return;
    }
    if (message.type === 'parse_stream') {
        const streamId = message.streamId;
        const patch = computeTranscriptStreamingMarkdownPatch(
            message.content,
            message.previousStableLength,
            message.previousTotalLength,
            renderSanitizedMarkdown,
            streamId !== undefined ? streamFrozenCaches.get(streamId) : undefined,
        );
        if (patch?.nextFrozenCache && streamId !== undefined) {
            rememberStreamFrozenCache(streamId, patch.nextFrozenCache);
        }
        if (!patch) {
            const response: TranscriptMarkdownWorkerResponse = {
                type: 'stream_result',
                requestId: message.requestId,
                generation: message.generation,
                cleanLength: message.content.length,
                stableLength: message.previousStableLength,
                totalLength: message.previousTotalLength,
                noop: true,
            };
            self.postMessage(response);
            return;
        }
        const response: TranscriptMarkdownWorkerResponse = {
            type: 'stream_result',
            requestId: message.requestId,
            generation: message.generation,
            cleanLength: message.content.length,
            stableLength: patch.stableLength,
            totalLength: patch.totalLength,
            ...(patch.frozenHtml !== undefined ? { frozenHtml: patch.frozenHtml } : {}),
            tailHtml: patch.tailHtml,
        };
        self.postMessage(response);
    }
};
