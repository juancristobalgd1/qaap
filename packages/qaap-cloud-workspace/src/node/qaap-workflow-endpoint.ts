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
    QAAP_WORKFLOW_API_PATH,
    QaapStartWorkflowRequest,
    QaapWorkflowPendingDecision,
    QaapWorkflowRunListResponse,
    QaapWorkflowRunSummary,
    QaapWorkflowTemplateListResponse,
} from '../common/qaap-workflow-api';
import { QaapWorkflowPromptError } from '../common/qaap-workflow-prompt-registry';
import { resolveQaapWorkflowRunBudget } from '../common/qaap-workflow-run';
import { isQaapVerificationScriptName } from './qaap-agent-verification';
import { QaapWorkflowTemplateRegistry } from '../common/qaap-workflow-template-registry';
import { QaapPersistedWorkflowRun, QaapWorkflowRunRequestError, QaapWorkflowRunStore } from './qaap-workflow-run-store';
import { QaapWorkflowService } from './qaap-workflow-service';

/** Authenticated HTTP API for Dynamic Workflow runs (ADR-001). */
@injectable()
export class QaapWorkflowEndpoint implements BackendApplicationContribution {

    @inject(QaapWorkflowService)
    protected readonly service: QaapWorkflowService;

    @inject(QaapWorkflowRunStore)
    protected readonly store: QaapWorkflowRunStore;

    @inject(QaapWorkflowTemplateRegistry)
    protected readonly templates: QaapWorkflowTemplateRegistry;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        app.get(`${QAAP_WORKFLOW_API_PATH}/templates`, (req, res) => this.handleListTemplates(req, res));
        app.get(QAAP_WORKFLOW_API_PATH, (req, res) => this.handleListRuns(req, res));
        app.post(QAAP_WORKFLOW_API_PATH, (req, res) => void this.handleStart(req, res));
        app.get(`${QAAP_WORKFLOW_API_PATH}/:id`, (req, res) => this.handleGetRun(req, res));
        app.post(`${QAAP_WORKFLOW_API_PATH}/:id/continue`, (req, res) => void this.handleContinue(req, res));
    }

    protected handleListTemplates(req: Request, res: Response): void {
        if (!this.requireAuth(req, res)) {
            return;
        }
        res.json({ templates: this.templates.list() } satisfies QaapWorkflowTemplateListResponse);
    }

    protected handleListRuns(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const runs = this.store.list(this.ownerLogin(ctx)).map(record => this.toSummary(record));
        res.json({ runs } satisfies QaapWorkflowRunListResponse);
    }

    protected async handleStart(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapStartWorkflowRequest>;
        if (typeof body.templateId !== 'string' || typeof body.cwd !== 'string') {
            res.status(400).json({
                error: nls.localize('qaap/workflows/templateAndCwdRequired', '"templateId" and "cwd" are required.'),
            });
            return;
        }
        const template = this.templates.get(body.templateId);
        if (!template) {
            res.status(404).json({
                error: nls.localize('qaap/workflows/unknownTemplate', 'Unknown workflow template "{0}".', body.templateId),
            });
            return;
        }
        const inputs = this.normalizeInputs(body.inputs);
        // Shape-checked here so a malformed name is a 400 rather than a run that quietly verifies
        // something else; whether the repository declares it is resolved at check time.
        const checkScript = typeof body.checkScript === 'string' ? body.checkScript.trim() : undefined;
        if (checkScript !== undefined && !isQaapVerificationScriptName(checkScript)) {
            res.status(400).json({
                error: nls.localize('qaap/workflows/invalidCheckScript', '"checkScript" must be an npm script name.'),
            });
            return;
        }
        const missing = template.summary.requiredInputs.filter(key => !inputs[key]?.trim());
        if (missing.length > 0) {
            res.status(400).json({
                error: nls.localize('qaap/workflows/missingInputs', 'Missing required inputs: {0}.', missing.join(', ')),
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
        try {
            const record = await this.service.start(template.build({
                verify: body.verify === true,
                reviewFix: body.reviewFix === true,
            }), {
                cwd: resolved.cwd,
                ownerLogin: this.ownerLogin(ctx),
                inputs: checkScript ? { ...inputs, checkScript } : inputs,
                goalCheckScript: checkScript,
                budget: resolveQaapWorkflowRunBudget(body),
            });
            res.status(201).json(this.toSummary(record));
        } catch (error) {
            res.status(this.statusFor(error)).json({ error: this.errorMessage(error) });
        }
    }

    protected handleGetRun(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const record = this.store.get(this.ownerLogin(ctx), req.params.id);
        if (!record) {
            res.status(404).json({ error: nls.localize('qaap/workflows/runNotFound', 'Workflow run not found.') });
            return;
        }
        // The trace only on the single-run read: a list of runs stays a list.
        res.json({ ...this.toSummary(record), trace: record.trace });
    }

    protected async handleContinue(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const owner = this.ownerLogin(ctx);
        const record = this.store.get(owner, req.params.id);
        if (!record) {
            res.status(404).json({ error: nls.localize('qaap/workflows/runNotFound', 'Workflow run not found.') });
            return;
        }
        const body = (req.body ?? {}) as { readonly nodeId?: unknown };
        const nodeId = typeof body.nodeId === 'string' ? body.nodeId : undefined;
        // Only a node actually parked at a human gate may be continued, so the endpoint cannot be
        // used to force an arbitrary node's outcome.
        if (!nodeId || record.run.status !== 'awaiting-human' || !record.run.active.includes(nodeId)) {
            res.status(409).json({
                error: nls.localize('qaap/workflows/notAwaitingHuman', 'This run is not awaiting a decision on that node.'),
            });
            return;
        }
        try {
            await this.service.continueAfterHumanGate(owner, record.run.id, nodeId);
            const updated = this.store.get(owner, record.run.id);
            res.json(updated ? this.toSummary(updated) : this.toSummary(record));
        } catch (error) {
            res.status(this.statusFor(error)).json({ error: this.errorMessage(error) });
        }
    }

    protected toSummary(record: QaapPersistedWorkflowRun): QaapWorkflowRunSummary {
        // cwd and inputs stay server-side; only the graph state is public.
        return {
            run: record.run,
            templateId: record.def.id,
            ...(record.goalCheckScript ? { checkScript: record.goalCheckScript } : {}),
            ...(this.pendingDecision(record) ? { pendingDecision: this.pendingDecision(record)! } : {}),
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
        };
    }

    /** The gate this run is parked at, with whatever it asks the person to look at. */
    protected pendingDecision(record: QaapPersistedWorkflowRun): QaapWorkflowPendingDecision | undefined {
        if (record.run.status !== 'awaiting-human') {
            return undefined;
        }
        for (const nodeId of record.run.active) {
            const node = record.def.nodes.find(candidate => candidate.id === nodeId);
            if (node?.kind === 'human-gate') {
                const detail = node.detailArtifactKey ? record.artifacts[node.detailArtifactKey] : undefined;
                return { nodeId, reasonRef: node.reasonRef, ...(detail ? { detail } : {}) };
            }
        }
        return undefined;
    }

    protected normalizeInputs(inputs: unknown): Record<string, string> {
        if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
            return {};
        }
        const normalized: Record<string, string> = {};
        for (const [key, value] of Object.entries(inputs)) {
            if (typeof value === 'string') {
                normalized[key] = value;
            }
        }
        return normalized;
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

    protected statusFor(error: unknown): number {
        return error instanceof QaapWorkflowRunRequestError || error instanceof QaapWorkflowPromptError ? 400 : 500;
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
