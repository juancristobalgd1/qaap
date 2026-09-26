// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// The `qaap-dev-preview-endpoint-*.ts` modules were split out of `QaapDevPreviewEndpoint` for size,
// but each extracted function still needs to call back into (now-public) endpoint members. This
// interface pins down exactly that surface. `import type` only: these are compile-time-only
// dependencies and must not create a runtime import cycle with the endpoint module, which already
// imports constants back out of the extracted files.
import type { Request, Response } from '@theia/core/shared/express';
import type * as http from 'http';
import type * as net from 'net';
import type { QaapGithubAuthGuard } from './qaap-github-auth-guard';
import type { QaapDevPreviewPortRegistry, QaapDevPreviewRecord } from './qaap-dev-preview-port-registry';

/**
 * The subset of `QaapDevPreviewEndpoint` used (via `ctx.`) by the extracted
 * `qaap-dev-preview-endpoint-render.ts` / `-timeline.ts` / `-streaming.ts` modules.
 */
export interface QaapDevPreviewEndpointContext {

    readonly auth: QaapGithubAuthGuard;

    readonly portRegistry: QaapDevPreviewPortRegistry;

    reaperRunning: boolean;

    requireHttpAuth(req: Request, res: Response): boolean;

    handleClaim(req: Request, res: Response): Promise<void>;

    handleProcessClaim(
        req: Request,
        res: Response,
        owner: string,
        root: string,
        preferredPort: number,
        claim: {
            readonly workspaceId: string;
            readonly projectId: string;
            readonly processId: string;
            readonly conversationId?: string;
        },
    ): Promise<void>;

    supersedeConversationPreviews(scope: {
        readonly previewId: string;
        readonly workspaceId: string;
        readonly projectId: string;
        readonly conversationId: string;
    }, owner: string): void;

    terminatePreviewProcess(record: { readonly osProcessId?: number; readonly port?: number; readonly ownerLogin?: string }): void;

    isPreviewProcessDead(record: { readonly osProcessId?: number; readonly port?: number; readonly ownerLogin?: string }): boolean;

    nextAllocationCandidate(preferredPort: number, offset: number): number;

    handleRelease(req: Request, res: Response): void;

    mayProxyPort(req: Request | http.IncomingMessage, port: number): boolean;

    previewForRequest(req: Request | http.IncomingMessage, previewId: string): QaapDevPreviewRecord | undefined;

    reapStoppedPreviews(): Promise<void>;

    handleProbe(req: Request, res: Response): Promise<void>;

    handleCurrentProjectPreview(req: Request, res: Response): Promise<void>;

    handleIdentityProbe(req: Request, res: Response): Promise<void>;

    handleProxy(req: Request, res: Response): void;

    handleIdentityProxy(req: Request, res: Response): void;

    resolveTargetHost(port: number, ownerLogin?: string): Promise<string | undefined>;
    /** Agent reaching the dev server on `port` (tunnelled runtimes), or undefined for loopback. */
    upstreamAgentFor(port: number, ownerLogin?: string): http.Agent | undefined;

    invalidateTargetHost(port: number): void;

    handleWebSocketUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer): void;

    proxyWebSocket(req: http.IncomingMessage, socket: net.Socket, head: Buffer, port: number, path: string): Promise<void>;

    forwardHttp(
        incoming: Request,
        outgoing: Response,
        targetPort: number,
        targetPath: string,
        publicPrefix?: string,
    ): Promise<void>;

    shouldRewriteProxyBody(proxyRes: http.IncomingMessage): boolean;

    rewriteDevPreviewLocation(location: string, targetPort: number, publicPrefix?: string): string;

    rewriteDevPreviewBody(body: string, targetPort: number, publicPrefix?: string): string;

    rewriteViteHmrClient(body: string, publicPrefix: string): string;

    rewritePreviewFrameHeaders(headers: http.OutgoingHttpHeaders, parentOrigin: string): void;

    isIdeListenPort(port: number): boolean;

    probeLocalDevServer(port: number, ownerLogin?: string): Promise<boolean>;
    /** True when every unclaimed listener of this runtime belongs to `login` (single-tenant backend). */
    ownsUnclaimedPorts(login: string | undefined): boolean;

    resolvePublicOrigin(req: Request): string;

    buildIdentityPreviewUrl(req: Request, record: Pick<QaapDevPreviewRecord, 'previewId' | 'accessToken'>): string;

    previewBaseDomain(): string | undefined;

    previewIdFromHost(req: Request | http.IncomingMessage): string | undefined;

    authorizePreviewHostRequest(req: Request, res: Response, record: QaapDevPreviewRecord): 'allowed' | 'redirected' | 'denied';

    hasPreviewCapability(req: Request | http.IncomingMessage, record: QaapDevPreviewRecord): boolean;

    matchesPreviewToken(candidate: string | null | undefined, expected: string): boolean;

    firstHeaderValue(value: string | string[] | undefined): string | undefined;
}
