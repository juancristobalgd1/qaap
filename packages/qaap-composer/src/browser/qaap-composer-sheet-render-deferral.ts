// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Sheet / popover slots of the sticky and transcript composers. Desktop popovers are anchored to a
 * composer toolbar button and dismiss themselves once that anchor leaves the DOM, so ANY rebuild of
 * the composer (`renderStickyComposer`, `remountTranscriptStickyComposer`) while one is open closes
 * it "by itself" a few seconds after the user opened it.
 */
export interface ComposerSheetSlots {
    readonly stickyComposerAgentSheet?: HTMLElement | undefined;
    readonly stickyComposerModeSheet?: HTMLElement | undefined;
    readonly stickyComposerApprovalSheet?: HTMLElement | undefined;
    readonly stickyComposerWorkspaceSheet?: HTMLElement | undefined;
    readonly stickyComposerContextUsageSheet?: HTMLElement | undefined;
    readonly stickyComposerCapabilitySheet?: HTMLElement | undefined;
    readonly transcriptComposerAgentSheet?: HTMLElement | undefined;
    readonly transcriptComposerQaiqModelSheet?: HTMLElement | undefined;
    readonly transcriptComposerModeSheet?: HTMLElement | undefined;
    readonly transcriptComposerApprovalSheet?: HTMLElement | undefined;
}

const COMPOSER_SHEET_SLOTS: readonly (keyof ComposerSheetSlots)[] = [
    'stickyComposerAgentSheet',
    'stickyComposerModeSheet',
    'stickyComposerApprovalSheet',
    'stickyComposerWorkspaceSheet',
    'stickyComposerContextUsageSheet',
    'stickyComposerCapabilitySheet',
    'transcriptComposerAgentSheet',
    'transcriptComposerQaiqModelSheet',
    'transcriptComposerModeSheet',
    'transcriptComposerApprovalSheet',
];

/** A slot only counts while its element is still in the document (stale slots never block renders). */
export function isComposerSheetOpen(slots: ComposerSheetSlots): boolean {
    return COMPOSER_SHEET_SLOTS.some(slot => slots[slot]?.isConnected === true);
}

export type ComposerRenderKind = 'render' | 'remount';

/**
 * Defers background composer rebuilds while a picker is open and replays them once it closes.
 * User-initiated renders are unaffected: picker handlers close the sheet before re-rendering.
 */
export class ComposerSheetRenderDeferral {

    protected pendingRender = false;
    protected pendingRemount = false;
    protected flushScheduled = false;

    constructor(
        protected readonly isSheetOpen: () => boolean,
        protected readonly replay: (kind: ComposerRenderKind) => void,
        protected readonly enqueue: (task: () => void) => void = task => queueMicrotask(task),
    ) { }

    /**
     * `true` when the caller must skip its rebuild now (it is queued for replay). `false` lets the
     * caller proceed and drops any queued replay of the same kind, which this rebuild supersedes.
     */
    defer(kind: ComposerRenderKind): boolean {
        if (this.isSheetOpen()) {
            if (kind === 'render') {
                this.pendingRender = true;
            } else {
                this.pendingRemount = true;
            }
            return true;
        }
        if (kind === 'render') {
            this.pendingRender = false;
        } else {
            this.pendingRemount = false;
        }
        return false;
    }

    hasPending(): boolean {
        return this.pendingRender || this.pendingRemount;
    }

    /** Called after composer sheets close; replays queued rebuilds on the next microtask. */
    scheduleFlush(): void {
        if (!this.hasPending() || this.flushScheduled) {
            return;
        }
        this.flushScheduled = true;
        this.enqueue(() => {
            this.flushScheduled = false;
            this.flush();
        });
    }

    flush(): void {
        if (!this.hasPending() || this.isSheetOpen()) {
            return;
        }
        const remount = this.pendingRemount;
        const render = this.pendingRender;
        this.pendingRemount = false;
        this.pendingRender = false;
        if (remount) {
            this.replay('remount');
        }
        if (render) {
            this.replay('render');
        }
    }
}
