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
import { QaapCreateJobGraphNode } from '../common/qaap-job';
import {
    QAAP_JOB_LOOP_API_PATH,
    QaapCreateJobLoopRequest,
    QaapJobLoop,
    QaapJobLoopListResponse,
} from '../common/qaap-job-loop';
import {
    QaapJobLoopConflictError,
    QaapJobLoopEngine,
    QaapJobLoopRequestError,
} from './qaap-job-loop-engine';
import { QaapJobConflictError, QaapJobRequestError } from './qaap-job-runtime';

/** Authenticated HTTP API for durable bounded loops over independent job graphs. */
@injectable()
export class QaapJobLoopEndpoint implements BackendApplicationContribution {

    @inject(QaapJobLoopEngine)
    protected readonly engine: QaapJobLoopEngine;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        app.get(QAAP_JOB_LOOP_API_PATH, (req, res) => this.handleList(req, res));
        app.post(QAAP_JOB_LOOP_API_PATH, (req, res) => void this.handleCreate(req, res));
        app.get(`${QAAP_JOB_LOOP_API_PATH}/:id`, (req, res) => this.handleGet(req, res));
        app.post(`${QAAP_JOB_LOOP_API_PATH}/:id/cancel`, (req, res) => void this.handleCancel(req, res));
    }

    onStop(): Promise<void> {
        return this.engine.shutdown();
    }

    protected handleList(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        res.json({ loops: this.engine.list(this.ownerLogin(ctx)) } satisfies QaapJobLoopListResponse);
    }

    protected async handleCreate(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapCreateJobLoopRequest>;
        if (!body.graph || !Array.isArray(body.graph.nodes)) {
            res.status(400).json({ error: nls.localize('qaap/jobLoops/graphNodesRequired', 'Loop graph "nodes" are required.') });
            return;
        }
        const nodes: QaapCreateJobGraphNode[] = [];
        for (const node of body.graph.nodes) {
            if (!node || typeof node !== 'object' || !node.request || typeof node.request.cwd !== 'string') {
                res.status(400).json({ error: nls.localize('qaap/jobLoops/invalidGraphNode', 'Invalid loop graph node.') });
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
            const result = await this.engine.create({
                title: body.title,
                graph: { nodes },
                until: body.until!,
                maxIterations: body.maxIterations,
                maxDurationMs: body.maxDurationMs,
                idempotencyKey: headerKey || bodyKey,
            }, this.ownerLogin(ctx));
            res.status(result.created ? 201 : 200).json(result);
        } catch (error) {
            const conflict = error instanceof QaapJobLoopConflictError || error instanceof QaapJobConflictError;
            const badRequest = error instanceof QaapJobLoopRequestError || error instanceof QaapJobRequestError;
            res.status(conflict ? 409 : badRequest ? 400 : 500).json({ error: this.errorMessage(error) });
        }
    }

    protected handleGet(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const loop = this.engine.get(req.params.id);
        if (!loop) {
            res.status(404).json({ error: nls.localize('qaap/jobLoops/notFound', 'Job loop not found.') });
            return;
        }
        if (!this.ownsLoop(ctx, loop)) {
            this.auth.denyForbidden(res, req, 'agent_task', { loopId: loop.id });
            return;
        }
        res.json(loop);
    }

    protected async handleCancel(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const loop = this.engine.get(req.params.id);
        if (!loop) {
            res.status(404).json({ error: nls.localize('qaap/jobLoops/notFound', 'Job loop not found.') });
            return;
        }
        if (!this.ownsLoop(ctx, loop)) {
            this.auth.denyForbidden(res, req, 'agent_task', { loopId: loop.id });
            return;
        }
        const owner = ctx.kind === 'skip' ? loop.ownerLogin : this.ownerLogin(ctx);
        res.json(await this.engine.cancel(loop.id, owner));
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

    protected ownsLoop(ctx: QaapGithubAuthContext, loop: QaapJobLoop): boolean {
        return ctx.kind === 'skip' || (ctx.kind === 'authenticated' && loop.ownerLogin === ctx.userLogin);
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
