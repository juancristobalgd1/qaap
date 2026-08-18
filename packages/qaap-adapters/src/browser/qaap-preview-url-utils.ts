// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Same prefix as {@link QAAP_DEV_PREVIEW_PREFIX} in qaap-mobile-shell (keep in sync). */
export const QAAP_DEV_PREVIEW_PATH_PREFIX = '/qaap-dev';

/** Same prefix as {@link QAAP_IDENTITY_PREVIEW_PREFIX} in qaap-mobile-shell (keep in sync). */
export const QAAP_IDENTITY_PREVIEW_PATH_PREFIX = '/qaap-preview';

const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);
const BARE_LOCAL_DEV_URL_PATTERN = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?):(\d{2,5})(\/.*)?$/i;

function normalizeBareLocalDevUrl(url: string): string {
    const match = BARE_LOCAL_DEV_URL_PATTERN.exec(url.trim());
    if (!match) {
        return url;
    }
    const host = match[1].replace(/^\[?::1\]?$/i, '[::1]');
    return `http://${host}:${match[2]}${match[3] ?? '/'}`;
}

function parseDevPort(raw: string | undefined): number | undefined {
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        return undefined;
    }
    return port;
}

function ideOrigin(): string | undefined {
    if (typeof window === 'undefined' || !window.location?.origin) {
        return undefined;
    }
    return window.location.origin.replace(/\/+$/, '');
}

/** Returns the port only when the URL targets `/qaap-dev/:port` on the IDE origin. */
export function getSameOriginPreviewProxyPort(url: string, publicOrigin?: string): number | undefined {
    const origin = (publicOrigin ?? ideOrigin())?.replace(/\/+$/, '');
    if (!origin) {
        return undefined;
    }
    try {
        const parsed = new URL(url, origin);
        if (parsed.origin !== new URL(origin).origin) {
            return undefined;
        }
        return parsePreviewProxyPath(parsed.pathname)?.port;
    } catch {
        return undefined;
    }
}

/**
 * Rewrites direct `http://localhost:5173/...` dev-server URLs to the same-origin
 * `/qaap-dev/:port/...` proxy so the element picker and inspector can access the iframe DOM.
 */
export function normalizePreviewUrlForSameOrigin(url: string, publicOrigin?: string): string {
    const trimmed = normalizeBareLocalDevUrl(url.trim());
    if (!trimmed) {
        return trimmed;
    }
    const origin = (publicOrigin ?? ideOrigin())?.replace(/\/+$/, '');
    if (!origin) {
        return trimmed;
    }
    try {
        const parsed = new URL(trimmed, origin);
        const ide = new URL(origin);

        if (parsed.origin === ide.origin && parsed.pathname.startsWith(`${QAAP_DEV_PREVIEW_PATH_PREFIX}/`)) {
            return parsed.toString();
        }

        if (parsePreviewIdentityPath(parsed.pathname)) {
            return parsed.toString();
        }

        if (!LOCAL_DEV_HOSTS.has(parsed.hostname)) {
            return trimmed;
        }

        const devPort = parseDevPort(parsed.port || undefined);
        const idePort = parseDevPort(ide.port || (ide.protocol === 'https:' ? '443' : '80'));
        if (devPort === undefined || devPort === idePort) {
            return trimmed;
        }

        const suffix = `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
        const path = suffix.startsWith('/') ? suffix : `/${suffix}`;
        return `${origin}${QAAP_DEV_PREVIEW_PATH_PREFIX}/${devPort}${path}`;
    } catch {
        return trimmed;
    }
}

export function buildSameOriginDevPreviewUrl(port: number, publicOrigin?: string): string {
    const origin = (publicOrigin ?? ideOrigin())?.replace(/\/+$/, '');
    if (!origin) {
        return `http://127.0.0.1:${port}/`;
    }
    return `${origin}${QAAP_DEV_PREVIEW_PATH_PREFIX}/${port}/`;
}

export interface QaapPreviewProxyPath {
    readonly port: number;
    readonly targetPath: string;
}

