// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import * as http from 'http';
import * as net from 'net';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';
import { QaapDevPreviewPortRegistry, type QaapDevPreviewRecord } from './qaap-dev-preview-port-registry';
import type { QaapDevPreviewEndpointContext } from './qaap-dev-preview-endpoint-context';
import { QAAP_DEV_PREVIEW_PREFIX } from '../common/qaap-dev-preview';
import { QAAP_PREVIEW_ACCESS_COOKIE_NAME } from './qaap-dev-preview-forward-headers';
import { QaapDevPreviewTargetHostResolver } from './qaap-dev-preview-target-host';
import { QaapDevPreviewUpstreamTunnel } from './qaap-dev-preview-upstream-tunnel';
import { QAAP_TENANT_BACKEND_MODE_ENV, QAAP_TENANT_LOGIN_ENV } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { configureExtracted, handleClaimExtracted, handleProcessClaimExtracted, requireHttpAuthExtracted, supersedeConversationPreviewsExtracted, terminatePreviewProcessExtracted } from './qaap-dev-preview-endpoint-render';
import { handleCurrentProjectPreviewExtracted, handleIdentityProbeExtracted, handleIdentityProxyExtracted, handleProbeExtracted, handleProxyExtracted, handleReleaseExtracted, handleWebSocketUpgradeExtracted, isPreviewProcessDeadExtracted, mayProxyPortExtracted, nextAllocationCandidateExtracted, onStartExtracted, previewForRequestExtracted, proxyWebSocketExtracted, reapStoppedPreviewsExtracted } from './qaap-dev-preview-endpoint-streaming';
import { authorizePreviewHostRequestExtracted, buildIdentityPreviewUrlExtracted, firstHeaderValueExtracted, forgetHeadUnsupportedPort, forwardHttpExtracted, hasPreviewCapabilityExtracted, matchesPreviewTokenExtracted, previewBaseDomainExtracted, previewIdFromHostExtracted, probeLocalDevServerExtracted, resolvePublicOriginExtracted, rewriteDevPreviewBodyExtracted, rewriteDevPreviewLocationExtracted, rewritePreviewCspExtracted, rewriteViteHmrClientExtracted, shouldRewriteProxyBodyExtracted } from './qaap-dev-preview-endpoint-timeline';

export const PROBE_TIMEOUT_MS = 2500;
export const LOCAL_TARGET_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);
export const TEXT_RESPONSE_PATTERN = /\b(?:text\/html|text\/css|application\/javascript|text\/javascript|application\/x-javascript)\b/i;
export const QAAP_PREVIEW_ACCESS_QUERY = 'qaap_preview_token';
export const QAAP_PREVIEW_ACCESS_COOKIE = QAAP_PREVIEW_ACCESS_COOKIE_NAME;
export const PREVIEW_PORT_ALLOCATION_ATTEMPTS = 128;
export const PREVIEW_RESERVATION_START_GRACE_MS = 5 * 60_000;
export const PREVIEW_REAPER_INTERVAL_MS = 60_000;

function getQaapBackendListenPort(): number {
    const parsed = Number(process.env.PORT);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;
}

/** Validates a client-supplied PID before trusting it for `process.kill` (never trust raw input for a syscall). */
export function parseClaimOsProcessId(raw: unknown): number | undefined {
    return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 && raw <= 2 ** 31 - 1 ? raw : undefined;
}

@injectable()
export class QaapDevPreviewEndpoint implements BackendApplicationContribution, QaapDevPreviewEndpointContext {
    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    @inject(QaapGithubAuthGuard)
    public readonly auth: QaapGithubAuthGuard;

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    @inject(QaapDevPreviewPortRegistry)
    public readonly portRegistry: QaapDevPreviewPortRegistry;

    /**
     * Present when dev servers live in another network/pid namespace than this process (hosted
     * per-tenant workers). Absent → classic loopback previews.
     */
    @inject(QaapDevPreviewUpstreamTunnel) @optional()
    protected readonly upstreamTunnel?: QaapDevPreviewUpstreamTunnel;

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public reaperRunning = false;

    @postConstruct()
    protected init(): void {
        // A released or reassigned port may be served by a different process next time.
        this.portRegistry.onDidReleasePort(port => this.forgetPortProbeState(port));
    }

    /** Invalidates per-port probe caches: resolved target host and HEAD support. */
    public forgetPortProbeState(port: number): void {
        this.invalidateTargetHost(port);
        forgetHeadUnsupportedPort(this, port);
    }

