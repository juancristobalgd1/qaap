// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import type { BackendApplicationContribution } from '@theia/core/lib/node';
import type { Application, Request, Response } from '@theia/core/shared/express';
import { json } from 'body-parser';
import {
    QAAP_TENANT_RUNTIME_API_PATH,
    type QaapTenantActivityReason,
    type QaapTenantRuntimeStatus,
} from '../common/qaap-cloud-api-types';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import { QaapDockerOrchestrator } from './qaap-docker-orchestrator';
import { QaapTenantActivityTracker } from './qaap-tenant-activity-tracker';
import { QaapTenantContainerReaper } from './qaap-tenant-container-reaper';
import { QaapTenantRuntimeMetrics } from './qaap-tenant-runtime-metrics';
import { QaapTenantRuntimeStore } from './qaap-tenant-runtime-store';

const ACTIVITY_REASONS = new Set<QaapTenantActivityReason>([
    'agent', 'terminal', 'websocket', 'workspace', 'preview', 'job', 'deploy', 'user',
]);

@injectable()
export class QaapTenantRuntimeEndpoint implements BackendApplicationContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(QaapDockerOrchestrator)
    protected readonly docker: QaapDockerOrchestrator;

    @inject(QaapTenantActivityTracker)
    protected readonly activity: QaapTenantActivityTracker;

    @inject(QaapTenantContainerReaper)
    protected readonly reaper: QaapTenantContainerReaper;

    @inject(QaapTenantRuntimeMetrics)
    protected readonly metrics: QaapTenantRuntimeMetrics;

    @inject(QaapTenantRuntimeStore)
    protected readonly store: QaapTenantRuntimeStore;

    configure(app: Application): void {
        app.use(json());
        app.post(`${QAAP_TENANT_RUNTIME_API_PATH}/activity`, (req, res) => {
            this.handleActivity(req, res);
        });
        app.get(`${QAAP_TENANT_RUNTIME_API_PATH}/status`, (req, res) => {
            this.handleStatus(req, res);
        });
        app.get(`${QAAP_TENANT_RUNTIME_API_PATH}/metrics`, (req, res) => {
            this.handleMetrics(req, res);
        });
        app.post(`${QAAP_TENANT_RUNTIME_API_PATH}/wake`, (req, res) => {
            void this.handleWake(req, res);
        });
    }

    protected handleActivity(req: Request, res: Response): void {
        const context = this.auth.authenticate(req);
        const ownerLogin = this.auth.resolveUserLogin(context);
        if (!ownerLogin) {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        const rawReason = (req.body as { reason?: unknown } | undefined)?.reason;
        const reason = typeof rawReason === 'string' && ACTIVITY_REASONS.has(rawReason as QaapTenantActivityReason)
            ? rawReason as QaapTenantActivityReason
            : 'user';
        this.activity.touch(ownerLogin, reason);
        res.json({ ok: true });
    }

    protected handleStatus(req: Request, res: Response): void {
        const context = this.auth.authenticate(req);
        const ownerLogin = this.auth.resolveUserLogin(context);
        if (!ownerLogin) {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        const existing = this.store.get(ownerLogin);
        const runtime: QaapTenantRuntimeStatus = existing
            ? { ...existing, reaperEnabled: this.reaper.isEnabled() }
            : {
                tenantLogin: ownerLogin.toLowerCase(),
                state: this.docker.isEnabled() ? 'destroyed' : 'active',
                reaperEnabled: this.reaper.isEnabled(),
            };
        res.json({ runtime });
    }

    protected handleMetrics(req: Request, res: Response): void {
        const context = this.auth.authenticate(req);
        if (!this.auth.resolveUserLogin(context)) {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        res.json(this.metrics.snapshot());
    }

    protected async handleWake(req: Request, res: Response): Promise<void> {
        const context = this.auth.authenticate(req);
        const ownerLogin = this.auth.resolveUserLogin(context);
        if (!ownerLogin) {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        if (!this.docker.isEnabled()) {
            res.status(409).json({ error: 'Tenant container isolation is not enabled.' });
            return;
        }
        const root = this.docker.tenantRootForLogin(ownerLogin);
        this.store.setState(ownerLogin, 'starting', {
            reaperEnabled: this.reaper.isEnabled(),
            lastActivityAt: new Date().toISOString(),
            idleSince: undefined,
            stoppedAt: undefined,
            destroyAfter: undefined,
        });
        try {
            const worker = await this.docker.ensureTenantContainer(ownerLogin, root);
            const backend = this.docker.isBackendPerTenantEnabled()
                ? await this.docker.ensureTenantBackend(ownerLogin, root)
                : undefined;
            const runtime = this.store.setState(ownerLogin, 'active', {
                workerContainerId: worker.containerId,
                backendContainerId: backend?.containerId,
                reaperEnabled: this.reaper.isEnabled(),
                lastActivityAt: new Date().toISOString(),
                idleSince: undefined,
                stoppedAt: undefined,
                destroyAfter: undefined,
                lastError: undefined,
            });
            res.json({ runtime });
        } catch (error) {
            const runtime = this.store.setState(ownerLogin, 'error', {
                reaperEnabled: this.reaper.isEnabled(),
                lastError: error instanceof Error ? error.message : String(error),
            });
            res.status(503).json({ error: runtime.lastError, runtime });
        }
    }
}
