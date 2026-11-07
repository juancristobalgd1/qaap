// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { BackendApplicationContribution } from '@theia/core/lib/node';
import { injectable } from '@theia/core/shared/inversify';
import { validateQaapTenantRuntimeEnv } from './qaap-tenant-runtime';

/**
 * Validates the tenant runtime settings when the backend starts, not at the first tenant spawn, so an
 * unsupported QAAP_TENANT_RUNTIME fails the boot (fail closed).
 */
@injectable()
export class QaapTenantRuntimeStartupContribution implements BackendApplicationContribution {

    onStart(): void {
        validateQaapTenantRuntimeEnv(process.env);
    }

}
