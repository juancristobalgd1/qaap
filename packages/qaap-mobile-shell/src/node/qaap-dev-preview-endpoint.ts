// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, NextFunction, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution, FileUri } from '@theia/core/lib/node';
import * as http from 'http';
import * as net from 'net';
import { timingSafeEqual } from 'crypto';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';
import { QaapDevPreviewPortRegistry, type QaapDevPreviewRecord } from './qaap-dev-preview-port-registry';
import {
    QAAP_DEV_PREVIEW_CLAIM_PATH,
    QAAP_DEV_PREVIEW_PREFIX,
    QAAP_DEV_PREVIEW_PROBE_PATH,
    QAAP_IDENTITY_PREVIEW_PREFIX,
    QAAP_IDENTITY_PREVIEW_PROBE_PATH,
    buildDevPreviewWaitingHtml,
    buildQaapDevPreviewOpenUrl,
    buildQaapIdentityPreviewUrl,
    isAllowedDevPreviewPort,
    parseQaapDevPreviewPort,
    parseQaapIdentityPreviewRequestPath,
    parseQaapDevPreviewRequestPath,
    type QaapDevPreviewProbeResponse,
} from '../common/qaap-dev-preview';
import {
    isQaapPreviewIdentity,
    isQaapPreviewId,
    resolveQaapPreviewIdentity,
    type QaapPreviewIdentity,
} from '../common/qaap-preview-identity';
import { normalizeQaapPublicUrl } from './qaap-github-oauth-config';
import { QaapDevPreviewTargetHostResolver } from './qaap-dev-preview-target-host';
import { injectQaapPreviewBridgeLoader } from '@theia/qaap-adapters/lib/common/qaap-preview-bridge-protocol';

