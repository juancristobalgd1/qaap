// Extracted from qaap-dev-preview-endpoint.ts

import type { Request, Response } from '@theia/core/shared/express';
import * as http from 'http';
import * as net from 'net';
import {
    QAAP_IDENTITY_PREVIEW_PREFIX,
    buildQaapDevPreviewOpenUrl,
    parseQaapDevPreviewPort,
    parseQaapIdentityPreviewRequestPath,
    parseQaapDevPreviewRequestPath,
    type QaapDevPreviewProbeResponse,
} from '../common/qaap-dev-preview';
import {
    isQaapPreviewId,
    isQaapProcessPreviewIdentity,
    normalizeQaapPreviewConversationId,
    qaapPreviewProjectIdMatches,
} from '../common/qaap-preview-identity';
import type { QaapDevPreviewRecord } from './qaap-dev-preview-port-registry';
import { buildQaapPreviewUpstreamHeaders, sanitizeQaapPreviewResponseHeaders } from './qaap-dev-preview-forward-headers';
import { PREVIEW_RESERVATION_START_GRACE_MS } from './qaap-dev-preview-endpoint';
import { PREVIEW_REAPER_INTERVAL_MS } from './qaap-dev-preview-endpoint';
import type { QaapDevPreviewEndpointContext } from './qaap-dev-preview-endpoint-context';

export function isPreviewProcessDeadExtracted(ctx: QaapDevPreviewEndpointContext, record: { readonly osProcessId?: number }): boolean {
        if (record.osProcessId === undefined) {
            return false;
        }
        try {
            process.kill(record.osProcessId, 0);
            return false;
        } catch (err) {
            return (err as NodeJS.ErrnoException)?.code === 'ESRCH';
        }
}

export function nextAllocationCandidateExtracted(ctx: QaapDevPreviewEndpointContext, preferredPort: number, offset: number): number {
        const candidate = preferredPort + offset;
        if (candidate <= 65535) {
            return candidate;
        }
        return 1024 + ((candidate - 1024) % (65535 - 1024 + 1));
}

export function handleReleaseExtracted(ctx: QaapDevPreviewEndpointContext, req: Request, res: Response): void {
        const authResult = ctx.auth.authenticate(req);
        if (authResult.kind === 'unauthorized') {
            res.sendStatus(401);
            return;
        }
        const owner = ctx.auth.resolveUserLogin(authResult);
        const previewId = typeof req.body?.previewId === 'string' ? req.body.previewId : undefined;
        if (!owner || !previewId || !isQaapPreviewId(previewId)) {
            res.sendStatus(400);
            return;
        }
        const record = ctx.portRegistry.getForOwner(previewId, owner);
        if (!record) {
            res.sendStatus(404);
            return;
        }
        // Kill the dev server before releasing the claim (mirrors supersedeConversationPreviews),
        // otherwise it keeps listening on the now-unclaimed port — the VPS orphan-process path.
        ctx.terminatePreviewProcess(record);
        ctx.portRegistry.releasePreview(previewId, owner);
        console.info('[qaap-preview] released', { previewId, ownerLogin: owner, port: record.port });
        res.sendStatus(204);
}

export function mayProxyPortExtracted(ctx: QaapDevPreviewEndpointContext, req: Request | http.IncomingMessage, port: number): boolean {
        const authResult = ctx.auth.authenticate(req);
        if (authResult.kind === 'skip') {
            return true;
        }
        if (authResult.kind === 'unauthorized') {
            return false;
        }
        const owner = ctx.portRegistry.ownerOf(port);
        const login = ctx.auth.resolveUserLogin(authResult);
        if (owner === undefined && ctx.ownsUnclaimedPorts(login)) {
            // Single-tenant runtime: every listener here was started by this tenant (e.g. its
            // agent's own `npm run dev`), so there is no other tenant to shield it from.
            return true;
        }
        if (owner === undefined || login === undefined || login !== owner) {
            return false;
        }
        // Keep the claim alive while the owner is actively using the preview — otherwise the
        // 30-minute TTL expires mid-session and the owner's own preview starts 403ing.
        ctx.portRegistry.touch(port, login);
        return true;
}

