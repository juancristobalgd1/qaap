// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { resolveMarkdownStreamStablePrefixLength } from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-streaming-markdown';

/** Accumulated frozen-prefix render, carried across ticks so each tick only parses the new segment. */
export interface TranscriptStreamingFrozenCache {
    readonly stableLength: number;
    readonly frozenHtml: string;
}

export interface TranscriptStreamingMarkdownPatch {
    readonly stableLength: number;
    readonly totalLength: number;
    /** Full frozen-prefix HTML; present only when the stable boundary advanced since the last patch. */
    readonly frozenHtml?: string;
    readonly tailHtml: string;
    /** Accumulator to remember for the next tick — present whenever {@link frozenHtml} is. */
    readonly nextFrozenCache?: TranscriptStreamingFrozenCache;
}

/**
 * Frozen/tail split for worker-side streaming markdown. Returns `undefined` when
 * {@link content} length and stable boundary are unchanged (noop for the DOM).
 *
 * When a {@link frozenCache} from the previous tick is supplied and the boundary advanced from that
 * exact cached position, only the *new* frozen segment is parsed and appended to the cached HTML —
 * turning the frozen-prefix render cost over a whole streamed answer from O(n²) (re-parsing the
 * entire prefix every time the boundary moves) into O(n). The caller receives the full accumulated
 * `frozenHtml` (so the DOM side stays a plain innerHTML replace) plus `nextFrozenCache` to carry
 * forward. Falls back to a full prefix render on first tick, boundary mismatch, or rollback.
 */
export function computeTranscriptStreamingMarkdownPatch(
    content: string,
    previousStableLength: number,
    previousTotalLength: number,
    renderHtml: (markdown: string) => string,
    frozenCache?: TranscriptStreamingFrozenCache,
): TranscriptStreamingMarkdownPatch | undefined {
    const stableLength = resolveMarkdownStreamStablePrefixLength(content);
    const totalLength = content.length;
    if (totalLength === previousTotalLength && stableLength === previousStableLength) {
        return undefined;
    }
    let frozenHtml: string | undefined;
    let nextFrozenCache: TranscriptStreamingFrozenCache | undefined;
    if (stableLength !== previousStableLength) {
        const canAppend = frozenCache !== undefined
            && frozenCache.stableLength === previousStableLength
            && frozenCache.stableLength <= stableLength;
        frozenHtml = canAppend
            ? frozenCache!.frozenHtml + renderHtml(content.slice(frozenCache!.stableLength, stableLength))
            : renderHtml(content.slice(0, stableLength));
        nextFrozenCache = { stableLength, frozenHtml };
    }
    return {
        stableLength,
        totalLength,
        ...(frozenHtml !== undefined ? { frozenHtml } : {}),
        tailHtml: renderHtml(content.slice(stableLength)),
        ...(nextFrozenCache !== undefined ? { nextFrozenCache } : {}),
    };
}
