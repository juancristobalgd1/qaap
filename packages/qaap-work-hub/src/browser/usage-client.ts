// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { QaapUserFacingErrors } from '@theia/qaap-adapters/lib/common/qaap-user-facing-error';
import {
    QAAP_USAGE_LIMITS_PATH,
    QAAP_USAGE_SUMMARY_PATH,
    QaapUsageLimits,
    QaapUsageProviderId,
    QaapUsageRange,
    QaapUsageSummary
} from '@theia/qaap-shared-core/lib/common/qaap-usage-summary-protocol';

/** Thin fetch wrapper around the usage endpoints; errors surface as user-facing errors. */
export class UsageClient {

    /** Summary for `range`, limited to `providers` when non-empty, bucketed in the browser's timezone. */
    async fetchSummary(range: QaapUsageRange, providers: readonly QaapUsageProviderId[], timezone: string): Promise<QaapUsageSummary> {
        const params = new URLSearchParams({ range, tz: timezone });
        if (providers.length > 0) {
            params.set('provider', providers.join(','));
        }
        return this.getJson<QaapUsageSummary>(`${QAAP_USAGE_SUMMARY_PATH}?${params.toString()}`);
    }

    /** Current rate-limit windows per provider. */
    async fetchLimits(): Promise<QaapUsageLimits> {
        return this.getJson<QaapUsageLimits>(QAAP_USAGE_LIMITS_PATH);
    }

    /** Timezone of the viewer, used to align daily and hourly buckets. */
    browserTimezone(): string {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    }

    protected async getJson<T>(url: string): Promise<T> {
        const response = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
        if (!response.ok) {
            throw await QaapUserFacingErrors.fromResponse(response, nls.localize('qaap/usage/loadFailed', 'Could not load usage data.'));
        }
        return await response.json() as T;
    }
}
