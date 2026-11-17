// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import type { BackendApplicationContribution } from '@theia/core/lib/node';
import type { Application, Request, Response } from '@theia/core/shared/express';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import { QaapAsyncRoute } from '@theia/qaap-shared-core/lib/node/qaap-async-route';
import { QAAP_TENANT_UPDATE_API_PATH } from '../common/qaap-cloud-api-types';
import { QaapDockerOrchestrator } from './qaap-docker-orchestrator';

/**
 * "Update now" for the signed-in user's tenant backend (`POST /qaap/api/tenant-update`). The state it
 * acts on is `updatePending` in `GET /qaap/api/cloud/runtime/status`; this route only applies it. Served
 * by the control plane (see `isControlPlanePath` in the tenant proxy), so the request never reaches the
 * tenant it is about. The owner is always the session's login: a `login` parameter is never read.
 */
@injectable()
export class QaapTenantUpdateEndpoint implements BackendApplicationContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(QaapDockerOrchestrator)
    protected readonly docker: QaapDockerOrchestrator;

    configure(app: Application): void {
        app.post(QAAP_TENANT_UPDATE_API_PATH, QaapAsyncRoute.wrap('qaap-tenant-update', (req, res) => this.handleApply(req, res)));
    }

    protected async handleApply(req: Request, res: Response): Promise<void> {
        // Same guard as the other cookie-authenticated mutations (see qaap-api-token-endpoint.ts): browsers
        // always send Sec-Fetch-Site; a request without it must be JSON, which a cross-site form cannot send.
        const fetchSite = req.headers['sec-fetch-site'];
        if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') {
            res.status(403).json({ error: 'Cross-site request refused.' });
            return;
        }
        if (fetchSite === undefined && !/^application\/json\s*(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
            res.status(415).json({ error: 'Send the request as application/json.' });
            return;
        }
        const ownerLogin = this.resolveOwnerLogin(req, res);
        if (!ownerLogin) {
            return;
        }
        const applied = await this.docker.applyTenantUpdateNow(ownerLogin);
        res.json({ applied });
    }

    protected resolveOwnerLogin(req: Request, res: Response): string | undefined {
        const context = this.auth.authenticate(req);
        const ownerLogin = this.auth.resolveUserLogin(context);
        if (!ownerLogin) {
            res.status(401).json({ error: 'Not signed in' });
            return undefined;
        }
        return ownerLogin;
    }
}
