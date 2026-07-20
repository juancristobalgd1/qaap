// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** HTTP path prefix for proxied dev-server preview (Codespaces-style, same origin as Qaap). */
export const QAAP_DEV_PREVIEW_PREFIX = '/qaap-dev';

/** Identity-scoped proxy. Unlike `/qaap-dev/:port`, the public URL never exposes/reuses a port. */
export const QAAP_IDENTITY_PREVIEW_PREFIX = '/qaap-preview';

export const QAAP_DEV_PREVIEW_PROBE_PATH = `${QAAP_DEV_PREVIEW_PREFIX}/api/probe`;

/** Owner claims a preview port for a workspace they own, so the proxy can deny other tenants. */
export const QAAP_DEV_PREVIEW_CLAIM_PATH = `${QAAP_DEV_PREVIEW_PREFIX}/api/claim`;

/** Releases one authenticated process-scoped preview after its dev process stops. */
export const QAAP_DEV_PREVIEW_RELEASE_PATH = `${QAAP_DEV_PREVIEW_PREFIX}/api/release`;

export const QAAP_IDENTITY_PREVIEW_PROBE_PATH = `${QAAP_IDENTITY_PREVIEW_PREFIX}/api/probe`;

/**
 * Resolves the caller's newest live claim for a project. Chained dev runs (retry, second tab,
 * backend restart) supersede the previous claim, so a surface still mounted on the old
 * `/qaap-preview/<previewId>/` URL starts 403ing; this endpoint lets it reconcile without a reload.
 */
export const QAAP_DEV_PREVIEW_CURRENT_PATH = `${QAAP_DEV_PREVIEW_PREFIX}/api/current`;

export interface QaapDevPreviewProbeResponse {
    readonly ready: boolean;
    /** URL the mini-browser should load via the same-origin `/qaap-dev/:port/` proxy. */
    readonly previewUrl: string;
    readonly previewId?: string;
    readonly workspaceId?: string;
    readonly projectId?: string;
    readonly processId?: string;
    /** Reserved port of the claim. Only owner-scoped responses (claim/current) include it. */
    readonly port?: number;
}

const MIN_DEV_PORT = 1024;
const MAX_DEV_PORT = 65535;

export function isAllowedDevPreviewPort(port: number): boolean {
    return Number.isInteger(port) && port >= MIN_DEV_PORT && port <= MAX_DEV_PORT;
}

export function parseQaapDevPreviewPort(raw: string | number | undefined): number | undefined {
    const port = typeof raw === 'number' ? raw : Number(raw);
    return isAllowedDevPreviewPort(port) ? port : undefined;
}

export function normalizePublicOrigin(origin: string): string {
    return origin.replace(/\/+$/, '');
}

/** Qaap IDE origin for preview URLs; falls back to localhost in Node tests without `window.location`. */
export function resolveDevPreviewPublicOrigin(explicit?: string): string {
    const trimmed = explicit?.trim();
    if (trimmed) {
        return normalizePublicOrigin(trimmed);
    }
    if (typeof window !== 'undefined' && window.location?.origin) {
        return normalizePublicOrigin(window.location.origin);
    }
    return 'http://localhost';
}

export function isLocalQaapPreviewOrigin(publicOrigin: string): boolean {
    try {
        const { hostname } = new URL(normalizePublicOrigin(publicOrigin));
        return hostname === 'localhost'
            || hostname === '127.0.0.1'
            || hostname === '0.0.0.0'
            || hostname === '[::1]'
            || hostname === '::1';
    } catch {
        return false;
    }
}

export function buildDirectDevPreviewUrl(publicOrigin: string, port: number): string {
    const url = new URL(normalizePublicOrigin(publicOrigin));
    url.port = String(port);
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.toString();
}

/**
 * Builds the preview URL served by {@link QAAP_DEV_PREVIEW_PREFIX} on the Qaap backend.
 * Works for localhost, VPS IP (`http://178.x.x.x:3000`), and future custom domains.
 */
export function buildQaapDevPreviewUrl(publicOrigin: string, port: number): string {
    const base = normalizePublicOrigin(publicOrigin);
    return `${base}${QAAP_DEV_PREVIEW_PREFIX}/${port}/`;
}

export function buildQaapDevPreviewOpenUrl(publicOrigin: string, port: number): string {
    // Always use the same-origin proxy so in-IDE preview can run the element picker / inspector.
    return buildQaapDevPreviewUrl(publicOrigin, port);
}

export function buildQaapIdentityPreviewUrl(publicOrigin: string, previewId: string, targetPath: string = '/'): string {
    const base = normalizePublicOrigin(publicOrigin);
    const suffix = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
    return `${base}${QAAP_IDENTITY_PREVIEW_PREFIX}/${encodeURIComponent(previewId)}${suffix}`;
}

export const QAAP_PREVIEW_VITE_ENV_BOOTSTRAP_MARKER = 'data-qaap-preview-vite-env';

