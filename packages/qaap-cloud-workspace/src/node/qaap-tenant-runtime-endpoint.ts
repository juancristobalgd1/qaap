// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import type { BackendApplicationContribution } from '@theia/core/lib/node';
import type { Application, Request, Response } from '@theia/core/shared/express';
import { json } from 'body-parser';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    QAAP_TENANT_RUNTIME_API_PATH,
    type QaapTenantActivityReason,
    type QaapTenantRuntimeStatus,
} from '../common/qaap-cloud-api-types';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import {
    QAAP_TENANT_BACKEND_MODE_ENV,
    QAAP_TENANT_BACKEND_SECRET_ENV,
    QAAP_TENANT_LOGIN_ENV,
} from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapDockerOrchestrator } from './qaap-docker-orchestrator';
import { QAAP_TENANT_BUSY_PROBE_HEADER, QaapTenantBusyProbe, type QaapTenantBusyStatus } from './qaap-tenant-busy-probe';
import { QaapTenantActivityTracker } from './qaap-tenant-activity-tracker';
import { QaapTenantContainerReaper } from './qaap-tenant-container-reaper';
import { QaapTenantRuntimeMetrics } from './qaap-tenant-runtime-metrics';
import { QaapTenantRuntimeStore } from './qaap-tenant-runtime-store';

const ACTIVITY_REASONS = new Set<QaapTenantActivityReason>([
    'agent', 'terminal', 'websocket', 'workspace', 'preview', 'job', 'deploy', 'user',
]);

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const DEFAULT_DEPLOY_DRAIN_MAX_MS = 45 * 60 * 1000;
/** Header carrying the per-process deploy token (see {@link resolveQaapDeployTokenPath}). */
export const QAAP_DEPLOY_TOKEN_HEADER = 'x-qaap-deploy-token';

/**
 * File holding the deploy token: `QAAP_DEPLOY_TOKEN_FILE`, else `~/.qaap/deploy-drain.token` of the
 * backend user. `scripts/qaap-vps-update.sh` reads it through `docker compose exec theia`, which runs as
 * that same user; agents running under their own uid cannot read it (file 0600, directory 0700).
 */