export function previewForRequestExtracted(ctx: QaapDevPreviewEndpointContext, req: Request | http.IncomingMessage, previewId: string): QaapDevPreviewRecord | undefined {
        const authResult = ctx.auth.authenticate(req);
        if (authResult.kind === 'unauthorized') {
            return undefined;
        }
        if (authResult.kind === 'skip') {
            const record = ctx.portRegistry.get(previewId);
            if (!record) {
                return undefined;
            }
            ctx.portRegistry.touchPreview(previewId, record.ownerLogin);
            return record;
        }
        const login = ctx.auth.resolveUserLogin(authResult);
        if (!login) {
            return undefined;
        }
        const record = ctx.portRegistry.getForOwner(previewId, login);
        if (!record) {
            return undefined;
        }
        ctx.portRegistry.touchPreview(previewId, login);
        return record;
}

export function onStartExtracted(ctx: QaapDevPreviewEndpointContext, server: http.Server): void {
        server.on('upgrade', (req, socket, head) => {
            ctx.handleWebSocketUpgrade(req, socket as net.Socket, head);
        });
        const reaper = setInterval(() => { void ctx.reapStoppedPreviews(); }, PREVIEW_REAPER_INTERVAL_MS);
        reaper.unref?.();
}

export async function reapStoppedPreviewsExtracted(ctx: QaapDevPreviewEndpointContext): Promise<void> {
        if (ctx.reaperRunning) {
            return;
        }
        ctx.reaperRunning = true;
        try {
            const now = Date.now();
            // TTL-expired claims have no explicit release; report them here so per-port probe
            // caches are dropped on the reaper's cadence instead of scanning per request.
            ctx.portRegistry.sweepExpiredClaims(now);
            for (const record of ctx.portRegistry.records()) {
                // A dead OS process is reaped immediately, even inside the start grace and even if
                // the port answers — a recycled port would otherwise keep a zombie record alive.
                // The UI probes while showing loading/error. Use the immutable reservation age,
                // not touchedAt, so those probes cannot keep a dead listener registered forever.
                if (!ctx.isPreviewProcessDead(record)
                    && (now - record.claimedAt < PREVIEW_RESERVATION_START_GRACE_MS
                        || await ctx.probeLocalDevServer(record.port))) {
                    continue;
                }
                // releasePreview fires onDidReleasePort, which clears this port's probe caches.
                ctx.portRegistry.releasePreview(record.previewId, record.ownerLogin);
                console.info('[qaap-preview] reaped stopped process', {
                    previewId: record.previewId,
                    ownerLogin: record.ownerLogin,
                    port: record.port,
                });
            }
        } finally {
            ctx.reaperRunning = false;
        }
}

export async function handleProbeExtracted(ctx: QaapDevPreviewEndpointContext, req: Request, res: Response): Promise<void> {
        const port = parseQaapDevPreviewPort(req.params.port);
        const origin = ctx.resolvePublicOrigin(req);
        if (port === undefined) {
            res.status(400).json({ ready: false, previewUrl: '' } satisfies QaapDevPreviewProbeResponse);
            return;
        }
        // Gate the probe by ownership like the proxy/WS paths — otherwise a signed-in user could
        // enumerate the liveness of other tenants' dev servers on the shared loopback (SEC-8).
        if (!ctx.mayProxyPort(req, port)) {
            res.status(403).json({ ready: false, previewUrl: '' } satisfies QaapDevPreviewProbeResponse);
            return;
        }
        if (ctx.isIdeListenPort(port)) {
            res.json({ ready: false, previewUrl: buildQaapDevPreviewOpenUrl(origin, port) } satisfies QaapDevPreviewProbeResponse);
            return;
        }
        const ready = await ctx.probeLocalDevServer(port);
        const record = ctx.portRegistry.getByPort(port);
        const login = ctx.auth.resolveUserLogin(ctx.auth.authenticate(req));
        if (record && login === record.ownerLogin) {
            const body: QaapDevPreviewProbeResponse = {
                ready,
                ...(ready ? { readiness: 'transport_ready' as const } : {}),
                previewUrl: ctx.buildIdentityPreviewUrl(req, record),
                previewId: record.previewId,
                projectId: record.projectId,
                ...(isQaapProcessPreviewIdentity(record) ? {
                    workspaceId: record.workspaceId,
                    processId: record.processId,
                } : {}),
            };
            res.json(body);
            return;
        }
        const body: QaapDevPreviewProbeResponse = {
            ready,
            ...(ready ? { readiness: 'transport_ready' as const } : {}),
            previewUrl: buildQaapDevPreviewOpenUrl(origin, port),
        };
        res.json(body);
}

