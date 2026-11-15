// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { qaapAuthenticatedFetchInit } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';

/** Control-plane route of the "Update now" status (GET) and action (POST); see `QaapTenantUpdateEndpoint`. */
export const QAAP_TENANT_UPDATE_PATH = '/qaap/api/tenant-update';

/** What the control plane knows about the signed-in user's backend update. */
export interface QaapTenantUpdateStatus {
    /** A newer serving image waits; applying it recreates the user's backend. */
    readonly updateAvailable: boolean;
    /** Agent turns running in the user's backend right now. */
    readonly runningTasks: number;
}

/** Thin HTTP client for {@link QAAP_TENANT_UPDATE_PATH}. Errors reject; callers decide what to show. */
@injectable()
export class QaapTenantUpdateClient {

    async fetchStatus(): Promise<QaapTenantUpdateStatus> {
        const response = await fetch(QAAP_TENANT_UPDATE_PATH, qaapAuthenticatedFetchInit());
        if (!response.ok) {
            throw new Error(`Tenant update status failed with HTTP ${response.status}.`);
        }
        return QaapTenantUpdateClient.parseStatus(await response.json());
    }

    /** Resolves `true` when the backend was recreated, `false` when there was nothing to apply. */
    async applyUpdate(): Promise<boolean> {
        const response = await fetch(QAAP_TENANT_UPDATE_PATH, qaapAuthenticatedFetchInit({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        }));
        if (!response.ok) {
            throw new Error(`Tenant update failed with HTTP ${response.status}.`);
        }
        const body = await response.json() as { applied?: unknown };
        return body.applied === true;
    }

    /** Tolerates missing or mistyped fields: anything but an explicit `true` / positive count means "no update" / "0 turns". */
    static parseStatus(body: unknown): QaapTenantUpdateStatus {
        const record = (body && typeof body === 'object' ? body : {}) as { updateAvailable?: unknown; runningTasks?: unknown };
        const runningTasks = typeof record.runningTasks === 'number' && Number.isFinite(record.runningTasks) && record.runningTasks > 0
            ? Math.floor(record.runningTasks)
            : 0;
        return { updateAvailable: record.updateAvailable === true, runningTasks };
    }
}
