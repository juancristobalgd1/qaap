// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import type { Application, Request } from '@theia/core/shared/express';
import { json } from 'body-parser';
import { BackendApplication, BackendApplicationContribution } from '@theia/core/lib/node';
import { QAAP_GITHUB_API_PATH } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';

const WEBHOOK_PATH = `${QAAP_GITHUB_API_PATH}/webhook`;

export interface QaapRequestWithGithubWebhookRawBody extends Request {
    qaapGithubWebhookRawBody?: string;
}

let jsonMiddlewareInstalled = false;

function installJsonBodyParser(use: BackendApplication['use']): void {
    if (jsonMiddlewareInstalled) {
        return;
    }
    jsonMiddlewareInstalled = true;
    use(json({
        verify: (req, _res, buf, encoding) => {
            const path = String((req as Request).originalUrl ?? req.url ?? '').split('?')[0] ?? '';
            if (path === WEBHOOK_PATH) {
                (req as QaapRequestWithGithubWebhookRawBody).qaapGithubWebhookRawBody =
                    buf.toString((encoding as BufferEncoding | undefined) || 'utf8');
            }
        },
    }));
}

/** Registers JSON parsing early so GitHub webhook HMAC uses the raw POST bytes. */
@injectable()
export class QaapExpressJsonBodyContribution implements BackendApplicationContribution {

    @inject(BackendApplication)
    protected readonly backendApplication: BackendApplication;

    @postConstruct()
    protected init(): void {
        installJsonBodyParser(this.backendApplication.use.bind(this.backendApplication));
    }

    configure(_app: Application): void {
        /* body parser installed in @postConstruct */
    }
}

/** Idempotent fallback when another module configures before postConstruct (tests). */
export function useQaapJsonBodyParser(app: Application): void {
    installJsonBodyParser(app.use.bind(app));
}

export function readGithubWebhookPayload(req: Request): string {
    const raw = (req as QaapRequestWithGithubWebhookRawBody).qaapGithubWebhookRawBody;
    if (raw !== undefined) {
        return raw;
    }
    return typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body ?? {});
}
