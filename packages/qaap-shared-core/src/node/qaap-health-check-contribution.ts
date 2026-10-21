// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Outcome of one {@link QaapHealthCheckContribution}. */
export interface QaapHealthCheckResult {
    readonly healthy: boolean;
    readonly detail?: Record<string, unknown>;
}

/**
 * Bind to contribute a dependency (storage, ...) to `/qaap/api/health`. Any unhealthy result turns
 * the default probe (Docker HEALTHCHECK, image smoke, deploy gates) into a 503; the liveness probe
 * (`?probe=liveness`, used to wake tenant backends) ignores these checks.
 */
export const QaapHealthCheckContribution = Symbol('QaapHealthCheckContribution');
export interface QaapHealthCheckContribution {
    readonly id: string;
    check(): QaapHealthCheckResult;
}
