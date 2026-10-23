// Extracted from qaap-dev-preview-endpoint.ts

import type { Application, Handler, NextFunction, Request, Response } from '@theia/core/shared/express';
import { FileUri } from '@theia/core/lib/node';
import * as path from 'path';
import {
    QAAP_DEV_PREVIEW_CLAIM_PATH,
    QAAP_DEV_PREVIEW_CURRENT_PATH,
    QAAP_DEV_PREVIEW_MEMORY_PATH,
    QAAP_DEV_PREVIEW_RELEASE_PATH,
    QAAP_DEV_PREVIEW_PREFIX,
    QAAP_DEV_PREVIEW_PROBE_PATH,
    QAAP_IDENTITY_PREVIEW_PREFIX,
    QAAP_IDENTITY_PREVIEW_PROBE_PATH,
    parseQaapDevPreviewPort,
    parseQaapDevPreviewRequestPath,
    parseQaapIdentityPreviewRequestPath,
} from '../common/qaap-dev-preview';
import {
    isQaapPreviewIdentity,
    isQaapProcessPreviewClaimIdentity,
    isQaapProcessPreviewIdentity,
    normalizeQaapPreviewConversationId,
    resolveQaapPreviewIdentity,
    type QaapPreviewIdentity,
} from '../common/qaap-preview-identity';
import { QAAP_PREVIEW_ROUTE_HEADER, formatQaapPreviewRoutes, type QaapPreviewRoute } from '../common/qaap-preview-route';
import { parseQaapPreviewHostLabel, resolveQaapPreviewBaseDomain } from './qaap-preview-host';
import { canSignalProcessGroup, isSelfOrUnsafeSignalTarget, terminateListenersOnPort } from './qaap-dev-preview-port-listener';
import { PREVIEW_RESERVATION_START_GRACE_MS, canonicalizeQaapPreviewRoot, parseClaimOsProcessId } from './qaap-dev-preview-endpoint';
import { PREVIEW_PORT_ALLOCATION_ATTEMPTS } from './qaap-dev-preview-endpoint';
import type { QaapDevPreviewAllocation, QaapDevPreviewEndpointContext } from './qaap-dev-preview-endpoint-context';
import type { QaapDevPreviewRecord } from './qaap-dev-preview-port-registry';

/** True inside a per-tenant backend (`QAAP_TENANT_BACKEND_MODE=1`). */
export function isQaapTenantBackendRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
    return /^(1|true)$/i.test(env.QAAP_TENANT_BACKEND_MODE?.trim() ?? '');
}

/**
 * Adds {@link QAAP_PREVIEW_ROUTE_HEADER} for a `previewId` carried by the JSON body about to be sent,
 * plus the host label of its isolated `previewUrl` (the identifier the control plane routes by).
 */
export function advertisePreviewRouteOnJson(res: Response): void {
    const json = res.json.bind(res);
    res.json = ((body?: unknown) => {
        const { previewId, previewUrl } = (body ?? {}) as { previewId?: unknown; previewUrl?: unknown };
        if (typeof previewId === 'string' && !res.headersSent) {
            const routes: QaapPreviewRoute[] = [{ kind: 'preview', id: previewId }];
            const hostLabel = previewHostLabelOfUrl(previewUrl);
            if (hostLabel) {
                routes.push({ kind: 'preview', id: hostLabel });
            }
            const header = formatQaapPreviewRoutes(routes);
            if (header) {
                res.setHeader(QAAP_PREVIEW_ROUTE_HEADER, header);
            }
        }
        return json(body);
    }) as Response['json'];
}

function previewHostLabelOfUrl(previewUrl: unknown): string | undefined {
    if (typeof previewUrl !== 'string') {
        return undefined;
    }
    try {
        return parseQaapPreviewHostLabel(new URL(previewUrl).host, resolveQaapPreviewBaseDomain());
    } catch {
        return undefined;
    }
}

/**
 * Handlers that must run BEFORE the frontend static server and Theia's gzipped-asset routes
 * (registered through `EarlyExpressMiddleware` in `initialize()`): contributions' `configure()`
 * runs after those, so an isolated preview host would otherwise be answered with Qaap's own
 * `/`, `/index.html`, bundles and icons instead of the previewed app.
 */
