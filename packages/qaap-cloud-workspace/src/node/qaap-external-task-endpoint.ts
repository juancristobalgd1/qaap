// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { json } from 'body-parser';
import { QAAP_TENANT_BACKEND_MODE_ENV, QAAP_TENANT_BACKEND_SECRET_ENV } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import {
    QAAP_EXTERNAL_TASK_GITHUB_OPT_IN_PATH,
    QAAP_EXTERNAL_TASK_INTAKE_PATH,
    QAAP_EXTERNAL_TASK_SIGNATURE_HEADER,
    type QaapExternalTaskIntakeRequest,
} from '../common/qaap-external-task';
import { isQaapExternalTasksGithubEnabled } from './qaap-external-task-intake';
import { verifyQaapExternalTaskIntake } from './qaap-external-task-intake-signature';
import { QaapExternalTaskLauncher } from './qaap-external-task-launcher';
import { QaapTaskPullRequestConsentStore } from './qaap-task-pull-request-consent-store';

const REPOSITORY_SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/;

/**
 * HTTP side of external tasks (doc/qaap-external-task-inputs.md):
 * - the per-repository opt-in, set only by the signed-in user in the app (never from GitHub);
 * - `POST /intake`, the control plane's signed hand-off to a tenant backend.
 * Every route answers 404 while `QAAP_EXTERNAL_TASKS_GITHUB` is off, except the opt-in list,
 * which answers `{ available: false }` so the Work Hub's load-time probe stays quiet.
 */
@injectable()
export class QaapExternalTaskEndpoint implements BackendApplicationContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(QaapTaskPullRequestConsentStore)
    protected readonly consents: QaapTaskPullRequestConsentStore;

    @inject(QaapExternalTaskLauncher)
    protected readonly launcher: QaapExternalTaskLauncher;

    configure(app: Application): void {
        app.get(QAAP_EXTERNAL_TASK_GITHUB_OPT_IN_PATH, (req, res) => this.handleListOptIns(req, res));
        app.put(`${QAAP_EXTERNAL_TASK_GITHUB_OPT_IN_PATH}/:owner/:repo`, (req, res) => this.handleSetOptIn(req, res, true));
        app.delete(`${QAAP_EXTERNAL_TASK_GITHUB_OPT_IN_PATH}/:owner/:repo`, (req, res) => this.handleSetOptIn(req, res, false));
        app.post(QAAP_EXTERNAL_TASK_INTAKE_PATH, json({ limit: '256kb' }), (req, res) => {
            void this.handleIntake(req, res);
        });
    }

    protected requireUser(req: Request, res: Response): string | undefined {
        if (!isQaapExternalTasksGithubEnabled()) {
            res.status(404).json({ error: 'GitHub issue tasks are off.' });
            return undefined;
        }
        const ctx = this.auth.authenticate(req);
        const login = ctx.kind === 'unauthorized' ? undefined : this.auth.resolveUserLogin(ctx);
        if (!login) {
            res.status(401).json({ error: 'Not signed in' });
            return undefined;
        }
        return login;
    }

    protected handleListOptIns(req: Request, res: Response): void {
        // The Work Hub probes this on every load; answer "off" with 200 rather than 404 so a
        // disabled feature does not log a failed request in the browser console.
        if (!isQaapExternalTasksGithubEnabled()) {
            res.json({ available: false, repositories: [] });
            return;
        }
        const login = this.requireUser(req, res);
        if (!login) {
            return;
        }
        res.json({ repositories: this.consents.listExternalGithub(login).map(entry => ({ repository: entry.repository, allowedAt: entry.allowedAt })) });
    }

    protected handleSetOptIn(req: Request, res: Response, allow: boolean): void {
        const login = this.requireUser(req, res);
        if (!login) {
            return;
        }
        const owner = String(req.params.owner ?? '');
        const repo = String(req.params.repo ?? '');
        if (!REPOSITORY_SEGMENT.test(owner) || !REPOSITORY_SEGMENT.test(repo) || /^\.+$/.test(owner) || /^\.+$/.test(repo)) {
            res.status(400).json({ error: 'Invalid repository.' });
            return;
        }
        if (allow) {
            this.consents.allowExternalGithub(login, owner, repo);
        } else {
            this.consents.revokeExternalGithub(login, owner, repo);
        }
        res.json({ repository: `${owner}/${repo}`.toLowerCase(), enabled: allow });
    }

    /**
     * Tenant backends only. The tenant assertion says who; the intake signature says the control plane sent it
     * (a browser request through the proxy also carries an assertion, never this signature).
     */
    protected async handleIntake(req: Request, res: Response): Promise<void> {
        if (!isQaapExternalTasksGithubEnabled() || !/^(1|true)$/i.test(process.env[QAAP_TENANT_BACKEND_MODE_ENV]?.trim() ?? '')) {
            res.status(404).json({ error: 'Not found.' });
            return;
        }
        const ctx = this.auth.authenticate(req);
        if (ctx.kind !== 'authenticated') {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        const request = req.body as QaapExternalTaskIntakeRequest | undefined;
        const deliveryId = request?.event?.deliveryId;
        const signature = req.header(QAAP_EXTERNAL_TASK_SIGNATURE_HEADER);
        // The control plane signed JSON.stringify of this very object; re-serializing parsed JSON reproduces it.
        if (!request || typeof deliveryId !== 'string'
            || !verifyQaapExternalTaskIntake(process.env[QAAP_TENANT_BACKEND_SECRET_ENV], signature, ctx.userLogin, deliveryId, JSON.stringify(request))) {
            res.status(403).json({ error: 'Invalid intake signature.' });
            return;
        }
        if (request.requester?.toLowerCase() !== ctx.userLogin.toLowerCase() || (request.kind !== 'launch' && request.kind !== 'refused')) {
            res.status(400).json({ error: 'Invalid intake request.' });
            return;
        }
        const result = await this.launcher.launch(request);
        res.json(result);
    }
}