const PROBE_TIMEOUT_MS = 2500;
const LOCAL_TARGET_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);
const TEXT_RESPONSE_PATTERN = /\b(?:text\/html|text\/css|application\/javascript|text\/javascript|application\/x-javascript)\b/i;
const QAAP_PREVIEW_ACCESS_QUERY = 'qaap_preview_token';
const QAAP_PREVIEW_ACCESS_COOKIE = 'qaap_preview_access';

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
        // Optional isolated-origin mode. DNS/TLS should route `*.QAAP_PREVIEW_BASE_DOMAIN` here;
        // access uses a host-only preview capability, never the IDE's broad session cookie.
        app.use((req: Request, res: Response, next: NextFunction) => {
            const previewId = this.previewIdFromHost(req);
            if (!previewId) {
                next();
                return;
            }
            const record = this.portRegistry.get(previewId);
            if (!record) {
                res.status(404).type('text/plain').send('Preview not found.');
                return;
            }
            const capability = this.authorizePreviewHostRequest(req, res, record);
            if (capability !== 'allowed') {
                return;
            }
            this.portRegistry.touchPreview(previewId, record.ownerLogin);
            if (this.isIdeListenPort(record.port)) {
                res.status(403).type('text/plain').send('Invalid preview target.');
                return;
            }
            void this.forwardHttp(req, res, record.port, req.url || '/', '');
        });
        // Register static /api segments before the `:port` catch-all so they aren't parsed as ports.
        app.post(QAAP_DEV_PREVIEW_CLAIM_PATH, (req, res) => {
            void this.handleClaim(req, res);
        });
        app.get(`${QAAP_DEV_PREVIEW_PROBE_PATH}/:port`, (req, res) => {
            if (!this.requireHttpAuth(req, res)) {
                return;
            }
            void this.handleProbe(req, res);
        });
        app.get(`${QAAP_IDENTITY_PREVIEW_PROBE_PATH}/:previewId`, (req, res) => {
            if (!this.requireHttpAuth(req, res)) {
                return;
            }
            void this.handleIdentityProbe(req, res);
        });
        app.use(`${QAAP_IDENTITY_PREVIEW_PREFIX}/:previewId`, (req, res) => {
            if (!this.requireHttpAuth(req, res)) {
                return;
            }
            this.handleIdentityProxy(req, res);
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
    protected async handleClaim(req: Request, res: Response): Promise<void> {
        const ctx = this.auth.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            res.sendStatus(401);
            return;
        }
        const body = (req.body ?? {}) as { port?: unknown; root?: unknown } & Partial<QaapPreviewIdentity>;
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
            if (isQaapPreviewIdentity(body)) {
                const identity = resolveQaapPreviewIdentity(body);
                const registration = {
                    ...identity,
                    ownerLogin: owner,
                    root,
                    port,
                };
                const expiredConflicts = this.portRegistry.expiredRegistrationConflicts(registration);
                const stalePortOwner = this.portRegistry.staleOwnerOf(port);
                const portsToProbe = new Set(expiredConflicts.map(conflict => conflict.port));
                if (stalePortOwner !== undefined && stalePortOwner !== owner) {
                    portsToProbe.add(port);
                }
                for (const conflictPort of portsToProbe) {
                    if (await this.probeLocalDevServer(conflictPort)) {
                        res.status(409).type('text/plain').send('This preview identity or port is already in use.');
                        return;
                    }
                }
                const replaceExpired = expiredConflicts.length > 0
                    || (stalePortOwner !== undefined && stalePortOwner !== owner);
                const record = this.portRegistry.register(registration, { replaceExpired });
                if (!record) {
                    res.status(409).type('text/plain').send('This preview identity or port is already in use.');
                    return;
                }
                const previewUrl = this.buildIdentityPreviewUrl(req, record);
                res.status(200).json({ previewId: record.previewId, previewUrl, port: record.port });
                return;
            }
            // An EXPIRED claim from a different tenant only frees the port once nothing is
            // listening on it: an idle-but-still-running server must not be silently taken over
            // just because its owner did not touch the preview for 30 minutes.
            const stale = this.portRegistry.staleOwnerOf(port);
            if (stale !== undefined && stale !== owner && await this.probeLocalDevServer(port)) {
                res.status(409).type('text/plain').send('This preview port is in use by another workspace.');
                return;
            }
            if (!this.portRegistry.claim(port, owner)) {
                // A different tenant holds a live claim — refuse the takeover instead of silently
                // rebinding their running preview to this caller (keeps H1 meaningful).
                res.status(409).type('text/plain').send('This preview port is in use by another workspace.');
                return;
            }
        }
        res.sendStatus(204);
    }

    /**
     * Whether the caller may proxy this dev-preview port. FAIL CLOSED: an authenticated user may
     * only reach a port they have CLAIMED (which proves workspace ownership). An unclaimed port is
     * denied — otherwise any signed-in user could reach another tenant's dev server on the shared
     * loopback before its owner happened to claim it. Skip-auth (single-user / local dev) is allowed
     * through; the owner's frontend claims the port before opening the preview.
     */
    protected mayProxyPort(req: Request | http.IncomingMessage, port: number): boolean {
        const ctx = this.auth.authenticate(req as unknown as Request);
        if (ctx.kind === 'skip') {
            return true;
        }
        if (ctx.kind === 'unauthorized') {
            return false;
        }
        const owner = this.portRegistry.ownerOf(port);
        const login = this.auth.resolveUserLogin(ctx);
        if (owner === undefined || login === undefined || login !== owner) {
            return false;
        }
        // Keep the claim alive while the owner is actively using the preview — otherwise the
        // 30-minute TTL expires mid-session and the owner's own preview starts 403ing.
        this.portRegistry.touch(port, login);
        return true;
    }

    /** Resolves an identity-scoped preview only for its authenticated owner. */
    protected previewForRequest(req: Request | http.IncomingMessage, previewId: string): QaapDevPreviewRecord | undefined {
        const ctx = this.auth.authenticate(req as unknown as Request);
        if (ctx.kind === 'unauthorized') {
            return undefined;
        }
        const login = this.auth.resolveUserLogin(ctx);
        if (!login) {
            return undefined;
        }
        const record = this.portRegistry.getForOwner(previewId, login);
        if (!record) {
            return undefined;
        }
        this.portRegistry.touchPreview(previewId, login);
        return record;
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
        // Gate the probe by ownership like the proxy/WS paths — otherwise a signed-in user could
        // enumerate the liveness of other tenants' dev servers on the shared loopback (SEC-8).
        if (!this.mayProxyPort(req, port)) {
            res.status(403).json({ ready: false, previewUrl: '' } satisfies QaapDevPreviewProbeResponse);
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

    protected async handleIdentityProbe(req: Request, res: Response): Promise<void> {
        const previewId = req.params.previewId;
        const record = this.previewForRequest(req, previewId);
        if (!record) {
            res.status(403).json({ ready: false, previewUrl: '', previewId } satisfies QaapDevPreviewProbeResponse);
            return;
        }
        const previewUrl = this.buildIdentityPreviewUrl(req, record);
        if (this.isIdeListenPort(record.port)) {
            res.json({ ready: false, previewUrl, previewId } satisfies QaapDevPreviewProbeResponse);
            return;
        }
        res.json({
            ready: await this.probeLocalDevServer(record.port),
            previewUrl,
            previewId,
        } satisfies QaapDevPreviewProbeResponse);
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
        if (!this.mayProxyPort(req, port)) {
            res.status(403).type('text/plain').send('This preview port belongs to another workspace.');
            return;
        }
        const targetPath = req.url || '/';
        void this.forwardHttp(req, res, port, targetPath);
    }

    protected handleIdentityProxy(req: Request, res: Response): void {
        const previewId = req.params.previewId;
        const record = this.previewForRequest(req, previewId);
        if (!record) {
            res.status(403).type('text/plain').send('This preview belongs to another execution.');
            return;
        }
        if (this.isIdeListenPort(record.port)) {
            res.status(403).type('text/plain').send('Cannot proxy the Qaap IDE port. Use a different dev-server port.');
            return;
        }
        const targetPath = req.url || '/';
        void this.forwardHttp(req, res, record.port, targetPath, `${QAAP_IDENTITY_PREVIEW_PREFIX}/${previewId}`);
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
        const hostPreviewId = this.previewIdFromHost(req);
        if (hostPreviewId) {
            const hostRecord = this.portRegistry.get(hostPreviewId);
            if (!hostRecord || !this.hasPreviewCapability(req, hostRecord) || this.isIdeListenPort(hostRecord.port)) {
                socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
                socket.destroy();
                return;
            }
            this.portRegistry.touchPreview(hostPreviewId, hostRecord.ownerLogin);
            const hostPath = `${pathname || '/'}${(req.url ?? '').includes('?') ? (req.url ?? '').slice((req.url ?? '').indexOf('?')) : ''}`;
            void this.proxyWebSocket(req, socket, head, hostRecord.port, hostPath);
            return;
        }
        const identity = parseQaapIdentityPreviewRequestPath(pathname);
        const legacy = identity ? undefined : parseQaapDevPreviewRequestPath(pathname);
        const identityRecord = identity ? this.previewForRequest(req, identity.previewId) : undefined;
        const targetPort = identityRecord?.port ?? legacy?.port;
        const targetPath = identity?.targetPath ?? legacy?.targetPath;
        if (!targetPort || !targetPath || this.isIdeListenPort(targetPort)) {
            return;
        }
        // Reject anonymous WebSocket upgrades — mirror the HTTP-route auth gate.
        if (this.auth.authenticate(req as unknown as Request).kind === 'unauthorized') {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        if ((identity && !identityRecord) || (!identity && !this.mayProxyPort(req, targetPort))) {
            socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        const query = (req.url ?? '').includes('?') ? (req.url ?? '').slice((req.url ?? '').indexOf('?')) : '';
        const path = `${targetPath}${query}`;
        void this.proxyWebSocket(req, socket, head, targetPort, path);
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

    protected async forwardHttp(
        incoming: Request,
        outgoing: Response,
        targetPort: number,
        targetPath: string,
        publicPrefix: string = `${QAAP_DEV_PREVIEW_PREFIX}/${targetPort}`,
    ): Promise<void> {
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
            if (publicPrefix === '') {
                delete responseHeaders['x-frame-options'];
                responseHeaders['content-security-policy'] = this.rewriteIsolatedPreviewCsp(
                    responseHeaders['content-security-policy'],
                    this.resolvePublicOrigin(incoming),
                );
            }
            const location = responseHeaders.location;
            if (typeof location === 'string') {
                responseHeaders.location = this.rewriteDevPreviewLocation(location, targetPort, publicPrefix);
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
                const rewritten = this.rewriteDevPreviewBody(body, targetPort, publicPrefix);
                const contentType = proxyRes.headers['content-type'];
                outgoing.end(typeof contentType === 'string' && /\btext\/html\b/i.test(contentType)
                    ? injectQaapPreviewBridgeLoader(rewritten, this.resolvePublicOrigin(incoming))
                    : rewritten);
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

    protected rewriteDevPreviewLocation(
        location: string,
        targetPort: number,
        publicPrefix: string = `${QAAP_DEV_PREVIEW_PREFIX}/${targetPort}`,
    ): string {
        if (location.startsWith(`${QAAP_DEV_PREVIEW_PREFIX}/`) || location.startsWith(`${QAAP_IDENTITY_PREVIEW_PREFIX}/`)) {
            return location;
        }
        if (location.startsWith('/')) {
            return `${publicPrefix}${location}`;
        }
        try {
            const parsed = new URL(location);
            if (LOCAL_TARGET_HOSTNAMES.has(parsed.hostname)) {
                parsed.host = '';
                return `${publicPrefix}${parsed.pathname}${parsed.search}${parsed.hash}`;
            }
        } catch {
            // Relative redirect without a leading slash; leave it untouched.
        }
        return location;
    }

    protected rewriteDevPreviewBody(
        body: string,
        targetPort: number,
        publicPrefix: string = `${QAAP_DEV_PREVIEW_PREFIX}/${targetPort}`,
    ): string {
        const prefix = publicPrefix;
        return body
            .replace(/\b(src|href|action)=("|')\/(?!\/|qaap-(?:dev|preview)\/)/g, `$1=$2${prefix}/`)
            .replace(/\burl\(\s*(["']?)\/(?!\/|qaap-(?:dev|preview)\/)/g, `url($1${prefix}/`)
            .replace(/(["'`])\/(?!\/|qaap-(?:dev|preview)\/)([^"'`\s]*)\1/g, `$1${prefix}/$2$1`)
            .replace(/(\bimport\s*(?:\(|[^"'`]*from\s*)?["'`])\/(?!\/|qaap-(?:dev|preview)\/)/g, `$1${prefix}/`)
            .replace(/(\bexport\s+[^"'`]*from\s*["'`])\/(?!\/|qaap-(?:dev|preview)\/)/g, `$1${prefix}/`)
            .replace(/(\bnew\s+URL\(\s*["'`])\/(?!\/|qaap-(?:dev|preview)\/)/g, `$1${prefix}/`);
    }

    protected rewriteIsolatedPreviewCsp(raw: string | string[] | undefined, parentOrigin: string): string {
        const source = Array.isArray(raw) ? raw.join('; ') : raw ?? '';
        const directives = source.split(';').map(item => item.trim()).filter(Boolean);
        let frameAncestorsSeen = false;
        let scriptSourceSeen = false;
        const rewritten = directives.map(directive => {
            const [name, ...values] = directive.split(/\s+/);
            if (name.toLowerCase() === 'frame-ancestors') {
                frameAncestorsSeen = true;
                return `frame-ancestors ${parentOrigin}`;
            }
            if (name.toLowerCase() === 'script-src') {
                scriptSourceSeen = true;
                return values.includes("'unsafe-inline'")
                    ? directive
                    : `${directive} 'unsafe-inline'`;
            }
            return directive;
        });
        if (!frameAncestorsSeen) {
            rewritten.push(`frame-ancestors ${parentOrigin}`);
        }
        const defaultSource = directives.find(directive => directive.toLowerCase().startsWith('default-src '));
        if (!scriptSourceSeen && defaultSource) {
            rewritten.push(`${defaultSource.replace(/^default-src/i, 'script-src')} 'unsafe-inline'`);
        }
        return rewritten.join('; ');
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

    protected buildIdentityPreviewUrl(req: Request, record: Pick<QaapDevPreviewRecord, 'previewId' | 'accessToken'>): string {
        const baseDomain = this.previewBaseDomain();
        if (!baseDomain) {
            return buildQaapIdentityPreviewUrl(this.resolvePublicOrigin(req), record.previewId);
        }
        const protocol = this.firstHeaderValue(req.headers['x-forwarded-proto']) ?? req.protocol ?? 'https';
        const url = new URL(`${protocol}://${record.previewId}.${baseDomain}/`);
        url.searchParams.set(QAAP_PREVIEW_ACCESS_QUERY, record.accessToken);
        return url.toString();
    }

    protected previewBaseDomain(): string | undefined {
        // The main origin is also baked into the bridge loader and frame-ancestors policy. Refuse
        // isolated-host mode unless it is explicit; deriving it from the preview Host is unsafe.
        if (!process.env.QAAP_OAUTH_PUBLIC_URL?.trim()) {
            return undefined;
        }
        const raw = process.env.QAAP_PREVIEW_BASE_DOMAIN?.trim().toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/^\*\./, '')
            .replace(/\/+$/, '');
        return raw && /^[a-z0-9.-]+(?::\d+)?$/.test(raw) ? raw : undefined;
    }

    protected previewIdFromHost(req: Request | http.IncomingMessage): string | undefined {
        const baseDomain = this.previewBaseDomain();
        if (!baseDomain) {
            return undefined;
        }
        const rawHost = this.firstHeaderValue(req.headers['x-forwarded-host'])
            ?? this.firstHeaderValue(req.headers.host);
        if (!rawHost) {
            return undefined;
        }
        let hostname: string;
        try {
            hostname = new URL(`http://${rawHost}`).hostname.toLowerCase();
        } catch {
            return undefined;
        }
        const domainHostname = baseDomain.replace(/:\d+$/, '');
        const suffix = `.${domainHostname}`;
        if (!hostname.endsWith(suffix)) {
            return undefined;
        }
        const previewId = hostname.slice(0, -suffix.length);
        return isQaapPreviewId(previewId) ? previewId : undefined;
    }

    protected authorizePreviewHostRequest(
        req: Request,
        res: Response,
        record: QaapDevPreviewRecord,
    ): 'allowed' | 'redirected' | 'denied' {
        if (this.hasPreviewCapability(req, record)) {
            return 'allowed';
        }
        const requestUrl = new URL(req.originalUrl || req.url || '/', 'http://preview.invalid');
        const queryToken = requestUrl.searchParams.get(QAAP_PREVIEW_ACCESS_QUERY);
        if (!this.matchesPreviewToken(queryToken, record.accessToken)) {
            res.status(403).type('text/plain').send('Preview access denied.');
            return 'denied';
        }
        const secure = (this.firstHeaderValue(req.headers['x-forwarded-proto']) ?? req.protocol) === 'https' ? '; Secure' : '';
        res.setHeader('Set-Cookie', `${QAAP_PREVIEW_ACCESS_COOKIE}=${encodeURIComponent(record.accessToken)}; Path=/; HttpOnly; SameSite=Strict${secure}`);
        requestUrl.searchParams.delete(QAAP_PREVIEW_ACCESS_QUERY);
        res.redirect(302, `${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}` || '/');
        return 'redirected';
    }

    protected hasPreviewCapability(req: Request | http.IncomingMessage, record: QaapDevPreviewRecord): boolean {
        const cookieHeader = this.firstHeaderValue(req.headers.cookie);
        if (!cookieHeader) {
            return false;
        }
        for (const part of cookieHeader.split(';')) {
            const [name, ...rest] = part.trim().split('=');
            if (name === QAAP_PREVIEW_ACCESS_COOKIE) {
                try {
                    return this.matchesPreviewToken(decodeURIComponent(rest.join('=')), record.accessToken);
                } catch {
                    return false;
                }
            }
        }
        return false;
    }

    protected matchesPreviewToken(candidate: string | null | undefined, expected: string): boolean {
        if (!candidate) {
            return false;
        }
        const left = Buffer.from(candidate);
        const right = Buffer.from(expected);
        return left.length === right.length && timingSafeEqual(left, right);
    }

    protected firstHeaderValue(value: string | string[] | undefined): string | undefined {
        if (Array.isArray(value)) {
            return value[0]?.split(',')[0]?.trim();
        }
        return value?.split(',')[0]?.trim();
    }
}