export function resolveQaapDeployTokenPath(env: NodeJS.ProcessEnv = process.env): string {
    return env.QAAP_DEPLOY_TOKEN_FILE?.trim() || path.join(os.homedir(), '.qaap', 'deploy-drain.token');
}

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

    @inject(QaapAgentTaskRunner)
    protected readonly taskRunner: QaapAgentTaskRunner;

    protected deployDrainTimer: NodeJS.Timeout | undefined;
    /** Fresh random token per process; undefined when it could not be written (deploy endpoints then refuse). */
    protected deployToken: string | undefined;

    initialize(): void {
        this.deployToken = this.writeDeployToken(resolveQaapDeployTokenPath());
    }

    protected writeDeployToken(tokenPath: string): string | undefined {
        const token = crypto.randomBytes(32).toString('hex');
        try {
            const directory = path.dirname(tokenPath);
            fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
            fs.chmodSync(directory, 0o700);
            // Replace instead of writing through: never follow a file or link planted at the path.
            fs.rmSync(tokenPath, { force: true });
            fs.writeFileSync(tokenPath, `${token}\n`, { mode: 0o600, flag: 'wx' });
            return token;
        } catch (error) {
            console.warn('[qaap-tenant-runtime] could not write the deploy drain token; deploy drain is disabled', {
                tokenPath,
                error: error instanceof Error ? error.message : String(error),
            });
            return undefined;
        }
    }

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
        app.get(`${QAAP_TENANT_RUNTIME_API_PATH}/busy`, (req, res) => {
            this.handleBusy(req, res);
        });
        app.get(`${QAAP_TENANT_RUNTIME_API_PATH}/drain-status`, (req, res) => {
            this.handleDrainStatus(req, res);
        });
        app.post(`${QAAP_TENANT_RUNTIME_API_PATH}/drain`, (req, res) => {
            this.handleDrain(req, res);
        });
    }

    protected busyStatus(runningTasks: number): QaapTenantBusyStatus {
        return { busy: runningTasks > 0, runningTasks, draining: this.taskRunner.isDrainingForDeploy() };
    }

    /**
     * Whether agent turns are in flight. A tenant backend answers the control-plane reaper's signed
     * probe for the whole process (it serves one tenant); a signed-in user only sees their own turns.
     */
    protected handleBusy(req: Request, res: Response): void {
        if (/^(1|true)$/i.test(process.env[QAAP_TENANT_BACKEND_MODE_ENV]?.trim() ?? '')) {
            const probe = req.headers[QAAP_TENANT_BUSY_PROBE_HEADER];
            if (QaapTenantBusyProbe.verify(
                typeof probe === 'string' ? probe : undefined,
                process.env[QAAP_TENANT_BACKEND_SECRET_ENV],
                process.env[QAAP_TENANT_LOGIN_ENV],
            )) {
                res.json(this.busyStatus(this.taskRunner.countRunningTasks()));
                return;
            }
        }
        const ownerLogin = this.auth.resolveUserLogin(this.auth.authenticate(req));
        if (!ownerLogin) {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        res.json(this.busyStatus(this.taskRunner.runningTaskCountForOwner(ownerLogin)));
    }

    /**
     * Deploy-only: `docker compose exec theia` calls these over the container's own loopback with the
     * deploy token. Anything that came through Caddy or the tenant proxy carries forwarding headers or a
     * non-loopback peer.
     */
    protected isLocalDeployRequest(req: Request): boolean {
        const peer = req.socket.remoteAddress ?? '';
        return LOOPBACK_ADDRESSES.has(peer)
            && !req.headers['x-forwarded-for']
            && !req.headers['x-forwarded-host']
            && !req.headers.forwarded
            && this.hasDeployToken(req);
    }

    /**
     * Loopback alone is not enough: an agent shares the container's network namespace. The caller
     * must also present the token only the backend user can read.
     */
    protected hasDeployToken(req: Request): boolean {
        const presented = req.headers[QAAP_DEPLOY_TOKEN_HEADER];
        if (!this.deployToken || typeof presented !== 'string') {
            return false;
        }
        const expected = Buffer.from(this.deployToken, 'utf8');
        const actual = Buffer.from(presented.trim(), 'utf8');
        return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    }

    protected handleDrainStatus(req: Request, res: Response): void {
        if (!this.isLocalDeployRequest(req)) {
            res.status(404).end();
            return;
        }
        res.json(this.busyStatus(this.taskRunner.countRunningTasks()));
    }

    /** `{ draining: true }` queues (and persists) new turns until restart or `{ draining: false }`. */
    protected handleDrain(req: Request, res: Response): void {
        if (!this.isLocalDeployRequest(req)) {
            res.status(404).end();
            return;
        }
        const draining = (req.body as { draining?: unknown } | undefined)?.draining !== false;
        if (this.deployDrainTimer) {
            clearTimeout(this.deployDrainTimer);
            this.deployDrainTimer = undefined;
        }
        this.taskRunner.setDrainingForDeploy(draining);
        if (draining) {
            // A deploy that dies between drain and restart must not leave new turns queued forever.
            const maxMs = Number.parseInt(process.env.QAAP_DEPLOY_DRAIN_MAX_MS?.trim() ?? '', 10);
            this.deployDrainTimer = setTimeout(() => {
                this.deployDrainTimer = undefined;
                this.taskRunner.setDrainingForDeploy(false);
            }, Number.isInteger(maxMs) && maxMs > 0 ? maxMs : DEFAULT_DEPLOY_DRAIN_MAX_MS);
            this.deployDrainTimer.unref?.();
        }
        res.json(this.busyStatus(this.taskRunner.countRunningTasks()));
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
