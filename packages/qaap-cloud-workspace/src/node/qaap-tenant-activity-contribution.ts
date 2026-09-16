// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import type { BackendApplicationContribution } from '@theia/core/lib/node';
import type { Application, Request, Response, NextFunction } from '@theia/core/shared/express';
import { QaapGithubAuthGuard } from '@theia/qaap-mobile-shell/lib/node/qaap-github-auth-guard';
import { QaapTenantActivityTracker } from './qaap-tenant-activity-tracker';

/** Keeps the tenant alive while authenticated API/SSE requests or WebSocket handshakes are active. */
@injectable()
export class QaapTenantActivityContribution implements BackendApplicationContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(QaapTenantActivityTracker)
    protected readonly activity: QaapTenantActivityTracker;

    configure(app: Application): void {
        app.use((req: Request, res: Response, next: NextFunction) => {
            const path = (req.url || '').split('?')[0];
            if (!this.isTrackedPath(path)) {
                next();
                return;
            }
            const context = this.auth.authenticate(req);
            const ownerLogin = this.auth.resolveUserLogin(context);
            if (!ownerLogin) {
                next();
                return;
            }
            const reason = this.reasonForPath(path);
            const release = this.activity.beginOperation(ownerLogin, `http:${req.method}:${path}:${Date.now()}`, reason);
            res.once('finish', release);
            res.once('close', release);
            next();
        });
    }

    protected isTrackedPath(path: string): boolean {
        if (path === '/qaap/api/cloud/runtime/status' || path === '/qaap/api/cloud/runtime/metrics') {
            return false;
        }
        return path.startsWith('/qaap/api/cloud/')
            || path.startsWith('/qaap/api/agent-')
            || path.startsWith('/qaap/api/jobs')
            || path.startsWith('/qaap/api/parallel-runs')
            || path.startsWith('/qaap/api/workflows')
            || path.startsWith('/qaap/api/work-hub-routines')
            || path.startsWith('/services/qaap-research');
    }

    protected reasonForPath(path: string): 'agent' | 'terminal' | 'preview' | 'job' | 'deploy' | 'workspace' | 'user' {
        if (path.includes('agent-')) {
            return 'agent';
        }
        if (path.includes('terminal')) {
            return 'terminal';
        }
        if (path.includes('preview')) {
            return 'preview';
        }
        if (path.includes('job') || path.includes('workflow') || path.includes('research')) {
            return 'job';
        }
        if (path.includes('deploy')) {
            return 'deploy';
        }
        if (path.includes('workspace')) {
            return 'workspace';
        }
        return 'user';
    }
}
