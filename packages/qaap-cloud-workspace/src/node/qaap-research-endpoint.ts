// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { nls } from '@theia/core/lib/common/nls';
import {
    QAAP_RESEARCH_API_PATH,
    type QaapCreateResearchGoalBody,
    type QaapResearchGoalDetailResponse,
    type QaapResearchGoalListResponse,
} from '@theia/qaap-mobile-shell/lib/common/qaap-research-api';
import type { ResearchGoal } from '@theia/qaap-mobile-shell/lib/common/qaap-research-goal';
import {
    QaapGithubAuthGuard,
    type QaapGithubAuthContext,
} from '@theia/qaap-mobile-shell/lib/node/qaap-github-auth-guard';
import { QAAP_CONTAINER_CWD_ERROR } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import { QaapResearchRunner } from './qaap-research-runner';
import { QaapResearchStore } from './qaap-research-store';

/**
 * REST create/list/detail/cancel/replay for the auto-researcher v1. Work Hub lists goals and
 * starts them via POST create or POST replay; the Node runner keeps executing after the browser
 * closes (see {@link QaapResearchRunner#reconcileOnBoot}).
 */
@injectable()
export class QaapResearchEndpoint implements BackendApplicationContribution {

    @inject(QaapResearchStore)
    protected readonly store: QaapResearchStore;

