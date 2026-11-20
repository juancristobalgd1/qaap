// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapBillingPlanId } from './qaap-billing-plans';

/** Per-project resources (container memory per repository) of the signed-in owner. */
export const QAAP_PROJECT_RESOURCES_API_PATH = '/qaap/api/billing/project-resources';

/** `GET`: the saved or default choice of one repository, `repo` is `owner/name`. */
export interface QaapProjectResourcesQuery {
    readonly repo: string;
}

/** `POST` body: sets the container memory of one repository. */
export interface QaapProjectResourcesUpdateRequest {
    readonly repo: string;
    readonly memoryGb: number;
}

/** Response of both `GET` and `POST` on {@link QAAP_PROJECT_RESOURCES_API_PATH}. */
export interface QaapProjectResourcesResponse {
    readonly repo: string;
    readonly memoryGb: number;
    /** The memory choices the owner's plan allows. */
    readonly options: readonly number[];
    readonly plan: QaapBillingPlanId;
}

/** Error body of a rejected request; `memory_not_in_plan` also carries the allowed `options`. */
export interface QaapProjectResourcesErrorResponse {
    readonly error: 'repo_required' | 'repo_invalid' | 'memory_invalid' | 'memory_not_in_plan' | 'Not signed in' | string;
    readonly options?: readonly number[];
    readonly plan?: QaapBillingPlanId;
}
