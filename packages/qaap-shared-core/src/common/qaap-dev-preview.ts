// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { isAllowedDevPreviewPort } from '@theia/qaap-adapters/lib/common/qaap-dev-preview-ports';

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
    /**
     * Why an identity probe is (not) ready. Additive: older backends omit it and clients derive it
     * from `ready` and the HTTP status. See {@link QaapDevPreviewClaimState}.
     */
    readonly state?: QaapDevPreviewClaimState;
}

/**
 * Liveness of one identity-scoped preview claim:
 * - `ready` — the dev server behind the claim answers.
 * - `booting` — the claim exists but its dev server is not answering yet (within the start grace).
 * - `stopped` — the claim exists but its dev server stopped answering after the start grace.
 * - `gone` — no such claim for this user (released, reaped, superseded or lost on backend restart).
 * - `unknown` — client-side only: the probe itself failed (network error, 5xx while a tenant
 *   backend cold-starts). Transient; never evidence that the preview is dead.
 */
export type QaapDevPreviewClaimState = 'ready' | 'booting' | 'stopped' | 'gone' | 'unknown';

const QAAP_DEV_PREVIEW_CLAIM_STATES: ReadonlySet<string> = new Set(['ready', 'booting', 'stopped', 'gone', 'unknown']);

export function isQaapDevPreviewClaimState(value: unknown): value is QaapDevPreviewClaimState {
    return typeof value === 'string' && QAAP_DEV_PREVIEW_CLAIM_STATES.has(value);
}

/** Single definition in qaap-adapters, shared with the browser preview URL helpers. */
export { isAllowedDevPreviewPort };

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

type PreviewScriptPlacement = 'head' | 'body-end';

function insertPreviewScript(html: string, script: string, placement: PreviewScriptPlacement): string {
    if (!script) {
        return html;
    }
    if (placement === 'body-end') {
        const bodyClose = /<\/body\s*>/i.exec(html);
        return bodyClose ? `${html.slice(0, bodyClose.index)}${script}${html.slice(bodyClose.index)}` : `${html}${script}`;
    }
    const open = /<head(?:\s[^>]*)?>/i.exec(html) ?? /<html(?:\s[^>]*)?>/i.exec(html);
    if (!open) {
        return `${script}${html}`;
    }
    const end = open.index + open[0].length;
    return `${html.slice(0, end)}${script}${html.slice(end)}`;
}

/**
 * Vue / React routers compiled with `base: '/'` read `location.pathname`. Under the same-origin
 * path proxy that value is `/qaap-preview/<id>/…`, so the app 404s (vitesse-lite "Not Found")
 * even though index.html loaded. Strip the prefix for reads and re-apply it on history writes.
 */
export function injectQaapPreviewHistoryBase(
    html: string,
    publicPrefix: string,
    placement: PreviewScriptPlacement = 'head',
): string {
    return insertPreviewScript(html, buildHistoryBaseScript(html, publicPrefix), placement);
}

