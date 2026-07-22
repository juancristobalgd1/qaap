// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { Application, Request, Response } from '@theia/core/shared/express';
import { inject, injectable } from '@theia/core/shared/inversify';
import { QAAP_CONTAINER_CWD_ERROR } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import {
    QaapGithubAuthContext,
    QaapGithubAuthGuard,
} from '@theia/qaap-mobile-shell/lib/node/qaap-github-auth-guard';
import {
    QAAP_JOB_API_PATH,
    QaapCreateJobGraphRequest,
    QaapCreateJobRequest,
    QaapJob,
    QaapJobGraph,
    QaapJobListResponse,
} from '../common/qaap-job';
import {
    QaapJobConflictError,
    QaapJobRequestError,
    QaapJobRuntime,
} from './qaap-job-runtime';

/** Authenticated HTTP API for jobs that do not require a coding agent. */
@injectable()
export class QaapJobEndpoint implements BackendApplicationContribution {

    @inject(QaapJobRuntime)
    protected readonly runtime: QaapJobRuntime;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        app.get(QAAP_JOB_API_PATH, (req, res) => this.handleList(req, res));
        app.get(`${QAAP_JOB_API_PATH}/functions`, (req, res) => this.handleFunctions(req, res));
        app.get(`${QAAP_JOB_API_PATH}/graphs`, (req, res) => this.handleListGraphs(req, res));
        app.get(`${QAAP_JOB_API_PATH}/graphs/:id`, (req, res) => this.handleGetGraph(req, res));
        app.post(QAAP_JOB_API_PATH, (req, res) => this.handleCreate(req, res));
        app.post(`${QAAP_JOB_API_PATH}/graphs`, (req, res) => this.handleCreateGraph(req, res));
        app.get(`${QAAP_JOB_API_PATH}/:id`, (req, res) => this.handleGet(req, res));
        app.post(`${QAAP_JOB_API_PATH}/:id/cancel`, (req, res) => this.handleCancel(req, res));
    }

    onStop(): Promise<void> {
        return this.runtime.shutdown();
    }

    protected handleList(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const owner = this.ownerLogin(ctx);
        const rawCwd = typeof req.query.cwd === 'string' ? req.query.cwd.trim() : '';
        let cwd: string | undefined;
        if (rawCwd) {
            const resolved = this.auth.resolveOwnedRepositoryCwd(ctx, rawCwd);
            if (resolved.kind !== 'ok') {
                this.auth.denyForbidden(res, req, 'agent_task', { cwd: rawCwd });
                return;
            }
            cwd = resolved.cwd;
        }
        const jobs = this.runtime.list(owner).filter(job => !cwd || job.cwd === cwd);
        res.json({ jobs } satisfies QaapJobListResponse);
    }

    protected handleCreate(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        const isFunction = body.kind === 'function';
        if (
            typeof body.cwd !== 'string'
            || (isFunction ? typeof body.functionId !== 'string' : typeof body.command !== 'string')
        ) {
            res.status(400).json({
                error: nls.localize(
                    'qaap/jobs/executorAndCwdRequired',
                    'A command or function id and "cwd" are required.',
                ),
            });
            return;
        }
        const resolved = this.auth.resolveOwnedRepositoryCwd(ctx, body.cwd);
        if (resolved.kind === 'needs-project') {
            res.status(400).json({ error: QAAP_CONTAINER_CWD_ERROR });
            return;
        }
        if (resolved.kind !== 'ok') {
            this.auth.denyForbidden(res, req, 'agent_task', { cwd: body.cwd });
            return;
        }
        const headerKey = req.header('idempotency-key')?.trim();
        const bodyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined;
        if (headerKey && bodyKey && headerKey !== bodyKey) {
            res.status(400).json({
                error: nls.localize(
                    'qaap/jobs/idempotencyHeaderMismatch',
                    'The Idempotency-Key header and request body must match.',
                ),
            });
            return;
        }
        try {
            const result = this.runtime.create({
                ...body,
                cwd: resolved.cwd,
                idempotencyKey: headerKey || bodyKey,
            } as unknown as QaapCreateJobRequest, this.ownerLogin(ctx));
            res.status(result.created ? 201 : 200).json(result.job);
        } catch (error) {
            const status = error instanceof QaapJobConflictError ? 409 : error instanceof QaapJobRequestError ? 400 : 500;
            res.status(status).json({ error: this.errorMessage(error) });
        }
    }

    protected handleFunctions(req: Request, res: Response): void {
        if (!this.requireAuth(req, res)) {
            return;
        }
        res.json({ functions: this.runtime.listFunctions() });
    }

    protected handleCreateGraph(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapCreateJobGraphRequest>;
        if (!Array.isArray(body.nodes)) {
            res.status(400).json({ error: nls.localize('qaap/jobs/graphNodesRequired', '"nodes" are required.') });
            return;
        }
        const nodes: QaapCreateJobGraphRequest['nodes'][number][] = [];
        for (const node of body.nodes) {
            if (!node || typeof node !== 'object' || !node.request || typeof node.request.cwd !== 'string') {
                res.status(400).json({ error: nls.localize('qaap/jobs/invalidGraphNode', 'Invalid graph node.') });
                return;
            }
            const resolved = this.auth.resolveOwnedRepositoryCwd(ctx, node.request.cwd);
            if (resolved.kind === 'needs-project') {
                res.status(400).json({ error: QAAP_CONTAINER_CWD_ERROR });
                return;
            }
            if (resolved.kind !== 'ok') {
                this.auth.denyForbidden(res, req, 'agent_task', { cwd: node.request.cwd });
                return;
            }
            nodes.push({
                key: node.key,
                request: { ...node.request, cwd: resolved.cwd },
                dependsOn: node.dependsOn,
            });
        }
        const headerKey = req.header('idempotency-key')?.trim();
        if (headerKey && body.idempotencyKey && headerKey !== body.idempotencyKey.trim()) {
            res.status(400).json({
                error: nls.localize(
                    'qaap/jobs/idempotencyHeaderMismatch',
                    'The Idempotency-Key header and request body must match.',
                ),
            });
            return;
        }
        try {
            const result = this.runtime.createGraph({
                nodes,
                idempotencyKey: headerKey || body.idempotencyKey,
            }, this.ownerLogin(ctx));
            res.status(result.created ? 201 : 200).json(result);
        } catch (error) {
            const status = error instanceof QaapJobConflictError ? 409 : error instanceof QaapJobRequestError ? 400 : 500;
            res.status(status).json({ error: this.errorMessage(error) });
        }
    }

    protected handleListGraphs(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        res.json({ graphs: this.runtime.listGraphs(this.ownerLogin(ctx)) });
    }

    protected handleGetGraph(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const detail = this.runtime.getGraph(req.params.id);
        if (!detail) {
            res.status(404).json({ error: nls.localize('qaap/jobs/graphNotFound', 'Job graph not found.') });
            return;
        }
        if (!this.ownsGraph(ctx, detail.graph)) {
            this.auth.denyForbidden(res, req, 'agent_task', { graphId: detail.graph.id });
            return;
        }
        res.json(detail);
    }

    protected handleGet(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const job = this.runtime.get(req.params.id);
        if (!job) {
            res.status(404).json({ error: nls.localize('qaap/jobs/notFound', 'Job not found.') });
            return;
        }
        if (!this.ownsJob(ctx, job)) {
            this.auth.denyForbidden(res, req, 'agent_task', { jobId: job.id });
            return;
        }
        res.json(job);
    }

    protected handleCancel(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const existing = this.runtime.get(req.params.id);
        if (!existing) {
            res.status(404).json({ error: nls.localize('qaap/jobs/notFound', 'Job not found.') });
            return;
        }
        if (!this.ownsJob(ctx, existing)) {
            this.auth.denyForbidden(res, req, 'agent_task', { jobId: existing.id });
            return;
        }
        res.json(this.runtime.cancel(existing.id));
    }

    protected requireAuth(req: Request, res: Response): QaapGithubAuthContext | undefined {
        const ctx = this.auth.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            res.status(401).json({ error: nls.localize('qaap/auth/notSignedIn', 'Not signed in') });
            return undefined;
        }
        return ctx;
    }

    protected ownerLogin(ctx: QaapGithubAuthContext): string | undefined {
        return ctx.kind === 'authenticated' ? ctx.userLogin : undefined;
    }

    protected ownsJob(ctx: QaapGithubAuthContext, job: QaapJob): boolean {
        if (ctx.kind === 'skip') {
            return true;
        }
        if (ctx.kind === 'unauthorized') {
            return false;
        }
        return job.ownerLogin ? job.ownerLogin === ctx.userLogin : this.auth.ownsWorkspacePath(ctx, job.cwd);
    }

    protected ownsGraph(ctx: QaapGithubAuthContext, graph: QaapJobGraph): boolean {
        return ctx.kind === 'skip' || (ctx.kind === 'authenticated' && graph.ownerLogin === ctx.userLogin);
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
