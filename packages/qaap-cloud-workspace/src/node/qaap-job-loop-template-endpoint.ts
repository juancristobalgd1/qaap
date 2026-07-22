// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { Application, Request, Response } from '@theia/core/shared/express';
import { inject, injectable } from '@theia/core/shared/inversify';
import * as path from 'path';
import { QAAP_CONTAINER_CWD_ERROR } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import { QaapGithubAuthContext, QaapGithubAuthGuard } from '@theia/qaap-mobile-shell/lib/node/qaap-github-auth-guard';
import { QaapCreateJobLoopGraphNode, QaapCreateJobLoopRequest } from '../common/qaap-job-loop';
import {
    QAAP_JOB_LOOP_TEMPLATE_API_PATH,
    QaapCreateJobLoopTemplateRequest,
    QaapDeleteJobLoopTemplateRequest,
    QaapImportJobLoopTemplateRequest,
    QaapJobLoopTemplateDefinition,
    QaapJobLoopTemplateListResponse,
    QaapRunJobLoopTemplateRequest,
    QaapUpdateJobLoopTemplateRequest,
} from '../common/qaap-job-loop-template';
import { QaapJobLoopConflictError, QaapJobLoopEngine, QaapJobLoopRequestError } from './qaap-job-loop-engine';
import { QaapJobLoopManagementLock, QaapJobLoopManagementLockTimeoutError } from './qaap-job-loop-management-lock';
import {
    QaapJobLoopTemplateConflictError,
    QaapJobLoopTemplateRequestError,
    QaapJobLoopTemplateStore,
} from './qaap-job-loop-template-store';
import { QaapJobLoopTriggerStore } from './qaap-job-loop-trigger-store';

class QaapJobLoopTemplateForbiddenError extends Error { }

/** Authenticated API for reusable private job-loop definitions. */
@injectable()
export class QaapJobLoopTemplateEndpoint implements BackendApplicationContribution {

    @inject(QaapJobLoopTemplateStore)
    protected readonly store: QaapJobLoopTemplateStore;

    @inject(QaapJobLoopEngine)
    protected readonly engine: QaapJobLoopEngine;

    @inject(QaapJobLoopTriggerStore)
    protected readonly triggers: QaapJobLoopTriggerStore;

