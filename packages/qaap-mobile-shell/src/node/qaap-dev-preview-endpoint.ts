// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-nocheck

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
import { configureExtracted, handleClaimExtracted, handleProcessClaimExtracted, requireHttpAuthExtracted, supersedeConversationPreviewsExtracted, supersedeProjectPreviewsExtracted, terminatePreviewProcessExtracted } from './qaap-dev-preview-endpoint-render2';
import { handleCurrentProjectPreviewExtracted, handleIdentityProbeExtracted, handleIdentityProxyExtracted, handleProbeExtracted, handleProxyExtracted, handleReleaseExtracted, handleWebSocketUpgradeExtracted, isPreviewProcessDeadExtracted, mayProxyPortExtracted, nextAllocationCandidateExtracted, onStartExtracted, previewForRequestExtracted, proxyWebSocketExtracted, reapStoppedPreviewsExtracted } from './qaap-dev-preview-endpoint-streaming2';
import { authorizePreviewHostRequestExtracted, buildIdentityPreviewUrlExtracted, firstHeaderValueExtracted, forwardHttpExtracted, hasPreviewCapabilityExtracted, matchesPreviewTokenExtracted, previewBaseDomainExtracted, previewIdFromHostExtracted, probeLocalDevServerExtracted, resolvePublicOriginExtracted, rewriteDevPreviewBodyExtracted, rewriteDevPreviewLocationExtracted, rewriteIsolatedPreviewCspExtracted, rewriteViteHmrClientExtracted, shouldRewriteProxyBodyExtracted } from './qaap-dev-preview-endpoint-timeline2';

