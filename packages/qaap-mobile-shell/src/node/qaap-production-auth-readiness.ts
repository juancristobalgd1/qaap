// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Fail-closed production auth/readiness checks. Keep in sync with
 * `QaapGithubAuthGuard.isProductionRuntime` / `isSkipAuthEnabled`.
 */

export interface QaapProductionAuthReadiness {
    readonly productionRuntime: boolean;
    readonly skipAuth: boolean;
    readonly oauthConfigured: boolean;
    readonly agentUidPerUser: boolean;
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
    const skipOverride = isTruthyEnv(env.QAAP_ALLOW_SKIP_AUTH_IN_PRODUCTION);
    const skipAuth = skipRequested && (!productionRuntime || skipOverride);
    const oauthConfigured = isQaapOauthConfigured(env);
    const allowUnconfigured = isTruthyEnv(env.QAAP_ALLOW_UNCONFIGURED_OAUTH_IN_PRODUCTION);
    const agentUidPerUser = !isFalseyEnv(env.QAAP_AGENT_UID_PER_USER);
    if (productionRuntime && !skipAuth && !oauthConfigured && !allowUnconfigured) {
        return {
            productionRuntime,
            skipAuth,
            oauthConfigured,
            agentUidPerUser,
            ready: false,
            fatalReason: 'Refusing to start a production runtime without GitHub OAuth. '
                + 'Set QAAP_GITHUB_CLIENT_ID, QAAP_GITHUB_CLIENT_SECRET, and QAAP_OAUTH_PUBLIC_URL. '
                + 'QAAP_ALLOW_UNCONFIGURED_OAUTH_IN_PRODUCTION=true is a last resort for a private box. '
                + 'See SECURITY.md and .env.docker.example.',
        };
    }
    return {
        productionRuntime,
        skipAuth,
        oauthConfigured,
        agentUidPerUser,
        ready: true,
    };
}
