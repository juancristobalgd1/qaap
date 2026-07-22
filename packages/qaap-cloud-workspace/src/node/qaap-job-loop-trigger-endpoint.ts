// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { Application, Request, Response } from '@theia/core/shared/express';
import { inject, injectable } from '@theia/core/shared/inversify';
import { QaapGithubAuthGuard } from '@theia/qaap-mobile-shell/lib/node/qaap-github-auth-guard';
import { QAAP_JOB_LOOP_TRIGGER_API_PATH, QaapCreateJobLoopTriggerBody, QaapUpdateJobLoopTriggerBody } from '../common/qaap-job-loop-trigger';
import { QaapJobLoopManagementLock, QaapJobLoopManagementLockTimeoutError } from './qaap-job-loop-management-lock';
import { QaapJobLoopTriggerService } from './qaap-job-loop-trigger-service';
import { QaapJobLoopTriggerStore } from './qaap-job-loop-trigger-store';
import { QaapJobLoopTemplateStore } from './qaap-job-loop-template-store';

@injectable()
export class QaapJobLoopTriggerEndpoint implements BackendApplicationContribution {
    @inject(QaapJobLoopTriggerStore) protected readonly store: QaapJobLoopTriggerStore;
    @inject(QaapJobLoopTriggerService) protected readonly service: QaapJobLoopTriggerService;
    @inject(QaapJobLoopTemplateStore) protected readonly templates: QaapJobLoopTemplateStore;
    @inject(QaapJobLoopManagementLock) protected readonly managementLock: QaapJobLoopManagementLock;
    @inject(QaapGithubAuthGuard) protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        app.get(QAAP_JOB_LOOP_TRIGGER_API_PATH, (req, res) => this.list(req, res));
        app.post(QAAP_JOB_LOOP_TRIGGER_API_PATH, (req, res) => void this.create(req, res));
        app.patch(`${QAAP_JOB_LOOP_TRIGGER_API_PATH}/:id`, (req, res) => void this.update(req, res));
        app.delete(`${QAAP_JOB_LOOP_TRIGGER_API_PATH}/:id`, (req, res) => void this.remove(req, res));
        app.post(`${QAAP_JOB_LOOP_TRIGGER_API_PATH}/:id/fire`, (req, res) => void this.fire(req, res));
        app.post(`${QAAP_JOB_LOOP_TRIGGER_API_PATH}/:id/webhook`, (req, res) => void this.webhook(req, res));
    }
    onStop(): Promise<void> { return this.service.shutdown(); }
    protected list(req: Request, res: Response): void { const owner = this.owner(req, res); if (owner) { res.json({ triggers: this.store.list(owner) }); } }
    protected async create(req: Request, res: Response): Promise<void> {
        const owner = this.owner(req, res); if (!owner) { return; }
        const body = (req.body ?? {}) as QaapCreateJobLoopTriggerBody;
        if (!body || !this.validTitle(body.title) || typeof body.templateId !== 'string' || !body.templateId.trim()) { this.bad(res, 'A template id and title are required.'); return; }
        try {
            let templateMissing = false;
            const created = await this.managementLock.runExclusive(async () => {
                if (!this.templates.get(owner, body.templateId.trim())) {
                    templateMissing = true;
                    return undefined;
                }
                return this.store.create(owner, body);
            });
            if (templateMissing || !created) { this.notFound(res); return; }
            res.status(201).json(created);
        } catch (error) {
            if (this.sendBusy(res, error)) { return; }
            const limited = (error as Error).message === 'trigger_limit';
            if (limited) {
                res.status(429).json({ error: nls.localize(
                    'qaap/jobLoopTriggers/limit', 'You can create at most 100 job loop triggers.',
                ) });
            } else if (this.isRequestError(error)) {
                this.sendInvalid(res);
            } else {
                this.sendFailed(res);
            }
        }
    }
    protected async update(req: Request, res: Response): Promise<void> {
        const owner = this.owner(req, res); if (!owner) { return; }
        const body = (req.body ?? {}) as QaapUpdateJobLoopTriggerBody;
        if (body.title !== undefined && !this.validTitle(body.title)) { this.bad(res, 'A trigger title must contain at most 120 characters.'); return; }
        if (body.templateId !== undefined && (typeof body.templateId !== 'string' || !body.templateId.trim())) {
            this.bad(res, 'A template id must be a non-empty string.');
            return;
        }
        try {
            let templateMissing = false;
            const trigger = await this.managementLock.runExclusive(async () => {
                if (body.templateId !== undefined && !this.templates.get(owner, body.templateId.trim())) {
                    templateMissing = true;
                    return undefined;
                }
                return this.store.update(owner, req.params.id, body);
            });
            if (templateMissing) { this.notFound(res); return; }
            trigger ? res.json(trigger) : this.notFound(res);
        } catch (error) {
            if (this.sendBusy(res, error)) { return; }
            this.isRequestError(error) ? this.sendInvalid(res) : this.sendFailed(res);
        }
    }
    protected async remove(req: Request, res: Response): Promise<void> { const owner = this.owner(req, res); if (!owner) { return; }
        try {
            const deleted = await this.store.delete(owner, req.params.id);
            if (deleted) { res.status(204).end(); } else { this.notFound(res); }
        } catch (error) {
            if (!this.sendBusy(res, error)) { this.sendFailed(res); }
        }
    }
    protected async fire(req: Request, res: Response): Promise<void> { const owner = this.owner(req, res); if (!owner) { return; }
        const trigger = await this.service.fireManual(owner, req.params.id); trigger ? res.json(trigger) : this.notFound(res); }
    protected async webhook(req: Request, res: Response): Promise<void> {
        const secret = req.header('x-qaap-webhook-secret');
        if (!secret || !this.store.verifyWebhookSecret(req.params.id, secret)) { res.status(401).json({ error: nls.localize('qaap/jobLoopTriggers/invalidWebhookSecret', 'Invalid webhook secret.') }); return; }
        const deliveryId = req.header('x-qaap-webhook-delivery-id')?.trim();
        if (deliveryId && deliveryId.length > 256) { res.status(400).json({ error: nls.localize('qaap/jobLoopTriggers/invalidDelivery', 'Invalid webhook delivery id.') }); return; }
        try {
            const status = await this.service.fireWebhook(req.params.id, deliveryId);
            if (status === 'missing') { this.notFound(res); return; }
            res.status(202).json({ accepted: true, duplicate: status === 'duplicate' });
        } catch (error) {
            if (!this.sendBusy(res, error)) { this.sendFailed(res); }
        }
    }
    protected owner(req: Request, res: Response): string | undefined { const context = this.auth.authenticate(req); if (context.kind === 'unauthorized') { res.status(401).json({ error: nls.localize('qaap/auth/notSignedIn', 'Not signed in') }); return undefined; } return context.userLogin; }
    protected bad(res: Response, message: string): void { res.status(400).json({ error: nls.localizeByDefault(message) }); }
    protected notFound(res: Response): void { res.status(404).json({ error: nls.localize('qaap/jobLoopTriggers/notFound', 'Job loop trigger not found.') }); }
    protected validTitle(title: unknown): title is string { return typeof title === 'string' && !!title.trim() && title.trim().length <= 120; }
    protected isRequestError(error: unknown): boolean {
        return error instanceof Error && [
            'invalid_trigger',
            'invalid_cron_schedule',
            'immutable_trigger_type',
        ].includes(error.message);
    }
    protected sendInvalid(res: Response): void {
        res.status(400).json({ error: nls.localize(
            'qaap/jobLoopTriggers/invalidRequest', 'Invalid job loop trigger request.',
        ) });
    }
    protected sendBusy(res: Response, error: unknown): boolean {
        if (!(error instanceof QaapJobLoopManagementLockTimeoutError)) { return false; }
        res.status(503).json({ error: nls.localize(
            'qaap/jobLoopTriggers/busy', 'Job loop automation is busy. Try again in a moment.',
        ) });
        return true;
    }
    protected sendFailed(res: Response): void {
        res.status(500).json({ error: nls.localize(
            'qaap/jobLoopTriggers/failed', 'Job loop automation operation failed.',
        ) });
    }
}