function buildHistoryBaseScript(html: string, publicPrefix: string): string {
    const prefix = publicPrefix.replace(/\/+$/, '');
    if (!html || !prefix || html.includes(QAAP_PREVIEW_HISTORY_BASE_MARKER)) {
        return '';
    }
    return `<script ${QAAP_PREVIEW_HISTORY_BASE_MARKER}>(function(){
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
// Framework routers (notably Next App Router) fetch an absolute root route before they update
// history. Rebase same-origin network URLs too, otherwise the root-relative dashboard route escapes this identity-scoped
// proxy and lands on Qaap's own origin. Keep cross-origin and already-prefixed requests untouched.
var fetchFn=globalThis.fetch;
if(typeof fetchFn==="function"){
globalThis.fetch=function(input,init){
var raw=typeof input==="string"?input:(input instanceof URL?input.href:(input&&input.url));
var rebased=add(raw);
if(!raw||rebased===raw)return fetchFn.call(this,input,init);
if(typeof Request!=="undefined"&&input instanceof Request){
return fetchFn.call(this,new Request(new URL(rebased,location.href).href,input),init);
}
return fetchFn.call(this,rebased,init);
};
}
if(typeof XMLHttpRequest!=="undefined"){
var xhrOpen=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(method,url){
var args=Array.prototype.slice.call(arguments);
args[1]=add(String(url));
return xhrOpen.apply(this,args);
};
}
// HMR clients of Next (/_next/webpack-hmr), webpack-dev-server (/ws) and CRA (/sockjs-node)
// build same-host socket URLs from location. Browsers never send a Referer on a WebSocket
// handshake, so the server cannot scope those upgrades; rebase them here instead.
var WS=globalThis.WebSocket;
if(typeof WS==="function"){
var PWS=function(url,protocols){
var target=url;
try{
var parsed=new URL(String(url),location.href);
if(parsed.host===location.host&&/^(wss?|https?):$/.test(parsed.protocol)&&parsed.pathname!==x&&parsed.pathname.indexOf(x+"/")!==0){
parsed.pathname=x+parsed.pathname;
target=parsed.href;
}
}catch(err){}
return arguments.length>1?new WS(target,protocols):new WS(target);
};
PWS.prototype=WS.prototype;
Object.setPrototypeOf(PWS,WS);
globalThis.WebSocket=PWS;
}
try{
if(navigator.serviceWorker&&typeof ServiceWorkerContainer!=="undefined"){
var swProto=ServiceWorkerContainer.prototype,swRegister=swProto.register;
swProto.register=function(scriptURL,options){
var scoped=options?Object.assign({},options):{};
var scriptPath=add(String(scriptURL));
scoped.scope=scoped.scope?add(String(scoped.scope)):x+"/";
return swRegister.call(this,scriptPath,scoped);
};
}
}catch(err){}
})();</script>`;
}

/**
 * Installs a bounded, same-origin diagnostic buffer before application scripts execute. The
 * visual verifier reads it after hydration, catching the common HTTP-200 + blank-app case that
 * a transport probe cannot distinguish from a healthy render.
 */
export function injectQaapPreviewDiagnostics(html: string, placement: PreviewScriptPlacement = 'head'): string {
    return insertPreviewScript(html, buildDiagnosticsScript(html), placement);
}

