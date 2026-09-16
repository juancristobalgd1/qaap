// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    isQaapBackendIsolationReady,
    isQaapPublicMultiTenantRuntime,
    QAAP_BACKEND_ISOLATION_MODE,
} from '@theia/qaap-adapters/lib/common/qaap-backend-isolation';

/**
 * Fail-closed production auth/readiness checks. Keep in sync with
 * `QaapGithubAuthGuard.isProductionRuntime` / `isSkipAuthEnabled`.
 */

export interface QaapProductionAuthReadiness {
    readonly productionRuntime: boolean;
    readonly skipAuth: boolean;
    readonly oauthConfigured: boolean;
    readonly agentUidPerUser: boolean;
    readonly backendIsolationMode: string;
    readonly backendIsolationReady: boolean;
    readonly ready: boolean;
    readonly fatalReason?: string;
}

function isTruthyEnv(value: string | undefined): boolean {
    const normalized = value?.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
}

function isFalseyEnv(value: string | undefined): boolean {
    const normalized = value?.trim().toLowerCase();
    return normalized === 'false' || normalized === '0';
}

export function isQaapHostedProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
    const cloudMode = env.QAAP_CLOUD_MODE?.trim().toLowerCase();
    return env.NODE_ENV === 'production' || (!!cloudMode && cloudMode !== 'local');
}

export function isQaapOauthConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
    return !!(
        env.QAAP_GITHUB_CLIENT_ID?.trim()
        && env.QAAP_GITHUB_CLIENT_SECRET?.trim()
        && env.QAAP_OAUTH_PUBLIC_URL?.trim()
        && !/your-dev-oauth/i.test(env.QAAP_GITHUB_CLIENT_ID)
    );
}

export function evaluateQaapProductionAuthReadiness(
    env: NodeJS.ProcessEnv = process.env,
): QaapProductionAuthReadiness {
    const productionRuntime = isQaapHostedProductionRuntime(env);
    const skipRequested = isTruthyEnv(env.QAAP_SKIP_AUTH);
    // No production bypass exists: an operator-controlled environment variable must not be able
    // to disable authentication for a public multi-tenant deployment.
    const skipAuth = skipRequested && !productionRuntime;
    const oauthConfigured = isQaapOauthConfigured(env);
    const agentUidPerUser = !isFalseyEnv(env.QAAP_AGENT_UID_PER_USER);
    const backendIsolationReady = isQaapBackendIsolationReady(env);
    if (isQaapPublicMultiTenantRuntime(env) && !backendIsolationReady) {
        return {
            productionRuntime,
            skipAuth,
            oauthConfigured,
            agentUidPerUser,
            backendIsolationMode: QAAP_BACKEND_ISOLATION_MODE,
            backendIsolationReady,
            ready: false,
            fatalReason: 'Refusing to serve third-party tenants before the backend-per-tenant router is enabled. '
                + 'Set QAAP_BACKEND_PER_TENANT=1 and a 32-character QAAP_TENANT_BACKEND_MASTER_SECRET '
                + 'so each authenticated session is routed to its own hardened Theia container. '
                + 'See MULTI_TENANCY_AUDIT.md.',
        };
    }
    if (productionRuntime && !skipAuth && !oauthConfigured) {
        return {
            productionRuntime,
            skipAuth,
            oauthConfigured,
            agentUidPerUser,
            backendIsolationMode: QAAP_BACKEND_ISOLATION_MODE,
            backendIsolationReady,
            ready: false,
            fatalReason: 'Refusing to start a production runtime without GitHub OAuth. '
                + 'Set QAAP_GITHUB_CLIENT_ID, QAAP_GITHUB_CLIENT_SECRET, and QAAP_OAUTH_PUBLIC_URL. '
                + 'There is no production OAuth bypass. '
                + 'See SECURITY.md and .env.docker.example.',
        };
    }
    return {
        productionRuntime,
        skipAuth,
        oauthConfigured,
        agentUidPerUser,
        backendIsolationMode: QAAP_BACKEND_ISOLATION_MODE,
        backendIsolationReady,
        ready: true,
    };
}

export interface QaapLaunchHealthPayload {
    readonly ok: true;
    readonly ready: boolean;
    readonly productionRuntime: boolean;
    readonly skipAuth: boolean;
    readonly oauthConfigured: boolean;
    readonly agentUidPerUser: boolean;
    readonly backendIsolationMode: string;
    readonly backendIsolationReady: boolean;
    readonly build?: string;
}

export function buildQaapLaunchHealthPayload(
    readiness: QaapProductionAuthReadiness,
    options: { readonly skipAuth?: boolean; readonly build?: string } = {},
): QaapLaunchHealthPayload {
    const build = options.build?.trim();
    return {
        ok: true,
        ready: readiness.ready,
        productionRuntime: readiness.productionRuntime,
        skipAuth: options.skipAuth ?? readiness.skipAuth,
        oauthConfigured: readiness.oauthConfigured,
        agentUidPerUser: readiness.agentUidPerUser,
        backendIsolationMode: readiness.backendIsolationMode,
        backendIsolationReady: readiness.backendIsolationReady,
        ...(build ? { build } : {}),
    };
}
