// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { QaapTenantUpdateClient, type QaapTenantUpdateStatus } from '@theia/qaap-shared-core/lib/browser/qaap-tenant-update-client';
import { QaapTenantUpdateConfirmDialog } from './qaap-tenant-update-confirm-dialog';

/** How often the status is re-read while the page stays open. */
export const QAAP_TENANT_UPDATE_POLL_MS = 5 * 60_000;
/** How long "Updating…" waits for the recreated backend before it reloads anyway. */
export const QAAP_TENANT_UPDATE_RECOVERY_TIMEOUT_MS = 60_000;
const RECOVERY_STEP_MS = 1_000;

/** Clock and timers, injectable so the flow can be exercised without real waits. */
export interface QaapTenantUpdateTimers {
    now(): number;
    setInterval(callback: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
    delay(ms: number): Promise<void>;
}

export type QaapTenantUpdatePhase = 'idle' | 'updating' | 'failed';

export interface QaapTenantUpdateState {
    /** Last status the control plane answered; `undefined` until the first successful read. */
    readonly status: QaapTenantUpdateStatus | undefined;
    readonly phase: QaapTenantUpdatePhase;
}

const defaultTimers: QaapTenantUpdateTimers = {
    now: () => Date.now(),
    setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
    clearInterval: handle => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
    delay: ms => new Promise(resolve => globalThis.setTimeout(resolve, ms)),
};

/**
 * Keeps the "A new version of Qaap is ready" state: polls the control plane on start, every few
 * minutes and when the tab becomes visible again, and applies the update on request. A deploy
 * never interrupts a turn; the user decides when the new version starts.
 */
@injectable()
export class QaapTenantUpdateService {

    @inject(QaapTenantUpdateClient)
    protected readonly client: QaapTenantUpdateClient;

    @inject(QaapTenantUpdateConfirmDialog)
    protected readonly confirmDialog: QaapTenantUpdateConfirmDialog;

    protected readonly onDidChangeStateEmitter = new Emitter<QaapTenantUpdateState>();
    readonly onDidChangeState: Event<QaapTenantUpdateState> = this.onDidChangeStateEmitter.event;

    protected state: QaapTenantUpdateState = { status: undefined, phase: 'idle' };
    protected pollHandle: unknown;
    protected visibilityListener: (() => void) | undefined;
    /** Test seam: the browser uses the real clock; specs replace it. */
    protected timers: QaapTenantUpdateTimers = defaultTimers;

    getState(): QaapTenantUpdateState {
        return this.state;
    }

    /** Idempotent: starts polling, a visibility refresh and an immediate status read. */
    start(): void {
        if (this.pollHandle === undefined) {
            this.pollHandle = this.timers.setInterval(() => void this.refresh(), QAAP_TENANT_UPDATE_POLL_MS);
        }
        if (this.visibilityListener === undefined && typeof document !== 'undefined') {
            const listener = (): void => {
                if (document.visibilityState === 'visible') {
                    void this.refresh();
                }
            };
            this.visibilityListener = listener;
            document.addEventListener('visibilitychange', listener);
        }
        void this.refresh();
    }

    stop(): void {
        if (this.pollHandle !== undefined) {
            this.timers.clearInterval(this.pollHandle);
            this.pollHandle = undefined;
        }
        if (this.visibilityListener !== undefined && typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.visibilityListener);
        }
        this.visibilityListener = undefined;
    }

    /** Re-reads the status. Silent on failure: the last known state stays on screen. */
    async refresh(): Promise<void> {
        try {
            const status = await this.client.fetchStatus();
            this.setState({ status });
        } catch {
            // Offline or signed out: nothing to tell the user.
        }
    }

    /**
     * "Update now". Asks first when agent turns are running, then recreates the backend and reloads
     * the page once it answers without a pending update (or after {@link QAAP_TENANT_UPDATE_RECOVERY_TIMEOUT_MS}).
     */
    async updateNow(): Promise<void> {
        if (this.state.phase === 'updating') {
            return;
        }
        const runningTasks = this.state.status?.runningTasks ?? 0;
        if (runningTasks > 0 && !await this.confirmDialog.confirm(runningTasks)) {
            return;
        }
        this.setState({ phase: 'updating' });
        let applied: boolean;
        try {
            applied = await this.client.applyUpdate();
        } catch {
            this.setState({ phase: 'failed' });
            return;
        }
        if (!applied) {
            // Nothing was stale any more (another tab or a previous attempt applied it).
            this.setState({ phase: 'idle' });
            await this.refresh();
            return;
        }
        await this.waitForRecovery();
        this.reloadPage();
    }

    /** Protected so specs can observe the reload instead of performing it. */
    protected reloadPage(): void {
        globalThis.location.reload();
    }

    protected async waitForRecovery(): Promise<void> {
        const deadline = this.timers.now() + QAAP_TENANT_UPDATE_RECOVERY_TIMEOUT_MS;
        while (this.timers.now() < deadline) {
            await this.timers.delay(RECOVERY_STEP_MS);
            try {
                const status = await this.client.fetchStatus();
                this.setState({ status });
                if (!status.updateAvailable) {
                    return;
                }
            } catch {
                // The backend is still starting: keep polling until the deadline.
            }
        }
    }

    protected setState(change: Partial<QaapTenantUpdateState>): void {
        this.state = { ...this.state, ...change };
        this.onDidChangeStateEmitter.fire(this.state);
    }
}
