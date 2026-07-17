// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import {
    QAAP_PARALLEL_RUN_API_PATH,
    type QaapChooseParallelVariantRequest,
    type QaapCreateParallelRunRequest,
    type QaapParallelRun,
} from '../common/qaap-parallel-run';
import type { QaapCreateAgentTaskQaiqModel } from '../common/qaap-agent-task';
import {
    QaapGithubAuthGuard,
    type QaapGithubAuthContext,
} from '@theia/qaap-mobile-shell/lib/node/qaap-github-auth-guard';
import { QAAP_CONTAINER_CWD_ERROR } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import { QaapParallelRunStore } from './qaap-parallel-run-store';

/** HTTP surface for parallel agent runs (variants in isolated git worktrees). */
@injectable()
export class QaapParallelRunEndpoint implements BackendApplicationContribution {

    @inject(QaapParallelRunStore)
    protected readonly store: QaapParallelRunStore;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        app.post(QAAP_PARALLEL_RUN_API_PATH, (req, res) => {
            void this.handleCreate(req, res);
        });
        app.get(`${QAAP_PARALLEL_RUN_API_PATH}/:id`, (req, res) => {
            void this.handleGet(req, res);
        });
        app.post(`${QAAP_PARALLEL_RUN_API_PATH}/:id/choose`, (req, res) => {
            void this.handleChoose(req, res);
        });
        app.delete(`${QAAP_PARALLEL_RUN_API_PATH}/:id`, (req, res) => {
            void this.handleDelete(req, res);
        });
    }

    protected async handleCreate(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapCreateParallelRunRequest>;
        if (typeof body.cwd !== 'string' || typeof body.prompt !== 'string' || !Array.isArray(body.agents)) {
            res.status(400).json({ error: '"cwd", "prompt" and "agents" are required.' });
            return;
        }
        // Normalize + ownership-check the cwd to the caller's canonical per-user repo path, and pass
        // THAT to the store — `ownsWorkspacePath` accepts bare/legacy names by canonical resolution,
        // but the store used to `path.resolve(body.cwd)` the literal string, so validation and
        // execution could diverge (SEC-7). resolveOwnedRepositoryCwd also rejects container cwds.
        const resolved = this.auth.resolveOwnedRepositoryCwd(ctx, body.cwd);
        if (resolved.kind === 'needs-project') {
            res.status(400).json({ error: QAAP_CONTAINER_CWD_ERROR });
            return;
        }
        if (resolved.kind !== 'ok') {
            this.auth.denyForbidden(res, req, 'agent_task', { cwd: body.cwd });
            return;
        }
        const agentModels = this.parseAgentModels(body.agentModels);
        try {
            const run = await this.store.create(
                {
                    cwd: resolved.cwd,
                    prompt: body.prompt,
                    agents: body.agents,
                    ...(agentModels ? { agentModels } : {}),
                },
                this.auth.resolveUserLogin(ctx),
            );
            res.status(201).json(run);
        } catch (error) {
            res.status(400).json({ error: this.errorMessage(error) });
        }
    }

    protected parseAgentModels(raw: unknown): Record<string, QaapCreateAgentTaskQaiqModel> | undefined {
        if (raw === undefined || raw === null) {
            return undefined;
        }
        if (typeof raw !== 'object' || Array.isArray(raw)) {
            return undefined;
        }
        const result: Record<string, QaapCreateAgentTaskQaiqModel> = {};
        for (const [agentId, value] of Object.entries(raw as Record<string, unknown>)) {
            if (typeof agentId !== 'string' || !agentId.trim()) {
                continue;
            }
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                continue;
            }
            const candidate = value as Record<string, unknown>;
            if (typeof candidate.modelId !== 'string' || !candidate.modelId.trim()) {
                continue;
            }
            if (typeof candidate.provider !== 'string' || typeof candidate.vendor !== 'string') {
                continue;
            }
            result[agentId] = {
                provider: candidate.provider as QaapCreateAgentTaskQaiqModel['provider'],
                vendor: candidate.vendor,
                modelId: candidate.modelId,
            };
        }
        return Object.keys(result).length > 0 ? result : undefined;
    }

    protected async handleGet(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        try {
            const run = await this.store.get(req.params.id);
            if (!run) {
                res.status(404).json({ error: 'Parallel run not found.' });
                return;
            }
            if (!this.ownsParallelRun(ctx, run)) {
                this.auth.denyForbidden(res, req, 'agent_task', { parallelRunId: req.params.id });
                return;
            }
            res.json(run);
        } catch (error) {
            res.status(500).json({ error: this.errorMessage(error) });
        }
    }

    protected async handleChoose(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const existing = await this.store.get(req.params.id);
        if (!existing) {
            res.status(404).json({ error: 'Parallel run not found.' });
            return;
        }
        if (!this.ownsParallelRun(ctx, existing)) {
            this.auth.denyForbidden(res, req, 'agent_task', { parallelRunId: req.params.id });
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapChooseParallelVariantRequest>;
        if (typeof body.conversationId !== 'string' || typeof body.action !== 'string') {
            res.status(400).json({ error: '"conversationId" and "action" are required.' });
            return;
        }
        try {
            const result = await this.store.choose(req.params.id, body.conversationId, body.action);
            res.json(result);
        } catch (error) {
            res.status(400).json({ error: this.errorMessage(error) });
        }
    }

    protected async handleDelete(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const existing = await this.store.get(req.params.id);
        if (!existing) {
            res.status(404).json({ error: 'Parallel run not found.' });
            return;
        }
        if (!this.ownsParallelRun(ctx, existing)) {
            this.auth.denyForbidden(res, req, 'agent_task', { parallelRunId: req.params.id });
            return;
        }
        try {
            await this.store.remove(req.params.id);
            res.json({ ok: true });
        } catch (error) {
            res.status(500).json({ error: this.errorMessage(error) });
        }
    }

    protected requireAuth(req: Request, res: Response): QaapGithubAuthContext | undefined {
        const ctx = this.auth.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return undefined;
        }
        return ctx;
    }

    protected ownsParallelRun(ctx: QaapGithubAuthContext, run: QaapParallelRun): boolean {
        if (ctx.kind === 'skip') {
            return true;
        }
        if (ctx.kind === 'unauthorized') {
            return false;
        }
        if (run.ownerLogin) {
            return run.ownerLogin === ctx.userLogin;
        }
        return this.auth.ownsWorkspacePath(ctx, run.cwd);
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
