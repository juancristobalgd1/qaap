// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { qaapAuthenticatedFetchInit } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';

/**
 * Mirrors of `QAAP_TENANT_RUNTIME_API_PATH` and `QAAP_TENANT_UPDATE_API_PATH` (qaap-cloud-workspace). This
 * layer sits below that package and cannot import the constants.
 */
export const QAAP_TENANT_RUNTIME_STATUS_PATH = '/qaap/api/cloud/runtime/status';
export const QAAP_TENANT_UPDATE_PATH = '/qaap/api/tenant-update';

/**
 * The `update` field of the runtime status: the one source of "a newer Qaap build waits for the user's
 * backend". `updatePending` is the only flag the UI acts on; `runningTasks` is set while it is pending.
 */
export interface QaapTenantBackendUpdate {
    readonly backendBuild?: string;
    readonly controlPlaneBuild?: string;
    readonly updatePending: boolean;
    /** Only `agent-turns-running`: the stale backend waits for the running turns to finish. */
    readonly reason?: 'agent-turns-running';
    /** Agent turns running in the backend now (0 when the backend cannot be asked). */
    readonly runningTasks: number;
}

/** HTTP client for the runtime status (read) and the "Update now" action (`POST`). Errors reject. */
export class QaapTenantUpdateClient {

    /** `undefined` when the answer carries no `update` field (an older control plane). */
    async fetchBackendUpdate(): Promise<QaapTenantBackendUpdate | undefined> {
        const response = await fetch(QAAP_TENANT_RUNTIME_STATUS_PATH, qaapAuthenticatedFetchInit());
        if (!response.ok) {
            throw new Error(`Runtime status failed with HTTP ${response.status}.`);
        }
        const body = await response.json() as { update?: unknown };
        return body.update ? QaapTenantUpdateClient.parseUpdate(body.update) : undefined;
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

    /** Tolerates missing or mistyped fields: only an explicit `true` means a pending update. */
    static parseUpdate(value: unknown): QaapTenantBackendUpdate {
        const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
        const runningTasks = typeof record.runningTasks === 'number' && Number.isFinite(record.runningTasks) && record.runningTasks > 0
            ? Math.floor(record.runningTasks)
            : 0;
        return {
            ...(typeof record.backendBuild === 'string' ? { backendBuild: record.backendBuild } : {}),
            ...(typeof record.controlPlaneBuild === 'string' ? { controlPlaneBuild: record.controlPlaneBuild } : {}),
            updatePending: record.updatePending === true,
            ...(record.reason === 'agent-turns-running' ? { reason: 'agent-turns-running' as const } : {}),
            runningTasks,
        };
    }
}
