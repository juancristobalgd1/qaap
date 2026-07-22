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
import { QaapJobLoopTriggerService } from './qaap-job-loop-trigger-service';
import { QaapJobLoopTriggerStore } from './qaap-job-loop-trigger-store';
import { QaapJobLoopTemplateStore } from './qaap-job-loop-template-store';

@injectable()
export class QaapJobLoopTriggerEndpoint implements BackendApplicationContribution {
    @inject(QaapJobLoopTriggerStore) protected readonly store: QaapJobLoopTriggerStore;
    @inject(QaapJobLoopTriggerService) protected readonly service: QaapJobLoopTriggerService;
    @inject(QaapJobLoopTemplateStore) protected readonly templates: QaapJobLoopTemplateStore;
    @inject(QaapGithubAuthGuard) protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        app.get(QAAP_JOB_LOOP_TRIGGER_API_PATH, (req, res) => this.list(req, res));
        app.post(QAAP_JOB_LOOP_TRIGGER_API_PATH, (req, res) => this.create(req, res));
        app.patch(`${QAAP_JOB_LOOP_TRIGGER_API_PATH}/:id`, (req, res) => this.update(req, res));
        app.delete(`${QAAP_JOB_LOOP_TRIGGER_API_PATH}/:id`, (req, res) => this.remove(req, res));
        app.post(`${QAAP_JOB_LOOP_TRIGGER_API_PATH}/:id/fire`, (req, res) => void this.fire(req, res));
        app.post(`${QAAP_JOB_LOOP_TRIGGER_API_PATH}/:id/webhook`, (req, res) => void this.webhook(req, res));
    }
    onStop(): Promise<void> { return this.service.shutdown(); }
    protected list(req: Request, res: Response): void { const owner = this.owner(req, res); if (owner) { res.json({ triggers: this.store.list(owner) }); } }
    protected create(req: Request, res: Response): void {
        const owner = this.owner(req, res); if (!owner) { return; }
        const body = (req.body ?? {}) as QaapCreateJobLoopTriggerBody;
        if (!body || !this.validTitle(body.title) || typeof body.templateId !== 'string' || !body.templateId.trim()) { this.bad(res, 'A template id and title are required.'); return; }
        if (!this.templates.get(owner, body.templateId.trim())) { this.notFound(res); return; }
        try { res.status(201).json(this.store.create(owner, body)); } catch (error) {
            const limited = (error as Error).message === 'trigger_limit';
            res.status(limited ? 429 : 400).json({ error: limited
                ? nls.localize('qaap/jobLoopTriggers/limit', 'You can create at most 100 job loop triggers.')
                : nls.localize('qaap/jobLoopTriggers/invalidRequest', 'Invalid job loop trigger request.') });
        }
    }
    protected update(req: Request, res: Response): void {
        const owner = this.owner(req, res); if (!owner) { return; }
        const body = (req.body ?? {}) as QaapUpdateJobLoopTriggerBody;
        if (body.title !== undefined && !this.validTitle(body.title)) { this.bad(res, 'A trigger title must contain at most 120 characters.'); return; }
        if (body.templateId !== undefined && !this.templates.get(owner, body.templateId.trim())) { this.notFound(res); return; }
        try { const trigger = this.store.update(owner, req.params.id, body);
            trigger ? res.json(trigger) : this.notFound(res);
        } catch { res.status(400).json({ error: nls.localize('qaap/jobLoopTriggers/invalidRequest', 'Invalid job loop trigger request.') }); }
    }
    protected remove(req: Request, res: Response): void { const owner = this.owner(req, res); if (!owner) { return; }
        this.store.delete(owner, req.params.id) ? res.status(204).end() : this.notFound(res); }
    protected async fire(req: Request, res: Response): Promise<void> { const owner = this.owner(req, res); if (!owner) { return; }
        const trigger = await this.service.fireManual(owner, req.params.id); trigger ? res.json(trigger) : this.notFound(res); }
    protected async webhook(req: Request, res: Response): Promise<void> {
        const secret = req.header('x-qaap-webhook-secret');
        if (!secret || !this.store.verifyWebhookSecret(req.params.id, secret)) { res.status(401).json({ error: nls.localize('qaap/jobLoopTriggers/invalidWebhookSecret', 'Invalid webhook secret.') }); return; }
        const deliveryId = req.header('x-qaap-webhook-delivery-id')?.trim();
        if (deliveryId && deliveryId.length > 256) { res.status(400).json({ error: nls.localize('qaap/jobLoopTriggers/invalidDelivery', 'Invalid webhook delivery id.') }); return; }
        const status = await this.service.fireWebhook(req.params.id, deliveryId);
        if (status === 'missing') { this.notFound(res); return; }
        res.status(202).json({ accepted: true, duplicate: status === 'duplicate' });
    }
    protected owner(req: Request, res: Response): string | undefined { const context = this.auth.authenticate(req); if (context.kind === 'unauthorized') { res.status(401).json({ error: nls.localize('qaap/auth/notSignedIn', 'Not signed in') }); return undefined; } return context.userLogin; }
    protected bad(res: Response, message: string): void { res.status(400).json({ error: nls.localizeByDefault(message) }); }
    protected notFound(res: Response): void { res.status(404).json({ error: nls.localize('qaap/jobLoopTriggers/notFound', 'Job loop trigger not found.') }); }
    protected validTitle(title: unknown): title is string { return typeof title === 'string' && !!title.trim() && title.trim().length <= 120; }
}
