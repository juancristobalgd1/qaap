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
import { isQaapTenantBackendMode, QAAP_TENANT_LOGIN_ENV } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { QaapUsageAggregator } from './qaap-usage-aggregator';
import { QaapUsageLimitsService } from './qaap-usage-limits';
import { QaapUsagePriceList } from './qaap-usage-prices';
import { QaapUsageScannerRegistry } from './qaap-usage-scanner-registry';
import { QaapUsageTime } from './qaap-usage-time';

const RANGES: readonly QaapUsageRange[] = ['24h', '7d', '30d', '90d'];
const PROVIDERS: readonly QaapUsageProviderId[] = ['claude', 'codex', 'opencode', 'pi', 'grok', 'copilot'];
const DEFAULT_RANGE: QaapUsageRange = '7d';

/**
 * Usage summary and limits for the signed-in user, read from the logs in the home their agents run with (see
 * `QaapUsageScanTargetResolver`): the user's own home on desktop, the tenant agent home on a per-tenant backend.
 * On hosted runtimes only a per-tenant backend serves it: a shared backend's home directory belongs to the operator.
 */
@injectable()
export class QaapUsageEndpoint implements BackendApplicationContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(QaapUsageScannerRegistry)
    protected readonly scanners: QaapUsageScannerRegistry;

    @inject(QaapUsageLimitsService)
    protected readonly limits: QaapUsageLimitsService;

    protected readonly aggregator = new QaapUsageAggregator(QaapUsagePriceList.loadBundled());

    configure(app: Application): void {
        app.get(QAAP_USAGE_SUMMARY_PATH, QaapAsyncRoute.wrap('qaap-usage', (req, res) => this.handleSummary(req, res)));
        app.get(QAAP_USAGE_LIMITS_PATH, QaapAsyncRoute.wrap('qaap-usage', (req, res) => this.handleLimits(req, res)));
    }

    protected async handleSummary(req: Request, res: Response): Promise<void> {
        if (!this.allowedOnThisBackend(res)) {
            return;
        }
        const login = this.requireLogin(req, res);
        if (!login) {
            return;
        }
        const range = this.queryValue(req, 'range') ?? DEFAULT_RANGE;
        if (!RANGES.includes(range as QaapUsageRange)) {
            res.status(400).json({ error: 'range must be one of 24h, 7d, 30d, 90d' });
            return;
        }
        const providers = this.parseProviderList(this.queryValue(req, 'provider'));
        if (providers === undefined) {
            res.status(400).json({ error: `provider must be a comma-separated list of ${PROVIDERS.join(', ')}` });
            return;
        }
        const timezone = this.queryValue(req, 'tz') ?? QaapUsageTime.defaultTimeZone();
        if (!QaapUsageTime.isValidTimeZone(timezone)) {
            res.status(400).json({ error: 'tz must be an IANA timezone name' });
            return;
        }
        const { scanner } = this.scanners.forOwner(login);
        // Starts the first scan on the first request and refreshes the ledger later; this response reads what is there now.
        scanner.refreshInBackground();
        res.json(this.aggregator.summarize(scanner.getLedger(), {
            range: range as QaapUsageRange,
            timezone,
            providers,
            nowMs: Date.now(),
            scanning: !scanner.hasCompletedScan(),
        }));
    }

    /**
     * Parses `provider=claude,codex`. A missing or empty value means every provider (`[]`).
     * Returns `undefined` when any id is not a known provider.
     */
    protected parseProviderList(raw: string | undefined): QaapUsageProviderId[] | undefined {
        const ids = (raw ?? '').split(',').map(part => part.trim()).filter(part => part.length > 0);
        const unique = [...new Set(ids)];
        if (!unique.every(id => PROVIDERS.includes(id as QaapUsageProviderId))) {
            return undefined;
        }
        return unique as QaapUsageProviderId[];
    }

    protected async handleLimits(req: Request, res: Response): Promise<void> {
        if (!this.allowedOnThisBackend(res)) {
            return;
        }
        const login = this.requireLogin(req, res);
        if (!login) {
            return;
        }
        res.json(await this.limits.forOwner(this.scanners.forOwner(login)).getLimits());
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

    /**
     * The signed-in login, or `undefined` after answering 401. A per-tenant backend holds one tenant's agent
     * home only, so a login other than its tenant's is refused (403) rather than shown the tenant's usage.
     */
    protected requireLogin(req: Request, res: Response): string | undefined {
        const ctx = this.auth.authenticate(req);
        const login = ctx.kind === 'unauthorized' ? undefined : this.auth.resolveUserLogin(ctx);
        if (!login) {
            res.status(401).json({ error: 'Not signed in' });
            return undefined;
        }
        const tenantLogin = isQaapTenantBackendMode() ? process.env[QAAP_TENANT_LOGIN_ENV]?.trim() : undefined;
        if (tenantLogin && tenantLogin.toLowerCase() !== login.trim().toLowerCase()) {
            res.status(403).json({ error: 'Usage belongs to another user' });
            return undefined;
        }
        return login;
    }
}