/** Parses `/qaap-dev/5173/...` paths on the IDE origin. */
export function parsePreviewProxyPath(pathname: string): QaapPreviewProxyPath | undefined {
    const match = /^\/qaap-dev\/(\d+)(\/.*)?$/.exec(pathname);
    if (!match) {
        return undefined;
    }
    const port = parseDevPort(match[1]);
    if (port === undefined) {
        return undefined;
    }
    return { port, targetPath: match[2] || '/' };
}

export interface QaapPreviewIdentityPath {
    readonly previewId: string;
    readonly targetPath: string;
}

/**
 * Parses `/qaap-preview/:previewId/...` paths on the IDE origin.
 *
 * The preview id is an opaque, server-issued identity (`userId+workspaceId+projectId+processId`);
 * it is never interpreted here beyond a conservative character check.
 */
export function parsePreviewIdentityPath(pathname: string): QaapPreviewIdentityPath | undefined {
    const match = /^\/qaap-preview\/([A-Za-z0-9._-]{1,128})(\/.*)?$/.exec(pathname);
    if (!match) {
        return undefined;
    }
    return { previewId: match[1], targetPath: match[2] || '/' };
}

/**
 * Replaces a retired preview/proxy identity with the newly claimed identity while preserving the
 * app route, query, and hash. A fresh claim supersedes the previous `/qaap-preview/:id/` URL, so
 * continuing to navigate to the caller's original URL would render the proxy's execution-mismatch
 * 403 page even though the replacement claim is valid.
 */
export function rebasePreviewUrlToIdentityClaim(sourceUrl: string, claimedPreviewUrl: string): string {
    try {
        const source = new URL(sourceUrl);
        const claimed = new URL(claimedPreviewUrl);
        const claimedIdentity = parsePreviewIdentityPath(claimed.pathname);
        if (!claimedIdentity) {
            return claimedPreviewUrl;
        }
        const sourceIdentity = parsePreviewIdentityPath(source.pathname);
        const sourceProxy = parsePreviewProxyPath(source.pathname);
        const targetPath = sourceIdentity?.targetPath
            ?? sourceProxy?.targetPath
            ?? source.pathname
            ?? '/';
        const normalizedTargetPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
        claimed.pathname = `${QAAP_IDENTITY_PREVIEW_PATH_PREFIX}/${encodeURIComponent(claimedIdentity.previewId)}${normalizedTargetPath}`;
        claimed.search = source.search;
        claimed.hash = source.hash;
        return claimed.toString();
    } catch {
        return claimedPreviewUrl;
    }
}

function normalizeNestedPreviewPath(nestedPath: string): string | undefined {
    const trimmed = nestedPath.trim();
    if (!trimmed || trimmed === '/') {
        return undefined;
    }
    const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    if (/\.[a-zA-Z0-9]+$/.test(withSlash.replace(/\/+$/, ''))) {
        return withSlash.replace(/\/+$/, '');
    }
    return withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
}

/** App path under a preview identity, `/qaap-dev/:port`, or a direct localhost URL. */
export function previewAppPathFromUrl(url: string | undefined): string | undefined {
    const trimmed = url?.trim();
    if (!trimmed) {
        return undefined;
    }
    try {
        const parsed = new URL(trimmed);
        const identity = parsePreviewIdentityPath(parsed.pathname);
        if (identity) {
            return identity.targetPath && identity.targetPath !== '/' ? identity.targetPath : undefined;
        }
        const proxy = parsePreviewProxyPath(parsed.pathname);
        if (proxy) {
            return proxy.targetPath && proxy.targetPath !== '/' ? proxy.targetPath : undefined;
        }
        if (parsed.pathname && parsed.pathname !== '/') {
            return parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
        }
        return undefined;
    } catch {
        return undefined;
    }
}

/**
 * Single open-URL for Preview: rebase onto the live identity, then pin a nested static
 * entry (`/docs/demo/`) when the claim still points at `/`. Call this at every mount,
 * remount, and claim fetch — not only at bootstrap `openPreview`.
 */
