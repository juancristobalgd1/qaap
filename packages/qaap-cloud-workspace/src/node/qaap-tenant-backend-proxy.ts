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
import { QAAP_AUTH_API_PATH, QAAP_HEALTH_API_PATH, QAAP_GITHUB_OAUTH_CALLBACK_PATH, QAAP_GITHUB_OAUTH_START_PATH } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    createQaapTenantBackendAssertion,
    QAAP_TENANT_BACKEND_ASSERTION_HEADER,
} from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { QaapGithubAuthGuard } from '@theia/qaap-mobile-shell/lib/node/qaap-github-auth-guard';
import { QAAP_TENANT_RUNTIME_API_PATH } from '../common/qaap-cloud-api-types';
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
        setImmediate(() => this.installUpgradeRouter(server));
    }

    protected async proxyAuthenticatedRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
        const context = this.auth.authenticate(req);
        if (context.kind !== 'authenticated') {
            next();
            return;
        }
        this.activity.touch(context.userLogin, 'user');
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
            this.forwardHttp(req, res, target, assertion);
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
            upstream.once('upgrade', (response, upstreamSocket, upstreamHead) => {
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
                release();
                socket.destroy();
            });
            upstream.once('error', () => {
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

    protected forwardHttp(req: Request, res: Response, target: QaapTenantBackendTarget, assertion: string): void {
        const headers = this.forwardHeaders(req.headers, target, assertion);
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
            const responseHeaders = { ...response.headers };
            for (const key of Object.keys(responseHeaders)) {
                if (HOP_BY_HOP_HEADERS.has(key.toLowerCase()) || key.toLowerCase() === 'set-cookie') {
                    delete responseHeaders[key];
                }
            }
            res.writeHead(response.statusCode ?? 502, responseHeaders);
            response.pipe(res);
        });
        upstream.once('error', error => this.writeProxyError(res, error));
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
            || pathname.startsWith(`${QAAP_TENANT_RUNTIME_API_PATH}/`);
    }

    protected writeProxyError(res: Response, error: unknown): void {
        if (res.headersSent) {
            res.end();
            return;
        }
        const message = error instanceof Error ? error.message : String(error);
        res.status(502).json({ error: 'Tenant backend unavailable', detail: message.slice(0, 240) });
    }
}
