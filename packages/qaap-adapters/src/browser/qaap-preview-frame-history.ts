// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * In-memory back/forward stack for preview iframes driven by `src` assignment
 * (and same-origin in-frame navigations observed via `load`).
 */
export class QaapPreviewFrameHistory {
    protected entries: string[] = [];
    protected index = -1;
    /** True while applying back/forward so the resulting load does not push again. */
    protected applyingHistoryNav = false;

    canGoBack(): boolean {
        return this.index > 0;
    }

    canGoForward(): boolean {
        return this.index >= 0 && this.index < this.entries.length - 1;
    }

    current(): string | undefined {
        return this.index >= 0 ? this.entries[this.index] : undefined;
    }

    /**
     * Records a visited URL. No-ops while applying back/forward, for blanks, or
     * when the URL matches the current entry.
     */
    record(url: string): void {
        if (this.applyingHistoryNav) {
            return;
        }
        const next = url.trim();
        if (!next || next === 'about:blank') {
            return;
        }
        if (this.index >= 0 && this.entries[this.index] === next) {
            return;
        }
        this.entries = this.entries.slice(0, this.index + 1);
        this.entries.push(next);
        this.index = this.entries.length - 1;
    }

    back(): string | undefined {
        if (!this.canGoBack()) {
            return undefined;
        }
        this.index -= 1;
        this.applyingHistoryNav = true;
        return this.entries[this.index];
    }

    forward(): string | undefined {
        if (!this.canGoForward()) {
            return undefined;
        }
        this.index += 1;
        this.applyingHistoryNav = true;
        return this.entries[this.index];
    }

    /** Call after a back/forward load has been applied (or failed). */
    finishHistoryNav(): void {
        this.applyingHistoryNav = false;
    }

    get isApplyingHistoryNav(): boolean {
        return this.applyingHistoryNav;
    }
}
