// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { validateQaapTenantRuntimeEnv } from './qaap-tenant-runtime';

/** Reports an invalid tenant runtime setting at startup; each tenant still fails closed when it is ensured. */
@injectable()
export class QaapTenantRuntimeStartupContribution implements BackendApplicationContribution {

    onStart(): void {
        validateQaapTenantRuntimeEnv(process.env);
    }

}