export const PROBE_TIMEOUT_MS = 2500;
export const LOCAL_TARGET_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);
export const TEXT_RESPONSE_PATTERN = /\b(?:text\/html|text\/css|application\/javascript|text\/javascript|application\/x-javascript)\b/i;
export const QAAP_PREVIEW_ACCESS_QUERY = 'qaap_preview_token';
export const QAAP_PREVIEW_ACCESS_COOKIE = 'qaap_preview_access';
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
export class QaapDevPreviewEndpoint implements BackendApplicationContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(QaapDevPreviewPortRegistry)
    protected readonly portRegistry: QaapDevPreviewPortRegistry;

    protected reaperRunning = false;

    configure(app: Application): void {
        configureExtracted(this, app);
    }

    protected requireHttpAuth(req: Request, res: Response): boolean {
        return requireHttpAuthExtracted(this, req, res);
    }

    protected async handleClaim(req: Request, res: Response): Promise<void> {
        return handleClaimExtracted(this, req, res);
    }

    protected async handleProcessClaim(req: Request, res: Response, owner: string, root: string, preferredPort: number, claim: { readonly workspaceId: string; readonly projectId: string; readonly processId: string; readonly conversationId?: string; },): Promise<void> {
        return handleProcessClaimExtracted(this, req, res, owner, root, preferredPort, claim);
    }

    protected supersedeConversationPreviews(scope: { readonly previewId: string; readonly workspaceId: string; readonly projectId: string; readonly conversationId: string; }, owner: string): void {
        supersedeConversationPreviewsExtracted(this, scope, owner);
    }

    protected supersedeProjectPreviews(project: { readonly previewId: string; readonly workspaceId: string; readonly projectId: string }, owner: string): void {
        supersedeProjectPreviewsExtracted(this, project, owner);
    }

    protected terminatePreviewProcess(record: { readonly osProcessId?: number; readonly port?: number }): void {
        terminatePreviewProcessExtracted(this, record);
    }

    protected isPreviewProcessDead(record: { readonly osProcessId?: number }): boolean {
        return isPreviewProcessDeadExtracted(this, record);
    }

    protected nextAllocationCandidate(preferredPort: number, offset: number): number {
        return nextAllocationCandidateExtracted(this, preferredPort, offset);
    }

    protected handleRelease(req: Request, res: Response): void {
        handleReleaseExtracted(this, req, res);
    }

    protected mayProxyPort(req: Request | http.IncomingMessage, port: number): boolean {
        return mayProxyPortExtracted(this, req, port);
    }

    protected previewForRequest(req: Request | http.IncomingMessage, previewId: string): QaapDevPreviewRecord | undefined {
        return previewForRequestExtracted(this, req, previewId);
    }

    onStart(server: http.Server): void {
        onStartExtracted(this, server);
    }

    protected async reapStoppedPreviews(): Promise<void> {
        return reapStoppedPreviewsExtracted(this);
    }

    protected async handleProbe(req: Request, res: Response): Promise<void> {
        return handleProbeExtracted(this, req, res);
    }

    protected async handleCurrentProjectPreview(req: Request, res: Response): Promise<void> {
        return handleCurrentProjectPreviewExtracted(this, req, res);
    }

    protected async handleIdentityProbe(req: Request, res: Response): Promise<void> {
        return handleIdentityProbeExtracted(this, req, res);
    }

    protected handleProxy(req: Request, res: Response): void {
        handleProxyExtracted(this, req, res);
    }

    protected handleIdentityProxy(req: Request, res: Response): void {
        handleIdentityProxyExtracted(this, req, res);
    }

    protected readonly targetHostResolver = new QaapDevPreviewTargetHostResolver();

    /** Picks the loopback family the dev server actually listens on (IPv4 first, then IPv6). */
    protected resolveTargetHost(port: number): Promise<string | undefined> {
        return this.targetHostResolver.resolve(port);
    }

    protected handleWebSocketUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer,): void {
        handleWebSocketUpgradeExtracted(this, req, socket, head);
    }

    protected async proxyWebSocket(req: http.IncomingMessage, socket: net.Socket, head: Buffer, port: number, path: string,): Promise<void> {
        return proxyWebSocketExtracted(this, req, socket, head, port, path);
    }

    protected async forwardHttp(incoming: Request, outgoing: Response, targetPort: number, targetPath: string, publicPrefix: string = `${QAAP_DEV_PREVIEW_PREFIX}/${targetPort}`,): Promise<void> {
        return forwardHttpExtracted(this, incoming, outgoing, targetPort, targetPath, publicPrefix);
    }

    protected shouldRewriteProxyBody(proxyRes: http.IncomingMessage): boolean {
        return shouldRewriteProxyBodyExtracted(this, proxyRes);
    }

    protected rewriteDevPreviewLocation(location: string, targetPort: number, publicPrefix: string = `${QAAP_DEV_PREVIEW_PREFIX}/${targetPort}`,): string {
        return rewriteDevPreviewLocationExtracted(this, location, targetPort, publicPrefix);
    }

    protected rewriteDevPreviewBody(body: string, targetPort: number, publicPrefix: string = `${QAAP_DEV_PREVIEW_PREFIX}/${targetPort}`,): string {
        return rewriteDevPreviewBodyExtracted(this, body, targetPort, publicPrefix);
    }

    protected rewriteViteHmrClient(body: string, publicPrefix: string): string {
        return rewriteViteHmrClientExtracted(this, body, publicPrefix);
    }

    protected rewriteIsolatedPreviewCsp(raw: string | string[] | undefined, parentOrigin: string): string {
        return rewriteIsolatedPreviewCspExtracted(this, raw, parentOrigin);
    }

    protected isIdeListenPort(port: number): boolean {
        return port === getQaapBackendListenPort();
    }

    protected async probeLocalDevServer(port: number): Promise<boolean> {
        return probeLocalDevServerExtracted(this, port);
    }

    protected resolvePublicOrigin(req: Request): string {
        return resolvePublicOriginExtracted(this, req);
    }

    protected buildIdentityPreviewUrl(req: Request, record: Pick<QaapDevPreviewRecord, 'previewId' | 'accessToken'>): string {
        return buildIdentityPreviewUrlExtracted(this, req, record);
    }

    protected previewBaseDomain(): string | undefined {
        return previewBaseDomainExtracted(this);
    }

    protected previewIdFromHost(req: Request | http.IncomingMessage): string | undefined {
        return previewIdFromHostExtracted(this, req);
    }

    protected authorizePreviewHostRequest(req: Request, res: Response, record: QaapDevPreviewRecord,): 'allowed' | 'redirected' | 'denied' {
        return authorizePreviewHostRequestExtracted(this, req, res, record);
    }

    protected hasPreviewCapability(req: Request | http.IncomingMessage, record: QaapDevPreviewRecord): boolean {
        return hasPreviewCapabilityExtracted(this, req, record);
    }

    protected matchesPreviewToken(candidate: string | null | undefined, expected: string): boolean {
        return matchesPreviewTokenExtracted(this, candidate, expected);
    }

    protected firstHeaderValue(value: string | string[] | undefined): string | undefined {
        return firstHeaderValueExtracted(this, value);
    }
}
