// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as http from 'http';
import type { Duplex } from 'stream';
import { injectable, inject } from '@theia/core/shared/inversify';
import { WsRequestValidator } from '@theia/core/lib/node/ws-request-validators';
import type { BackendApplicationContribution } from '@theia/core/lib/node';
import type { Application, Request, Response, NextFunction } from '@theia/core/shared/express';
import { QAAP_AUTH_API_PATH, QAAP_GITHUB_API_PATH, QAAP_HEALTH_API_PATH, QAAP_GITHUB_OAUTH_CALLBACK_PATH, QAAP_GITHUB_OAUTH_START_PATH } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    createQaapTenantBackendAssertion,
    QAAP_TENANT_BACKEND_ASSERTION_HEADER,
} from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import { filterQaapReservedSetCookies, QAAP_PREVIEW_ACCESS_COOKIE_NAME, stripQaapReservedCookies } from '@theia/qaap-shared-core/lib/node/qaap-dev-preview-forward-headers';
import { QAAP_DEV_PREVIEW_PREFIX, QAAP_IDENTITY_PREVIEW_PREFIX } from '@theia/qaap-shared-core/lib/common/qaap-dev-preview';
import { QAAP_TENANT_RUNTIME_API_PATH, type QaapTenantActivityReason } from '../common/qaap-cloud-api-types';
import { parseQaapPreviewIdFromHost, resolveQaapPreviewBaseDomain } from '@theia/qaap-shared-core/lib/node/qaap-preview-host';
import { QAAP_PREVIEW_ROUTE_HEADER, parseQaapPreviewRoutes, type QaapPreviewRoute } from '@theia/qaap-shared-core/lib/common/qaap-preview-route';
import { parseQaapPublicPreviewSharePath } from '../common/qaap-preview-share';
import { QaapTenantPreviewRouteTable } from './qaap-tenant-preview-route-table';
import { QaapDockerOrchestrator, type QaapTenantBackendTarget } from './qaap-docker-orchestrator';
import { QaapTenantActivityTracker } from './qaap-tenant-activity-tracker';

const HOP_BY_HOP_HEADERS = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
]);

/** Floor for the response wait when the tenant cold start consumed (almost) the whole budget. */
const TENANT_PROXY_MIN_RESPONSE_WAIT_MS = 5_000;

/**
 * Routes an authenticated browser session to the complete Theia backend running in its tenant
 * container. The outer Theia process remains a small control-plane for OAuth, health and login;
 * all IDE HTTP, RPC and WebSocket traffic is served by the tenant backend.
 */
