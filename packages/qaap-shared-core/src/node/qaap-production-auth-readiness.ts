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

/**
 * Normalizes `QAAP_PREVIEW_BASE_DOMAIN` (`https://*.previews.example/` → `previews.example`).
 * Returns `undefined` for an empty or syntactically invalid value.
 */
export function normalizeQaapPreviewBaseDomain(raw: string | undefined): string | undefined {
    const value = raw?.trim().toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^\*\./, '')
        .replace(/\/+$/, '');
    return value && /^[a-z0-9.-]+(?::\d+)?$/.test(value) ? value : undefined;
}

function hostnameWithoutPort(host: string): string {
    return host.replace(/:\d+$/, '');
}

function isSameOrSubdomain(host: string, parent: string): boolean {
    return host === parent || host.endsWith(`.${parent}`);
}

/** Last two DNS labels. A heuristic for the registrable domain (no Public Suffix List available). */
function approximateSite(host: string): string {
    return host.split('.').filter(Boolean).slice(-2).join('.');
}

/**
 * Why preview isolation is not ready for untrusted tenant code, or `undefined` when it is.
 *
 * Without an isolated preview domain, previewed apps are served under the Qaap origin
 * (`/qaap-preview/<id>/…`): their JavaScript runs same-origin with the IDE and every
 * `fetch('/qaap/api/…')` carries the user's `qaap_sid` session cookie. Previews must therefore
 * live on a different *site*: a sibling subdomain of the IDE host is same-site, so the
 * `SameSite=Lax` session cookie is still attached to its requests and it can toss cookies for the
 * shared parent domain.
 */
export function qaapPreviewIsolationProblem(env: NodeJS.ProcessEnv = process.env): string | undefined {
    const rawBaseDomain = env.QAAP_PREVIEW_BASE_DOMAIN?.trim();
    if (!rawBaseDomain) {
        return 'QAAP_PREVIEW_BASE_DOMAIN is not set, so previews would run on the Qaap origin.';
    }
    const baseDomain = normalizeQaapPreviewBaseDomain(rawBaseDomain);
    if (!baseDomain) {
        return `QAAP_PREVIEW_BASE_DOMAIN "${rawBaseDomain}" is not a valid domain.`;
    }
    const publicUrl = env.QAAP_OAUTH_PUBLIC_URL?.trim();
    let publicHost: string;
    try {
        publicHost = new URL(publicUrl ?? '').hostname.toLowerCase();
    } catch {
        return 'QAAP_OAUTH_PUBLIC_URL must be a valid URL for isolated previews to be enabled.';
    }
    const previewHost = hostnameWithoutPort(baseDomain);
    if (isSameOrSubdomain(previewHost, publicHost) || isSameOrSubdomain(publicHost, previewHost)) {
        return `QAAP_PREVIEW_BASE_DOMAIN "${baseDomain}" overlaps the Qaap host "${publicHost}"; `
            + 'preview subdomains would share its cookies.';
    }
    if (approximateSite(previewHost) === approximateSite(publicHost) && !isTruthyEnv(env.QAAP_PREVIEW_ALLOW_SAME_SITE)) {
        return `QAAP_PREVIEW_BASE_DOMAIN "${baseDomain}" is same-site with the Qaap host "${publicHost}"; `
            + 'use a separate registrable domain (e.g. qaap-previews.example). If the shared suffix is a '
            + 'public suffix (e.g. co.uk), set QAAP_PREVIEW_ALLOW_SAME_SITE=1.';
    }
    return undefined;
}

function parseLoginList(raw: string | undefined): string[] {
    return (raw ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
}

/**
 * Whether the beta allowlist admits anyone besides the operators (`QAAP_OPERATOR_LOGINS`, the people
 * who run this instance and preview their own code). A single-operator deployment still lists the
 * operator in `QAAP_BETA_ALLOWED_LOGINS` (production admits nobody otherwise), but it has no third
 * party whose session an untrusted preview could abuse.
 */
export function qaapAdmitsThirdPartyTenants(env: NodeJS.ProcessEnv = process.env): boolean {
    const operators = new Set(parseLoginList(env.QAAP_OPERATOR_LOGINS));
    return parseLoginList(env.QAAP_BETA_ALLOWED_LOGINS).some(login => !operators.has(login));
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
    const previewIsolationProblem = isQaapPublicMultiTenantRuntime(env) && qaapAdmitsThirdPartyTenants(env)
        ? qaapPreviewIsolationProblem(env)
        : undefined;
    if (previewIsolationProblem) {
        return {
            productionRuntime,
            skipAuth,
            oauthConfigured,
            agentUidPerUser,
            backendIsolationMode: QAAP_BACKEND_ISOLATION_MODE,
            backendIsolationReady,
            ready: false,
            fatalReason: 'Refusing to serve third-party tenants without isolated preview origins. '
                + `${previewIsolationProblem} `
                + 'Logins listed in QAAP_OPERATOR_LOGINS do not count as third parties. '
                + 'Point wildcard DNS/TLS for *.QAAP_PREVIEW_BASE_DOMAIN at this server so untrusted '
                + 'preview code cannot use the IDE session. See SECURITY.md.',
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
