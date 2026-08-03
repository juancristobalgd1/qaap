// @ts-nocheck
// Extracted from qaap-dev-preview-endpoint.ts

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, NextFunction, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution, FileUri } from '@theia/core/lib/node';
import * as http from 'http';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { timingSafeEqual } from 'crypto';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';
import { QaapDevPreviewPortRegistry, type QaapDevPreviewRecord } from './qaap-dev-preview-port-registry';
import {
    QAAP_DEV_PREVIEW_CLAIM_PATH,
    QAAP_DEV_PREVIEW_CURRENT_PATH,
    QAAP_DEV_PREVIEW_RELEASE_PATH,
    QAAP_DEV_PREVIEW_PREFIX,
    QAAP_DEV_PREVIEW_PROBE_PATH,
    QAAP_IDENTITY_PREVIEW_PREFIX,
    QAAP_IDENTITY_PREVIEW_PROBE_PATH,
    buildDevPreviewWaitingHtml,
    buildQaapDevPreviewOpenUrl,
    buildQaapIdentityPreviewUrl,
    injectQaapPreviewViteEnvBootstrap,
    injectQaapPreviewDiagnostics,
    isAllowedDevPreviewPort,
    parseQaapDevPreviewPort,
    parseQaapIdentityPreviewRequestPath,
    parseQaapDevPreviewRequestPath,
    type QaapDevPreviewProbeResponse,
} from '../common/qaap-dev-preview';
import {
    QAAP_DEFAULT_PREVIEW_CONVERSATION_ID,
    isQaapPreviewIdentity,
    isQaapPreviewId,
    isQaapProcessPreviewClaimIdentity,
    isQaapProcessPreviewIdentity,
    normalizeQaapPreviewConversationId,
    qaapPreviewProjectIdMatches,
    resolveQaapPreviewIdentity,
    type QaapPreviewIdentity,
} from '../common/qaap-preview-identity';
import { normalizeQaapPublicUrl } from './qaap-github-oauth-config';
import { QaapDevPreviewTargetHostResolver } from './qaap-dev-preview-target-host';
import { terminateListenersOnPort } from './qaap-dev-preview-port-listener';
import { injectQaapPreviewBridgeLoader } from '@theia/qaap-adapters/lib/common/qaap-preview-bridge-protocol';
import { PREVIEW_RESERVATION_START_GRACE_MS,parseClaimOsProcessId } from './qaap-dev-preview-endpoint';
import { PREVIEW_PORT_ALLOCATION_ATTEMPTS } from './qaap-dev-preview-endpoint';

export function configureExtracted(ctx: any, app: Application): void {
        // Optional isolated-origin mode. DNS/TLS should route `*.QAAP_PREVIEW_BASE_DOMAIN` here;
        // access uses a host-only preview capability, never the IDE's broad session cookie.
        app.use((req: Request, res: Response, next: NextFunction) => {
            const previewId =  authResult.previewIdFromHost(req);
            if (!previewId) {
                next();
                return;
            }
            const record = ctx.portRegistry.get(previewId);
            if (!record) {
                res.status(404).type('text/plain').send('Preview not found.');
                return;
            }
            const capability = ctx.authorizePreviewHostRequest(req, res, record);
            if (capability !== 'allowed') {
                return;
            }
            ctx.portRegistry.touchPreview(previewId, record.ownerLogin);
            if (ctx.isIdeListenPort(record.port)) {
                res.status(403).type('text/plain').send('Invalid preview target.');
                return;
            }
            void ctx.forwardHttp(req, res, record.port, req.url || '/', '');
        });
        // The IDE shell must never render inside a frame: typing the bare Qaap origin into the
        // preview bar — or a previewed app navigating its own iframe to "/" — loaded Qaap
        // recursively inside itself. Registered AFTER the isolated-host middleware (which never
        // calls next() for preview hosts), so it only ever touches the MAIN origin's shell
        // document; proxied previews, webviews, and mini-browser endpoints keep their own rules.
        app.use((req: Request, res: Response, next: NextFunction) => {
            const path = (req.path || '').toLowerCase();
            if (path === '/' || path === '/index.html') {
                res.setHeader('X-Frame-Options', 'DENY');
                res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
            }
            next();
        });
        // Register static /api segments before the `:port` catch-all so they aren't parsed as ports.
        app.post(QAAP_DEV_PREVIEW_CLAIM_PATH, (req, res) => {
            void ctx.handleClaim(req, res);
        });
        app.post(QAAP_DEV_PREVIEW_RELEASE_PATH, (req, res) => {
            ctx.handleRelease(req, res);
        });
        app.get(`${QAAP_DEV_PREVIEW_PROBE_PATH}/:port`, (req, res) => {
            if (!ctx.requireHttpAuth(req, res)) {
                return;
            }
            void ctx.handleProbe(req, res);
        });
        app.get(QAAP_DEV_PREVIEW_CURRENT_PATH, (req, res) => {
            if (!ctx.requireHttpAuth(req, res)) {
                return;
            }
            void ctx.handleCurrentProjectPreview(req, res);
        });
        app.get(`${QAAP_IDENTITY_PREVIEW_PROBE_PATH}/:previewId`, (req, res) => {
            if (!ctx.requireHttpAuth(req, res)) {
                return;
            }
            void ctx.handleIdentityProbe(req, res);
        });
        app.use(`${QAAP_IDENTITY_PREVIEW_PREFIX}/:previewId`, (req, res) => {
            if (!ctx.requireHttpAuth(req, res)) {
                return;
            }
            ctx.handleIdentityProxy(req, res);
        });
        app.use(`${QAAP_DEV_PREVIEW_PREFIX}/:port`, (req, res) => {
            if (!ctx.requireHttpAuth(req, res)) {
                return;
            }
            ctx.handleProxy(req, res);
        });
}