    @inject(QaapJobLoopManagementLock)
    protected readonly managementLock: QaapJobLoopManagementLock;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        app.get(QAAP_JOB_LOOP_TEMPLATE_API_PATH, (req, res) => this.handleList(req, res));
        app.post(QAAP_JOB_LOOP_TEMPLATE_API_PATH, (req, res) => void this.handleCreate(req, res));
        app.post(`${QAAP_JOB_LOOP_TEMPLATE_API_PATH}/import`, (req, res) => void this.handleImport(req, res));
        app.get(`${QAAP_JOB_LOOP_TEMPLATE_API_PATH}/:id/export`, (req, res) => this.handleExport(req, res));
        app.post(`${QAAP_JOB_LOOP_TEMPLATE_API_PATH}/:id/run`, (req, res) => void this.handleRun(req, res));
        app.get(`${QAAP_JOB_LOOP_TEMPLATE_API_PATH}/:id`, (req, res) => this.handleGet(req, res));
        app.patch(`${QAAP_JOB_LOOP_TEMPLATE_API_PATH}/:id`, (req, res) => void this.handleUpdate(req, res));
        app.delete(`${QAAP_JOB_LOOP_TEMPLATE_API_PATH}/:id`, (req, res) => void this.handleDelete(req, res));
    }

    protected handleList(req: Request, res: Response): void {
        const context = this.requireAuth(req, res);
        if (context) {
            res.json({ templates: this.store.list(this.ownerLogin(context)) } satisfies QaapJobLoopTemplateListResponse);
        }
    }

    protected async handleCreate(req: Request, res: Response): Promise<void> {
        const context = this.requireAuth(req, res);
        if (!context) {
            return;
        }
        try {
            const body = req.body as QaapCreateJobLoopTemplateRequest;
            const definition = await this.canonicalizeDefinition(context, body?.definition);
            const template = await this.store.create({ ...body, definition }, this.ownerLogin(context));
            res.status(201).json(template);
        } catch (error) {
            this.sendError(res, error);
        }
    }

    protected handleGet(req: Request, res: Response): void {
        const context = this.requireAuth(req, res);
        if (!context) {
            return;
        }
        const template = this.store.get(this.ownerLogin(context), req.params.id);
        if (!template) {
            this.notFound(res);
            return;
        }
        res.json(template);
    }

    protected async handleUpdate(req: Request, res: Response): Promise<void> {
        const context = this.requireAuth(req, res);
        if (!context) {
            return;
        }
        try {
            const body = req.body as QaapUpdateJobLoopTemplateRequest;
            const definition = body?.definition === undefined ? undefined : await this.canonicalizeDefinition(context, body.definition);
            const template = await this.store.update(req.params.id, { ...body, ...(definition ? { definition } : {}) }, this.ownerLogin(context));
            if (!template) {
                this.notFound(res);
                return;
            }
            res.json(template);
        } catch (error) {
            this.sendError(res, error);
        }
    }

    protected async handleDelete(req: Request, res: Response): Promise<void> {
        const context = this.requireAuth(req, res);
        if (!context) {
            return;
        }
        try {
            const owner = this.ownerLogin(context);
            const deleted = await this.managementLock.runExclusive(async () => {
                if (owner && this.triggers.list(owner).some(trigger => trigger.templateId === req.params.id)) {
                    throw new QaapJobLoopTemplateConflictError(nls.localize(
                        'qaap/jobLoopTemplates/inUse',
                        'Delete this template\'s triggers before deleting the template.',
                    ));
                }
                return this.store.delete(req.params.id, (req.body as QaapDeleteJobLoopTemplateRequest)?.revision, owner);
            });
            if (!deleted) {
                this.notFound(res);
                return;
            }
            res.status(204).end();
        } catch (error) {
            this.sendError(res, error);
        }
    }

    protected handleExport(req: Request, res: Response): void {
        const context = this.requireAuth(req, res);
        if (!context) {
            return;
        }
        const document = this.store.export(this.ownerLogin(context), req.params.id);
        if (!document) {
            this.notFound(res);
            return;
        }
        const workspaceRoot = this.auth.userWorkspaceRoot(context);
        if (!workspaceRoot) {
            res.json(document);
            return;
        }
        res.json({
            ...document,
            template: {
                ...document.template,
                definition: {
                    ...document.template.definition,
                    graph: {
                        nodes: document.template.definition.graph.nodes.map(node => {
                            const relative = path.relative(workspaceRoot, node.request.cwd);
                            const portableCwd = relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
                                ? relative.split(path.sep).join('/')
                                : node.request.cwd;
                            return { ...node, request: { ...node.request, cwd: portableCwd } };
                        }),
                    },
                },
            },
        });
    }

    protected async handleImport(req: Request, res: Response): Promise<void> {
        const context = this.requireAuth(req, res);
        if (!context) {
            return;
        }
        try {
            const body = req.body as QaapImportJobLoopTemplateRequest;
            const document = body?.document;
            if (!document || typeof document !== 'object' || !document.template || typeof document.template !== 'object') {
                throw new QaapJobLoopTemplateRequestError(nls.localize(
                    'qaap/jobLoopTemplates/invalidImport', 'Invalid job loop template import document.',
                ));
            }
            const definition = await this.canonicalizeDefinition(context, document.template.definition);
            const result = await this.store.import({ document: {
                ...document,
                template: { ...document.template, definition },
            } }, this.ownerLogin(context));
            res.status(result.created ? 201 : 200).json(result);
        } catch (error) {
            this.sendError(res, error);
        }
    }

    protected async handleRun(req: Request, res: Response): Promise<void> {
        const context = this.requireAuth(req, res);
        if (!context) {
            return;
        }
        const template = this.store.get(this.ownerLogin(context), req.params.id);
        if (!template) {
            this.notFound(res);
            return;
        }
        const body = (req.body ?? {}) as QaapRunJobLoopTemplateRequest;
        const headerKey = req.header('idempotency-key')?.trim();
        const bodyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined;
        if (headerKey && bodyKey && headerKey !== bodyKey) {
            res.status(400).json({ error: nls.localize(
                'qaap/jobLoopTemplates/idempotencyHeaderMismatch', 'The Idempotency-Key header and request body must match.',
            ) });
            return;
        }
        try {
            const definition = await this.canonicalizeDefinition(context, template.definition);
            const result = await this.engine.create({ ...definition, idempotencyKey: headerKey || bodyKey }, this.ownerLogin(context));
            res.status(result.created ? 201 : 200).json(result);
        } catch (error) {
            this.sendError(res, error);
        }
    }

    /** CWD is authorization-sensitive, so every execution is canonicalized afresh. */
    protected async canonicalizeDefinition(
        context: QaapGithubAuthContext,
        definition: QaapJobLoopTemplateDefinition | undefined,
    ): Promise<Omit<QaapCreateJobLoopRequest, 'idempotencyKey'>> {
        if (!definition || typeof definition !== 'object' || !definition.graph || !Array.isArray(definition.graph.nodes)) {
            throw new QaapJobLoopTemplateRequestError(nls.localize(
                'qaap/jobLoopTemplates/graphNodesRequired', 'Template loop graph "nodes" are required.',
            ));
        }
        const nodes: QaapCreateJobLoopGraphNode[] = [];
        for (const node of definition.graph.nodes) {
            const request = node && typeof node === 'object' ? node.request : undefined;
            const cwd = request?.cwd;
            if (!request || typeof cwd !== 'string') {
                throw new QaapJobLoopTemplateRequestError(nls.localize(
                    'qaap/jobLoopTemplates/invalidGraphNode', 'Invalid template loop graph node.',
                ));
            }
            const resolved = this.auth.resolveOwnedRepositoryCwd(context, cwd);
            if (resolved.kind === 'needs-project') {
                throw new QaapJobLoopTemplateRequestError(QAAP_CONTAINER_CWD_ERROR);
            }
            if (resolved.kind !== 'ok') {
                throw new QaapJobLoopTemplateForbiddenError(nls.localize(
                    'qaap/jobLoopTemplates/forbiddenWorkspace', 'This template refers to a workspace you cannot use.',
                ));
            }
            nodes.push({ key: node.key, request: { ...request, cwd: resolved.cwd }, dependsOn: node.dependsOn, bindings: node.bindings });
        }
        const canonical: Omit<QaapCreateJobLoopRequest, 'idempotencyKey'> = {
            title: definition.title,
            graph: { nodes },
            until: definition.until,
            maxIterations: definition.maxIterations,
            maxDurationMs: definition.maxDurationMs,
        };
        this.engine.validate(canonical);
        return canonical;
    }

    protected requireAuth(req: Request, res: Response): QaapGithubAuthContext | undefined {
        const context = this.auth.authenticate(req);
        if (context.kind === 'unauthorized') {
            res.status(401).json({ error: nls.localize('qaap/auth/notSignedIn', 'Not signed in') });
            return undefined;
        }
        return context;
    }

    protected ownerLogin(context: QaapGithubAuthContext): string | undefined {
        return context.kind === 'authenticated' || context.kind === 'skip' ? context.userLogin : undefined;
    }

    protected notFound(res: Response): void {
        res.status(404).json({ error: nls.localize('qaap/jobLoopTemplates/notFound', 'Job loop template not found.') });
    }

    protected sendError(res: Response, error: unknown): void {
        if (error instanceof QaapJobLoopManagementLockTimeoutError) {
            res.status(503).json({ error: nls.localize(
                'qaap/jobLoopTemplates/busy', 'Job loop template storage is busy. Try again in a moment.',
            ) });
            return;
        }
        const conflict = error instanceof QaapJobLoopTemplateConflictError || error instanceof QaapJobLoopConflictError;
        const forbidden = error instanceof QaapJobLoopTemplateForbiddenError;
        const badRequest = error instanceof QaapJobLoopTemplateRequestError || error instanceof QaapJobLoopRequestError;
        res.status(conflict ? 409 : forbidden ? 403 : badRequest ? 400 : 500).json({ error: error instanceof Error ? error.message : nls.localize('qaap/jobLoopTemplates/failed', 'Job loop template operation failed.') });
    }
}
