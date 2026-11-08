// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { createHash } from 'crypto';
import { isQaapHostedEnvironment } from '@theia/qaap-adapters/lib/common/qaap-hosted-runtime';
import { isQaapPreviewId } from '../common/qaap-preview-identity';
import { normalizeQaapPreviewBaseDomain } from './qaap-production-auth-readiness';

/**
 * Base domain of isolated preview hosts (`<hostLabel>.<domain>`), or undefined when that mode is off.
 * The main origin is also baked into the bridge loader and frame-ancestors policy, so the mode
 * requires an explicit public URL; deriving it from the preview Host would be unsafe.
 */
export function resolveQaapPreviewBaseDomain(env: NodeJS.ProcessEnv = process.env): string | undefined {
    if (!env.QAAP_OAUTH_PUBLIC_URL?.trim()) {
        return undefined;
    }
    return normalizeQaapPreviewBaseDomain(env.QAAP_PREVIEW_BASE_DOMAIN);
}

/** Local isolated previews are on unless `QAAP_PREVIEW_LOCAL_ISOLATION=0` opts out. */
export function isQaapLocalPreviewIsolationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.QAAP_PREVIEW_LOCAL_ISOLATION?.trim() !== '0';
}

/**
 * Base domain of isolated preview hosts for one request. Explicit configuration always wins (see
 * {@link resolveQaapPreviewBaseDomain}). Otherwise, on a non-hosted runtime only, a request for
 * `localhost[:port]` gets the base domain `localhost[:port]`: browsers resolve `*.localhost` to
 * loopback, so no DNS is needed, and the origin stays the one the developer already uses. Requests
 * on any other host (127.0.0.1, IPs, LAN names) get no isolation. The Host header is never read in
 * production, where it is client-controlled.
 */
export function resolveQaapPreviewBaseDomainForRequest(rawHost: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
    if (env.QAAP_PREVIEW_BASE_DOMAIN?.trim() || env.QAAP_OAUTH_PUBLIC_URL?.trim()) {
        return resolveQaapPreviewBaseDomain(env);
    }
    if (!rawHost || isQaapHostedEnvironment(env) || !isQaapLocalPreviewIsolationEnabled(env)) {
        return undefined;
    }
    let parsed: URL;
    try {
        parsed = new URL(`http://${rawHost}`);
    } catch {
        return undefined;
    }
    // An isolated request arrives on `<label>.localhost`; its base is the same loopback origin.
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== 'localhost' && !hostname.endsWith('.localhost')) {
        return undefined;
    }
    return parsed.port ? `localhost:${parsed.port}` : 'localhost';
}

/**
 * Origin of the Qaap app that frames an isolated preview host: the explicit `QAAP_OAUTH_PUBLIC_URL`,
 * or in local isolation the loopback origin of the same port. Preview frame headers and the bridge
 * loader must name this origin, never the preview host itself. Undefined when no origin applies.
 */
export function resolveQaapIsolatedParentOrigin(rawHost: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
    const explicit = env.QAAP_OAUTH_PUBLIC_URL?.trim();
    if (explicit) {
        try {
            const url = new URL(explicit);
            return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined;
        } catch {
            return undefined;
        }
    }
    const base = resolveQaapPreviewBaseDomainForRequest(rawHost, env);
    return base ? `http://${base}` : undefined;
}

/**
 * DNS label of a preview's isolated host. The label IS the access capability: 128 bits derived
 * from the preview's secret access token, so it cannot be guessed from the (readable) preview id.
 * A cookie cannot carry the capability instead: the preview is framed by the Qaap app, a different
 * site, where browsers withhold SameSite cookies and Safari blocks third-party cookies outright.
 * Rotating the access token rotates the host.
 */
export function buildQaapPreviewHostLabel(previewId: string, accessToken: string): string {
    return createHash('sha256').update(`qaap-preview-host\0${previewId}\0${accessToken}`).digest('hex').slice(0, 32);
}

/** The host label of an isolated preview host (see {@link buildQaapPreviewHostLabel}), or undefined for any other host. */
export function parseQaapPreviewHostLabel(rawHost: string | undefined, baseDomain: string | undefined): string | undefined {
    if (!baseDomain || !rawHost) {
        return undefined;
    }
    let hostname: string;
    try {
        hostname = new URL(`http://${rawHost}`).hostname.toLowerCase();
    } catch {
        return undefined;
    }
    const suffix = `.${baseDomain.replace(/:\d+$/, '')}`;
    if (!hostname.endsWith(suffix)) {
        return undefined;
    }
    const label = hostname.slice(0, -suffix.length);
    return isQaapPreviewId(label) ? label : undefined;
}
