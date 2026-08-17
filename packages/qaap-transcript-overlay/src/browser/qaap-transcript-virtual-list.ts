// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import { isTranscriptDocumentVisible } from '../common/qaap-transcript-document-visibility';
import {
    formatTranscriptGpuLayerTransform,
    TRANSCRIPT_GPU_LAYER_CLASS,
} from '../common/qaap-transcript-gpu-compositor';
import {
    buildVirtualListOffsets,
    resolveVirtualListVisibleRange,
} from '../common/qaap-transcript-virtual-list-math';
import { TRANSCRIPT_SCROLL_TO_BOTTOM_NEAR_BOTTOM_PX } from '../common/qaap-transcript-scroll-to-bottom';
import { getTranscriptScrollController } from './qaap-transcript-scroll-controller';

export {
    TRANSCRIPT_VIRTUAL_MIN_MESSAGES,
    TRANSCRIPT_VIRTUAL_MIN_MESSAGES_NARROW,
} from '../common/qaap-transcript-virtual-list-policy';

// Agent turns (with tool output) dominate transcript height and run far taller than a chat line,
// so a low estimate makes the virtualized total swing as rows measure. ~200px is closer to the
// observed per-row average and keeps scroll-up more stable for the long threads that still virtualize.
export const TRANSCRIPT_VIRTUAL_DEFAULT_ITEM_HEIGHT = 200;
export const TRANSCRIPT_VIRTUAL_OVERSCAN_PX = 480;
/**
 * Coalescing window for height remeasurements. During token streaming, content reflows
 * fire ResizeObserver many times per second; without throttling, each fires a
 * `getBoundingClientRect()` over every visible row and a relayout, forcing layout
 * thrash. 100ms keeps the perceived scroll-pin smooth without backlogging measurements.
 */
export const TRANSCRIPT_VIRTUAL_MEASURE_THROTTLE_MS = 100;

export type TranscriptVirtualListRenderFn = (index: number) => HTMLElement;

export interface TranscriptVirtualListOptions {
    readonly scrollHost: HTMLElement;
    readonly defaultItemHeight?: number;
    readonly overscanPx?: number;
    readonly renderItem: TranscriptVirtualListRenderFn;
}

/**
 * Windowed transcript renderer — only mounts rows in (or near) the viewport.
 * The scroll host keeps native overflow so touch scroll and scroll-pin still work.
 *
 * Scroll frames are O(log n): prefix offsets are cached and rebuilt only when a
 * size actually changes, and row remeasurement (forced layout reads) runs only
 * when rows were just mounted or content reflowed — never on plain scrolling.
 *
 * Window/footer offsets use a GPU compositor translate (`translate3d`) so
 * scrolling does not invalidate paint of the mounted rows.
 */
export class TranscriptVirtualList implements Disposable {
    protected readonly defaultItemHeight: number;
    protected readonly overscanPx: number;
    protected readonly renderItem: TranscriptVirtualListRenderFn;
    protected readonly root: HTMLElement;
    protected readonly spacer: HTMLElement;
    protected readonly window: HTMLElement;
    protected readonly footerHost: HTMLElement;
    protected readonly scrollHost: HTMLElement;
    protected readonly mounted = new Map<number, HTMLElement>();
    protected sizes: number[] = [];
    protected offsets: readonly number[] = [0];
    protected offsetsDirty = false;
    protected footerHeight = 0;
    protected itemCount = 0;
    protected disposed = false;
    protected rafId = 0;
    protected measureRafId = 0;
    protected measureRequested = true;
    protected measureTimeoutId: ReturnType<typeof setTimeout> | undefined;
    protected lastMeasureRanAt = 0;
    protected pendingWhileHidden = false;
    /**
     * Set by content-driven mutations only (item count, footer, measured row heights) so the
     * next `update()` re-asserts follow-tail. Never set from the scroll listener: `update()`
     * runs on scroll, and a follow write emits a scroll event, so an unconditional re-assert
     * loops at frame rate.
     */
    protected followReassertRequested = false;
    protected scrollListener: () => void;
    protected resizeObserver: ResizeObserver | undefined;
    protected visibilityListener: (() => void) | undefined;

