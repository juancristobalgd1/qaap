// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { json } from 'body-parser';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import { QaapAsyncRoute } from '@theia/qaap-shared-core/lib/node/qaap-async-route';
import {
    QAAP_PROJECT_RESOURCES_API_PATH,
    type QaapProjectResourcesResponse,
    type QaapProjectResourcesUpdateRequest,
} from '../common/qaap-project-resources-protocol';
import {
    getQaapBillingPlan,
    type QaapBillingPlan,
} from '../common/qaap-billing-plans';
import { clampProjectMemoryGb, isProjectMemoryAllowed } from '../common/qaap-tenant-resource-plan';
import { QaapBillingStore } from './qaap-billing-store';
import { QaapDockerOrchestrator } from './qaap-docker-orchestrator';
import { QaapProjectResourcesStore } from './qaap-project-resources-store';

/**
 * Per-project container memory for the signed-in owner (`GET` reads the saved or default choice,
 * `POST` saves one from the plan's options and applies it to the running tenant at once).
 */
@injectable()
export class QaapProjectResourcesEndpoint implements BackendApplicationContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(QaapBillingStore)
    protected readonly billing: QaapBillingStore;

    @inject(QaapProjectResourcesStore)
    protected readonly projects: QaapProjectResourcesStore;

    @inject(QaapDockerOrchestrator) @optional()
    protected readonly orchestrator: QaapDockerOrchestrator | undefined;

    configure(app: Application): void {
        app.get(QAAP_PROJECT_RESOURCES_API_PATH, QaapAsyncRoute.wrap('qaap-project-resources', (req, res) => this.handleGet(req, res)));
        app.post(QAAP_PROJECT_RESOURCES_API_PATH, json(), QaapAsyncRoute.wrap('qaap-project-resources', (req, res) => this.handlePost(req, res)));
    }

    protected async handleGet(req: Request, res: Response): Promise<void> {
        const login = this.requireLogin(req, res);
        if (!login) {
            return;
        }
        const rawRepo = typeof req.query.repo === 'string' ? req.query.repo : '';
        const repo = QaapProjectResourcesStore.normalizeRepo(rawRepo);
        if (!repo) {
            res.status(400).json({ error: rawRepo.trim() ? 'repo_invalid' : 'repo_required' });
            return;
        }
        const plan = await this.planOf(login);
        const saved = this.projects.get(login, repo);
        res.json(this.responseFor(repo, plan, saved?.memoryGb ?? plan.defaultMemoryGb));
    }

    protected async handlePost(req: Request, res: Response): Promise<void> {
        const login = this.requireLogin(req, res);
        if (!login) {
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapProjectResourcesUpdateRequest>;
        const rawRepo = typeof body.repo === 'string' ? body.repo : '';
        const repo = QaapProjectResourcesStore.normalizeRepo(rawRepo);
        if (!repo) {
            res.status(400).json({ error: rawRepo.trim() ? 'repo_invalid' : 'repo_required' });
            return;
        }
        const memoryGb = body.memoryGb;
        if (typeof memoryGb !== 'number' || !Number.isInteger(memoryGb)) {
            res.status(400).json({ error: 'memory_invalid' });
            return;
        }
        const plan = await this.planOf(login);
        if (!isProjectMemoryAllowed(plan, memoryGb)) {
            res.status(400).json({ error: 'memory_not_in_plan', options: [...plan.memoryOptionsGb], plan: plan.id });
            return;
        }
        this.projects.set(login, repo, memoryGb);
        try {
            // Running tenants take the new memory now (docker update), not on their next start.
            await this.orchestrator?.applyTenantResourceLimits(login);
        } catch (error) {
            console.warn(`[qaap-project-resources] Saved ${repo} for ${login}, but the running tenant was not updated: `
                + (error instanceof Error ? error.message : String(error)));
        }
        res.json(this.responseFor(repo, plan, memoryGb));
    }

    protected async planOf(login: string): Promise<QaapBillingPlan> {
        const account = await this.billing.getOrCreateAccount(login);
        return getQaapBillingPlan(account.planId);
    }

    protected responseFor(repo: string, plan: QaapBillingPlan, memoryGb: number): QaapProjectResourcesResponse {
        return {
            repo,
            memoryGb: clampProjectMemoryGb(plan.memoryOptionsGb, memoryGb),
            options: [...plan.memoryOptionsGb],
            plan: plan.id,
        };
    }

    protected requireLogin(req: Request, res: Response): string | undefined {
        const ctx = this.auth.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return undefined;
        }
        const login = this.auth.resolveUserLogin(ctx);
        if (!login) {
            res.status(401).json({ error: 'Not signed in' });
            return undefined;
        }
        return login;
    }
}
