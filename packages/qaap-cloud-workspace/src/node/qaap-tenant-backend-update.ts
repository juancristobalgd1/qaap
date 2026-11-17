// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapTenantBackendUpdateStatus } from '../common/qaap-cloud-api-types';

export interface QaapTenantBackendUpdateInput {
    /** Build the tenant backend reported in its last ready health check (in memory, no Docker call). */
    readonly backendBuild: string | undefined;
    /** Build of the control plane answering the request (`QAAP_BUILD_SHA`). */
    readonly controlPlaneBuild: string | undefined;
    /** The orchestrator kept a stale backend alive because agent turns were running. */
    readonly deferred: boolean;
    /** The running backend container does not use the serving image (checked by the orchestrator, no build string needed). */
    readonly imageStale?: boolean;
}

/**
 * Derives what the user is told about their backend's build. An update is pending when either
 *  - a recreation was deferred (`reason: 'agent-turns-running'`): the stale backend keeps serving
 *    until its turns finish, whatever the build strings say (a deferral can also be caused by a
 *    config change under the same build), or
 *  - both builds are known and differ: the next wake recreates the backend on the new image. No
 *    `reason` then, because nothing blocks it; the wake itself is the user's next request, or the
 *    user's "Update now" (`POST /qaap/api/tenant-update`).
 *  - the running container does not use the serving image (`imageStale`): this is checked against
 *    Docker, so it is also right after a control-plane restart, when no build is known in memory.
 * Unknown builds (no ready health seen since the control plane started, or a `dev` build) never
 * report a pending update on their own: that would be a guess.
 */
export function computeTenantBackendUpdateStatus(input: QaapTenantBackendUpdateInput): QaapTenantBackendUpdateStatus {
    const backendBuild = input.backendBuild?.trim() || undefined;
    const controlPlaneBuild = input.controlPlaneBuild?.trim() || undefined;
    const knownBuilds = controlPlaneBuild !== undefined && controlPlaneBuild !== 'dev' && backendBuild !== undefined;
    const buildsDiffer = knownBuilds && backendBuild !== controlPlaneBuild;
    const updatePending = input.deferred || buildsDiffer || input.imageStale === true;
    return {
        backendBuild,
        controlPlaneBuild,
        updatePending,
        ...(input.deferred ? { reason: 'agent-turns-running' as const } : {}),
    };
}