export async function handleCurrentProjectPreviewExtracted(ctx: QaapDevPreviewEndpointContext, req: Request, res: Response): Promise<void> {
        const raw = req.query.projectId;
        const projectCandidates = (Array.isArray(raw) ? raw : [raw])
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
        if (projectCandidates.length === 0) {
            res.status(400).json({ ready: false, previewUrl: '' } satisfies QaapDevPreviewProbeResponse);
            return;
        }
        const login = ctx.auth.resolveUserLogin(ctx.auth.authenticate(req));
        if (!login) {
            res.status(403).json({ ready: false, previewUrl: '' } satisfies QaapDevPreviewProbeResponse);
            return;
        }
        const conversationFilter = typeof req.query.conversationId === 'string'
            ? normalizeQaapPreviewConversationId(req.query.conversationId)
            : undefined;
        const record = ctx.portRegistry.records()
            .filter(candidate => candidate.ownerLogin === login
                && isQaapProcessPreviewIdentity(candidate)
                && !ctx.isIdeListenPort(candidate.port)
                && qaapPreviewProjectIdMatches(candidate.projectId, ...projectCandidates)
                && (conversationFilter === undefined
                    || normalizeQaapPreviewConversationId(candidate.conversationId) === conversationFilter))
            .sort((left, right) => right.touchedAt - left.touchedAt || right.claimedAt - left.claimedAt)[0];
        if (!record) {
            res.status(404).json({ ready: false, previewUrl: '' } satisfies QaapDevPreviewProbeResponse);
            return;
        }
        const conversationId = isQaapProcessPreviewIdentity(record)
            ? normalizeQaapPreviewConversationId(record.conversationId)
            : undefined;
        const ready = await ctx.probeLocalDevServer(record.port);
        if (ready) {
            ctx.portRegistry.touchPreview(record.previewId, login);
            console.info('[qaap-preview] current claim', {
                projectId: record.projectId,
                conversationId,
                previewId: record.previewId,
                port: record.port,
                conversationFilter,
            });
            res.json({
                ready: true,
                readiness: 'transport_ready',
                previewUrl: ctx.buildIdentityPreviewUrl(req, record),
                previewId: record.previewId,
                projectId: record.projectId,
                port: record.port,
                ...(conversationId ? { conversationId } : {}),
                ...(isQaapProcessPreviewIdentity(record) ? {
                    workspaceId: record.workspaceId,
                    processId: record.processId,
                } : {}),
            } satisfies QaapDevPreviewProbeResponse);
            return;
        }
        const withinStartGrace = Date.now() - record.claimedAt < PREVIEW_RESERVATION_START_GRACE_MS;
        if (!withinStartGrace) {
            ctx.portRegistry.releasePreview(record.previewId, login);
            res.status(404).json({ ready: false, previewUrl: '' } satisfies QaapDevPreviewProbeResponse);
            return;
        }
        res.json({
            ready: false,
            previewUrl: ctx.buildIdentityPreviewUrl(req, record),
            previewId: record.previewId,
            projectId: record.projectId,
            port: record.port,
            ...(conversationId ? { conversationId } : {}),
            ...(isQaapProcessPreviewIdentity(record) ? {
                workspaceId: record.workspaceId,
                processId: record.processId,
            } : {}),
        } satisfies QaapDevPreviewProbeResponse);
}

export async function handleIdentityProbeExtracted(ctx: QaapDevPreviewEndpointContext, req: Request, res: Response): Promise<void> {
        const previewId = req.params.previewId;
        const record = ctx.previewForRequest(req, previewId);
        if (!record) {
            res.status(403).json({ ready: false, previewUrl: '', previewId } satisfies QaapDevPreviewProbeResponse);
            return;
        }
        const previewUrl = ctx.buildIdentityPreviewUrl(req, record);
        if (ctx.isIdeListenPort(record.port)) {
            res.json({ ready: false, previewUrl, previewId } satisfies QaapDevPreviewProbeResponse);
            return;
        }
        const ready = await ctx.probeLocalDevServer(record.port);
        res.json({
            ready,
            ...(ready ? { readiness: 'transport_ready' as const } : {}),
            previewUrl,
            previewId,
            projectId: record.projectId,
            ...(isQaapProcessPreviewIdentity(record) ? {
                workspaceId: record.workspaceId,
                processId: record.processId,
            } : {}),
        } satisfies QaapDevPreviewProbeResponse);
}

