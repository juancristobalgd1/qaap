// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QAAP_GITHUB_OAUTH_CALLBACK_PATH } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';

export interface QaapGithubOAuthConfig {
    clientId: string;
    clientSecret: string;
    /** e.g. http://localhost:3000 — no trailing slash */
    publicUrl: string;
    callbackUrl: string;
}

export function normalizeQaapPublicUrl(url: string): string {
    return url.replace(/\/+$/, '');
}

/** Minimal request shape shared by Express `Request` and Node `IncomingMessage`. */
export interface QaapPublicOriginRequest {
    headers: Record<string, string | string[] | undefined>;
    protocol?: string;
    socket?: { remoteAddress?: string; encrypted?: boolean };
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const SAFE_HOST = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
    const raw = Array.isArray(value) ? value[0] : value;
    const first = raw?.split(',')[0]?.trim();
    return first || undefined;
}

/**
 * `X-Forwarded-*` headers are client-controlled unless a trusted proxy overwrites them. They are
 * honoured only when the direct peer is a loopback reverse proxy, or when the operator opts in with
 * `QAAP_TRUST_PROXY=1` (proxy on another host that is known to overwrite these headers).
 */
export function isQaapTrustedProxyPeer(req: QaapPublicOriginRequest, env: NodeJS.ProcessEnv = process.env): boolean {
    const trust = env.QAAP_TRUST_PROXY?.trim().toLowerCase();
    if (trust === '1' || trust === 'true') {
        return true;
    }
    const peer = req.socket?.remoteAddress;
    return !!peer && LOOPBACK_ADDRESSES.has(peer);
}

/**
 * Canonical public origin of this Qaap instance. Security-relevant consumers (preview bridge
 * `parentOrigin`, CSP `frame-ancestors`, Referer checks) depend on it, so the explicit
 * `QAAP_OAUTH_PUBLIC_URL` always wins (it is mandatory in hosted production, see
 * `evaluateQaapProductionAuthReadiness`). Without it, forwarded headers are only used from a
 * trusted proxy peer and the host is syntax-checked so it cannot smuggle a path or a second origin.
 */
export function resolveQaapPublicOrigin(req: QaapPublicOriginRequest, env: NodeJS.ProcessEnv = process.env): string {
    const envUrl = env.QAAP_OAUTH_PUBLIC_URL?.trim();
    if (envUrl) {
        return normalizeQaapPublicUrl(envUrl);
    }
    const trustForwarded = isQaapTrustedProxyPeer(req, env);
    const forwardedProto = trustForwarded ? firstHeaderValue(req.headers['x-forwarded-proto'])?.toLowerCase() : undefined;
    const directProto = req.protocol ?? (req.socket?.encrypted ? 'https' : 'http');
    const proto = forwardedProto === 'https' || forwardedProto === 'http' ? forwardedProto : directProto;
    const forwardedHost = trustForwarded ? firstHeaderValue(req.headers['x-forwarded-host']) : undefined;
    const directHost = firstHeaderValue(req.headers.host);
    const host = [forwardedHost, directHost].find(candidate => !!candidate && SAFE_HOST.test(candidate)) ?? 'localhost';
    return normalizeQaapPublicUrl(`${proto}://${host}`);
}

export function buildQaapGithubCallbackUrl(publicUrl: string): string {
    return `${normalizeQaapPublicUrl(publicUrl)}${QAAP_GITHUB_OAUTH_CALLBACK_PATH}`;
}

/**
 * Reads QAAP_GITHUB_CLIENT_ID, QAAP_GITHUB_CLIENT_SECRET, QAAP_OAUTH_PUBLIC_URL from process.env.
 * Optional QAAP_GITHUB_WEBHOOK_SECRET verifies POST /qaap/api/github/webhook (GitHub App / repo hook).
 */
export function readQaapGithubOAuthConfig(): QaapGithubOAuthConfig | undefined {
    const clientId = process.env.QAAP_GITHUB_CLIENT_ID?.trim();
    const clientSecret = process.env.QAAP_GITHUB_CLIENT_SECRET?.trim();
    const publicUrlRaw = process.env.QAAP_OAUTH_PUBLIC_URL?.trim();
    if (!clientId || !clientSecret || !publicUrlRaw) {
        return undefined;
    }
    const publicUrl = normalizeQaapPublicUrl(publicUrlRaw);
    return {
        clientId,
        clientSecret,
        publicUrl,
        callbackUrl: buildQaapGithubCallbackUrl(publicUrl),
    };
}
