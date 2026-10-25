// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import type { BackendApplicationContribution } from '@theia/core/lib/node';
import type { Application, Request, Response } from '@theia/core/shared/express';
import { isQaapTenantBackendMode, QAAP_TENANT_BACKEND_SECRET_ENV, QAAP_TENANT_LOGIN_ENV } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { QAAP_TENANT_PUSH_OUTBOX_PATH } from '../common/qaap-cloud-api-types';
import { QAAP_TENANT_BUSY_PROBE_HEADER, QaapTenantBusyProbe } from './qaap-tenant-busy-probe';
import { QaapPushOutbox } from './qaap-push-outbox';

/**
 * Tenant-backend side of the push pull model. The control plane drains this outbox with the same
 * tenant-scoped signed probe it uses for the busy probe; without a valid probe the answer is 401.
 */
@injectable()
export class QaapPushOutboxEndpoint implements BackendApplicationContribution {

    @inject(QaapPushOutbox)
    protected readonly outbox: QaapPushOutbox;

    configure(app: Application): void {
        app.get(QAAP_TENANT_PUSH_OUTBOX_PATH, (req, res) => this.handleDrain(req, res));
    }

    protected handleDrain(req: Request, res: Response): void {
        if (!isQaapTenantBackendMode()) {
            res.status(404).end();
            return;
        }
        const probe = req.headers[QAAP_TENANT_BUSY_PROBE_HEADER];
        if (!QaapTenantBusyProbe.verify(
            typeof probe === 'string' ? probe : undefined,
            process.env[QAAP_TENANT_BACKEND_SECRET_ENV],
            process.env[QAAP_TENANT_LOGIN_ENV],
        )) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
        res.setHeader('cache-control', 'no-store');
        res.json({ entries: this.outbox.drain() });
    }
}
