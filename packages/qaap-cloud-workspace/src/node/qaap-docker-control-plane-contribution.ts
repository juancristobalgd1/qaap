// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import type { BackendApplicationContribution } from '@theia/core/lib/node';
import { assertQaapHostedTenantIsolation } from './qaap-docker-control-plane';
import {
    isQaapBackendIsolationReady,
    isQaapPublicMultiTenantRuntime,
} from '@theia/qaap-adapters/lib/common/qaap-backend-isolation';

/** Fails before the HTTP server becomes ready if hosted worker control is unsafe. */
@injectable()
export class QaapDockerControlPlaneContribution implements BackendApplicationContribution {

    initialize(): void {
        assertQaapHostedTenantIsolation(process.env);
        if (isQaapPublicMultiTenantRuntime(process.env) && !isQaapBackendIsolationReady(process.env)) {
            throw new Error(
                'Refusing public tenant admission until QAAP_BACKEND_PER_TENANT=1 and '
                + 'QAAP_TENANT_BACKEND_MASTER_SECRET are configured.',
            );
        }
    }
}
