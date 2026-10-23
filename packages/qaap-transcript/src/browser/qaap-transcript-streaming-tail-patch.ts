// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { recordTranscriptRenderMetric } from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-render-metrics';
import { patchTranscriptMarkdownCodeBlockCard, TRANSCRIPT_CODE_BLOCK_CARD_CLASS } from './qaap-transcript-rich-content-ui';

/** Outcome of one {@link patchTranscriptStreamingTailHtml} call, for metrics and specs. */
export interface TranscriptStreamingTailPatchResult {
    /** Blocks whose sanitized HTML did not change: their (enhanced) DOM was kept as is. */
    readonly reused: number;
    /** Streaming code fences grown in place inside their existing code-block card. */
    readonly codePatched: number;
    /** Blocks swapped for freshly parsed nodes (still to be enhanced by the caller). */
    readonly replaced: number;
    /** `true` when the whole tail was re-set with `innerHTML` (first tick or unexpected DOM shape). */
    readonly fullReset: boolean;
}

/** Sanitized top-level block HTML last applied to each tail container. */
const tailBlockHtmlCache = new WeakMap<HTMLElement, readonly string[]>();

/**
 * Applies the worker's sanitized HTML for the open markdown tail block by block instead of a
 * blanket `tail.innerHTML =`. A block whose sanitized HTML matches the previous tick keeps its
 * DOM — including whatever {@link enhanceTranscriptMarkdownRichContent} turned it into, which is
 * a pure function of that HTML; a streaming fence whose code grew is patched line by line inside
 * its code-block card; anything else is replaced with the new parsed node.
 *
 * The previous tail must still have exactly one DOM child per cached block (rich enhancement is
 * 1:1 at the top level); a capture chip or any other foreign element breaks that, so the tail
 * falls back to a full reset, as does non-whitespace top-level text in the new HTML.
 */
export function patchTranscriptStreamingTailHtml(tail: HTMLElement, tailHtml: string): TranscriptStreamingTailPatchResult {
    const template = tail.ownerDocument.createElement('template');
    template.innerHTML = tailHtml;
    const nextBlocks = Array.from(template.content.children);
    const nextHtml = nextBlocks.map(block => block.outerHTML);
    const previousHtml = tailBlockHtmlCache.get(tail);
    const hasLooseText = Array.from(template.content.childNodes)
        .some(node => node.nodeType === node.TEXT_NODE && node.textContent?.trim());
    // Only element children are compared: markdown-it separates blocks with whitespace text nodes.
    if (!previousHtml || hasLooseText || tail.children.length !== previousHtml.length) {
        tail.innerHTML = tailHtml;
        if (hasLooseText) {
            tailBlockHtmlCache.delete(tail);
        } else {
            tailBlockHtmlCache.set(tail, nextHtml);
        }
        recordTranscriptRenderMetric('markdown_tail_full_reset');
        return { reused: 0, codePatched: 0, replaced: nextBlocks.length, fullReset: true };
    }

    const current = Array.from(tail.children) as HTMLElement[];
    let reused = 0;
    let codePatched = 0;
    let replaced = 0;
    for (let index = 0; index < nextBlocks.length; index++) {
        const next = nextBlocks[index];
        const existing = current[index];
        if (!existing) {
            tail.append(next);
            replaced++;
            continue;
        }
        if (previousHtml[index] === nextHtml[index]) {
            reused++;
            continue;
        }
        if (next.tagName === 'PRE'
            && existing.classList.contains(TRANSCRIPT_CODE_BLOCK_CARD_CLASS)
            && patchTranscriptMarkdownCodeBlockCard(existing, next as HTMLPreElement)) {
            codePatched++;
            continue;
        }
        existing.replaceWith(next);
        replaced++;
    }
    for (let index = current.length - 1; index >= nextBlocks.length; index--) {
        current[index].remove();
    }
    tailBlockHtmlCache.set(tail, nextHtml);
    if (reused > 0) {
        recordTranscriptRenderMetric('markdown_tail_block_reused');
    }
    if (codePatched > 0) {
        recordTranscriptRenderMetric('markdown_tail_code_patched');
    }
    if (replaced > 0) {
        recordTranscriptRenderMetric('markdown_tail_block_replaced');
    }
    return { reused, codePatched, replaced, fullReset: false };
}
