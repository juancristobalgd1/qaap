// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import {
    QAAP_WORK_HUB_ROUTINE_API_PATH,
    type QaapCreateWorkHubRoutineBody,
    type QaapUpdateWorkHubRoutineBody,
    type QaapWorkHubRoutine,
    type QaapWorkHubRoutineListResponse,
} from '@theia/qaap-mobile-shell/lib/common/qaap-work-hub-routine';
import {
    QaapGithubAuthGuard,
    type QaapGithubAuthContext,
} from '@theia/qaap-mobile-shell/lib/node/qaap-github-auth-guard';
import { isQaapWorkspaceContainerPath, QAAP_CONTAINER_CWD_ERROR } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapWorkHubRoutineRunner } from './qaap-work-hub-routine-runner';
import { QaapWorkHubRoutineStore } from './qaap-work-hub-routine-store';

@injectable()
export class QaapWorkHubRoutineEndpoint implements BackendApplicationContribution {

    @inject(QaapWorkHubRoutineStore)
    protected readonly store: QaapWorkHubRoutineStore;

    @inject(QaapWorkHubRoutineRunner)
    protected readonly runner: QaapWorkHubRoutineRunner;

    @inject(QaapAgentTaskRunner)
    protected readonly taskRunner: QaapAgentTaskRunner;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        app.get(QAAP_WORK_HUB_ROUTINE_API_PATH, (req, res) => {
            const ctx = this.requireAuth(req, res);
            if (!ctx) {
                return;
            }
            res.json({
                routines: this.filterRoutines(ctx, this.store.list()),
                agentConfigured: this.taskRunner.isAgentConfigured(),
                defaultAgent: this.taskRunner.defaultAgent(),
            } satisfies QaapWorkHubRoutineListResponse);
        });
        app.post(QAAP_WORK_HUB_ROUTINE_API_PATH, (req, res) => {
            this.handleCreate(req, res);
        });
        app.patch(`${QAAP_WORK_HUB_ROUTINE_API_PATH}/:id`, (req, res) => {
            this.handleUpdate(req, res);
        });
        app.delete(`${QAAP_WORK_HUB_ROUTINE_API_PATH}/:id`, (req, res) => {
            this.handleDelete(req, res);
        });
        app.post(`${QAAP_WORK_HUB_ROUTINE_API_PATH}/:id/run`, (req, res) => {
            this.handleRun(req, res);
        });
    }

    protected handleCreate(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapCreateWorkHubRoutineBody>;
        if (typeof body.title !== 'string' || typeof body.prompt !== 'string' || typeof body.cwd !== 'string') {
            res.status(400).json({ error: '"title", "prompt", and "cwd" are required.' });
            return;
        }
        if (!body.title.trim() || !body.prompt.trim() || !body.cwd.trim()) {
            res.status(400).json({ error: 'Fields cannot be empty.' });
            return;
        }
        if (!this.auth.ownsWorkspacePath(ctx, body.cwd)) {
            this.auth.denyForbidden(res, req, 'workspace_path', { cwd: body.cwd });
            return;
        }
        // `ownsWorkspacePath` accepts container levels of the caller's OWN tree (their per-user root,
        // an owner directory). A routine stored with such a cwd would run the agent over every repo
        // they own, on every tick. Reject it here, as the conversation/task endpoints already do.
        if (isQaapWorkspaceContainerPath(body.cwd)) {
            res.status(400).json({ error: QAAP_CONTAINER_CWD_ERROR });
            return;
        }
        try {
            const ownerLogin = this.auth.resolveUserLogin(ctx);
            const routine = this.store.create({
                title: body.title,
                prompt: body.prompt,
                cwd: body.cwd,
                agent: body.agent,
                trigger: body.trigger,
                intervalHours: body.intervalHours,
                cronExpression: body.cronExpression,
                timezone: body.timezone,
                oneShot: body.oneShot,
                runMode: body.runMode,
                enabled: body.enabled,
                autoApprove: body.autoApprove,
            }, ownerLogin);
            res.status(201).json(routine);
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
        }
    }

    protected handleUpdate(req: Request, res: Response): void {
        const routine = this.getRoutineIfOwned(req, res, req.params.id);
        if (!routine) {
            return;
        }
        const ctx = this.requireAuth(req, res)!;
        const body = (req.body ?? {}) as QaapUpdateWorkHubRoutineBody;
        if (body.cwd !== undefined && !this.auth.ownsWorkspacePath(ctx, body.cwd)) {
            this.auth.denyForbidden(res, req, 'workspace_path', { cwd: body.cwd });
            return;
        }
        if (body.cwd !== undefined && isQaapWorkspaceContainerPath(body.cwd)) {
            res.status(400).json({ error: QAAP_CONTAINER_CWD_ERROR });
            return;
        }
        const updated = this.store.update(req.params.id, body);
        if (!updated) {
            res.status(404).json({ error: 'Routine not found.' });
            return;
        }
        res.json(updated);
    }

    protected handleDelete(req: Request, res: Response): void {
        if (!this.getRoutineIfOwned(req, res, req.params.id)) {
            return;
        }
        if (!this.store.delete(req.params.id)) {
            res.status(404).json({ error: 'Routine not found.' });
            return;
        }
        res.status(204).end();
    }

    protected handleRun(req: Request, res: Response): void {
        if (!this.getRoutineIfOwned(req, res, req.params.id)) {
            return;
        }
        try {
            const routine = this.runner.runNow(req.params.id);
            res.json(routine);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('not found')) {
                res.status(404).json({ error: message });
                return;
            }
            res.status(500).json({ error: message });
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

    protected getRoutineIfOwned(req: Request, res: Response, routineId: string): QaapWorkHubRoutine | undefined {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return undefined;
        }
        const routine = this.store.get(routineId);
        if (!routine) {
            res.status(404).json({ error: 'Routine not found.' });
            return undefined;
        }
        if (!this.ownsRoutine(ctx, routine)) {
            this.auth.denyForbidden(res, req, 'agent_task', { routineId });
            return undefined;
        }
        return routine;
    }

    protected filterRoutines(ctx: QaapGithubAuthContext, routines: QaapWorkHubRoutine[]): QaapWorkHubRoutine[] {
        return routines.filter(routine => this.ownsRoutine(ctx, routine));
    }

    protected ownsRoutine(ctx: QaapGithubAuthContext, routine: QaapWorkHubRoutine): boolean {
        if (ctx.kind === 'skip') {
            return true;
        }
        if (ctx.kind === 'unauthorized') {
            return false;
        }
        if (routine.ownerLogin) {
            return routine.ownerLogin === ctx.userLogin;
        }
        return this.auth.ownsWorkspacePath(ctx, routine.cwd);
    }
}
