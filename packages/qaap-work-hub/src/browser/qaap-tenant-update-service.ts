// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Emitter, type Event } from '@theia/core/lib/common/event';
import {
    QaapTenantUpdateClient,
    type QaapTenantBackendUpdate,
} from '@theia/qaap-shared-core/lib/browser/qaap-tenant-update-client';
import { QaapTenantUpdateConfirmDialog } from './qaap-tenant-update-confirm-dialog';

/** How long "Updating…" waits for the recreated backend to stop reporting a pending update before it reloads anyway. */
export const QAAP_TENANT_UPDATE_RECOVERY_TIMEOUT_MS = 60_000;
const RECOVERY_STEP_MS = 1_000;

/**
 * How a "Update now" request ended:
 * - `applied`: the backend was recreated and the page is reloading;
 * - `cancelled`: the user declined the interruption of running agent turns;
 * - `nothing`: the control plane had nothing to apply (the status is stale);
 * - `failed`: the request failed; the caller restores its control and says so.
 */
export type QaapTenantUpdateOutcome = 'applied' | 'cancelled' | 'nothing' | 'failed';

/** Clock and delay, injectable so the recovery wait runs without real time passing. */
export interface QaapTenantUpdateTimers {
    now(): number;
    delay(ms: number): Promise<void>;
}

const defaultTimers: QaapTenantUpdateTimers = {
    now: () => Date.now(),
    delay: ms => new Promise(resolve => globalThis.setTimeout(resolve, ms)),
};

/**
 * Applies the pending Qaap build on request, for the sessions sidebar's "Update now" chip. It owns the
 * whole action (confirm when turns run, apply, wait for the backend, reload) and nothing else: "is an
 * update pending" is read from the runtime status by the caller, the one source of that state.
 */
export class QaapTenantUpdateService {

    protected readonly onDidStartApplyingEmitter = new Emitter<void>();
    /** Fired once the user confirmed (or no confirmation was needed) and the request is sent. */
    readonly onDidStartApplying: Event<void> = this.onDidStartApplyingEmitter.event;

    protected inFlight: Promise<QaapTenantUpdateOutcome> | undefined;

    constructor(
        protected readonly client: QaapTenantUpdateClient = new QaapTenantUpdateClient(),
        protected readonly confirmDialog: QaapTenantUpdateConfirmDialog = new QaapTenantUpdateConfirmDialog(),
        protected readonly timers: QaapTenantUpdateTimers = defaultTimers,
    ) { }

    readBackendUpdate(): Promise<QaapTenantBackendUpdate | undefined> {
        return this.client.fetchBackendUpdate();
    }

    /** Concurrent calls share the run already in progress, so the backend is recreated once. */
    updateNow(runningTasks: number): Promise<QaapTenantUpdateOutcome> {
        this.inFlight ??= this.runUpdate(runningTasks).finally(() => {
            this.inFlight = undefined;
        });
        return this.inFlight;
    }

    protected async runUpdate(runningTasks: number): Promise<QaapTenantUpdateOutcome> {
        if (runningTasks > 0 && !await this.confirmDialog.confirm(runningTasks)) {
            return 'cancelled';
        }
        this.onDidStartApplyingEmitter.fire();
        let applied: boolean;
        try {
            applied = await this.client.applyUpdate();
        } catch {
            return 'failed';
        }
        if (!applied) {
            return 'nothing';
        }
        await this.waitForRecovery();
        this.reloadPage();
        return 'applied';
    }

    /** Protected so specs can observe the reload instead of performing it. */
    protected reloadPage(): void {
        globalThis.location.reload();
    }

    /** Polls the runtime status until the update is no longer pending, or the timeout passes. */
    protected async waitForRecovery(): Promise<void> {
        const deadline = this.timers.now() + QAAP_TENANT_UPDATE_RECOVERY_TIMEOUT_MS;
        while (this.timers.now() < deadline) {
            await this.timers.delay(RECOVERY_STEP_MS);
            try {
                const update = await this.client.fetchBackendUpdate();
                if (!update?.updatePending) {
                    return;
                }
            } catch {
                // The backend is still starting: keep polling until the deadline.
            }
        }
    }
}