export function resolveEffectivePreviewUrl(options: {
    readonly candidateUrl: string;
    readonly identityUrl?: string;
    readonly nestedEntry?: string;
    readonly rememberedUrls?: readonly (string | undefined)[];
}): string {
    const candidate = options.candidateUrl.trim();
    const identity = options.identityUrl?.trim();
    const rememberedPath = (options.rememberedUrls ?? [])
        .map(previewAppPathFromUrl)
        .find((path): path is string => !!path);
    const nested = previewAppPathFromUrl(candidate)
        ?? rememberedPath
        ?? options.nestedEntry;
    let next = candidate || identity || '';
    if (!next) {
        return next;
    }
    if (identity) {
        try {
            if (parsePreviewIdentityPath(new URL(identity).pathname)) {
                next = rebasePreviewUrlToIdentityClaim(next, identity);
            }
        } catch {
            /* keep next */
        }
    }
    if (nested) {
        next = applyNestedPathToPreviewUrl(next, nested);
    }
    return normalizePreviewUrlForSameOrigin(next);
}

/**
 * When a nested static demo (e.g. `/docs/demo/`) is served from the workspace root, identity
 * claims still advertise `/qaap-preview/:id/`. Opening that root hits backend `/` → "Not found".
 * If the preview URL has no app path yet, pin the nested entry so relative `../css` / `../js`
 * resolve under the identity prefix.
 */
export function applyNestedPathToPreviewUrl(previewUrl: string, nestedPath: string): string {
    const nested = normalizeNestedPreviewPath(nestedPath);
    if (!nested) {
        return previewUrl;
    }
    try {
        const parsed = new URL(previewUrl);
        const identity = parsePreviewIdentityPath(parsed.pathname);
        if (identity) {
            if (identity.targetPath && identity.targetPath !== '/') {
                return previewUrl;
            }
            parsed.pathname = `${QAAP_IDENTITY_PREVIEW_PATH_PREFIX}/${encodeURIComponent(identity.previewId)}${nested}`;
            return parsed.toString();
        }
        const proxy = parsePreviewProxyPath(parsed.pathname);
        if (proxy) {
            if (proxy.targetPath && proxy.targetPath !== '/') {
                return previewUrl;
            }
            parsed.pathname = `${QAAP_DEV_PREVIEW_PATH_PREFIX}/${proxy.port}${nested}`;
            return parsed.toString();
        }
        if (!parsed.pathname || parsed.pathname === '/') {
            parsed.pathname = nested;
            return parsed.toString();
        }
        return previewUrl;
    } catch {
        return previewUrl;
    }
}

/**
 * User-facing URL for browsing history (direct `localhost:PORT` instead of `/qaap-dev/:port/`).
 */
function stripPreviewHistoryCacheBust(url: URL): void {
    url.searchParams.delete('_qaap_cache_bust');
    if (!url.searchParams.toString()) {
        url.search = '';
    }
}

export function toPreviewHistoryDisplayUrl(url: string, publicOrigin?: string): string {
    const trimmed = url.trim();
    if (!trimmed) {
        return trimmed;
    }
    const origin = (publicOrigin ?? ideOrigin())?.replace(/\/+$/, '');
    try {
        const parsed = new URL(trimmed, origin);
        stripPreviewHistoryCacheBust(parsed);
        const proxy = parsePreviewProxyPath(parsed.pathname);
        if (proxy) {
            const suffix = `${proxy.targetPath}${parsed.search}${parsed.hash}` || '/';
            const path = suffix.startsWith('/') ? suffix : `/${suffix}`;
            return `http://localhost:${proxy.port}${path}`;
        }
        if (origin) {
            const ide = new URL(origin);
            if (parsed.origin !== ide.origin) {
                return parsed.toString();
            }
        }
        if (LOCAL_DEV_HOSTS.has(parsed.hostname)) {
            const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
            const suffix = `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
            const path = suffix.startsWith('/') ? suffix : `/${suffix}`;
            return `http://localhost:${port}${path}`;
        }
        return parsed.toString();
    } catch {
        return trimmed;
    }
}

/** Stable key so proxy and direct dev URLs dedupe to one history row. */
export function canonicalPreviewHistoryKey(url: string, publicOrigin?: string): string {
    const display = toPreviewHistoryDisplayUrl(url, publicOrigin);
    if (!display) {
        return '';
    }
    try {
        const parsed = new URL(display);
        const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
        const path = parsed.pathname.replace(/\/+$/, '') || '/';
        return `${parsed.protocol}//${parsed.hostname}:${port}${path}${parsed.search}`;
    } catch {
        return display.toLowerCase();
    }
}