/**
 * In dev, Vite materializes the config `define` entries as runtime globals via `/@vite/env`
 * (loaded by `/@vite/client`). SSR frameworks are responsible for injecting `/@vite/client` into
 * their rendered HTML; some app stacks fail to (observed: TanStack Start behind config wrappers),
 * and then every raw `process.env.X` read left in dev-served modules crashes hydration with
 * "process is not defined" — a blank preview. A catch-guarded, order-preserving import of
 * `/@vite/env` restores those globals, and is a no-op for non-Vite dev servers (the import 404s
 * and the catch swallows it). Top-level await keeps later module scripts (the app entry) from
 * executing before the env globals exist.
 *
 * The same script then rebases `TSS_ROUTER_BASEPATH` onto the proxy prefix: client-side routers
 * match `window.location.pathname`, which under the path proxy is `/qaap-preview/<id>/…` while
 * the SSR matched the stripped path — without the rebase TanStack Start hydration dies with
 * "Expected to find a match below the root match" and the preview stays blank (verified live on
 * the VPS with a Lovable-generated app that renders fine when served without the proxy).
 */
export function injectQaapPreviewViteEnvBootstrap(html: string, publicPrefix: string): string {
    if (!html || html.includes(QAAP_PREVIEW_VITE_ENV_BOOTSTRAP_MARKER) || html.includes('/@vite/client')) {
        return html;
    }
    const rebase = publicPrefix
        ? 'try{'
        + 'const e=(globalThis.process=globalThis.process||{env:{}}).env=globalThis.process.env||{};'
        + `const x=${JSON.stringify(publicPrefix.replace(/\/+$/, ''))};`
        + 'const b=typeof e.TSS_ROUTER_BASEPATH==="string"?e.TSS_ROUTER_BASEPATH:"";'
        + 'if(!b.startsWith(x)){e.TSS_ROUTER_BASEPATH=x+(b&&b!=="/"?b:"");}'
        + '}catch{}'
        : '';
    const script = `<script type="module" ${QAAP_PREVIEW_VITE_ENV_BOOTSTRAP_MARKER}>`
        + `try{await import(${JSON.stringify(`${publicPrefix}/@vite/env`)})}catch{}`
        + rebase
        + '</script>';
    const headOpen = /<head(?:\s[^>]*)?>/i;
    if (headOpen.test(html)) {
        return html.replace(headOpen, match => `${match}${script}`);
    }
    const htmlOpen = /<html(?:\s[^>]*)?>/i;
    if (htmlOpen.test(html)) {
        return html.replace(htmlOpen, match => `${match}${script}`);
    }
    return `${script}${html}`;
}

/** Friendly holding page while the dev server is still binding (v0-style auto-retry). */
export function buildDevPreviewWaitingHtml(targetPort: number): string {
    const safePort = String(targetPort);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Starting preview</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #0d1117; color: #e6edf3; font-family: system-ui, sans-serif; }
  .card { text-align: center; padding: 2rem; max-width: 24rem; }
  .spinner { width: 2rem; height: 2rem; border: 2px solid #30363d; border-top-color: #58a6ff;
    border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 1rem; }
  @keyframes spin { to { transform: rotate(360deg); } }
  h1 { font-size: 1rem; font-weight: 600; margin: 0 0 0.5rem; }
  p { font-size: 0.875rem; color: #8b949e; margin: 0; line-height: 1.5; }
</style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h1>Starting dev server</h1>
    <p>Waiting for port ${safePort}… This page refreshes automatically.</p>
  </div>
  <script>
    setTimeout(function () { location.reload(); }, 2000);
  </script>
</body>
</html>`;
}

/** Parses `/qaap-dev/5173/...` upgrade or request paths. */
export function parseQaapDevPreviewRequestPath(pathname: string): { port: number; targetPath: string } | undefined {
    const match = /^\/qaap-dev\/(\d+)(\/.*)?$/.exec(pathname);
    if (!match) {
        return undefined;
    }
    const port = parseQaapDevPreviewPort(match[1]);
    if (port === undefined) {
        return undefined;
    }
    const targetPath = match[2] || '/';
    return { port, targetPath };
}

/** Parses `/qaap-preview/:previewId/...` without trusting the id as a port or process key. */
export function parseQaapIdentityPreviewRequestPath(pathname: string): { previewId: string; targetPath: string } | undefined {
    const match = /^\/qaap-preview\/([^/]+)(\/.*)?$/.exec(pathname);
    if (!match || match[1] === 'api') {
        return undefined;
    }
    try {
        const previewId = decodeURIComponent(match[1]);
        if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(previewId)) {
            return undefined;
        }
        return { previewId, targetPath: match[2] || '/' };
    } catch {
        return undefined;
    }
}

/** Returns the first stable identity URL, ignoring legacy bare-port candidates. */
export function findQaapIdentityPreviewUrl(
    candidates: Array<string | undefined>,
    publicOrigin: string = resolveDevPreviewPublicOrigin(),
): string | undefined {
    for (const candidate of candidates) {
        if (!candidate) {
            continue;
        }
        try {
            const parsed = new URL(candidate, publicOrigin);
            if (parseQaapIdentityPreviewRequestPath(parsed.pathname)) {
                return candidate;
            }
        } catch {
            // Ignore malformed compatibility candidates.
        }
    }
    return undefined;
}
