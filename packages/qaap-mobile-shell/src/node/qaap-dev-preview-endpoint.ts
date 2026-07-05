// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution, FileUri } from '@theia/core/lib/node';
import * as http from 'http';
import * as net from 'net';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';
import { QaapDevPreviewPortRegistry } from './qaap-dev-preview-port-registry';
import {
    QAAP_DEV_PREVIEW_CLAIM_PATH,
    QAAP_DEV_PREVIEW_PREFIX,
    QAAP_DEV_PREVIEW_PROBE_PATH,
    buildDevPreviewWaitingHtml,
    buildQaapDevPreviewOpenUrl,
    isAllowedDevPreviewPort,
    parseQaapDevPreviewPort,
    parseQaapDevPreviewRequestPath,
    type QaapDevPreviewProbeResponse,
} from '../common/qaap-dev-preview';
import { normalizeQaapPublicUrl } from './qaap-github-oauth-config';
import { QaapDevPreviewTargetHostResolver } from './qaap-dev-preview-target-host';

const PROBE_TIMEOUT_MS = 2500;
const LOCAL_TARGET_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);
const TEXT_RESPONSE_PATTERN = /\b(?:text\/html|text\/css|application\/javascript|text\/javascript|application\/x-javascript)\b/i;

function getQaapBackendListenPort(): number {
    const parsed = Number(process.env.PORT);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;
}