    constructor(options: TranscriptVirtualListOptions) {
        this.scrollHost = options.scrollHost;
        this.defaultItemHeight = options.defaultItemHeight ?? TRANSCRIPT_VIRTUAL_DEFAULT_ITEM_HEIGHT;
        this.overscanPx = options.overscanPx ?? TRANSCRIPT_VIRTUAL_OVERSCAN_PX;
        this.renderItem = options.renderItem;

        this.root = document.createElement('div');
        this.root.className = 'theia-transcript-virtual-root';

        this.spacer = document.createElement('div');
        this.spacer.className = 'theia-transcript-virtual-spacer';

        this.window = document.createElement('div');
        this.window.className = `theia-transcript-virtual-window ${TRANSCRIPT_GPU_LAYER_CLASS}`;

        this.footerHost = document.createElement('div');
        this.footerHost.className = `theia-transcript-virtual-footer ${TRANSCRIPT_GPU_LAYER_CLASS}`;

        this.spacer.append(this.window, this.footerHost);
        this.root.append(this.spacer);
        this.scrollHost.replaceChildren(this.root);

        this.scrollListener = () => this.scheduleUpdate();
        this.scrollHost.addEventListener('scroll', this.scrollListener, { passive: true });

        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => this.scheduleMeasure());
            this.resizeObserver.observe(this.window);
        }

        if (typeof document !== 'undefined') {
            this.visibilityListener = () => {
                if (isTranscriptDocumentVisible() && this.pendingWhileHidden) {
                    this.pendingWhileHidden = false;
                    this.followReassertRequested = true;
                    this.scheduleUpdate();
                }
            };
            document.addEventListener('visibilitychange', this.visibilityListener);
        }
    }

    get active(): boolean {
        return !this.disposed && this.itemCount > 0;
    }

    setItemCount(count: number, resetSizes = false): void {
        this.itemCount = Math.max(0, count);
        if (resetSizes || this.sizes.length !== count) {
            this.sizes = Array.from({ length: count }, (_, index) => resetSizes ? 0 : this.sizes[index] ?? 0);
            this.offsetsDirty = true;
            this.measureRequested = true;
        }
        this.followReassertRequested = true;
        this.scheduleUpdate();
    }

    setFooter(children: readonly HTMLElement[]): void {
        // Streaming patches refresh the footer on every tick. Most agent-tail updates have no
        // footer at all, so avoid replaceChildren() and its follow-up measurement/layout work
        // when the footer node set is already identical.
        const currentChildren = this.footerHost.children;
        if (children.length === currentChildren.length
            && children.every((child, index) => currentChildren[index] === child)) {
            return;
        }
        this.footerHost.replaceChildren(...children);
        this.measureRequested = true;
        this.followReassertRequested = true;
        this.scheduleUpdate();
    }

    scrollToEnd(): void {
        if (this.offsetsDirty || this.offsets.length !== this.sizes.length + 1) {
            this.offsets = buildVirtualListOffsets(this.sizes, this.defaultItemHeight);
            this.offsetsDirty = false;
        }
        const estimatedHeight = this.offsets[this.offsets.length - 1] ?? 0;
        if (estimatedHeight > 0) {
            this.spacer.style.height = `${estimatedHeight + this.footerHeight}px`;
        }
        getTranscriptScrollController(this.scrollHost)?.markProgrammaticScroll();
        this.scrollHost.scrollTop = this.scrollHost.scrollHeight;
    }

    scrollToIndex(index: number, contextPx = 64): void {
        if (this.offsetsDirty || this.offsets.length !== this.sizes.length + 1) {
            this.offsets = buildVirtualListOffsets(this.sizes, this.defaultItemHeight);
            this.offsetsDirty = false;
        }
        const safeIndex = Math.max(0, Math.min(index, Math.max(0, this.itemCount - 1)));
        const estimatedTop = this.offsets[safeIndex] ?? safeIndex * this.defaultItemHeight;
        getTranscriptScrollController(this.scrollHost)?.markProgrammaticScroll();
        this.scrollHost.scrollTop = Math.max(0, estimatedTop - contextPx);
        this.scheduleUpdate();
    }

    isNearBottom(thresholdPx = TRANSCRIPT_SCROLL_TO_BOTTOM_NEAR_BOTTOM_PX): boolean {
        const distance = this.scrollHost.scrollHeight - this.scrollHost.scrollTop - this.scrollHost.clientHeight;
        return distance <= thresholdPx;
    }

    findRowByAttribute(attr: string, value: string): HTMLElement | undefined {
        return this.window.querySelector<HTMLElement>(`[${attr}="${CSS.escape(value)}"]`) ?? undefined;
    }

    replaceRowByAttribute(attr: string, value: string, row: HTMLElement): boolean {
        const existing = this.findRowByAttribute(attr, value);
        if (!existing) {
            return false;
        }
        const parent = existing.parentElement;
        const indexAttr = existing.getAttribute('data-virtual-index');
        existing.replaceWith(row);
        if (indexAttr !== null) {
            const index = Number(indexAttr);
            if (!Number.isNaN(index)) {
                this.mounted.set(index, row);
                row.setAttribute('data-virtual-index', String(index));
                this.scheduleMeasure();
            }
        }
        if (parent) {
            this.scheduleUpdate();
        }
        return true;
    }

    appendRow(row: HTMLElement, index: number): void {
        row.setAttribute('data-virtual-index', String(index));
        this.window.append(row);
        this.mounted.set(index, row);
        this.itemCount = Math.max(this.itemCount, index + 1);
        if (this.sizes.length < this.itemCount) {
            this.sizes = [...this.sizes, ...Array.from({ length: this.itemCount - this.sizes.length }, () => 0)];
            this.offsetsDirty = true;
        }
        this.scheduleMeasure();
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = 0;
        }
        if (this.measureRafId) {
            cancelAnimationFrame(this.measureRafId);
            this.measureRafId = 0;
        }
        if (this.measureTimeoutId !== undefined) {
            clearTimeout(this.measureTimeoutId);
            this.measureTimeoutId = undefined;
        }
        this.scrollHost.removeEventListener('scroll', this.scrollListener);
        this.resizeObserver?.disconnect();
        if (this.visibilityListener) {
            document.removeEventListener('visibilitychange', this.visibilityListener);
            this.visibilityListener = undefined;
        }
        this.mounted.clear();
    }

    protected shouldPauseBackgroundWork(): boolean {
        return !isTranscriptDocumentVisible();
    }

    protected scheduleUpdate(): void {
        if (this.disposed || this.rafId) {
            return;
        }
        if (this.shouldPauseBackgroundWork()) {
            this.pendingWhileHidden = true;
            return;
        }
        this.pendingWhileHidden = false;
        this.rafId = requestAnimationFrame(() => {
            this.rafId = 0;
            this.update();
        });
    }

    /**
     * True while a streaming agent row is mounted — its height can grow every
     * token and must expand the spacer before absolute content paints over the
     * scroller-tail live-status sibling.
     */
    protected hasMountedStreamingRow(): boolean {
        for (const row of this.mounted.values()) {
            if (row.classList.contains('theia-mod-streaming')) {
                return true;
            }
        }
        return false;
    }

    /**
     * Force a measure pass on the next animation frame (clears any pending
     * throttle). Call after in-place streaming patches that grow row height.
     */
    requestMeasureImmediate(): void {
        if (this.disposed) {
            return;
        }
        if (this.shouldPauseBackgroundWork()) {
            this.measureRequested = true;
            this.pendingWhileHidden = true;
            return;
        }
        this.measureRequested = true;
        if (this.measureTimeoutId !== undefined) {
            clearTimeout(this.measureTimeoutId);
            this.measureTimeoutId = undefined;
        }
        this.lastMeasureRanAt = Date.now();
        this.scheduleUpdate();
    }

    /**
     * Throttled remeasure path used by ResizeObserver and content swaps during streaming.
     * Bursts of reflow events coalesce into one `scheduleUpdate()` per
     * `TRANSCRIPT_VIRTUAL_MEASURE_THROTTLE_MS` window, avoiding layout thrash on every
     * token delta. Scroll handling stays on its own RAF path and remains snappy.
     *
     * While a `theia-mod-streaming` row is mounted, skip the throttle so the
     * spacer keeps up with absolute-positioned content and does not overflow
     * onto the in-flow live-status row below the virtual root.
     */
    protected scheduleMeasure(): void {
        if (this.disposed) {
            return;
        }
        if (this.shouldPauseBackgroundWork()) {
            this.measureRequested = true;
            this.pendingWhileHidden = true;
            return;
        }
        this.measureRequested = true;
        if (this.hasMountedStreamingRow()) {
            this.requestMeasureImmediate();
            return;
        }
        if (this.measureTimeoutId !== undefined) {
            return;
        }
        const now = Date.now();
        const elapsed = now - this.lastMeasureRanAt;
        const delay = elapsed >= TRANSCRIPT_VIRTUAL_MEASURE_THROTTLE_MS
            ? 0
            : TRANSCRIPT_VIRTUAL_MEASURE_THROTTLE_MS - elapsed;
        this.measureTimeoutId = setTimeout(() => {
            this.measureTimeoutId = undefined;
            this.lastMeasureRanAt = Date.now();
            this.scheduleUpdate();
        }, delay);
    }

    protected update(): void {
        if (this.disposed) {
            return;
        }
        if (this.shouldPauseBackgroundWork()) {
            this.pendingWhileHidden = true;
            return;
        }
        this.pendingWhileHidden = false;
        // Consume here, past the pause guard, so a deferred update still re-asserts.
        const reassertFollow = this.followReassertRequested;
        this.followReassertRequested = false;
        if (this.offsetsDirty || this.offsets.length !== this.sizes.length + 1) {
            this.offsets = buildVirtualListOffsets(this.sizes, this.defaultItemHeight);
            this.offsetsDirty = false;
        }
        const range = resolveVirtualListVisibleRange(
            this.scrollHost.scrollTop,
            this.scrollHost.clientHeight,
            this.offsets,
            this.overscanPx,
        );
        this.window.style.transform = formatTranscriptGpuLayerTransform(range.windowOffset);
        this.footerHost.style.transform = formatTranscriptGpuLayerTransform(range.totalHeight);

        let mountedNew = false;
        const nextMounted = new Set<number>();
        for (let index = range.startIndex; index <= range.endIndex; index++) {
            nextMounted.add(index);
            let row = this.mounted.get(index);
            if (!row || !row.isConnected) {
                row = this.renderItem(index);
                row.setAttribute('data-virtual-index', String(index));
                this.mounted.set(index, row);
                mountedNew = true;
            }
            if (!row.parentElement) {
                this.window.append(row);
                mountedNew = true;
            }
        }

        for (const [index, row] of this.mounted) {
            if (!nextMounted.has(index)) {
                row.remove();
                this.mounted.delete(index);
            }
        }

        this.spacer.style.height = `${range.totalHeight + this.footerHeight}px`;

        // Re-assert the glue, but ONLY for content-driven updates. Resizing the spacer changes
        // the scrollable range without moving the viewport, so a reader who never detached can
        // be stranded away from the live edge — the browser clamps scrollTop when a remount
        // shrinks the spacer, and `measureMounted` only chases on row-height deltas, which that
        // path does not produce.
        //
        // This MUST NOT run on scroll-driven updates: `update()` is wired to the scroll event,
        // and a follow write emits a scroll event, so re-asserting unconditionally builds a
        // self-sustaining 60fps write loop (the "already glued" guard cannot break it while
        // streaming keeps the tail moving). Strictly gated on the follow phase too: while
        // detached this would cancel a queued preserve-anchor and lose the reading position.
        if (reassertFollow) {
            const scrollController = getTranscriptScrollController(this.scrollHost);
            if (scrollController?.shouldFollowTail()) {
                scrollController.onContentChanged(this.scrollHost);
            }
        }

        // Forced layout reads only when row content may have changed — plain
        // scroll frames stay write-only and never trigger a synchronous reflow.
        // A pending measure RAF covers rows mounted afterwards too, because the
        // measure pass walks whatever is mounted when it runs.
        if (mountedNew || this.measureRequested) {
            this.measureRequested = false;
            if (!this.measureRafId) {
                this.measureRafId = requestAnimationFrame(() => {
                    this.measureRafId = 0;
                    this.measureMounted();
                });
            }
        }
    }

    protected measureMounted(): void {
        if (this.disposed) {
            return;
        }
        if (this.shouldPauseBackgroundWork()) {
            this.measureRequested = true;
            this.pendingWhileHidden = true;
            return;
        }
        const scrollTop = this.scrollHost.scrollTop;
        let changed = false;
        let deltaAboveViewport = 0;
        const streamingTailActive = [...this.mounted.values()].some(row =>
            row.classList.contains('theia-mod-streaming'),
        );
        for (const [index, row] of this.mounted) {
            if (streamingTailActive && !row.classList.contains('theia-mod-streaming')) {
                continue;
            }
            const height = Math.ceil(row.getBoundingClientRect().height);
            if (height > 0 && this.sizes[index] !== height) {
                // Rows fully above the viewport shift everything below them when
                // corrected; track the delta so the scroll position can be anchored.
                if ((this.offsets[index + 1] ?? 0) <= scrollTop) {
                    const previous = this.sizes[index] > 0 ? this.sizes[index] : this.defaultItemHeight;
                    deltaAboveViewport += height - previous;
                }
                this.sizes[index] = height;
                this.offsetsDirty = true;
                changed = true;
            }
        }
        const footerHeight = this.footerHost.offsetHeight;
        if (footerHeight !== this.footerHeight) {
            this.footerHeight = footerHeight;
            changed = true;
        }
        if (!changed) {
            return;
        }
        // Measured row heights moved: a content-driven reflow, so let update() re-assert follow.
        this.followReassertRequested = true;
        this.update();
        if (deltaAboveViewport !== 0) {
            const scrollController = getTranscriptScrollController(this.scrollHost);
            // Live-edge follow wins — coalesce with render-layer follow instead of fighting delta.
            if (scrollController?.shouldFollowTail()) {
                scrollController.onContentChanged(this.scrollHost);
                return;
            }
            // Defer height correction while a preserve pass is already queued for this frame.
            if (scrollController?.isPreserveAnchorPending()) {
                return;
            }
            scrollController?.markProgrammaticScroll();
            this.scrollHost.scrollTop = scrollTop + deltaAboveViewport;
        }
    }
}
