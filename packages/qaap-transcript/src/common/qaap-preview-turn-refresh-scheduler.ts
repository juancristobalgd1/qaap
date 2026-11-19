// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Quiet time after a turn settles before the preview is refreshed; a chained turn postpones it. */
export const QAAP_PREVIEW_TURN_REFRESH_DEBOUNCE_MS = 1500;
/** Slack for the browser/workspace clock difference when comparing file mtimes to the turn start. */
export const QAAP_PREVIEW_TURN_REFRESH_CLOCK_SLACK_MS = 2000;
/** Retries while a refresh must wait (e.g. an in-frame visual capture is still running). */
export const QAAP_PREVIEW_TURN_REFRESH_MAX_DEFERRALS = 20;

export interface QaapPreviewTurnRefreshSummary {
    readonly id: string;
    readonly cwd: string;
    readonly status: string;
}

export interface QaapPreviewTurnRefreshSchedulerOptions {
    readonly debounceMs?: number;
    readonly now: () => number;
    readonly setTimer: (callback: () => void, ms: number) => unknown;
    readonly clearTimer: (handle: unknown) => void;
    /** Refreshes the project's preview for the turns that ran since `since`; `'defer'` retries later. */
    readonly run: (cwd: string, since: number) => Promise<void | 'defer'>;
}

/**
 * Turns conversation status snapshots into one debounced preview refresh per project folder:
 * a turn settling (streaming → anything else) schedules it, a turn starting in the same folder
 * postpones it, and chained turns collapse into a single refresh covering all their changes.
 */
export class QaapPreviewTurnRefreshScheduler {
    protected readonly statusById = new Map<string, string>();
    protected readonly sinceByCwd = new Map<string, number>();
    protected readonly timerByCwd = new Map<string, unknown>();
    protected readonly deferralsByCwd = new Map<string, number>();
    protected streamingCwds = new Set<string>();

    constructor(protected readonly options: QaapPreviewTurnRefreshSchedulerOptions) { }

    observe(summaries: readonly QaapPreviewTurnRefreshSummary[]): void {
        this.streamingCwds = new Set(summaries.filter(summary => summary.status === 'streaming').map(summary => summary.cwd));
        for (const summary of summaries) {
            const previous = this.statusById.get(summary.id);
            this.statusById.set(summary.id, summary.status);
            if (summary.status === 'streaming' && previous !== 'streaming') {
                const startedAt = this.options.now() - QAAP_PREVIEW_TURN_REFRESH_CLOCK_SLACK_MS;
                const known = this.sinceByCwd.get(summary.cwd);
                this.sinceByCwd.set(summary.cwd, known === undefined ? startedAt : Math.min(known, startedAt));
                this.cancel(summary.cwd);
            } else if (previous === 'streaming' && summary.status !== 'streaming' && this.sinceByCwd.has(summary.cwd)) {
                this.schedule(summary.cwd);
            }
        }
    }

    dispose(): void {
        for (const cwd of [...this.timerByCwd.keys()]) {
            this.cancel(cwd);
        }
    }

    protected schedule(cwd: string): void {
        this.cancel(cwd);
        this.timerByCwd.set(cwd, this.options.setTimer(() => void this.fire(cwd), this.options.debounceMs ?? QAAP_PREVIEW_TURN_REFRESH_DEBOUNCE_MS));
    }

    protected cancel(cwd: string): void {
        const handle = this.timerByCwd.get(cwd);
        if (handle !== undefined) {
            this.options.clearTimer(handle);
            this.timerByCwd.delete(cwd);
        }
    }

    protected async fire(cwd: string): Promise<void> {
        this.timerByCwd.delete(cwd);
        if (this.streamingCwds.has(cwd)) {
            // Another turn in this folder is running: its settle schedules the combined refresh.
            return;
        }
        const since = this.sinceByCwd.get(cwd);
        if (since === undefined) {
            return;
        }
        let outcome: void | 'defer';
        try {
            outcome = await this.options.run(cwd, since);
        } catch (error) {
            console.warn('[qaap-preview-refresh] refresh after turn failed:', error);
            outcome = undefined;
        }
        if (outcome === 'defer') {
            const deferrals = (this.deferralsByCwd.get(cwd) ?? 0) + 1;
            this.deferralsByCwd.set(cwd, deferrals);
            if (deferrals <= QAAP_PREVIEW_TURN_REFRESH_MAX_DEFERRALS) {
                this.schedule(cwd);
                return;
            }
        }
        this.deferralsByCwd.delete(cwd);
        // A turn that started while this refresh ran owns the newer changes; keep its start time.
        if (this.sinceByCwd.get(cwd) === since && !this.streamingCwds.has(cwd)) {
            this.sinceByCwd.delete(cwd);
        }
    }
}