export function handleProxyExtracted(ctx: QaapDevPreviewEndpointContext, req: Request, res: Response): void {
        const port = parseQaapDevPreviewPort(req.params.port);
        if (port === undefined) {
            res.status(400).send('Invalid dev preview port');
            return;
        }
        if (ctx.isIdeListenPort(port)) {
            res.status(403).type('text/plain').send('Cannot proxy the Qaap IDE port. Use a different dev-server port.');
            return;
        }
        if (!ctx.mayProxyPort(req, port)) {
            res.status(403).type('text/plain').send('This preview port belongs to another workspace.');
            return;
        }
        const targetPath = req.url || '/';
        void ctx.forwardHttp(req, res, port, targetPath);
}

export function handleIdentityProxyExtracted(ctx: QaapDevPreviewEndpointContext, req: Request, res: Response): void {
        const previewId = req.params.previewId;
        const record = ctx.previewForRequest(req, previewId);
        if (!record) {
            res.status(403).type('text/plain').send('This preview belongs to another execution.');
            return;
        }
        if (ctx.isIdeListenPort(record.port)) {
            res.status(403).type('text/plain').send('Cannot proxy the Qaap IDE port. Use a different dev-server port.');
            return;
        }
        const targetPath = req.url || '/';
        void ctx.forwardHttp(req, res, record.port, targetPath, `${QAAP_IDENTITY_PREVIEW_PREFIX}/${previewId}`);
}

