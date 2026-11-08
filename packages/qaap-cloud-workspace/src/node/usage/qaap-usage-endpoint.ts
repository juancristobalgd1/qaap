// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import {
    QAAP_USAGE_LIMITS_PATH,
    QAAP_USAGE_SUMMARY_PATH,
    type QaapUsageProviderId,
    type QaapUsageRange,
} from '@theia/qaap-shared-core/lib/common/qaap-usage-summary-protocol';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import { QaapAsyncRoute } from '@theia/qaap-shared-core/lib/node/qaap-async-route';
import { isQaapHostedProductionRuntime } from '@theia/qaap-shared-core/lib/node/qaap-production-auth-readiness';
import { QAAP_BACKEND_ISOLATION_MODE } from '@theia/qaap-adapters/lib/common/qaap-backend-isolation';
import { isQaapTenantBackendMode } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { QaapUsageAggregator } from './qaap-usage-aggregator';
import { QaapUsageLimitsService } from './qaap-usage-limits';
import { QaapUsagePriceList } from './qaap-usage-prices';
import { QaapUsageScanner } from './qaap-usage-scanner';
import { QaapUsageTime } from './qaap-usage-time';

const RANGES: readonly QaapUsageRange[] = ['24h', '7d', '30d', '90d'];
const PROVIDERS: readonly QaapUsageProviderId[] = ['claude', 'codex', 'opencode', 'pi', 'grok', 'copilot'];
const DEFAULT_RANGE: QaapUsageRange = '7d';

/**
 * Usage summary and limits for the signed-in user, read from the logs of the backend's own home directory.
 * On hosted runtimes only a per-tenant backend serves it: a shared backend's home directory belongs to the operator.
 */
@injectable()
export class QaapUsageEndpoint implements BackendApplicationContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(QaapUsageScanner)
    protected readonly scanner: QaapUsageScanner;

    @inject(QaapUsageLimitsService)
    protected readonly limits: QaapUsageLimitsService;

    protected readonly aggregator = new QaapUsageAggregator(QaapUsagePriceList.loadBundled());

    configure(app: Application): void {
        app.get(QAAP_USAGE_SUMMARY_PATH, QaapAsyncRoute.wrap('qaap-usage', (req, res) => this.handleSummary(req, res)));
        app.get(QAAP_USAGE_LIMITS_PATH, QaapAsyncRoute.wrap('qaap-usage', (req, res) => this.handleLimits(req, res)));
    }

    protected async handleSummary(req: Request, res: Response): Promise<void> {
        if (!this.allowedOnThisBackend(res) || !this.requireLogin(req, res)) {
            return;
        }
        const range = this.queryValue(req, 'range') ?? DEFAULT_RANGE;
        if (!RANGES.includes(range as QaapUsageRange)) {
            res.status(400).json({ error: 'range must be one of 24h, 7d, 30d, 90d' });
            return;
        }
        const providerParam = this.queryValue(req, 'provider');
        if (providerParam !== undefined && !PROVIDERS.includes(providerParam as QaapUsageProviderId)) {
            res.status(400).json({ error: `provider must be one of ${PROVIDERS.join(', ')}` });
            return;
        }
        const timezone = this.queryValue(req, 'tz') ?? QaapUsageTime.defaultTimeZone();
        if (!QaapUsageTime.isValidTimeZone(timezone)) {
            res.status(400).json({ error: 'tz must be an IANA timezone name' });
            return;
        }
        // Starts the first scan on the first request and refreshes the ledger later; this response reads what is there now.
        this.scanner.refreshInBackground();
        res.json(this.aggregator.summarize(this.scanner.getLedger(), {
            range: range as QaapUsageRange,
            timezone,
            provider: providerParam as QaapUsageProviderId | undefined,
            nowMs: Date.now(),
            scanning: !this.scanner.hasCompletedScan(),
        }));
    }

    protected async handleLimits(req: Request, res: Response): Promise<void> {
        if (!this.allowedOnThisBackend(res) || !this.requireLogin(req, res)) {
            return;
        }
        res.json(await this.limits.getLimits());
    }

    /**
     * On a hosted runtime only a per-tenant backend process may answer: its home directory belongs to one user.
     * The shared control plane's home belongs to the operator and must never be read for other users.
     */
    protected allowedOnThisBackend(res: Response): boolean {
        const perTenant = QAAP_BACKEND_ISOLATION_MODE === 'per-tenant' && isQaapTenantBackendMode();
        if (isQaapHostedProductionRuntime() && !perTenant) {
            res.status(403).json({ error: 'Usage is only available with per-tenant backends' });
            return false;
        }
        return true;
    }

    protected queryValue(req: Request, name: string): string | undefined {
        const value = req.query[name];
        return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    }

    protected requireLogin(req: Request, res: Response): string | undefined {
        const ctx = this.auth.authenticate(req);
        const login = ctx.kind === 'unauthorized' ? undefined : this.auth.resolveUserLogin(ctx);
        if (!login) {
            res.status(401).json({ error: 'Not signed in' });
            return undefined;
        }
        return login;
    }
}