@injectable()
export class QaapDevPreviewEndpoint implements BackendApplicationContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(QaapDevPreviewPortRegistry)
    protected readonly portRegistry: QaapDevPreviewPortRegistry;

    configure(app: Application): void {
        // Register static /api segments before the `:port` catch-all so they aren't parsed as ports.
        app.post(QAAP_DEV_PREVIEW_CLAIM_PATH, (req, res) => {
            this.handleClaim(req, res);
        });
        app.get(`${QAAP_DEV_PREVIEW_PROBE_PATH}/:port`, (req, res) => {
            if (!this.requireHttpAuth(req, res)) {
                return;
            }
            void this.handleProbe(req, res);
        });
        app.use(`${QAAP_DEV_PREVIEW_PREFIX}/:port`, (req, res) => {
            if (!this.requireHttpAuth(req, res)) {
                return;
            }
            this.handleProxy(req, res);
        });
    }

    /**
     * Rejects anonymous callers. This private in-IDE proxy reaches any dev server on a loopback
     * port of the shared backend; the public share path (token-gated) is a separate endpoint.
     * Ownership is further scoped by {@link portRegistry} once the owner claims the port.
     * Skip-auth (single-user/local dev) is allowed through.
     */
    protected requireHttpAuth(req: Request, res: Response): boolean {
        if (this.auth.authenticate(req).kind === 'unauthorized') {
            res.status(401).type('text/plain').send('Not signed in');
            return false;
        }
        return true;
    }

    /** Records that the authenticated caller owns the workspace a dev-preview port belongs to. */
    protected handleClaim(req: Request, res: Response): void {
        const ctx = this.auth.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            res.sendStatus(401);
            return;
        }
        const body = (req.body ?? {}) as { port?: unknown; root?: unknown };
        const port = parseQaapDevPreviewPort(typeof body.port === 'number' ? body.port : Number(body.port));
        const root = typeof body.root === 'string' ? body.root : undefined;
        if (port === undefined || !root) {
            res.sendStatus(400);
            return;
        }
        // assertWorkspacePathOwned re-authenticates and sends 401/403; it returns true under skip-auth.
        if (!this.auth.assertWorkspacePathOwned(req, res, FileUri.fsPath(root), 'workspace_path')) {
            return;
        }
        const owner = this.auth.resolveUserLogin(ctx);
        if (owner) {
            this.portRegistry.claim(port, owner);
        }
        res.sendStatus(204);
    }

    /** True when the port is claimed by a different login than the authenticated caller. */
    protected isForeignClaimedPort(req: Request | http.IncomingMessage, port: number): boolean {
        const owner = this.portRegistry.ownerOf(port);
        if (!owner) {
            return false; // unclaimed → fall back to the requireAuth gate
        }
        const ctx = this.auth.authenticate(req as unknown as Request);
        if (ctx.kind === 'skip') {
            return false;
        }
        return this.auth.resolveUserLogin(ctx) !== owner;
    }

    onStart(server: http.Server): void {
        server.on('upgrade', (req, socket, head) => {
            this.handleWebSocketUpgrade(req, socket as net.Socket, head);
        });
    }

    protected async handleProbe(req: Request, res: Response): Promise<void> {
        const port = parseQaapDevPreviewPort(req.params.port);
        const origin = this.resolvePublicOrigin(req);
        if (port === undefined) {
            res.status(400).json({ ready: false, previewUrl: '' } satisfies QaapDevPreviewProbeResponse);
            return;
        }
        if (this.isIdeListenPort(port)) {
            res.json({ ready: false, previewUrl: buildQaapDevPreviewOpenUrl(origin, port) } satisfies QaapDevPreviewProbeResponse);
            return;
        }
        const ready = await this.probeLocalDevServer(port);
        const body: QaapDevPreviewProbeResponse = {
            ready,
            previewUrl: buildQaapDevPreviewOpenUrl(origin, port),
        };
        res.json(body);
    }

    protected handleProxy(req: Request, res: Response): void {
        const port = parseQaapDevPreviewPort(req.params.port);
        if (port === undefined) {
            res.status(400).send('Invalid dev preview port');
            return;
        }
        if (this.isIdeListenPort(port)) {
            res.status(403).type('text/plain').send('Cannot proxy the Qaap IDE port. Use a different dev-server port.');
            return;
        }
        if (this.isForeignClaimedPort(req, port)) {
            res.status(403).type('text/plain').send('This preview port belongs to another workspace.');
            return;
        }
        const targetPath = req.url || '/';
        void this.forwardHttp(req, res, port, targetPath);
    }

    protected readonly targetHostResolver = new QaapDevPreviewTargetHostResolver();

    /** Picks the loopback family the dev server actually listens on (IPv4 first, then IPv6). */
    protected resolveTargetHost(port: number): Promise<string | undefined> {
        return this.targetHostResolver.resolve(port);
    }

    protected handleWebSocketUpgrade(
        req: http.IncomingMessage,
        socket: net.Socket,
        head: Buffer,
    ): void {
        const pathname = (req.url ?? '').split('?')[0];
        const parsed = parseQaapDevPreviewRequestPath(pathname);
        if (!parsed || this.isIdeListenPort(parsed.port)) {
            return;
        }
        // Reject anonymous WebSocket upgrades — mirror the HTTP-route auth gate.
        if (this.auth.authenticate(req as unknown as Request).kind === 'unauthorized') {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        if (this.isForeignClaimedPort(req, parsed.port)) {
            socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        const query = (req.url ?? '').includes('?') ? (req.url ?? '').slice((req.url ?? '').indexOf('?')) : '';
        const path = `${parsed.targetPath}${query}`;
        void this.proxyWebSocket(req, socket, head, parsed.port, path);
    }

    protected async proxyWebSocket(
        req: http.IncomingMessage,
        socket: net.Socket,
        head: Buffer,
        port: number,
        path: string,
    ): Promise<void> {
        const targetHost = await this.resolveTargetHost(port);
        if (!targetHost) {
            socket.destroy();
            return;
        }
        // `localhost` keeps dev-server host checks happy regardless of loopback family.
        const headers = { ...req.headers, host: `localhost:${port}` };
        const proxyReq = http.request({
            hostname: targetHost,
            port,
            path,
            method: req.method,
            headers,
        });
        proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
            const headerLines = Object.entries(proxyRes.headers)
                .filter(([, value]) => value !== undefined)
                .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
            socket.write(
                `HTTP/1.1 ${proxyRes.statusCode ?? 101} ${proxyRes.statusMessage ?? 'Switching Protocols'}\r\n`
                + `${headerLines.join('\r\n')}\r\n\r\n`,
            );
            if (head.length > 0) {
                proxySocket.write(head);
            }
            if (proxyHead.length > 0) {
                proxySocket.write(proxyHead);
            }
            proxySocket.pipe(socket);
            socket.pipe(proxySocket);
        });
        proxyReq.on('error', () => {
            socket.destroy();
        });
        proxyReq.end();
    }

    protected async forwardHttp(incoming: Request, outgoing: Response, targetPort: number, targetPath: string): Promise<void> {
        const targetHost = await this.resolveTargetHost(targetPort);
        if (!targetHost) {
            outgoing.status(503).type('text/html').send(buildDevPreviewWaitingHtml(targetPort));
            return;
        }
        const headers: http.OutgoingHttpHeaders = { ...incoming.headers };
        headers.host = `localhost:${targetPort}`;
        headers['accept-encoding'] = 'identity';
        delete headers.connection;

        const proxyReq = http.request({
            hostname: targetHost,
            port: targetPort,
            path: targetPath,
            method: incoming.method,
            headers,
        }, proxyRes => {
            const responseHeaders = { ...proxyRes.headers };
            const location = responseHeaders.location;
            if (typeof location === 'string') {
                responseHeaders.location = this.rewriteDevPreviewLocation(location, targetPort);
            }

            if (!this.shouldRewriteProxyBody(proxyRes)) {
                outgoing.writeHead(proxyRes.statusCode ?? 502, responseHeaders);
                proxyRes.pipe(outgoing);
                return;
            }

            delete responseHeaders['content-length'];
            outgoing.writeHead(proxyRes.statusCode ?? 502, responseHeaders);
            const chunks: Buffer[] = [];
            proxyRes.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            proxyRes.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                outgoing.end(this.rewriteDevPreviewBody(body, targetPort));
            });
        });
        proxyReq.on('error', () => {
            if (!outgoing.headersSent) {
                outgoing.status(503).type('text/html').send(buildDevPreviewWaitingHtml(targetPort));
            } else {
                outgoing.end();
            }
        });
        incoming.pipe(proxyReq);
    }

    protected shouldRewriteProxyBody(proxyRes: http.IncomingMessage): boolean {
        const encoding = proxyRes.headers['content-encoding'];
        if (encoding && encoding !== 'identity') {
            return false;
        }
        const contentType = proxyRes.headers['content-type'];
        return typeof contentType === 'string' && TEXT_RESPONSE_PATTERN.test(contentType);
    }

    protected rewriteDevPreviewLocation(location: string, targetPort: number): string {
        if (location.startsWith(`${QAAP_DEV_PREVIEW_PREFIX}/`)) {
            return location;
        }
        if (location.startsWith('/')) {
            return `${QAAP_DEV_PREVIEW_PREFIX}/${targetPort}${location}`;
        }
        try {
            const parsed = new URL(location);
            if (LOCAL_TARGET_HOSTNAMES.has(parsed.hostname)) {
                parsed.host = '';
                return `${QAAP_DEV_PREVIEW_PREFIX}/${targetPort}${parsed.pathname}${parsed.search}${parsed.hash}`;
            }
        } catch {
            // Relative redirect without a leading slash; leave it untouched.
        }
        return location;
    }

    protected rewriteDevPreviewBody(body: string, targetPort: number): string {
        const prefix = `${QAAP_DEV_PREVIEW_PREFIX}/${targetPort}`;
        return body
            .replace(/\b(src|href|action)=("|')\/(?!\/|qaap-dev\/)/g, `$1=$2${prefix}/`)
            .replace(/\burl\(\s*(["']?)\/(?!\/|qaap-dev\/)/g, `url($1${prefix}/`)
            .replace(/(["'`])\/(?!\/|qaap-dev\/)([^"'`\s]*)\1/g, `$1${prefix}/$2$1`)
            .replace(/(\bimport\s*(?:\(|[^"'`]*from\s*)?["'`])\/(?!\/|qaap-dev\/)/g, `$1${prefix}/`)
            .replace(/(\bexport\s+[^"'`]*from\s*["'`])\/(?!\/|qaap-dev\/)/g, `$1${prefix}/`)
            .replace(/(\bnew\s+URL\(\s*["'`])\/(?!\/|qaap-dev\/)/g, `$1${prefix}/`);
    }

    protected isIdeListenPort(port: number): boolean {
        return port === getQaapBackendListenPort();
    }

    protected async probeLocalDevServer(port: number): Promise<boolean> {
        if (!isAllowedDevPreviewPort(port) || this.isIdeListenPort(port)) {
            return false;
        }
        const targetHost = await this.resolveTargetHost(port);
        if (!targetHost) {
            return false;
        }
        return new Promise(resolve => {
            const req = http.get({
                host: targetHost,
                port,
                path: '/',
                headers: { host: `localhost:${port}` },
                timeout: PROBE_TIMEOUT_MS,
            }, res => {
                res.resume();
                resolve((res.statusCode ?? 0) > 0);
            });
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
            req.on('error', () => resolve(false));
        });
    }

    protected resolvePublicOrigin(req: Request): string {
        const envUrl = process.env.QAAP_OAUTH_PUBLIC_URL?.trim();
        if (envUrl) {
            return normalizeQaapPublicUrl(envUrl);
        }
        const proto = this.firstHeaderValue(req.headers['x-forwarded-proto']) ?? req.protocol ?? 'http';
        const host = this.firstHeaderValue(req.headers['x-forwarded-host']) ?? req.get('host') ?? 'localhost';
        return normalizeQaapPublicUrl(`${proto}://${host}`);
    }

    protected firstHeaderValue(value: string | string[] | undefined): string | undefined {
        if (Array.isArray(value)) {
            return value[0]?.split(',')[0]?.trim();
        }
        return value?.split(',')[0]?.trim();
    }
}