export function earlyMiddlewareExtracted(ctx: QaapDevPreviewEndpointContext): Handler[] {
    return [
        // Optional isolated-origin mode. DNS/TLS should route `*.QAAP_PREVIEW_BASE_DOMAIN` here. The
        // unguessable host label is the preview capability, never the IDE's broad session cookie.
        (req: Request, res: Response, next: NextFunction) => {
            const hostLabel = ctx.previewHostLabel(req);
            if (!hostLabel) {
                next();
                return;
            }
            const record = ctx.portRegistry.getByHostLabel(hostLabel);
            if (!record) {
                res.status(404).type('text/plain').send('Preview not found.');
                return;
            }
            ctx.portRegistry.touchPreview(record.previewId, record.ownerLogin);
            if (ctx.isIdeListenPort(record.port)) {
                res.status(403).type('text/plain').send('Invalid preview target.');
                return;
            }
            void ctx.forwardHttp(req, res, record.port, req.url || '/', '');
        },
        // The IDE shell must never render inside a frame: typing the bare Qaap origin into the
        // preview bar — or a previewed app navigating its own iframe to "/" — loaded Qaap
        // recursively inside itself. Runs AFTER the isolated-host handler (which never calls
        // next() for preview hosts), so it only ever touches the MAIN origin's shell document.
        (req: Request, res: Response, next: NextFunction) => {
            const shellPath = (req.path || '').toLowerCase();
            if (shellPath === '/' || shellPath === '/index.html') {
                res.setHeader('X-Frame-Options', 'DENY');
                res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
            }
            next();
        },
    ];
}

