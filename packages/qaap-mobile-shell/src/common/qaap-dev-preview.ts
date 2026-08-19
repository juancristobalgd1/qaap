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
    /**
     * `ready` is retained for existing clients, but only means the HTTP transport answered.
     * Render readiness is produced later by visual verification and must not be inferred here.
     */
    readonly readiness?: 'transport_ready' | 'render_ready' | 'failed';
    /** URL the mini-browser should load via the same-origin `/qaap-dev/:port/` proxy. */
    readonly previewUrl: string;
    readonly previewId?: string;
    readonly workspaceId?: string;
    readonly projectId?: string;
    readonly processId?: string;
    /** Reserved port of the claim. Only owner-scoped responses (claim/current) include it. */
    readonly port?: number;
    /** Work Hub section that owns this claim. Present on `/api/current` when the registry has it. */
    readonly conversationId?: string;
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
export const QAAP_PREVIEW_DIAGNOSTICS_MARKER = 'data-qaap-preview-diagnostics';
export const QAAP_PREVIEW_HISTORY_BASE_MARKER = 'data-qaap-preview-history-base';

function insertPreviewHeadScript(html: string, script: string): string {
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

/**
 * Vue / React routers compiled with `base: '/'` read `location.pathname`. Under the same-origin
 * path proxy that value is `/qaap-preview/<id>/…`, so the app 404s (vitesse-lite "Not Found")
 * even though index.html loaded. Strip the prefix for reads and re-apply it on history writes.
 */
export function injectQaapPreviewHistoryBase(html: string, publicPrefix: string): string {
    const prefix = publicPrefix.replace(/\/+$/, '');
    if (!html || !prefix || html.includes(QAAP_PREVIEW_HISTORY_BASE_MARKER)) {
        return html;
    }
    const script = `<script ${QAAP_PREVIEW_HISTORY_BASE_MARKER}>(function(){
var x=${JSON.stringify(prefix)};
function strip(p){return p.indexOf(x)===0?(p.slice(x.length)||"/"):p;}
function add(u){
if(u==null||u===""||typeof u!=="string"||u.charAt(0)==="#")return u;
try{
var parsed=/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)?new URL(u):new URL(u,location.href);
if(parsed.origin!==location.origin)return u;
if(parsed.pathname.indexOf(x)!==0){
parsed.pathname=x+(parsed.pathname.charAt(0)==="/"?parsed.pathname:"/"+parsed.pathname);
}
return parsed.pathname+parsed.search+parsed.hash;
}catch(err){return u;}
}
try{
var pd=Object.getOwnPropertyDescriptor(Location.prototype,"pathname");
if(pd&&pd.get){
Object.defineProperty(Location.prototype,"pathname",{
configurable:true,enumerable:true,
get:function(){return strip(pd.get.call(this));},
set:pd.set
});
}
}catch(err){}
var push=History.prototype.pushState,repl=History.prototype.replaceState;
History.prototype.pushState=function(s,t,u){return push.call(this,s,t,u==null?u:add(u));};
History.prototype.replaceState=function(s,t,u){return repl.call(this,s,t,u==null?u:add(u));};
})();</script>`;
    return insertPreviewHeadScript(html, script);
}

/**
 * Installs a bounded, same-origin diagnostic buffer before application scripts execute. The
 * visual verifier reads it after hydration, catching the common HTTP-200 + blank-app case that
 * a transport probe cannot distinguish from a healthy render.
 */
export function injectQaapPreviewDiagnostics(html: string): string {
    if (!html || html.includes(QAAP_PREVIEW_DIAGNOSTICS_MARKER)) {
        return html;
    }
    const script = `<script ${QAAP_PREVIEW_DIAGNOSTICS_MARKER}>(function(){
var root=globalThis;
if(root.__qaapPreviewDiagnostics){return;}
var errors=[];
function text(value){try{return typeof value==='string'?value:JSON.stringify(value);}catch(e){return String(value);}}
function add(kind,value){var message=text(value)||'Unknown application error';
if(errors.length<20&&!errors.some(function(item){return item.kind===kind&&item.message===message;})){
errors.push({kind:kind,message:message.slice(0,500)});}}
root.__qaapPreviewDiagnostics={errors:errors};
addEventListener('error',function(event){add('pageerror',event.message||(event.error&&event.error.message)||event.error);});
addEventListener('unhandledrejection',function(event){add('unhandledrejection',event.reason&&event.reason.message||event.reason);});
var original=console.error;
console.error=function(){var values=Array.prototype.slice.call(arguments);add('console.error',values.map(text).join(' '));
return original.apply(console,arguments);};
})();</script>`;
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
    // The rebase must be a CLASSIC inline script: it executes during parsing, before ANY module —
    // the app entry is an async module and can call hydrateStart before deferred modules run, so a
    // module-scheduled assignment loses the race. The accessor also survives `/@vite/env`
    // re-evaluations (query-suffixed duplicates re-walk the defines through the no-op setter).
    const rebase = publicPrefix
        ? '<script>try{'
        + 'var p=globalThis.process=globalThis.process||{env:{}};'
        + 'var e=p.env=p.env||{};'
        + `var x=${JSON.stringify(publicPrefix.replace(/\/+$/, ''))};`
        + 'var b=typeof e.TSS_ROUTER_BASEPATH==="string"?e.TSS_ROUTER_BASEPATH:"";'
        + 'var v=b.indexOf(x)===0?b:x+(b&&b!=="/"?b:"");'
        + 'Object.defineProperty(e,"TSS_ROUTER_BASEPATH",{configurable:true,get:function(){return v;},set:function(){}});'
        + '}catch(err){}</script>'
        : '';
    const script = rebase
        + `<script type="module" ${QAAP_PREVIEW_VITE_ENV_BOOTSTRAP_MARKER}>`
        + `try{await import(${JSON.stringify(`${publicPrefix}/@vite/env`)})}catch{}`
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
