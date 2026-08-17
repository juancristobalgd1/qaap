// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { json } from 'body-parser';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { QAAP_USER_SETTINGS_API_PATH } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { QaapGithubAuthGuard } from '@theia/qaap-mobile-shell/lib/node/qaap-github-auth-guard';
import {
    filterAiSettings,
    readUserSettingsFromDisk,
    writeUserSettingsToDisk,
} from './qaap-agent-task-runner-utils2';

/** GET/PUT per-user AI/BYOK settings (`~/.qaap/users/{login}/settings.json`). */
@injectable()
export class QaapUserAiSettingsEndpoint implements BackendApplicationContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        app.use(json());
        app.get(QAAP_USER_SETTINGS_API_PATH, (req, res) => this.handleGet(req, res));
        app.put(QAAP_USER_SETTINGS_API_PATH, (req, res) => this.handlePut(req, res));
    }

    protected handleGet(req: Request, res: Response): void {
        const login = this.requireLogin(req, res);
        if (!login) {
            return;
        }
        res.json({ settings: filterAiSettings(readUserSettingsFromDisk(login)) });
    }

    protected handlePut(req: Request, res: Response): void {
        const login = this.requireLogin(req, res);
        if (!login) {
            return;
        }
        const body = (req.body ?? {}) as { settings?: unknown };
        if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
            res.status(400).json({ error: '"settings" object is required.' });
            return;
        }
        try {
            const settings = writeUserSettingsToDisk(login, body.settings as Record<string, unknown>);
            res.json({ settings });
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
        }
    }

    protected requireLogin(req: Request, res: Response): string | undefined {
        const ctx = this.auth.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return undefined;
        }
        const login = this.auth.resolveUserLogin(ctx);
        if (!login) {
            res.status(401).json({ error: 'Not signed in' });
            return undefined;
        }
        return login;
    }
}