export function configureExtracted(ctx: QaapDevPreviewEndpointContext, app: Application): void {
    // A per-tenant backend advertises every preview id it hands out, so the control plane can route
    // the id's isolated preview host (reached without the IDE session) back to this backend.
    app.use([`${QAAP_DEV_PREVIEW_PREFIX}/api`, `${QAAP_IDENTITY_PREVIEW_PREFIX}/api`], (req: Request, res: Response, next: NextFunction) => {
        if (isQaapTenantBackendRuntime()) {
            advertisePreviewRouteOnJson(res);
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
    app.get(QAAP_DEV_PREVIEW_MEMORY_PATH, (req, res) => {
        if (!ctx.requireHttpAuth(req, res)) {
            return;
        }
        void ctx.handleMemoryStatus(req, res);
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
    // SSR frameworks such as Next compare rendered href/src attributes during hydration. Their
    // absolute same-origin URLs must remain unchanged in the HTML, so route those later browser
    // requests by the identity preview in Referer. Ownership is rechecked for every request and
    // HTML navigations are redirected back under the identity prefix before the next page loads.
    app.use((req: Request, res: Response, next: NextFunction) => {
        const requestPath = req.path || '/';
        if (requestPath.startsWith(`${QAAP_IDENTITY_PREVIEW_PREFIX}/`)
            || requestPath.startsWith(`${QAAP_DEV_PREVIEW_PREFIX}/`)) {
            next();
            return;
        }
        const referer = req.get('referer');
        if (!referer) {
            next();
            return;
        }
        let refererUrl: URL;
        try {
            refererUrl = new URL(referer);
        } catch {
            next();
            return;
        }
        if (refererUrl.origin !== ctx.resolvePublicOrigin(req)) {
            next();
            return;
        }
        const identity = parseQaapIdentityPreviewRequestPath(refererUrl.pathname);
        // Legacy `/qaap-dev/:port` previews get the same routing, gated by port ownership.
        const legacy = identity ? undefined : parseQaapDevPreviewRequestPath(refererUrl.pathname);
        if (!identity && !legacy) {
            next();
            return;
        }
        if (!ctx.requireHttpAuth(req, res)) {
            return;
        }
        let targetPort: number;
        let publicPrefix: string;
        if (identity) {
            const record = ctx.previewForRequest(req, identity.previewId);
            if (!record || ctx.isIdeListenPort(record.port)) {
                res.status(403).type('text/plain').send('This preview belongs to another execution.');
                return;
            }
            ctx.portRegistry.touchPreview(identity.previewId, record.ownerLogin);
            targetPort = record.port;
            publicPrefix = `${QAAP_IDENTITY_PREVIEW_PREFIX}/${identity.previewId}`;
        } else {
            targetPort = legacy!.port;
            if (ctx.isIdeListenPort(targetPort) || !ctx.mayProxyPort(req, targetPort)) {
                res.status(403).type('text/plain').send('This preview port belongs to another workspace.');
                return;
            }
            publicPrefix = `${QAAP_DEV_PREVIEW_PREFIX}/${targetPort}`;
        }
        const accept = req.get('accept') ?? '';
        const isDocumentNavigation = req.method === 'GET'
            && (req.get('sec-fetch-dest') === 'document' || /\btext\/html\b/i.test(accept));
        if (isDocumentNavigation) {
            const target = req.originalUrl || req.url || '/';
            const encodedPrefix = identity
                ? `${QAAP_IDENTITY_PREVIEW_PREFIX}/${encodeURIComponent(identity.previewId)}`
                : publicPrefix;
            res.redirect(307, `${encodedPrefix}${target}`);
            return;
        }
        // Marks a Referer-routed response (private, Vary: Referer) in forwardHttp.
        req.headers['x-qaap-preview-referer-id'] = identity?.previewId ?? String(targetPort);
        void ctx.forwardHttp(req, res, targetPort, req.url || '/', publicPrefix);
    });
}

export function requireHttpAuthExtracted(ctx: QaapDevPreviewEndpointContext, req: Request, res: Response): boolean {
    if (ctx.auth.authenticate(req).kind === 'unauthorized') {
        res.status(401).type('text/plain').send('Not signed in');
        return false;
    }
    return true;
}

export async function handleClaimExtracted(ctx: QaapDevPreviewEndpointContext, req: Request, res: Response): Promise<void> {
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
            if (ctx.portRegistry.isOwnerAtPreviewLimit(owner, registration.previewId)) {
                res.status(429).type('text/plain').send('You have too many previews running. Stop one and try again.');
                return;
            }
            const record = ctx.portRegistry.register(registration, { replaceExpired });
            if (!record) {
                res.status(409).type('text/plain').send('This preview identity or port is already in use.');
                return;
            }
            const previewUrl = ctx.buildIdentityPreviewUrl(req, record);
            res.status(200).json({ previewId: record.previewId, previewUrl, port: record.port });
            return;
        }
        // A port claim is how a bootstrap attaches to a server already answering there: hand the
        // port back from another project's process-less identity when that server is provably this
        // root's, or the probe keeps answering with the other project and the attach fails closed.
        await ctx.releaseSupersededProcesslessPreview(port, owner, FileUri.fsPath(root));
        // An EXPIRED claim from a different tenant only frees the port once nothing is
        // listening on it: an idle-but-still-running server must not be silently taken over
        // just because its owner did not touch the preview for 30 minutes.
        const stale = ctx.portRegistry.staleOwnerOf(port);
        if (stale !== undefined && stale !== owner && await ctx.probeLocalDevServer(port)) {
            res.status(409).type('text/plain').send('This preview port is in use by another workspace.');
            return;
        }
        if (authResult.kind !== 'skip'
            && ctx.portRegistry.ownerOf(port) === undefined && stale === undefined
            && !ctx.ownsUnclaimedPorts(owner)
            && await ctx.probeLocalDevServer(port, owner)) {
            // After a backend restart an unregistered listener has no trustworthy project or
            // tenant identity. Adopting it based only on liveness is the exact cross-project
            // failure this endpoint must prevent. This guard applies to authenticated
            // multi-user sessions; local skip-auth has no tenant boundary to cross.
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

export async function handleProcessClaimExtracted(ctx: QaapDevPreviewEndpointContext, req: Request,
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
    const canonicalRoot = canonicalizeQaapPreviewRoot(FileUri.fsPath(root));
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
            // Same owner and identity, different root: a stale entry (non-canonical path from an older
            // registry, moved checkout). Hand the identity to the current root, Codex-style, instead of
            // failing the preview. Claims of other owners are never visible here (getForOwner).
            console.info('[qaap-preview] reassigning preview identity to the current workspace root', {
                previewId: existing.previewId,
                ownerLogin: owner,
                fromRoot: existing.root,
                root: canonicalRoot,
            });
            ctx.terminatePreviewProcess(existing);
            ctx.portRegistry.releasePreview(existing.previewId, owner);
        } else {
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

    if (ctx.portRegistry.isOwnerAtPreviewLimit(owner, identity.previewId)) {
        res.status(429).type('text/plain').send('You have too many previews running. Stop one and try again.');
        return;
    }
    const allocated = await ctx.allocatePreviewPort({
        ...identity,
        ownerLogin: owner,
        root: canonicalRoot,
        osProcessId,
    }, preferredPort);
    if (!allocated) {
        if (ctx.portRegistry.isOwnerAtPreviewLimit(owner, identity.previewId)) {
            res.status(429).type('text/plain').send('You have too many previews running. Stop one and try again.');
            return;
        }
        res.status(503).type('text/plain').send('No safe dev-preview port is currently available.');
        return;
    }
    res.status(200).json({
        previewId: allocated.previewId,
        previewUrl: ctx.buildIdentityPreviewUrl(req, allocated),
        port: allocated.port,
    });
}

function isSameOrInsideQaapPreviewRoot(candidate: string, root: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * A preview identity outlives the server it was bound to: once the server stops and another one
 * takes its port, the identity keeps answering for that port. For an identity with a live process
 * the start grace and the process itself protect it. A PROCESS-LESS identity (an external server
 * adopted by #292, or a terminal whose recorded process died) has nothing that ever ends it, so
 * it would block every other project of the same owner from that port for as long as something
 * answers there.
 *
 * Release it to `claimingRoot` only on positive evidence that the server now answering is the
 * claiming project's own: every listener runs from inside `claimingRoot` and none from inside the
 * identity's root. Never across owners, never inside the start grace (an empty reservation is still
 * waiting for its process), never when either root contains the other (the evidence would be
 * ambiguous), and never when the listeners cannot be inspected. The listener is NOT signalled: it
 * is the server being handed over.
 */
export async function releaseSupersededProcesslessPreviewExtracted(
    ctx: QaapDevPreviewEndpointContext,
    port: number,
    owner: string,
    claimingRoot: string,
): Promise<boolean> {
    const record = ctx.portRegistry.getByPort(port);
    if (!record || record.ownerLogin !== owner) {
        return false;
    }
    const recordRoot = canonicalizeQaapPreviewRoot(record.root);
    const root = canonicalizeQaapPreviewRoot(claimingRoot);
    if (isSameOrInsideQaapPreviewRoot(root, recordRoot) || isSameOrInsideQaapPreviewRoot(recordRoot, root)) {
        return false;
    }
    if (Date.now() - record.claimedAt < PREVIEW_RESERVATION_START_GRACE_MS) {
        return false;
    }
    if (record.osProcessId !== undefined && !ctx.isPreviewProcessDead(record)) {
        return false;
    }
    if (!await ctx.probeLocalDevServer(port)) {
        return false;
    }
    const listenerCwds = ctx.resolvePortListenerCwds(port, owner);
    if (listenerCwds.length === 0
        || !listenerCwds.every(cwd => isSameOrInsideQaapPreviewRoot(cwd, root))
        || listenerCwds.some(cwd => isSameOrInsideQaapPreviewRoot(cwd, recordRoot))) {
        return false;
    }
    ctx.portRegistry.releasePreview(record.previewId, owner);
    console.info('[qaap-preview] released process-less identity to the project now serving its port', {
        previewId: record.previewId,
        ownerLogin: owner,
        port,
        fromRoot: recordRoot,
        root,
    });
    return true;
}

/**
 * Reserves the first safe port at or after `preferredPort` for `registration` and registers it.
 * Skips the IDE port, ports held by a registration (start grace, or still answering), any
 * unregistered port answering HTTP (ownership is never inferred from liveness) and ports that fail
 * a real bind test. Undefined when no candidate is safe.
 */
export async function allocatePreviewPortExtracted(
    ctx: QaapDevPreviewEndpointContext,
    registration: QaapDevPreviewAllocation,
    preferredPort: number,
): Promise<QaapDevPreviewRecord | undefined> {
    const owner = registration.ownerLogin;
    for (let offset = 0; offset < PREVIEW_PORT_ALLOCATION_ATTEMPTS; offset++) {
        const port = ctx.nextAllocationCandidate(preferredPort, offset);
        if (ctx.isIdeListenPort(port)) {
            continue;
        }
        let occupiedRecord = ctx.portRegistry.getByPort(port);
        if (occupiedRecord && offset === 0 && occupiedRecord.ownerLogin === owner
            && await ctx.releaseSupersededProcesslessPreview(port, owner, registration.root)) {
            occupiedRecord = undefined;
        }
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
        } else if (await ctx.probeLocalDevServer(port, owner)) {
            // Crucial fail-closed rule: never infer project ownership from a responding port. The
            // one exception is not an inference: the SAME owner explicitly claimed this very port
            // (an external Vite they started and pointed the workspace at). The claim endpoint
            // already refuses that claim for an unregistered listener in authenticated sessions,
            // so reaching it here means the listener is the owner's. Binding the new identity to
            // it keeps the preview on that server instead of parking a second copy of the app on
            // the next free port.
            if (offset === 0 && ctx.portRegistry.ownerOf(port) === owner) {
                if (ctx.portRegistry.isOwnerAtPreviewLimit(owner, registration.previewId)) {
                    return undefined; // a concurrent claim reached the per-owner cap during the probes
                }
                const adopted = ctx.portRegistry.register({ ...registration, port }, {
                    claimedAt: Date.now() - PREVIEW_RESERVATION_START_GRACE_MS,
                });
                if (adopted) {
                    console.info('[qaap-preview] adopted listener explicitly claimed by its owner', {
                        previewId: adopted.previewId,
                        ownerLogin: owner,
                        projectId: registration.projectId,
                        port,
                    });
                    return adopted;
                }
            }
            continue;
        }
        if (!await ctx.isPortBindable(port, owner)) {
            // Something holds the port without answering HTTP (a Theia/Node backend still booting,
            // the host IDE on a non-default port). Handing it out makes the dev server die on bind.
            continue;
        }
        // Re-check the per-owner cap with no await before register: concurrent claims of one owner all
        // passed the caller's check while this loop awaited probes.
        if (ctx.portRegistry.isOwnerAtPreviewLimit(owner, registration.previewId)) {
            return undefined;
        }
        const record = ctx.portRegistry.register({ ...registration, port });
        if (!record) {
            continue; // concurrent allocator won this candidate; try the next one
        }
        console.info('[qaap-preview] reserved', {
            previewId: record.previewId,
            ownerLogin: owner,
            workspaceId: registration.workspaceId,
            projectId: registration.projectId,
            conversationId: registration.conversationId,
            processId: registration.processId,
            port,
        });
        return record;
    }
    return undefined;
}

export function supersedeConversationPreviewsExtracted(ctx: QaapDevPreviewEndpointContext, scope: {
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

export function terminatePreviewProcessExtracted(ctx: QaapDevPreviewEndpointContext, record: { readonly osProcessId?: number; readonly port?: number }): void {
    const osProcessId = record.osProcessId;
    if (osProcessId !== undefined && !isSelfOrUnsafeSignalTarget(osProcessId)) {
        try {
            process.kill(osProcessId, 'SIGTERM');
        } catch {
            // Already gone, or not ours to signal; the registration is released either way.
        }
        if (canSignalProcessGroup(osProcessId)) {
            try {
                process.kill(-osProcessId, 'SIGTERM');
            } catch {
                // Process group may not exist or may not be ours.
            }
        }
    }
    if (record.port !== undefined) {
        terminateListenersOnPort(record.port);
    }
}

