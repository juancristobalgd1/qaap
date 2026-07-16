// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
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
import { isQaapWorkspaceContainerPath, QAAP_CONTAINER_CWD_ERROR } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import { QaapResearchRunner } from './qaap-research-runner';
import { QaapResearchStore } from './qaap-research-store';

/**
 * REST create/list/detail/cancel for the auto-researcher v1. No frontend yet — `v1 sin UI, se
 * maneja con curl` — so this mirrors {@link QaapWorkHubRoutineEndpoint}'s auth/ownership pattern
 * without any UI-specific shaping.
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
            this.handleDetail(req, res);
        });
        app.post(`${QAAP_RESEARCH_API_PATH}/:id/cancel`, (req, res) => {
            this.handleCancel(req, res);
        });
    }

    protected handleCreate(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapCreateResearchGoalBody>;
        if (typeof body.cwd !== 'string' || !body.cwd.trim()) {
            res.status(400).json({ error: '"cwd" is required.' });
            return;
        }
        if (typeof body.description !== 'string' || !body.description.trim()) {
            res.status(400).json({ error: '"description" is required.' });
            return;
        }
        if (!Array.isArray(body.metrics) || body.metrics.length === 0) {
            res.status(400).json({ error: '"metrics" must be a non-empty array.' });
            return;
        }
        if (!this.auth.ownsWorkspacePath(ctx, body.cwd)) {
            this.auth.denyForbidden(res, req, 'workspace_path', { cwd: body.cwd });
            return;
        }
        // Same guard as routines/tasks: a container-level cwd would run the researcher's agent
        // turns AND its runCommand over every repository the caller owns at once.
        if (isQaapWorkspaceContainerPath(body.cwd)) {
            res.status(400).json({ error: QAAP_CONTAINER_CWD_ERROR });
            return;
        }
        try {
            const ownerLogin = this.auth.resolveUserLogin(ctx);
            const goal = this.store.create({
                cwd: body.cwd,
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

    protected handleDetail(req: Request, res: Response): void {
        const goal = this.getGoalIfOwned(req, res, req.params.id);
        if (!goal) {
            return;
        }
        res.json({ goal, records: this.store.readLedgerForGoal(goal) } satisfies QaapResearchGoalDetailResponse);
    }

    protected handleCancel(req: Request, res: Response): void {
        if (!this.getGoalIfOwned(req, res, req.params.id)) {
            return;
        }
        const cancelled = this.runner.cancel(req.params.id);
        if (!cancelled) {
            res.status(404).json({ error: 'Research goal not found.' });
            return;
        }
        res.json(cancelled);
    }

    protected requireAuth(req: Request, res: Response): QaapGithubAuthContext | undefined {
        const ctx = this.auth.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
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
            res.status(404).json({ error: 'Research goal not found.' });
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
