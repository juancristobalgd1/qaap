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
    QAAP_JOB_LOOP_API_PATH,
    QaapCreateJobLoopGraphNode,
    QaapCreateJobLoopRequest,
    QaapJobLoop,
    QaapJobLoopListResponse,
    QaapJobLoopStreamSnapshot,
} from '../common/qaap-job-loop';
import {
    QaapJobLoopConflictError,
    QaapJobLoopEngine,
    QaapJobLoopRequestError,
} from './qaap-job-loop-engine';
import { QaapJobConflictError, QaapJobRequestError } from './qaap-job-runtime';

const SSE_HEARTBEAT_MS = 20_000;

/** Authenticated HTTP API for durable bounded loops over independent job graphs. */
@injectable()
export class QaapJobLoopEndpoint implements BackendApplicationContribution {

    @inject(QaapJobLoopEngine)
    protected readonly engine: QaapJobLoopEngine;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        app.get(QAAP_JOB_LOOP_API_PATH, (req, res) => this.handleList(req, res));
        app.get(`${QAAP_JOB_LOOP_API_PATH}/metrics`, (req, res) => this.handleMetrics(req, res));
        app.get(`${QAAP_JOB_LOOP_API_PATH}/events`, (req, res) => this.handleStream(req, res));
        app.post(QAAP_JOB_LOOP_API_PATH, (req, res) => void this.handleCreate(req, res));
        app.get(`${QAAP_JOB_LOOP_API_PATH}/:id/rounds/:iteration`, (req, res) => this.handleRound(req, res));
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

    protected handleMetrics(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        res.json(this.engine.getMetrics(this.ownerLogin(ctx)));
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
        const nodes: QaapCreateJobLoopGraphNode[] = [];
        for (const node of body.graph.nodes) {
            const request = node && typeof node === 'object' ? node.request : undefined;
            const cwd = request?.cwd;
            if (!request || typeof cwd !== 'string') {
                res.status(400).json({ error: nls.localize('qaap/jobLoops/invalidGraphNode', 'Invalid loop graph node.') });
                return;
            }
            const resolved = this.auth.resolveOwnedRepositoryCwd(ctx, cwd);
            if (resolved.kind === 'needs-project') {
                res.status(400).json({ error: QAAP_CONTAINER_CWD_ERROR });
                return;
            }
            if (resolved.kind !== 'ok') {
                this.auth.denyForbidden(res, req, 'agent_task', { cwd });
                return;
            }
            nodes.push({
                key: node.key,
                request: { ...request, cwd: resolved.cwd },
                dependsOn: node.dependsOn,
                bindings: node.bindings,
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

    protected handleRound(req: Request, res: Response): void {
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
        const iteration = Number(req.params.iteration);
        if (!Number.isSafeInteger(iteration) || iteration < 1) {
            res.status(400).json({ error: nls.localize('qaap/jobLoops/invalidRound', 'Invalid loop round.') });
            return;
        }
        const detail = this.engine.getRoundDetail(loop.id, iteration);
        if (!detail) {
            res.status(404).json({ error: nls.localize('qaap/jobLoops/roundNotFound', 'Loop round not found.') });
            return;
        }
        res.json(detail);
    }

    protected handleStream(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const owner = this.ownerLogin(ctx);
        const lastEventId = Number(req.header('last-event-id') ?? 0);
        const afterSequence = Number.isSafeInteger(lastEventId) && lastEventId >= 0 ? lastEventId : 0;
        res.status(200).set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders?.();
        res.write(': qaap-job-loops stream\n\n');
        const snapshot: QaapJobLoopStreamSnapshot = {
            sequence: this.engine.currentSequence(),
            loops: this.engine.list(owner),
            metrics: this.engine.getMetrics(owner),
        };
        res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
        const writeEvent = (event: ReturnType<QaapJobLoopEngine['eventsSince']>[number]): void => {
            res.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        };
        for (const event of this.engine.eventsSince(owner, afterSequence)) {
            writeEvent(event);
        }
        const subscription = this.engine.onDidChangeLoop(event => {
            if (event.ownerLogin === owner) {
                writeEvent(event);
            }
        });
        const heartbeat = setInterval(() => res.write('event: heartbeat\ndata: {}\n\n'), SSE_HEARTBEAT_MS);
        heartbeat.unref?.();
        let cleaned = false;
        const cleanup = (): void => {
            if (cleaned) {
                return;
            }
            cleaned = true;
            clearInterval(heartbeat);
            subscription.dispose();
        };
        req.on('close', cleanup);
        res.on('close', cleanup);
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
        return ctx.kind === 'authenticated' || ctx.kind === 'skip' ? ctx.userLogin : undefined;
    }

    protected ownsLoop(ctx: QaapGithubAuthContext, loop: QaapJobLoop): boolean {
        return ctx.kind === 'skip' || (ctx.kind === 'authenticated' && loop.ownerLogin === ctx.userLogin);
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