@injectable()
export class QaapTenantBackendProxyContribution implements BackendApplicationContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(QaapDockerOrchestrator)
    protected readonly docker: QaapDockerOrchestrator;

    @inject(WsRequestValidator)
    protected readonly wsRequestValidator: WsRequestValidator;

    @inject(QaapTenantActivityTracker)
    protected readonly activity: QaapTenantActivityTracker;

    @inject(QaapTenantPreviewRouteTable)
    protected readonly previewRoutes: QaapTenantPreviewRouteTable;

    configure(app: Application): void {
        app.use((req: Request, res: Response, next: NextFunction) => {
            if (!this.docker.isBackendPerTenantEnabled() || this.isControlPlanePath(req.url)) {
                next();
                return;
            }
            void this.proxyAuthenticatedRequest(req, res, next);
        });
    }

    onStart(server: http.Server): void {
        // Theia and preview contributions register upgrade listeners during startup. Install after
        // those listeners are present, then dispatch non-tenant upgrades back to the original set.
        setImmediate(() => {
            this.installUpgradeRouter(server);
            this.installRequestRouter(server);
        });
    }

    /**
     * Routes authenticated tenant HTTP traffic BEFORE Express and Socket.IO see it.
     *
     * The Express middleware above only runs after every contribution loaded earlier (plugin-ext,
     * filesystem, mini-browser, the dev-preview endpoint, ...) had its chance, and Socket.IO's
     * long-polling transport never reaches Express at all (engine.io intercepts `/socket.io/` on
     * the server's `request` event). Without this router the browser's IDE session, terminals and
     * preview registry silently stayed on the control plane while the agent ran in the tenant
     * backend: a dev server the agent started was invisible to the preview proxy and to the
     * Preview pill. Set `QAAP_TENANT_PROXY_EARLY_ROUTING=0` to fall back to middleware routing.
     */
    protected installRequestRouter(server: http.Server): void {
        if (!this.isEarlyRequestRoutingEnabled()) {
            return;
        }
        const originalListeners = server.listeners('request').slice();
        for (const listener of originalListeners) {
            server.removeListener('request', listener as (...args: any[]) => void);
        }
        const dispatchOriginal = (request: http.IncomingMessage, response: http.ServerResponse): void => {
            for (const listener of originalListeners) {
                listener.call(server, request, response);
            }
        };
        server.on('request', (request: http.IncomingMessage, response: http.ServerResponse) => {
            if (!this.docker.isBackendPerTenantEnabled()) {
                dispatchOriginal(request, response);
                return;
            }
            const publicRoute = this.publicPreviewRouteFor(request);
            if (publicRoute) {
                void this.routePublicPreviewRequest(request, response, publicRoute, dispatchOriginal);
                return;
            }
            if (this.isControlPlanePath(request.url)) {
                dispatchOriginal(request, response);
                return;
            }
            const context = this.auth.authenticate(request as Request);
            if (context.kind !== 'authenticated') {
                dispatchOriginal(request, response);
                return;
            }
            void this.routeRequestToTenant(request, response, context.userLogin, context.session);
        });
    }

    protected async routeRequestToTenant(
        request: http.IncomingMessage,
        response: http.ServerResponse,
        userLogin: string,
        session: { accessToken: string; user: { provider: 'github' | 'gitlab'; login: string; name: string; avatarUrl?: string } },
    ): Promise<void> {
        this.activity.touch(userLogin, 'user');
        // Requests that bypass Express also bypass QaapTenantActivityContribution: keep the tenant
        // busy for the lifetime of each proxied request so the reaper never stops a backend that
        // is streaming an agent run, a long poll or a preview.
        const release = this.activity.beginOperation(userLogin,
            `http:${request.method}:${(request.url ?? '/').split('?', 1)[0]}:${Date.now()}`, this.activityReasonFor(request.url));
        response.once('finish', release);
        response.once('close', release);
        const deadline = Date.now() + this.getTenantProxyIdleTimeoutMs();
        try {
            const socketIo = this.isSocketIoPath(request.url);
            if (socketIo && this.wsRequestValidator && !await this.wsRequestValidator.allowWsUpgrade(request)) {
                // Same outer check Socket.IO's allowRequest applies to the polling handshake.
                this.writeJson(response, 403, { error: 'Forbidden' });
                return;
            }
            const root = this.auth.userWorkspaceRoot({ kind: 'authenticated', userLogin, session, sessionId: '' });
            if (!root) {
                this.auth.logSecurityEvent('ownership_denied', { action: 'workspace_path', userLogin, reason: 'tenant_root_missing' });
                this.writeJson(response, 403, { error: 'Forbidden' });
                return;
            }
            const target = await this.docker.ensureTenantBackend(userLogin, root);
            const assertion = createQaapTenantBackendAssertion({
                tenantLogin: userLogin,
                user: session.user,
                githubAccessToken: session.accessToken,
            }, this.docker.getTenantBackendAssertionSecret(userLogin));
            let socketIoHeaders: Record<string, string> | undefined;
            if (socketIo) {
                const tenantConnectionToken = this.docker.getTenantBackendConnectionToken(userLogin);
                if (!tenantConnectionToken) {
                    this.writeJson(response, 503, { error: 'Tenant backend is not ready' });
                    return;
                }
                // The tenant's Socket.IO validates its own connection token and Origin for the
                // polling transport exactly like for the WebSocket upgrade.
                socketIoHeaders = {
                    cookie: `theia-connection-token=${encodeURIComponent(tenantConnectionToken)}`,
                    origin: `http://${target.host}:${target.port}`,
                };
            }
            this.forwardHttp(request as Request, response as Response, target, assertion, userLogin,
                this.remainingTenantProxyBudgetMs(deadline), socketIoHeaders);
        } catch (error) {
            this.writeProxyError(response as Response, error);
        }
    }

    /**
     * Public preview traffic that carries its own capability instead of the IDE session: isolated
     * preview hosts (`<previewId>.<QAAP_PREVIEW_BASE_DOMAIN>`, preview-access cookie/token) and public
     * share links (`/qaap-dev/public/<token>/`). It is routed by identifier, never by the visitor's
     * session, so a signed-in visitor of someone else's share reaches the owner's backend, and never
     * carries the visitor's identity. Set `QAAP_TENANT_PREVIEW_ROUTING=0` to serve it locally.
     */
    protected publicPreviewRouteFor(request: http.IncomingMessage): QaapPreviewRoute | undefined {
        if (/^(0|false|off|no)$/i.test(process.env.QAAP_TENANT_PREVIEW_ROUTING?.trim() ?? '')) {
            return undefined;
        }
        const rawHost = this.firstHeader(request.headers['x-forwarded-host']) ?? this.firstHeader(request.headers.host);
        const previewId = parseQaapPreviewIdFromHost(rawHost, resolveQaapPreviewBaseDomain());
        if (previewId) {
            return { kind: 'preview', id: previewId };
        }
        const share = parseQaapPublicPreviewSharePath((request.url ?? '/').split('?', 1)[0]);
        return share ? { kind: 'share', id: share.token } : undefined;
    }

    protected async routePublicPreviewRequest(
        request: http.IncomingMessage,
        response: http.ServerResponse,
        route: QaapPreviewRoute,
        dispatchOriginal: (request: http.IncomingMessage, response: http.ServerResponse) => void,
    ): Promise<void> {
        const tenantLogin = this.previewRoutes.resolve(route.kind, route.id);
        if (!tenantLogin) {
            // Unknown here: legacy shares/previews still served by this process (or its 404).
            dispatchOriginal(request, response);
            return;
        }
        this.activity.touch(tenantLogin, 'preview');
        const deadline = Date.now() + this.getTenantProxyIdleTimeoutMs();
        try {
            const target = await this.docker.ensureTenantBackend(tenantLogin, this.docker.tenantRootForLogin(tenantLogin));
            this.forwardHttp(request as Request, response as Response, target, undefined, tenantLogin,
                this.remainingTenantProxyBudgetMs(deadline), undefined, route);
        } catch (error) {
            this.writeProxyError(response as Response, error);
        }
    }

    /**
     * Headers for anonymous public preview traffic: no tenant assertion and no internal `x-qaap-*`
     * header crosses, the public Host survives as `X-Forwarded-Host` (the backend derives the preview
     * id from it) and only the cookies that belong to the preview are kept.
     */
    protected publicPreviewHeaders(
        incoming: http.IncomingHttpHeaders,
        target: QaapTenantBackendTarget,
        route: QaapPreviewRoute,
    ): Record<string, string | string[]> {
        const headers: Record<string, string | string[]> = {};
        for (const [key, value] of Object.entries(incoming)) {
            const lowerKey = key.toLowerCase();
            if (value !== undefined && !HOP_BY_HOP_HEADERS.has(lowerKey) && lowerKey !== 'host'
                && lowerKey !== 'cookie' && !lowerKey.startsWith('x-qaap-')) {
                headers[lowerKey] = value;
            }
        }
        const publicHost = this.firstHeader(incoming['x-forwarded-host']) ?? this.firstHeader(incoming.host);
        if (publicHost) {
            headers['x-forwarded-host'] = publicHost;
        }
        headers.host = `${target.host}:${target.port}`;
        const cookie = this.publicPreviewCookie(incoming.cookie, route);
        if (cookie) {
            headers.cookie = cookie;
        }
        return headers;
    }

    /** Share links are on the main origin: drop every Qaap cookie. Preview hosts keep their capability. */
    protected publicPreviewCookie(raw: string | string[] | undefined, route: QaapPreviewRoute): string | undefined {
        if (route.kind === 'share') {
            return stripQaapReservedCookies(raw);
        }
        const capability = this.cookiePairs(raw).filter(pair => pair.startsWith(`${QAAP_PREVIEW_ACCESS_COOKIE_NAME}=`));
        const app = this.cookiePairs(stripQaapReservedCookies(raw));
        const kept = [...capability, ...app];
        return kept.length > 0 ? kept.join('; ') : undefined;
    }

    /** `Set-Cookie` a public preview response may carry (the preview host's capability cookie included). */
    protected publicPreviewSetCookies(raw: string | string[] | undefined, route: QaapPreviewRoute): string[] | undefined {
        const entries = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
        const kept = route.kind === 'preview'
            ? entries.filter(entry => entry.startsWith(`${QAAP_PREVIEW_ACCESS_COOKIE_NAME}=`)
                || (filterQaapReservedSetCookies(entry) ?? []).length > 0)
            : filterQaapReservedSetCookies(entries) ?? [];
        return kept.length > 0 ? kept : undefined;
    }

    protected cookiePairs(raw: string | string[] | undefined): string[] {
        if (raw === undefined) {
            return [];
        }
        return (Array.isArray(raw) ? raw.join('; ') : raw).split(';').map(pair => pair.trim()).filter(pair => pair.length > 0);
    }

    protected firstHeader(value: string | string[] | undefined): string | undefined {
        const first = Array.isArray(value) ? value[0] : value;
        const trimmed = first?.split(',')[0]?.trim();
        return trimmed ? trimmed : undefined;
    }

    /** Remembers the public identifiers `tenantLogin`'s own backend advertised to `tenantLogin`. */
    protected recordAdvertisedPreviewRoutes(headerValue: string | string[] | number | undefined, tenantLogin: string): void {
        for (const route of parseQaapPreviewRoutes(headerValue)) {
            this.previewRoutes.record(route, tenantLogin);
        }
    }

    protected activityReasonFor(url: string | undefined): QaapTenantActivityReason {
        const pathname = (url ?? '/').split('?', 1)[0];
        if (this.isSocketIoPath(pathname)) {
            return 'websocket';
        }
        if (this.isPreviewPath(pathname)) {
            return 'preview';
        }
        if (pathname.startsWith('/qaap/api/agent-')) {
            return 'agent';
        }
        return pathname.startsWith('/qaap/api/jobs') ? 'job' : 'user';
    }

    /** Same-origin dev previews (`/qaap-dev/<port>/`, `/qaap-preview/<id>/`) served by the tenant backend. */
    protected isPreviewPath(url: string | undefined): boolean {
        const pathname = (url ?? '/').split('?', 1)[0];
        return pathname.startsWith(`${QAAP_DEV_PREVIEW_PREFIX}/`) || pathname.startsWith(`${QAAP_IDENTITY_PREVIEW_PREFIX}/`);
    }

    protected isSocketIoPath(url: string | undefined): boolean {
        const pathname = (url ?? '/').split('?', 1)[0];
        return pathname === '/socket.io' || pathname.startsWith('/socket.io/');
    }

    protected isEarlyRequestRoutingEnabled(): boolean {
        return !/^(0|false|off|no)$/i.test(process.env.QAAP_TENANT_PROXY_EARLY_ROUTING?.trim() ?? '');
    }

    protected async proxyAuthenticatedRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
        const context = this.auth.authenticate(req);
        if (context.kind !== 'authenticated') {
            next();
            return;
        }
        this.activity.touch(context.userLogin, 'user');
        // One budget covers the tenant cold start and the wait for response headers, so a request
        // that first had to start the backend still gets its answer (at worst a 504) within
        // max(QAAP_TENANT_ENSURE_TIMEOUT_MS, QAAP_TENANT_PROXY_IDLE_TIMEOUT_MS) + the floor below.
        // The browser budgets (e.g. repository open) are sized above that.
        const deadline = Date.now() + this.getTenantProxyIdleTimeoutMs();
        try {
            const root = this.auth.userWorkspaceRoot(context);
            if (!root) {
                this.auth.denyForbidden(res, req, 'workspace_path', { reason: 'tenant_root_missing' });
                return;
            }
            const target = await this.docker.ensureTenantBackend(context.userLogin, root);
            const assertion = createQaapTenantBackendAssertion({
                tenantLogin: context.userLogin,
                user: context.session.user,
                githubAccessToken: context.session.accessToken,
            }, this.docker.getTenantBackendAssertionSecret(context.userLogin));
            this.forwardHttp(req, res, target, assertion, context.userLogin, this.remainingTenantProxyBudgetMs(deadline));
        } catch (error) {
            this.writeProxyError(res, error);
        }
    }

    protected installUpgradeRouter(server: http.Server): void {
        const originalListeners = server.listeners('upgrade').slice();
        for (const listener of originalListeners) {
            server.removeListener('upgrade', listener as (...args: any[]) => void);
        }
        server.on('upgrade', (request, socket, head) => {
            if (!this.docker.isBackendPerTenantEnabled()) {
                this.dispatchOriginalUpgrade(originalListeners, request, socket, head, server);
                return;
            }
            const publicRoute = this.publicPreviewRouteFor(request);
            const publicTenant = publicRoute ? this.previewRoutes.resolve(publicRoute.kind, publicRoute.id) : undefined;
            if (publicRoute && publicTenant) {
                void this.proxyPublicPreviewWebSocket(request, socket, head, publicRoute, publicTenant);
                return;
            }
            if (publicRoute) {
                // Unknown public identifier: never fall through to the visitor's own backend.
                this.dispatchOriginalUpgrade(originalListeners, request, socket, head, server);
                return;
            }
            const context = this.auth.authenticate(request as Request);
            if (context.kind !== 'authenticated') {
                this.dispatchOriginalUpgrade(originalListeners, request, socket, head, server);
                return;
            }
            void this.authorizeAndProxyWebSocket(request, socket, head, context.userLogin, context.session, originalListeners, server);
        });
    }

    protected async authorizeAndProxyWebSocket(
        request: http.IncomingMessage,
        socket: Duplex,
        head: Buffer,
        userLogin: string,
        session: { accessToken: string; user: { provider: 'github' | 'gitlab'; login: string; name: string; avatarUrl?: string } },
        originalListeners: readonly Function[],
        server: http.Server,
    ): Promise<void> {
        if (this.wsRequestValidator && !await this.wsRequestValidator.allowWsUpgrade(request)) {
            socket.destroy();
            return;
        }
        await this.proxyWebSocket(request, socket, head, userLogin, session, originalListeners, server);
    }

    /** HMR / app WebSockets of a public preview, routed to the owner's backend like its HTTP. */
    protected async proxyPublicPreviewWebSocket(
        request: http.IncomingMessage,
        socket: Duplex,
        head: Buffer,
        route: QaapPreviewRoute,
        tenantLogin: string,
    ): Promise<void> {
        socket.on('error', () => socket.destroy());
        try {
            const target = await this.docker.ensureTenantBackend(tenantLogin, this.docker.tenantRootForLogin(tenantLogin));
            const headers = this.publicPreviewHeaders(request.headers, target, route);
            headers.connection = 'Upgrade';
            headers.upgrade = this.firstHeader(request.headers.upgrade) ?? 'websocket';
            const upstream = http.request({ host: target.host, port: target.port, method: request.method, path: request.url, headers });
            const connectTimer = setTimeout(() => upstream.destroy(new Error('Tenant backend did not accept the WebSocket in time.')),
                this.getTenantWebSocketConnectTimeoutMs());
            upstream.once('upgrade', (response, upstreamSocket, upstreamHead) => {
                clearTimeout(connectTimer);
                const lines = Object.entries(response.headers).flatMap(([key, value]) =>
                    (Array.isArray(value) ? value : [value]).filter((entry): entry is string => typeof entry === 'string').map(entry => `${key}: ${entry}\r\n`));
                socket.write(`HTTP/1.1 ${response.statusCode ?? 101} ${response.statusMessage ?? 'Switching Protocols'}\r\n${lines.join('')}\r\n`);
                if (upstreamHead.length > 0) {
                    socket.write(upstreamHead);
                }
                if (head.length > 0) {
                    upstreamSocket.write(head);
                }
                upstreamSocket.on('error', () => socket.destroy());
                upstreamSocket.pipe(socket);
                socket.pipe(upstreamSocket);
            });
            upstream.once('response', response => {
                clearTimeout(connectTimer);
                response.resume();
                socket.destroy();
            });
            upstream.once('error', () => {
                clearTimeout(connectTimer);
                socket.destroy();
            });
            upstream.end();
        } catch {
            socket.destroy();
        }
    }

    protected dispatchOriginalUpgrade(
        listeners: readonly Function[],
        request: http.IncomingMessage,
        socket: Duplex,
        head: Buffer,
        server: http.Server,
    ): void {
        for (const listener of listeners) {
            listener.call(server, request, socket, head);
        }
    }

    protected async proxyWebSocket(
        request: http.IncomingMessage,
        socket: Duplex,
        head: Buffer,
        userLogin: string,
        session: { accessToken: string; user: { provider: 'github' | 'gitlab'; login: string; name: string; avatarUrl?: string } },
        originalListeners: readonly Function[],
        server: http.Server,
    ): Promise<void> {
        const release = this.activity.beginOperation(userLogin, `websocket:${request.url ?? '/'}:${Date.now()}`, 'websocket');
        socket.once('close', release);
        socket.once('error', release);
        try {
            const root = this.auth.userWorkspaceRoot({ kind: 'authenticated', userLogin, session, sessionId: '' });
            if (!root) {
                socket.destroy();
                return;
            }
            // A WebSocket can be the first request after the reaper stopped or destroyed the
            // backend. Ensure from the authenticated tenant root so cold start is complete for
            // both HTTP and upgrade paths.
            const target = await this.docker.ensureTenantBackend(userLogin, root);
            const tenantConnectionToken = this.docker.getTenantBackendConnectionToken(userLogin);
            if (!tenantConnectionToken) {
                socket.destroy();
                return;
            }
            const assertion = createQaapTenantBackendAssertion({
                tenantLogin: userLogin,
                user: session.user,
                githubAccessToken: session.accessToken,
            }, this.docker.getTenantBackendAssertionSecret(userLogin));
            const headers = this.forwardWebSocketHeaders(request.headers, target, assertion, tenantConnectionToken);
            const upstream = http.request({
                host: target.host,
                port: target.port,
                method: 'GET',
                path: request.url,
                headers,
            });
            // Bound only the handshake: a backend that accepts TCP but never answers the upgrade
            // would otherwise hold the browser socket open forever. The upgraded stream is unbounded.
            let connectTimedOut = false;
            const isConnected = this.trackUpstreamConnected(upstream);
            const connectTimer = setTimeout(() => {
                connectTimedOut = true;
                upstream.destroy(new Error('Tenant backend did not accept the WebSocket in time.'));
            }, this.getTenantWebSocketConnectTimeoutMs());
            upstream.once('upgrade', (response, upstreamSocket, upstreamHead) => {
                clearTimeout(connectTimer);
                const status = `HTTP/1.1 ${response.statusCode ?? 101} ${response.statusMessage ?? 'Switching Protocols'}\r\n`;
                const lines = Object.entries(response.headers).flatMap(([key, value]) => {
                    const values = Array.isArray(value) ? value : [value];
                    return values.filter((entry): entry is string => typeof entry === 'string').map(entry => `${key}: ${entry}\r\n`);
                });
                socket.write(`${status}${lines.join('')}\r\n`);
                if (upstreamHead.length > 0) {
                    socket.write(upstreamHead);
                }
                if (head.length > 0) {
                    upstreamSocket.write(head);
                }
                upstreamSocket.pipe(socket);
                socket.pipe(upstreamSocket);
            });
            upstream.once('response', () => {
                clearTimeout(connectTimer);
                release();
                socket.destroy();
            });
            upstream.once('error', error => {
                clearTimeout(connectTimer);
                if (this.shouldEvictTenantBackendTarget(error, connectTimedOut, isConnected())) {
                    // Same as the HTTP path: drop the cached target so the next upgrade re-ensures it.
                    this.docker.invalidateTenantBackendTarget(userLogin, target);
                }
                release();
                socket.destroy();
            });
            socket.once('error', () => upstream.destroy());
            upstream.end();
        } catch {
            release();
            socket.destroy();
            // Keep the original listener list referenced so a future refactor cannot accidentally
            // turn a failed tenant lookup into a silent fallback to the shared backend.
            void originalListeners.length;
            void server;
        }
    }

    protected forwardHttp(
        req: Request,
        res: Response,
        target: QaapTenantBackendTarget,
        assertion: string | undefined,
        tenantLogin?: string,
        responseTimeoutMs = this.getTenantProxyIdleTimeoutMs(),
        extraHeaders?: Record<string, string>,
        publicRoute?: QaapPreviewRoute,
    ): void {
        const headers = publicRoute
            ? this.publicPreviewHeaders(req.headers, target, publicRoute)
            : { ...this.forwardHeaders(req.headers, target, assertion ?? ''), ...extraHeaders };
        const previewTraffic = !publicRoute && this.isPreviewPath(req.url);
        if (previewTraffic) {
            // Previewed apps keep their own cookies (sessions, CSRF); Qaap-owned ones never cross.
            const appCookies = stripQaapReservedCookies(req.headers.cookie);
            if (appCookies) {
                headers.cookie = appCookies;
            }
        }
        const body = req.body !== undefined && req.method !== 'GET' && req.method !== 'HEAD'
            ? Buffer.from(JSON.stringify(req.body), 'utf8')
            : undefined;
        if (body) {
            headers['content-length'] = String(body.length);
        }
        const upstream = http.request({
            host: target.host,
            port: target.port,
            method: req.method,
            path: req.originalUrl || req.url,
            headers,
        }, response => {
            // Headers arrived: streaming / long-lived bodies must not be cut by the wait deadline.
            clearTimeout(responseTimer);
            const responseHeaders = { ...response.headers };
            for (const key of Object.keys(responseHeaders)) {
                if (HOP_BY_HOP_HEADERS.has(key.toLowerCase()) || key.toLowerCase() === 'set-cookie') {
                    delete responseHeaders[key];
                }
            }
            delete responseHeaders[QAAP_PREVIEW_ROUTE_HEADER];
            if (!publicRoute && assertion && tenantLogin) {
                // Only the tenant's own backend answering the tenant's own authenticated request
                // can register routes, and only to that tenant.
                this.recordAdvertisedPreviewRoutes(response.headers[QAAP_PREVIEW_ROUTE_HEADER], tenantLogin);
            }
            const appSetCookies = publicRoute
                ? this.publicPreviewSetCookies(response.headers['set-cookie'], publicRoute)
                : previewTraffic ? filterQaapReservedSetCookies(response.headers['set-cookie']) : undefined;
            if (appSetCookies) {
                responseHeaders['set-cookie'] = appSetCookies;
            }
            res.writeHead(response.statusCode ?? 502, responseHeaders);
            response.pipe(res);
        });
        // Hard deadline (not a socket idle timeout, which trickled bytes would keep resetting) for the
        // response headers; a wedged backend otherwise leaves the browser request (e.g. repository
        // open) pending forever. Destroying the upstream request closes its connection, so the
        // tenant backend sees the response 'close' and cancels the work (e.g. kills git).
        let timedOut = false;
        const isConnected = this.trackUpstreamConnected(upstream);
        const responseTimer = setTimeout(() => {
            timedOut = true;
            upstream.destroy(new Error('Tenant backend did not respond in time.'));
        }, responseTimeoutMs);
        // The browser went away (navigation, client timeout): stop the tenant work as well.
        res.once('close', () => {
            clearTimeout(responseTimer);
            if (!res.writableFinished) {
                upstream.destroy();
            }
        });
        upstream.once('error', error => {
            clearTimeout(responseTimer);
            if (this.shouldEvictTenantBackendTarget(error, timedOut, isConnected())) {
                // Drop the cached target so the next request re-ensures (restarts) the backend.
                this.docker.invalidateTenantBackendTarget(tenantLogin, target);
            }
            if (timedOut && !res.headersSent) {
                this.writeJson(res, 504, { error: 'Tenant backend timed out', detail: error.message.slice(0, 240) });
                return;
            }
            this.writeProxyError(res, error);
        });
        if (body) {
            upstream.end(body);
        } else {
            req.pipe(upstream);
        }
    }

    protected forwardHeaders(
        incoming: http.IncomingHttpHeaders,
        target: QaapTenantBackendTarget,
        assertion: string,
    ): Record<string, string | string[]> {
        const headers: Record<string, string | string[]> = {};
        for (const [key, value] of Object.entries(incoming)) {
            const lowerKey = key.toLowerCase();
            if (value !== undefined
                && !HOP_BY_HOP_HEADERS.has(lowerKey)
                && lowerKey !== 'host'
                // The browser's control-plane cookie is not needed after the HMAC assertion is
                // minted and must not cross the tenant boundary or appear in tenant logs.
                && lowerKey !== 'cookie') {
                headers[key] = value;
            }
        }
        headers.host = `${target.host}:${target.port}`;
        headers[QAAP_TENANT_BACKEND_ASSERTION_HEADER] = assertion;
        return headers;
    }

    protected forwardWebSocketHeaders(
        incoming: http.IncomingHttpHeaders,
        target: QaapTenantBackendTarget,
        assertion: string,
        tenantConnectionToken: string,
    ): Record<string, string | string[]> {
        const headers = this.forwardHeaders(incoming, target, assertion);
        // Upgrade and Connection are hop-by-hop headers and are intentionally stripped by
        // forwardHeaders for normal HTTP. They must be restored for this upstream handshake.
        headers.connection = 'Upgrade';
        headers.upgrade = 'websocket';
        // The browser's control-plane token is deliberately not forwarded. The tenant backend
        // receives only its own token, captured from its private health response above.
        headers.cookie = `theia-connection-token=${encodeURIComponent(tenantConnectionToken)}`;
        // The tenant backend validates Origin against its internal Host header. The public origin
        // was already validated by the outer WsRequestValidator before this hop.
        headers.origin = `http://${target.host}:${target.port}`;
        return headers;
    }

    protected isControlPlanePath(url: string | undefined): boolean {
        const pathname = (url ?? '/').split('?', 1)[0];
        return pathname === QAAP_HEALTH_API_PATH
            || pathname.startsWith(`${QAAP_AUTH_API_PATH}/`)
            || pathname === QAAP_GITHUB_OAUTH_START_PATH
            || pathname === QAAP_GITHUB_OAUTH_CALLBACK_PATH
            || pathname === QAAP_TENANT_RUNTIME_API_PATH
            || pathname.startsWith(`${QAAP_TENANT_RUNTIME_API_PATH}/`)
            // GitHub delivers webhooks to the control plane, whose inbox hub streams them.
            || pathname === `${QAAP_GITHUB_API_PATH}/webhook`
            || pathname.startsWith(`${QAAP_GITHUB_API_PATH}/inbox/`);
    }

    protected getTenantProxyIdleTimeoutMs(): number {
        const configured = Number.parseInt(process.env.QAAP_TENANT_PROXY_IDLE_TIMEOUT_MS?.trim() ?? '', 10);
        return Number.isInteger(configured) && configured > 0 ? configured : 180_000;
    }

    /** What is left of the per-request budget after ensure, never below a short floor to reach a warm backend. */
    protected remainingTenantProxyBudgetMs(deadline: number): number {
        return Math.max(TENANT_PROXY_MIN_RESPONSE_WAIT_MS, deadline - Date.now());
    }

    protected getTenantWebSocketConnectTimeoutMs(): number {
        const configured = Number.parseInt(process.env.QAAP_TENANT_PROXY_WS_CONNECT_TIMEOUT_MS?.trim() ?? '', 10);
        return Number.isInteger(configured) && configured > 0 ? configured : 15_000;
    }

    /** Report whether the upstream request ever had a connected socket (fresh or reused keep-alive). */
    protected trackUpstreamConnected(upstream: http.ClientRequest): () => boolean {
        let connected = false;
        upstream.once('socket', socket => {
            if (!socket.connecting) {
                connected = true;
                return;
            }
            socket.once('connect', () => {
                connected = true;
            });
        });
        return () => connected;
    }

    /**
     * Evict the cached target only when the backend is unreachable: a connect error, or a timeout
     * before any TCP connection. A slow request on a live backend (e.g. a long clone) keeps it cached.
     */
    protected shouldEvictTenantBackendTarget(error: unknown, timedOut: boolean, connected: boolean): boolean {
        return this.isTenantBackendConnectError(error) || (timedOut && !connected);
    }

    protected isTenantBackendConnectError(error: unknown): boolean {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        return code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENOTFOUND' || code === 'ETIMEDOUT';
    }

    protected writeProxyError(res: Response, error: unknown): void {
        if (res.headersSent) {
            res.end();
            return;
        }
        const message = error instanceof Error ? error.message : String(error);
        this.writeJson(res, 502, { error: 'Tenant backend unavailable', detail: message.slice(0, 240) });
    }

    /** Works for Express and raw `http.ServerResponse`s (the early request router has no Express). */
    protected writeJson(res: http.ServerResponse, status: number, body: unknown): void {
        if (res.headersSent) {
            res.end();
            return;
        }
        const payload = JSON.stringify(body);
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', Buffer.byteLength(payload));
        res.end(payload);
    }
}