export function handleWebSocketUpgradeExtracted(ctx: QaapDevPreviewEndpointContext, req: http.IncomingMessage,
        socket: net.Socket,
        head: Buffer,): void {
        const rawUrl = req.url ?? '';
        const queryIndex = rawUrl.indexOf('?');
        const pathname = queryIndex < 0 ? rawUrl : rawUrl.slice(0, queryIndex);
        const query = queryIndex < 0 ? '' : rawUrl.slice(queryIndex);
        const hostPreviewId = ctx.previewIdFromHost(req);
        if (hostPreviewId) {
            const hostRecord = ctx.portRegistry.get(hostPreviewId);
            if (!hostRecord || !ctx.hasPreviewCapability(req, hostRecord) || ctx.isIdeListenPort(hostRecord.port)) {
                socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
                socket.destroy();
                return;
            }
            ctx.portRegistry.touchPreview(hostPreviewId, hostRecord.ownerLogin);
            void ctx.proxyWebSocket(req, socket, head, hostRecord.port, `${pathname || '/'}${query}`);
            return;
        }
        const identity = parseQaapIdentityPreviewRequestPath(pathname);
        const legacy = identity ? undefined : parseQaapDevPreviewRequestPath(pathname);
        if (!identity && !legacy) {
            // Not ours (Theia's /socket.io, agent sockets, …). Unprefixed HMR sockets cannot be
            // scoped here: browsers send no Referer on WebSocket handshakes and Origin has no
            // path. The injected history-base script rebases them under the preview prefix.
            return;
        }
        // Reject anonymous WebSocket upgrades before resolving a tenant record. Previously an
        // identity-scoped request without access returned early with an open/hanging socket.
        if (ctx.auth.authenticate(req).kind === 'unauthorized') {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        const identityRecord = identity ? ctx.previewForRequest(req, identity.previewId) : undefined;
        if (identity && !identityRecord) {
            socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        const targetPort = identityRecord?.port ?? legacy?.port;
        const targetPath = identity?.targetPath ?? legacy?.targetPath;
        if (!targetPort || !targetPath || ctx.isIdeListenPort(targetPort)) {
            socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        if (!identity && !ctx.mayProxyPort(req, targetPort)) {
            socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        void ctx.proxyWebSocket(req, socket, head, targetPort, `${targetPath}${query}`);
}

export async function proxyWebSocketExtracted(ctx: QaapDevPreviewEndpointContext, req: http.IncomingMessage,
        socket: net.Socket,
        head: Buffer,
        port: number,
        path: string,
        handshakeTimeoutMs: number = DEV_PREVIEW_WS_HANDSHAKE_TIMEOUT_MS,): Promise<void> {
        // Without an error listener an ECONNRESET on an HMR socket is an uncaught backend exception.
        socket.on('error', () => socket.destroy());
        const releaseUpgradeHold = holdUpgradeSocket(socket);
        const targetHost = await ctx.resolveTargetHost(port);
        if (!targetHost || socket.destroyed) {
            releaseUpgradeHold();
            socket.destroy();
            return;
        }
        // `localhost` keeps dev-server host checks happy regardless of loopback family.
        const headers = buildQaapPreviewUpstreamHeaders(req.headers, `localhost:${port}`);
        const proxyReq = http.request({
            hostname: targetHost,
            port,
            path,
            method: req.method,
            headers,
            // Tunnelled runtimes (hosted workers) are reached through their own agent.
            agent: ctx.upstreamAgentFor(port),
        });
        // The hold keeps engine.io from reaping this socket, so bound the upstream handshake here.
        const handshakeTimer = setTimeout(() => {
            releaseUpgradeHold();
            socket.end('HTTP/1.1 504 Gateway Timeout\r\nConnection: close\r\n\r\n');
            proxyReq.destroy();
        }, handshakeTimeoutMs);
        // Browser gone (reload during a slow first compile) before the dev server answered: drop the pending
        // upstream handshake, otherwise a late 101 leaves an HMR connection open with nobody on the other end.
        const onClientClosedBeforeHandshake = (): void => {
            clearTimeout(handshakeTimer);
            releaseUpgradeHold();
            proxyReq.destroy();
        };
        socket.once('close', onClientClosedBeforeHandshake);
        proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
            clearTimeout(handshakeTimer);
            releaseUpgradeHold();
            socket.off('close', onClientClosedBeforeHandshake);
            if (socket.destroyed) {
                proxySocket.destroy();
                return;
            }
            const upgradeHeaders = { ...proxyRes.headers };
            sanitizeQaapPreviewResponseHeaders(upgradeHeaders);
            const headerLines = Object.entries(upgradeHeaders)
                .filter(([, value]) => value !== undefined)
                .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
            socket.write(
                `HTTP/1.1 ${proxyRes.statusCode ?? 101} ${proxyRes.statusMessage ?? 'Switching Protocols'}\r\n`
                + `${headerLines.join('\r\n')}\r\n\r\n`,
            );
            if (head.length > 0) {
                proxySocket.write(head);
            }
            // Bytes the dev server sent right after its 101 belong to the browser, not back upstream.
            if (proxyHead.length > 0) {
                socket.write(proxyHead);
            }
            proxySocket.on('error', () => socket.destroy());
            socket.on('close', () => proxySocket.destroy());
            proxySocket.on('close', () => socket.destroy());
            proxySocket.pipe(socket);
            socket.pipe(proxySocket);
        });
        // Dev server refused the upgrade (404/400): relay the status instead of leaving the client socket hanging.
        proxyReq.on('response', proxyRes => {
            clearTimeout(handshakeTimer);
            releaseUpgradeHold();
            socket.off('close', onClientClosedBeforeHandshake);
            socket.end(`HTTP/1.1 ${proxyRes.statusCode ?? 502} ${proxyRes.statusMessage ?? 'Bad Gateway'}\r\nConnection: close\r\n\r\n`);
            proxyRes.resume();
        });
        proxyReq.on('error', () => {
            clearTimeout(handshakeTimer);
            releaseUpgradeHold();
            ctx.invalidateTargetHost(port);
            socket.destroy();
        });
        proxyReq.end();
}

/** Upper bound for the dev server's answer (101 or refusal) to a proxied WebSocket upgrade. */
export const DEV_PREVIEW_WS_HANDSHAKE_TIMEOUT_MS = 30_000;

/**
 * Theia's socket.io server (engine.io, `destroyUpgrade` on by default) ends every upgrade socket
 * outside `/socket.io` that is still writable with `bytesWritten <= 0` one second after the
 * upgrade event. A dev server that takes longer to send its 101 (first HMR compile, slow host
 * resolution) lost its socket that way. While the proxy owns the socket and the upstream answer
 * is pending, report a non-zero `bytesWritten` on this instance only; the returned release
 * restores the real accessor before anything is written. Upstream Theia stays untouched.
 */
export function holdUpgradeSocket(socket: net.Socket): () => void {
    let held = true;
    Object.defineProperty(socket, 'bytesWritten', { configurable: true, get: () => 1 });
    return () => {
        if (held) {
            held = false;
            Reflect.deleteProperty(socket, 'bytesWritten');
        }
    };
}