    configure(app: Application): void {
        configureExtracted(this, app);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public requireHttpAuth(req: Request, res: Response): boolean {
        return requireHttpAuthExtracted(this, req, res);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public async handleClaim(req: Request, res: Response): Promise<void> {
        return handleClaimExtracted(this, req, res);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public async handleProcessClaim(req: Request, res: Response, owner: string, root: string, preferredPort: number, claim: { readonly workspaceId: string; readonly projectId: string; readonly processId: string; readonly conversationId?: string; },): Promise<void> {
        return handleProcessClaimExtracted(this, req, res, owner, root, preferredPort, claim);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public supersedeConversationPreviews(scope: { readonly previewId: string; readonly workspaceId: string; readonly projectId: string; readonly conversationId: string; }, owner: string): void {
        supersedeConversationPreviewsExtracted(this, scope, owner);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public terminatePreviewProcess(record: { readonly osProcessId?: number; readonly port?: number; readonly ownerLogin?: string }): void {
        const tunnelOwner = record.port !== undefined ? this.tunnelOwnerFor(record.port, record.ownerLogin) : undefined;
        if (tunnelOwner !== undefined && record.port !== undefined && this.upstreamTunnel) {
            // The recorded pid and the port's listeners live in the tenant runtime, not in this
            // process' namespace: signalling them locally could hit an unrelated process.
            this.upstreamTunnel.terminateListeners(tunnelOwner, record.port);
            return;
        }
        terminatePreviewProcessExtracted(this, record);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public isPreviewProcessDead(record: { readonly osProcessId?: number; readonly port?: number; readonly ownerLogin?: string }): boolean {
        if (record.port !== undefined && this.tunnelOwnerFor(record.port, record.ownerLogin) !== undefined) {
            // Pids reported for tunnelled runtimes belong to another pid namespace; liveness is
            // decided by probing the port through the tunnel instead.
            return false;
        }
        return isPreviewProcessDeadExtracted(this, record);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public nextAllocationCandidate(preferredPort: number, offset: number): number {
        return nextAllocationCandidateExtracted(this, preferredPort, offset);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public handleRelease(req: Request, res: Response): void {
        handleReleaseExtracted(this, req, res);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public mayProxyPort(req: Request | http.IncomingMessage, port: number): boolean {
        return mayProxyPortExtracted(this, req, port);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public previewForRequest(req: Request | http.IncomingMessage, previewId: string): QaapDevPreviewRecord | undefined {
        return previewForRequestExtracted(this, req, previewId);
    }

    onStart(server: http.Server): void {
        onStartExtracted(this, server);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public async reapStoppedPreviews(): Promise<void> {
        return reapStoppedPreviewsExtracted(this);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public async handleProbe(req: Request, res: Response): Promise<void> {
        return handleProbeExtracted(this, req, res);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public async handleCurrentProjectPreview(req: Request, res: Response): Promise<void> {
        return handleCurrentProjectPreviewExtracted(this, req, res);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public async handleIdentityProbe(req: Request, res: Response): Promise<void> {
        return handleIdentityProbeExtracted(this, req, res);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public handleProxy(req: Request, res: Response): void {
        handleProxyExtracted(this, req, res);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public handleIdentityProxy(req: Request, res: Response): void {
        handleIdentityProxyExtracted(this, req, res);
    }

    protected readonly targetHostResolver = new QaapDevPreviewTargetHostResolver();

    /**
     * Picks the loopback family the dev server actually listens on (IPv4 first, then IPv6).
     * @internal Used by the extracted qaap-dev-preview-endpoint-* modules.
     */
    public resolveTargetHost(port: number, ownerLogin?: string): Promise<string | undefined> {
        const tunnelOwner = this.tunnelOwnerFor(port, ownerLogin);
        if (tunnelOwner !== undefined && this.upstreamTunnel) {
            return this.upstreamTunnel.resolveHost(tunnelOwner, port);
        }
        return this.targetHostResolver.resolve(port);
    }

    /**
     * HTTP agent that reaches the dev server on `port`, or undefined for the default (loopback)
     * connection. Pass it to every upstream `http.request` next to {@link resolveTargetHost}.
     * @internal Used by the extracted qaap-dev-preview-endpoint-* modules.
     */
    public upstreamAgentFor(port: number, ownerLogin?: string): http.Agent | undefined {
        const tunnelOwner = this.tunnelOwnerFor(port, ownerLogin);
        return tunnelOwner !== undefined && this.upstreamTunnel ? this.upstreamTunnel.agentFor(tunnelOwner) : undefined;
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public invalidateTargetHost(port: number): void {
        this.targetHostResolver.invalidate(port);
        this.upstreamTunnel?.invalidate(port);
    }

    /**
     * The tenant whose runtime serves `port` when that runtime must be reached through the tunnel.
     * Ports are owned per tenant by the registry; an explicit hint covers not-yet-claimed ports.
     */
    protected tunnelOwnerFor(port: number, ownerHint?: string): string | undefined {
        if (!this.upstreamTunnel) {
            return undefined;
        }
        const owner = ownerHint
            ?? this.portRegistry.ownerOf(port)
            ?? this.portRegistry.staleOwnerOf(port)
            ?? this.portRegistry.getByPort(port)?.ownerLogin;
        return owner !== undefined && this.upstreamTunnel.handles(owner) ? owner : undefined;
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public handleWebSocketUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer,): void {
        handleWebSocketUpgradeExtracted(this, req, socket, head);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public async proxyWebSocket(req: http.IncomingMessage, socket: net.Socket, head: Buffer, port: number, path: string,): Promise<void> {
        return proxyWebSocketExtracted(this, req, socket, head, port, path);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public async forwardHttp(incoming: Request, outgoing: Response, targetPort: number, targetPath: string, publicPrefix: string = `${QAAP_DEV_PREVIEW_PREFIX}/${targetPort}`,): Promise<void> {
        return forwardHttpExtracted(this, incoming, outgoing, targetPort, targetPath, publicPrefix);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public shouldRewriteProxyBody(proxyRes: http.IncomingMessage): boolean {
        return shouldRewriteProxyBodyExtracted(this, proxyRes);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public rewriteDevPreviewLocation(location: string, targetPort: number, publicPrefix: string = `${QAAP_DEV_PREVIEW_PREFIX}/${targetPort}`,): string {
        return rewriteDevPreviewLocationExtracted(this, location, targetPort, publicPrefix);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public rewriteDevPreviewBody(body: string, targetPort: number, publicPrefix: string = `${QAAP_DEV_PREVIEW_PREFIX}/${targetPort}`,): string {
        return rewriteDevPreviewBodyExtracted(this, body, targetPort, publicPrefix);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public rewriteViteHmrClient(body: string, publicPrefix: string): string {
        return rewriteViteHmrClientExtracted(this, body, publicPrefix);
    }

    protected rewritePreviewCsp(raw: string | number | string[] | undefined, parentOrigin: string): string {
        return rewritePreviewCspExtracted(this, raw, parentOrigin);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public rewritePreviewFrameHeaders(headers: http.OutgoingHttpHeaders, parentOrigin: string): void {
        delete headers['x-frame-options'];
        headers['content-security-policy'] = this.rewritePreviewCsp(headers['content-security-policy'], parentOrigin);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public isIdeListenPort(port: number): boolean {
        return port === getQaapBackendListenPort();
    }

    /**
     * A per-tenant backend (`QAAP_TENANT_BACKEND_MODE=1`) serves exactly one login and runs only that
     * tenant's processes, so a listener nobody claimed yet (a dev server the agent started from its
     * shell) is that tenant's by construction and may be probed, proxied and adopted by a claim.
     * On shared runtimes unclaimed listeners stay fail-closed.
     * @internal Used by the extracted qaap-dev-preview-endpoint-* modules.
     */
    public ownsUnclaimedPorts(login: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
        if (!login || !/^(1|true)$/i.test(env[QAAP_TENANT_BACKEND_MODE_ENV]?.trim() ?? '')) {
            return false;
        }
        const tenant = env[QAAP_TENANT_LOGIN_ENV]?.trim().toLowerCase();
        return !!tenant && tenant === login.trim().toLowerCase();
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public async probeLocalDevServer(port: number, ownerLogin?: string): Promise<boolean> {
        return probeLocalDevServerExtracted(this, port, ownerLogin);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public resolvePublicOrigin(req: Request): string {
        return resolvePublicOriginExtracted(this, req);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public buildIdentityPreviewUrl(req: Request, record: Pick<QaapDevPreviewRecord, 'previewId' | 'accessToken'>): string {
        return buildIdentityPreviewUrlExtracted(this, req, record);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public previewBaseDomain(): string | undefined {
        return previewBaseDomainExtracted(this);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public previewIdFromHost(req: Request | http.IncomingMessage): string | undefined {
        return previewIdFromHostExtracted(this, req);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public authorizePreviewHostRequest(req: Request, res: Response, record: QaapDevPreviewRecord,): 'allowed' | 'redirected' | 'denied' {
        return authorizePreviewHostRequestExtracted(this, req, res, record);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public hasPreviewCapability(req: Request | http.IncomingMessage, record: QaapDevPreviewRecord): boolean {
        return hasPreviewCapabilityExtracted(this, req, record);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public matchesPreviewToken(candidate: string | null | undefined, expected: string): boolean {
        return matchesPreviewTokenExtracted(this, candidate, expected);
    }

    /** @internal Used by the extracted qaap-dev-preview-endpoint-* modules. */
    public firstHeaderValue(value: string | string[] | undefined): string | undefined {
        return firstHeaderValueExtracted(this, value);
    }
}