    @inject(QaapResearchRunner)
    protected readonly runner: QaapResearchRunner;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        app.get(QAAP_RESEARCH_API_PATH, (req, res) => {
            const ctx = this.requireAuth(req, res);
            if (!ctx) {
                return;
            }
            res.json({ goals: this.filterGoals(ctx, this.store.list()) } satisfies QaapResearchGoalListResponse);
        });
        app.post(QAAP_RESEARCH_API_PATH, (req, res) => {
            this.handleCreate(req, res);
        });
        app.get(`${QAAP_RESEARCH_API_PATH}/:id`, (req, res) => {
            void this.handleDetail(req, res);
        });
        app.post(`${QAAP_RESEARCH_API_PATH}/:id/cancel`, (req, res) => {
            this.handleCancel(req, res);
        });
        app.post(`${QAAP_RESEARCH_API_PATH}/:id/replay`, (req, res) => {
            this.handleReplay(req, res);
        });
    }

    protected handleCreate(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapCreateResearchGoalBody>;
        if (typeof body.cwd !== 'string' || !body.cwd.trim()) {
            res.status(400).json({
                error: nls.localize('qaap/research/cwdRequired', '"cwd" is required.'),
            });
            return;
        }
        if (typeof body.description !== 'string' || !body.description.trim()) {
            res.status(400).json({
                error: nls.localize('qaap/research/descriptionRequired', '"description" is required.'),
            });
            return;
        }
        if (!Array.isArray(body.metrics) || body.metrics.length === 0) {
            res.status(400).json({
                error: nls.localize('qaap/research/metricsRequired', '"metrics" must be a non-empty array.'),
            });
            return;
        }
        // Normalize + ownership-check to the caller's canonical per-user repo path, and persist
        // THAT — `ownsWorkspacePath` accepts bare/legacy/cross-tenant-equivalent names by
        // resolution, but the runner would otherwise execute git/runCommand on the literal
        // body.cwd (SEC-7). resolveOwnedRepositoryCwd also rejects container cwds.
        const resolved = this.auth.resolveOwnedRepositoryCwd(ctx, body.cwd);
        if (resolved.kind === 'needs-project') {
            res.status(400).json({ error: QAAP_CONTAINER_CWD_ERROR });
            return;
        }
        if (resolved.kind !== 'ok') {
            this.auth.denyForbidden(res, req, 'workspace_path', { cwd: body.cwd });
            return;
        }
        try {
            const ownerLogin = this.auth.resolveUserLogin(ctx);
            if (!this.assertResearchQuota(ownerLogin, res)) {
                return;
            }
            const goal = this.store.create({
                cwd: resolved.cwd,
                description: body.description,
                agentId: body.agentId,
                agentModel: body.agentModel,
                runCommand: body.runCommand,
                runTimeoutMs: body.runTimeoutMs,
                metrics: body.metrics,
                maxRounds: body.maxRounds,
                deadlineAt: body.deadlineAt,
                stagnationRounds: body.stagnationRounds,
                infraFailureLimit: body.infraFailureLimit,
            }, ownerLogin);
            this.runner.start(goal);
            res.status(201).json(goal);
        } catch (error) {
            // normalizeResearchGoal only throws on caller-supplied shape errors (missing/duplicate
            // primary metric, etc.) — always a 400, never a 500.
            res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
        }
    }

    protected async handleDetail(req: Request, res: Response): Promise<void> {
        const goal = this.getGoalIfOwned(req, res, req.params.id);
        if (!goal) {
            return;
        }
        res.json({
            goal,
            records: await this.store.readLedgerForGoalAsync(goal),
        } satisfies QaapResearchGoalDetailResponse);
    }

    protected handleCancel(req: Request, res: Response): void {
        if (!this.getGoalIfOwned(req, res, req.params.id)) {
            return;
        }
        const cancelled = this.runner.cancel(req.params.id);
        if (!cancelled) {
            res.status(404).json({
                error: nls.localize('qaap/research/goalNotFound', 'Research goal not found.'),
            });
            return;
        }
        res.json(cancelled);
    }

    protected handleReplay(req: Request, res: Response): void {
        const source = this.getGoalIfOwned(req, res, req.params.id);
        if (!source) {
            return;
        }
        if (source.status === 'running') {
            res.status(409).json({
                error: nls.localize('qaap/research/alreadyRunning', 'Research goal is already running.'),
            });
            return;
        }
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        try {
            const ownerLogin = this.auth.resolveUserLogin(ctx);
            if (!this.assertResearchQuota(ownerLogin, res)) {
                return;
            }
            const goal = this.store.replayFrom(source.id, ownerLogin);
            this.runner.start(goal);
            res.status(201).json(goal);
        } catch (error) {
            res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
        }
    }

    protected assertResearchQuota(ownerLogin: string | undefined, res: Response): boolean {
        const running = this.store.listRunning();
        const globalLimit = this.maxConcurrentResearch();
        if (running.length >= globalLimit) {
            res.status(409).json({
                error: nls.localize(
                    'qaap/research/globalQuota',
                    'Too many research goals are already running (limit {0}).',
                    String(globalLimit),
                ),
            });
            return false;
        }
        if (ownerLogin) {
            const perUser = this.maxConcurrentResearchPerUser();
            const ownerRunning = running.filter(goal => this.store.ownerOf(goal.id) === ownerLogin).length;
            if (ownerRunning >= perUser) {
                res.status(409).json({
                    error: nls.localize(
                        'qaap/research/userQuota',
                        'You already have the maximum number of running research goals ({0}).',
                        String(perUser),
                    ),
                });
                return false;
            }
        }
        return true;
    }

    protected maxConcurrentResearch(): number {
        return this.positiveEnv('QAAP_RESEARCH_MAX_CONCURRENT', 2);
    }

    protected maxConcurrentResearchPerUser(): number {
        return this.positiveEnv('QAAP_RESEARCH_MAX_CONCURRENT_PER_USER', 1);
    }

    protected positiveEnv(name: string, fallback: number): number {
        const parsed = Number.parseInt(process.env[name]?.trim() ?? '', 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    protected requireAuth(req: Request, res: Response): QaapGithubAuthContext | undefined {
        const ctx = this.auth.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            res.status(401).json({
                error: nls.localize('qaap/research/notSignedIn', 'Not signed in'),
            });
            return undefined;
        }
        return ctx;
    }

    protected getGoalIfOwned(req: Request, res: Response, id: string): ResearchGoal | undefined {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return undefined;
        }
        const goal = this.store.get(id);
        if (!goal) {
            res.status(404).json({
                error: nls.localize('qaap/research/goalNotFound', 'Research goal not found.'),
            });
            return undefined;
        }
        if (!this.ownsGoal(ctx, goal)) {
            this.auth.denyForbidden(res, req, 'agent_task', { researchGoalId: id });
            return undefined;
        }
        return goal;
    }

    protected filterGoals(ctx: QaapGithubAuthContext, goals: ResearchGoal[]): ResearchGoal[] {
        return goals.filter(goal => this.ownsGoal(ctx, goal));
    }

    protected ownsGoal(ctx: QaapGithubAuthContext, goal: ResearchGoal): boolean {
        if (ctx.kind === 'skip') {
            return true;
        }
        if (ctx.kind === 'unauthorized') {
            return false;
        }
        const owner = this.store.ownerOf(goal.id);
        if (owner) {
            return owner === ctx.userLogin;
        }
        return this.auth.ownsWorkspacePath(ctx, goal.cwd);
    }
}