export function requireHttpAuthExtracted(ctx: any, req: Request, res: Response): boolean {
        if (ctx.auth.authenticate(req).kind === 'unauthorized') {
            res.status(401).type('text/plain').send('Not signed in');
            return false;
        }
        return true;
}

export async function handleClaimExtracted(ctx: any, req: Request, res: Response): Promise<void> {
        const authResult = ctx.auth.authenticate(req);
        if (authResult.kind === 'unauthorized') {
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
        if (!ctx.auth.assertWorkspacePathOwned(req, res, FileUri.fsPath(root), 'workspace_path')) {
            return;
        }
        const owner = ctx.auth.resolveUserLogin(authResult);
        if (owner) {
            if (isQaapProcessPreviewClaimIdentity(body)) {
                await ctx.handleProcessClaim(req, res, owner, root, port, body);
                return;
            }
            if (isQaapPreviewIdentity(body)) {
                const identity = resolveQaapPreviewIdentity(body);
                const registration = {
                    ...identity,
                    ownerLogin: owner,
                    root,
                    port,
                };
                const expiredConflicts = ctx.portRegistry.expiredRegistrationConflicts(registration);
                const stalePortOwner = ctx.portRegistry.staleOwnerOf(port);
                const portsToProbe = new Set(expiredConflicts.map(conflict => conflict.port));
                if (stalePortOwner !== undefined && stalePortOwner !== owner) {
                    portsToProbe.add(port);
                }
                for (const conflictPort of portsToProbe) {
                    if (await ctx.probeLocalDevServer(conflictPort)) {
                        res.status(409).type('text/plain').send('This preview identity or port is already in use.');
                        return;
                    }
                }
                const replaceExpired = expiredConflicts.length > 0
                    || (stalePortOwner !== undefined && stalePortOwner !== owner);
                const record = ctx.portRegistry.register(registration, { replaceExpired });
                if (!record) {
                    res.status(409).type('text/plain').send('This preview identity or port is already in use.');
                    return;
                }
                const previewUrl = ctx.buildIdentityPreviewUrl(req, record);
                res.status(200).json({ previewId: record.previewId, previewUrl, port: record.port });
                return;
            }
            // An EXPIRED claim from a different tenant only frees the port once nothing is
            // listening on it: an idle-but-still-running server must not be silently taken over
            // just because its owner did not touch the preview for 30 minutes.
            const stale = ctx.portRegistry.staleOwnerOf(port);
            if (stale !== undefined && stale !== owner && await ctx.probeLocalDevServer(port)) {
                res.status(409).type('text/plain').send('This preview port is in use by another workspace.');
                return;
            }
            if (ctx.portRegistry.ownerOf(port) === undefined && stale === undefined
                && await ctx.probeLocalDevServer(port)) {
                // After a backend restart an unregistered listener has no trustworthy project or
                // tenant identity. Adopting it based only on liveness is the exact cross-project
                // failure this endpoint must prevent. Local skip-auth never enters this branch.
                res.status(409).type('text/plain').send('This running server has no verifiable preview reservation.');
                return;
            }
            if (!ctx.portRegistry.claim(port, owner)) {
                // A different tenant holds a live claim — refuse the takeover instead of silently
                // rebinding their running preview to this caller (keeps H1 meaningful).
                res.status(409).type('text/plain').send('This preview port is in use by another workspace.');
                return;
            }
        }
        res.sendStatus(204);
}

export async function handleProcessClaimExtracted(ctx: any, req: Request,
        res: Response,
        owner: string,
        root: string,
        preferredPort: number,
        claim: {
            readonly workspaceId: string;
            readonly projectId: string;
            readonly processId: string;
            readonly conversationId?: string;
        },): Promise<void> {
        // Client-supplied OS PID of the terminal shell (node-pty); lets release() SIGTERM the
        // process group when the sandboxed container cannot discover listeners by port.
        const osProcessId = parseClaimOsProcessId((req.body as { osProcessId?: unknown } | undefined)?.osProcessId);
        const rootPath = path.resolve(FileUri.fsPath(root));
        let canonicalRoot = rootPath;
        try {
            canonicalRoot = fs.realpathSync.native(rootPath);
        } catch {
            // Ownership was already checked. A missing root will fail when the process is spawned.
        }
        const canonicalProjectId = FileUri.create(canonicalRoot).toString();
        const conversationId = normalizeQaapPreviewConversationId(claim.conversationId);
        const identity = resolveQaapPreviewIdentity({
            userId: owner,
            workspaceId: canonicalProjectId,
            // UI routing keys (`ws:…`, `github:…`) are presentation state, not execution identity.
            // Derive projectId from the ownership-checked root so every entry flow of one section
            // resolves the same project/conversation/process tuple.
            projectId: canonicalProjectId,
            conversationId,
            processId: claim.processId,
        });
        const existing = ctx.portRegistry.getForOwner(identity.previewId, owner);
        if (existing) {
            if (existing.root !== canonicalRoot) {
                res.status(409).type('text/plain').send('This preview identity belongs to a different workspace.');
                return;
            }
            if (!ctx.isPreviewProcessDead(existing) && await ctx.probeLocalDevServer(existing.port)) {
                if (osProcessId !== undefined) {
                    ctx.portRegistry.attachProcess(existing.previewId, owner, osProcessId);
                }
                res.status(200).json({
                    previewId: existing.previewId,
                    previewUrl: ctx.buildIdentityPreviewUrl(req, existing),
                    port: existing.port,
                });
                return;
            }
            // Reserved empty / dead claim, but the process bound the preferred port (common when a
            // project hardcodes PORT while the allocator had to park on another free slot first).
            if (preferredPort !== existing.port && await ctx.probeLocalDevServer(preferredPort)) {
                const rebound = ctx.portRegistry.rebindPort(existing.previewId, owner, preferredPort);
                if (rebound) {
                    if (osProcessId !== undefined) {
                        ctx.portRegistry.attachProcess(rebound.previewId, owner, osProcessId);
                    }
                    console.info('[qaap-preview] rebound process claim to listening preferred port', {
                        previewId: rebound.previewId,
                        ownerLogin: owner,
                        fromPort: existing.port,
                        port: rebound.port,
                        processId: identity.processId,
                    });
                    res.status(200).json({
                        previewId: rebound.previewId,
                        previewUrl: ctx.buildIdentityPreviewUrl(req, rebound),
                        port: rebound.port,
                    });
                    return;
                }
            }
            ctx.terminatePreviewProcess(existing);
            ctx.portRegistry.releasePreview(existing.previewId, owner);
        }

        // Reattach only within the same conversation/section. Another section of the same project
        // must keep its own live claim (Cursor/Codex-style independent previews).
        const previousSectionRecords = ctx.portRegistry.records()
            .filter(record => record.ownerLogin === owner
                && isQaapProcessPreviewIdentity(record)
                && record.workspaceId === canonicalProjectId
                && record.projectId === canonicalProjectId
                && record.root === canonicalRoot
                && normalizeQaapPreviewConversationId(record.conversationId) === conversationId)
            .sort((left, right) => Number(right.port === preferredPort) - Number(left.port === preferredPort)
                || right.touchedAt - left.touchedAt);
        for (const record of previousSectionRecords) {
            if (!ctx.isPreviewProcessDead(record) && await ctx.probeLocalDevServer(record.port)) {
                if (osProcessId !== undefined) {
                    ctx.portRegistry.attachProcess(record.previewId, owner, osProcessId);
                }
                console.info('[qaap-preview] reattached existing live section preview', {
                    previewId: record.previewId,
                    ownerLogin: owner,
                    projectId: canonicalProjectId,
                    conversationId,
                    port: record.port,
                });
                res.status(200).json({
                    previewId: record.previewId,
                    previewUrl: ctx.buildIdentityPreviewUrl(req, record),
                    port: record.port,
                });
                return;
            }
            ctx.terminatePreviewProcess(record);
            ctx.portRegistry.releasePreview(record.previewId, owner);
        }

        ctx.supersedeConversationPreviews({
            previewId: identity.previewId,
            workspaceId: canonicalProjectId,
            projectId: canonicalProjectId,
            conversationId,
        }, owner);

        for (let offset = 0; offset < PREVIEW_PORT_ALLOCATION_ATTEMPTS; offset++) {
            const port = ctx.nextAllocationCandidate(preferredPort, offset);
            if (ctx.isIdeListenPort(port)) {
                continue;
            }
            const occupiedRecord = ctx.portRegistry.getByPort(port);
            if (occupiedRecord) {
                const withinStartGrace = Date.now() - occupiedRecord.claimedAt < PREVIEW_RESERVATION_START_GRACE_MS;
                if (withinStartGrace || await ctx.probeLocalDevServer(port)) {
                    continue;
                }
                ctx.portRegistry.releasePreview(occupiedRecord.previewId, occupiedRecord.ownerLogin);
                console.info('[qaap-preview] reaped stale registration', {
                    previewId: occupiedRecord.previewId,
                    ownerLogin: occupiedRecord.ownerLogin,
                    port,
                });
            } else if (await ctx.probeLocalDevServer(port)) {
                // Crucial fail-closed rule: never infer project ownership from a responding port.
                continue;
            }
            const record = ctx.portRegistry.register({
                ...identity,
                ownerLogin: owner,
                root: canonicalRoot,
                port,
                osProcessId,
            });
            if (!record) {
                continue; // concurrent allocator won this candidate; try the next one
            }
            console.info('[qaap-preview] reserved', {
                previewId: record.previewId,
                ownerLogin: owner,
                workspaceId: identity.workspaceId,
                projectId: identity.projectId,
                conversationId: identity.conversationId,
                processId: identity.processId,
                port,
            });
            res.status(200).json({
                previewId: record.previewId,
                previewUrl: ctx.buildIdentityPreviewUrl(req, record),
                port,
            });
            return;
        }
        res.status(503).type('text/plain').send('No safe dev-preview port is currently available.');
}

export function supersedeConversationPreviewsExtracted(ctx: any, scope: {
            readonly previewId: string;
            readonly workspaceId: string;
            readonly projectId: string;
            readonly conversationId: string;
        },
        owner: string): void {
        const conversationId = normalizeQaapPreviewConversationId(scope.conversationId);
        for (const record of ctx.portRegistry.records()) {
            if (record.ownerLogin !== owner
                || record.previewId === scope.previewId
                || !isQaapProcessPreviewIdentity(record)
                || record.workspaceId !== scope.workspaceId
                || record.projectId !== scope.projectId
                || normalizeQaapPreviewConversationId(record.conversationId) !== conversationId) {
                continue;
            }
            // Kill the recorded OS pid when present, and always SIGTERM whatever is still listening
            // on the claimed port. Terminal-spawned previews rarely record osProcessId; leaving
            // those listeners alive after release was the VPS orphan path (claim gone, process live).
            ctx.terminatePreviewProcess(record);
            ctx.portRegistry.releasePreview(record.previewId, record.ownerLogin);
            console.info('[qaap-preview] superseded previous preview for conversation', {
                previewId: record.previewId,
                ownerLogin: record.ownerLogin,
                projectId: scope.projectId,
                conversationId,
                port: record.port,
            });
        }
}

export function supersedeProjectPreviewsExtracted(ctx: any, project: { readonly previewId: string; readonly workspaceId: string; readonly projectId: string },
        owner: string): void {
        ctx.supersedeConversationPreviews({
            ...project,
            conversationId: QAAP_DEFAULT_PREVIEW_CONVERSATION_ID,
        }, owner);
}

export function terminatePreviewProcessExtracted(ctx: any, record: { readonly osProcessId?: number; readonly port?: number }): void {
        if (record.osProcessId !== undefined) {
            try {
                process.kill(record.osProcessId, 'SIGTERM');
            } catch {
                // Already gone, or not ours to signal; the registration is released either way.
            }
            try {
                process.kill(-record.osProcessId, 'SIGTERM');
            } catch {
                // Process group may not exist or may not be ours.
            }
        }
        if (record.port !== undefined) {
            terminateListenersOnPort(record.port);
        }
}