function buildDiagnosticsScript(html: string): string {
    if (!html || html.includes(QAAP_PREVIEW_DIAGNOSTICS_MARKER)) {
        return '';
    }
    return `<script ${QAAP_PREVIEW_DIAGNOSTICS_MARKER}>(function(){
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
    return insertPreviewScript(html, buildViteEnvBootstrapScript(html, publicPrefix), 'head');
}

function buildViteEnvBootstrapScript(html: string, publicPrefix: string): string {
    if (!html || html.includes(QAAP_PREVIEW_VITE_ENV_BOOTSTRAP_MARKER) || html.includes('/@vite/client')) {
        return '';
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
    return rebase
        + `<script type="module" ${QAAP_PREVIEW_VITE_ENV_BOOTSTRAP_MARKER}>`
        + `try{await import(${JSON.stringify(`${publicPrefix}/@vite/env`)})}catch{}`
        + '</script>';
}

/**
 * Injects the diagnostics, history-base, (optionally, always into `<head>`) Vite env bootstrap
 * and the prebuilt bridge loader (`buildQaapPreviewBridgeLoaderScript`, may be `''`) with one
 * insertion per location instead of one full-document pass per script. Order: `head` puts the
 * bridge last after `<head>`; `body-end` puts it first before `</body>`, as the proxy always did.
 */
export function injectQaapPreviewDocumentScripts(
    html: string,
    publicPrefix: string,
    placement: PreviewScriptPlacement,
    includeViteEnvBootstrap: boolean,
    bridgeLoader: string = '',
): string {
    const diagnostics = buildDiagnosticsScript(html);
    const historyBase = buildHistoryBaseScript(html, publicPrefix);
    const viteEnv = includeViteEnvBootstrap ? buildViteEnvBootstrapScript(html, publicPrefix) : '';
    if (placement === 'head') {
        return insertPreviewScript(html, diagnostics + historyBase + viteEnv + bridgeLoader, 'head');
    }
    return insertPreviewScript(insertPreviewScript(html, viteEnv, 'head'), bridgeLoader + historyBase + diagnostics, placement);
}

/**
 * History-base + diagnostics scripts for a document whose `</body>` lies beyond the proxy's
 * bounded look-ahead. Appended after the streamed document, the HTML parser moves them to the
 * end of `<body>` — the same DOM position (and parse-time execution) as `body-end` placement.
 * `sentHtml` is what was already sent, so markers present there are not injected twice.
 */
export function buildQaapPreviewTrailingScripts(sentHtml: string, publicPrefix: string): string {
    // The builders treat an empty document as "nothing to inject"; a trailer always has a document.
    const probe = sentHtml || ' ';
    return buildHistoryBaseScript(probe, publicPrefix) + buildDiagnosticsScript(probe);
}

/**
 * Marks the proxy's own "dev server unreachable" 503 (holding page and its HEAD polls) so the
 * page can tell it apart from a 503 the dev server returns itself. Stripped from upstream responses.
 */
export const QAAP_DEV_PREVIEW_WAITING_HEADER = 'x-qaap-preview-waiting';

/**
 * Single readiness rule shared by the backend probe and the holding page: any HTTP answer from
 * the dev server counts as served — including its own 503, which the proxy relays and the user
 * must see — except the proxy's marked "not reachable yet" 503.
 */
export function isQaapDevPreviewServedResponse(status: number, waitingMarker: string | null | undefined): boolean {
    return status > 0 && !(status === 503 && !!waitingMarker);
}

/** How long the holding page polls before it stops and offers a manual retry. */
export const QAAP_DEV_PREVIEW_WAITING_MAX_MS = 120_000;

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
  button { margin-top: 1rem; padding: 0.4rem 1rem; border: 1px solid #30363d; border-radius: 6px;
    background: #21262d; color: #e6edf3; font: inherit; cursor: pointer; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
  <div class="card">
    <div class="spinner" id="qaap-wait-spinner"></div>
    <h1 id="qaap-wait-title">Starting dev server</h1>
    <p id="qaap-wait-text">Waiting for port ${safePort}… This page refreshes automatically.</p>
    <button type="button" id="qaap-wait-retry" hidden>Retry</button>
  </div>
  <script>
    // Poll with HEAD (no frame reload, no history/URL-bar churn) and back off; reload once the
    // response is no longer the proxy's own holding 503 (a 503 from the dev server lacks the
    // marker header). Polling is also bounded and then falls back to a manual Retry.
    (function () {
      var maxMs = ${QAAP_DEV_PREVIEW_WAITING_MAX_MS};
      var marker = '${QAAP_DEV_PREVIEW_WAITING_HEADER}';
      var served = ${isQaapDevPreviewServedResponse.toString()};
      var delay, startedAt;
      var spinner = document.getElementById('qaap-wait-spinner');
      var title = document.getElementById('qaap-wait-title');
      var text = document.getElementById('qaap-wait-text');
      var button = document.getElementById('qaap-wait-retry');
      function start() {
        delay = 1000;
        startedAt = Date.now();
        spinner.hidden = false;
        button.hidden = true;
        title.textContent = 'Starting dev server';
        text.textContent = 'Waiting for port ${safePort}… This page refreshes automatically.';
        setTimeout(check, delay);
      }
      function check() {
        fetch(location.href, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' })
          .then(function (r) { if (served(r.status, r.headers.get(marker))) { location.reload(); } else { retry(); } })
          .catch(retry);
      }
      function retry() {
        if (Date.now() - startedAt >= maxMs) {
          spinner.hidden = true;
          button.hidden = false;
          title.textContent = 'Dev server still not reachable';
          text.textContent = 'Nothing answered on port ${safePort}. Check the dev server output, then retry.';
          return;
        }
        delay = Math.min(delay * 1.5, 8000);
        setTimeout(check, delay);
      }
      button.addEventListener('click', start);
      start();
    })();
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
