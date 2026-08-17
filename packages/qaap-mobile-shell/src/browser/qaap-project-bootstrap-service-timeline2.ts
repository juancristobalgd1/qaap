// @ts-nocheck
// Extracted from qaap-project-bootstrap-service.ts

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { generateUuid } from '@theia/core/lib/common/uuid';
import { nls } from '@theia/core/lib/common/nls';
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { matchesMobileOneColumnLayout } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { syncQaapMiniBrowserPreviewSuspension } from '@theia/qaap-adapters/lib/browser/qaap-mini-browser-preview-frame';
import {
    applyNestedPathToPreviewUrl,
    parsePreviewIdentityPath,
    parsePreviewProxyPath,
    rebasePreviewUrlToIdentityClaim,
} from '@theia/qaap-adapters/lib/browser/qaap-preview-url-utils';
import { staticEntryPathFromDevCommand } from '../common/qaap-project-bootstrap-static';
import { QaapPreviewPortClaimService } from '@theia/qaap-adapters/lib/browser/qaap-preview-port-claim-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { TerminalWatcher } from '@theia/terminal/lib/common/terminal-watcher';
import { MiniBrowserOpenHandler } from '@theia/mini-browser/lib/browser/mini-browser-open-handler';
import { QaapPreviewWidgetKey, QaapProjectPreviewOpener } from './qaap-project-preview-opener';
import { QaapProjectBootstrapDetector } from './qaap-project-bootstrap-detector';
import {
    QaapBootstrapPhase,
    QaapForwardedPort,
    QaapMonorepoAppCandidate,
    QaapProjectDescriptor,
    QaapProjectKind,
} from './qaap-project-bootstrap-types';
import {
    fetchQaapCurrentDevPreview,
    probeQaapDevPreviewPort,
    probeQaapIdentityPreview,
    toDevPreviewUrl,
    waitForQaapDevPreviewPort,
} from './qaap-dev-preview-client';
import {
    getImplicitDevPort,
    getQaapIdeListenPort,
    isReservedIdePort,
    pickNextDevPort,
    resolveBootstrapDevPort,
    wrapCommandForDevNodeEnv,
    wrapDevCommandForPort,
} from './qaap-project-bootstrap-port';
import {
    diagnoseBootstrapFailure,
    extractDevOutputProbePorts,
    extractTerminalFailureLine,
    isTerminalDoesNotExistError,
    terminalOutputNeedsInstall,
    terminalOutputNextDevLock,
    type QaapBootstrapFailureKind,
} from './qaap-project-bootstrap-dev-errors';
import { MobileProjectsService } from './mobile-projects-service';
import { peekPreferDesktopIde } from './mobile-projects-open';
import {
    enrichBootstrapDevRunError,
    resolveBootstrapDevTarget,
    resolveBootstrapInstallTarget,
} from '../common/qaap-project-bootstrap-scaffold-plan';
import type { QaapPreviewPortClaimResult } from '@theia/qaap-adapters/lib/browser/qaap-preview-port-claim-service';
import { normalizePersistedBootstrapPhase } from '../common/qaap-project-bootstrap-phase';
import { isLocalQaapPreviewOrigin, resolveDevPreviewPublicOrigin, type QaapDevPreviewProbeResponse } from '../common/qaap-dev-preview';
import {
    normalizeQaapPreviewConversationId,
    QAAP_DEFAULT_PREVIEW_CONVERSATION_ID,
    qaapPreviewProjectIdMatches,
} from '../common/qaap-preview-identity';
import { resolveQaapReattachedPreviewIdentity } from './qaap-preview-reattachment';
import {
    QAAP_PREVIEW_TERMINAL_KIND,
    extractQaapPreviewTerminalPort,
    isQaapBootRestoredPreviewTerminal,
    isQaapRestoredPreviewTerminal,
    isRestoredPreviewProbeOwned,
    shouldDisposeRestoredPreviewTerminal,
} from './qaap-preview-terminal-lifecycle';
import { switchQaapMonorepoPreviewApp } from './qaap-monorepo-preview-switch';
import { buildQaapManagedShellInvocation } from './qaap-project-bootstrap-shell';
import {
    previewProjectId as previewProjectIdHelper,
    normalizeDevUrl as normalizeDevUrlHelper,
    extractPortFromInUseMessage as extractPortFromInUseMessageHelper,
    normalizeRestoredPhase as normalizeRestoredPhaseHelper,
    readTerminalTail as readTerminalTailHelper,
    disposeBootstrapTerminal as disposeBootstrapTerminalHelper,
    delay as delayHelper,
} from './qaap-project-bootstrap-helpers';
import { ANSI_REGEX, DEV_PREVIEW_FALLBACK_MS, DEV_PREVIEW_OPEN_PROBE_ATTEMPTS, DEV_PREVIEW_OPEN_PROBE_INTERVAL_MS, DEV_URL_REGEX, PORT_IN_USE_REGEX } from './qaap-project-bootstrap-service';

export function scanDevOutputExtracted(ctx: any, data: string, plan: { expectedPort?: number }): void {
        if (ctx._phase !== 'starting' && ctx._phase !== 'running') {
            return;
        }
        const clean = data.replace(ANSI_REGEX, '');
        if (PORT_IN_USE_REGEX.test(clean)) {
            ctx._portConflictDetected = true;
            const fromLog = ctx.extractPortFromInUseMessage(clean);
            if (fromLog !== undefined) {
                ctx._portConflictPort = fromLog;
            }
            void ctx.tryAttachToExistingServer(ctx.collectProbePorts(plan));
        }
        for (const port of extractDevOutputProbePorts(clean)) {
            if (ctx._portConflictPort === undefined) {
                ctx._portConflictPort = port;
            }
            void ctx.tryAttachToExistingServer(ctx.collectProbePorts(plan));
        }
        ctx.scanForDevUrl(clean);
}

export function scanForDevUrlExtracted(ctx: any, data: string): void {
        if (ctx._phase !== 'starting' && ctx._phase !== 'running') {
            return;
        }
        const clean = data.replace(ANSI_REGEX, '');
        const matches = clean.matchAll(DEV_URL_REGEX);
        for (const match of matches) {
            const url = ctx.normalizeDevUrl(match[1]);
            if (!url) {
                continue;
            }
            const port = ctx.extractPort(url);
            if (port === undefined) {
                continue;
            }
            const effectivePort = isReservedIdePort(port) && ctx.activeDevPortHint !== undefined
                ? ctx.activeDevPortHint
                : port;
            if (isReservedIdePort(effectivePort)) {
                continue;
            }
            // Keep the logged pathname (`/docs/demo/`) so identity preview opens the nested
            // static entry instead of `/qaap-preview/<id>/` → backend `/` → "Not found".
            ctx.recordForwardedPort(effectivePort, url);
        }
}

export function extractPortExtracted(ctx: any, url: string): number | undefined {
        try {
            const parsed = new URL(url);
            const proxied = parsePreviewProxyPath(parsed.pathname);
            if (proxied) {
                return proxied.port;
            }
            if (parsed.pathname.startsWith('/qaap-preview/')) {
                return ctx.activePreviewClaim?.port;
            }
            if (parsed.port) {
                return Number(parsed.port);
            }
            if (parsed.protocol === 'http:') { return 80; }
            if (parsed.protocol === 'https:') { return 443; }
        } catch {
            return undefined;
        }
        return undefined;
}

export function recordForwardedPortExtracted(ctx: any, port: number,
        url: string,
        options?: { alreadyReady?: boolean },): void {
        if (isReservedIdePort(port)) {
            return;
        }
        ctx.ensurePreviewProcessIdForConversation(ctx.activePreviewConversationId);
        const existing = ctx._forwardedPorts.find(p => p.port === port);
        if (existing) {
            return;
        }
        // Claim the port for this workspace FIRST (proves ownership), then open the preview. The
        // backend proxy fails closed on unclaimed ports, so opening before the claim lands would
        // 403 the owner's own preview. claimDevPreviewPort is best-effort and resolves even on
        // failure, so a claim error still lets the preview attempt (and fail closed) rather than hang.
        const claimed = ctx.claimDevPreviewPort(port);
        const isPrimary = ctx._forwardedPorts.length === 0;
        const isolatedUrl = ctx.activePreviewClaim?.port === port
            ? rebasePreviewUrlToIdentityClaim(url, ctx.activePreviewClaim.previewUrl)
            : url;
        const next: QaapForwardedPort = {
            port,
            url: isolatedUrl,
            firstSeenAt: Date.now(),
            previewOpen: false,
            primary: isPrimary,
        };
        ctx._forwardedPorts = [...ctx._forwardedPorts, next].sort((a, b) => a.firstSeenAt - b.firstSeenAt);
        ctx.forwardedPortsEmitter.fire(ctx.forwardedPorts);
        if (isPrimary) {
            // Remember the primary port so the next session can offer a "resume preview · :3001"
            // action instead of a generic "Run & Preview" CTA.
            ctx._lastPort = port;
            if (options?.alreadyReady) {
                void claimed.then(() => {
                    const target = ctx.resolvePrimaryPreviewTarget(port, isolatedUrl);
                    ctx._lastPort = target.port;
                    return ctx.openPreview(target.url, /* primary */ true, { auto: true });
                });
            } else {
                void claimed.then(() => {
                    const target = ctx.resolvePrimaryPreviewTarget(port, isolatedUrl);
                    ctx._lastPort = target.port;
                    return ctx.openPrimaryPreviewWhenReady(target.port, target.url, { auto: true });
                });
            }
        }
}

function previewUrlForIdentityOpen(ctx: any, discoveredUrl: string, identityPreviewUrl?: string): string {
        const nestedEntry = staticEntryPathFromDevCommand(ctx._descriptor?.devCommand);
        const base = identityPreviewUrl || discoveredUrl;
        const rebased = identityPreviewUrl && discoveredUrl
            ? rebasePreviewUrlToIdentityClaim(discoveredUrl, identityPreviewUrl)
            : base;
        return nestedEntry ? applyNestedPathToPreviewUrl(rebased || base, nestedEntry) : (rebased || base);
}

export function resolvePrimaryPreviewTargetExtracted(ctx: any, port: number, url: string): { port: number; url: string } {
        const claim = ctx.activePreviewClaim;
        if (claim && claim.port !== undefined && claim.port !== port) {
            return { port: claim.port, url: previewUrlForIdentityOpen(ctx, url, claim.previewUrl) };
        }
        return { port, url: previewUrlForIdentityOpen(ctx, url, claim?.previewUrl) };
}

export function mayAutoOpenPreviewNowExtracted(ctx: any): boolean {
        try {
            return ctx.previewAutoOpenGate?.() ?? true;
        } catch {
            return true;
        }
}

export async function claimDevPreviewPortExtracted(ctx: any, port: number): Promise<void> {
        const processRoot = ctx._descriptor?.rootUri ?? ctx.activeWorkspaceRoot;
        const claim = ctx.activePreviewRunId && processRoot
            ? await ctx.reserveActivePreview(port, processRoot)
            : await ctx.previewPortClaimService.claim(port);
        if (claim.kind === 'claimed' && claim.previewId && claim.previewUrl && claim.port !== undefined) {
            ctx.rememberActivePreviewClaim({
                previewId: claim.previewId,
                previewUrl: claim.previewUrl,
                port: claim.port,
            });
        }
}

export async function openPrimaryPreviewWhenReadyExtracted(ctx: any, port: number, url: string, options?: { auto?: boolean }): Promise<void> {
        if (ctx._previewUrl) {
            return;
        }
        ({ port, url } = ctx.resolvePrimaryPreviewTarget(port, url));
        let ready = await waitForQaapDevPreviewPort(port, {
            maxAttempts: DEV_PREVIEW_OPEN_PROBE_ATTEMPTS,
            intervalMs: DEV_PREVIEW_OPEN_PROBE_INTERVAL_MS,
        });
        if (!ready) {
            ready = await ctx.healPreviewClaimToListeningPort(port);
            if (ready && ctx.activePreviewClaim) {
                port = ctx.activePreviewClaim.port;
                url = previewUrlForIdentityOpen(ctx, url, ctx.activePreviewClaim.previewUrl);
            }
        }
        if (ctx._previewUrl) {
            return;
        }
        if (!ready) {
            return;
        }
        const activeUrl = ctx.activePreviewClaim?.port === port
            ? ctx.activePreviewClaim.previewUrl
            : undefined;
        const previewId = ctx.activePreviewClaim?.previewId;
        if (previewId) {
            const identity = await probeQaapIdentityPreview(previewId);
            if (!identity.ready) {
                return;
            }
            const identityBase = identity.previewUrl || activeUrl || ready.previewUrl;
            await ctx.openPreview(previewUrlForIdentityOpen(ctx, url, identityBase), true, options);
            return;
        }
        await ctx.openPreview(previewUrlForIdentityOpen(ctx, url, activeUrl ?? ready.previewUrl), true, options);
}

export async function healPreviewClaimToListeningPortExtracted(ctx: any, deadPort: number,): Promise<Awaited<ReturnType<typeof waitForQaapDevPreviewPort>>> {
        const candidates = [
            ctx.activeDevPortHint,
            ctx._lastPort,
            ctx._portConflictPort,
            ...ctx._forwardedPorts.map(entry => entry.port),
        ].filter((value, index, all): value is number => (
            typeof value === 'number'
            && Number.isInteger(value)
            && value > 0
            && value !== deadPort
            && !isReservedIdePort(value)
            && all.indexOf(value) === index
        ));
        for (const candidate of candidates) {
            // Claim first: an unclaimed listening port cannot be probed (403), but process-claim
            // rebind adopts the preferred port when it answers on loopback.
            await ctx.claimDevPreviewPort(candidate);
            const claim = ctx.activePreviewClaim;
            if (!claim || claim.port === deadPort) {
                continue;
            }
            const healed = await waitForQaapDevPreviewPort(claim.port, {
                maxAttempts: 8,
                intervalMs: DEV_PREVIEW_OPEN_PROBE_INTERVAL_MS,
            });
            if (healed?.ready) {
                ctx._lastPort = claim.port;
                return healed;
            }
            const identity = await probeQaapIdentityPreview(claim.previewId);
            if (identity.ready) {
                ctx._lastPort = claim.port;
                return {
                    ready: true,
                    readiness: 'transport_ready',
                    previewUrl: identity.previewUrl || claim.previewUrl,
                    previewId: claim.previewId,
                    port: claim.port,
                };
            }
        }
        return undefined;
}

export async function openForwardedPortExtracted(ctx: any, port: QaapForwardedPort): Promise<void> {
        if (port.primary) {
            // Primary ports go through the shared preview widget so users can swap between dev URLs
            // without spawning new tabs by accident.
            await ctx.openPrimaryPreviewWhenReady(port.port, port.url);
            return;
        }
        try {
            await ctx.miniBrowser.open(new URI(port.url));
            ctx.markPortOpened(port.port, true);
        } catch (e) {
            console.error('[qaap-project-bootstrap] failed to open forwarded port', e);
        }
}

export function markPortOpenedExtracted(ctx: any, port: number, open: boolean): void {
        let changed = false;
        ctx._forwardedPorts = ctx._forwardedPorts.map(p => {
            if (p.port !== port || p.previewOpen === open) {
                return p;
            }
            changed = true;
            return { ...p, previewOpen: open };
        });
        if (changed) {
            ctx.forwardedPortsEmitter.fire(ctx.forwardedPorts);
        }
}

export function collectProbePortsExtracted(ctx: any, plan?: { expectedPort?: number }): number[] {
        const idePort = getQaapIdeListenPort();
        const ports: number[] = [];
        if (ctx._portConflictPort !== undefined) {
            ports.push(ctx._portConflictPort);
        }
        if (plan?.expectedPort !== undefined) {
            ports.push(plan.expectedPort);
        }
        if (ctx.activeDevPortHint !== undefined) {
            ports.push(ctx.activeDevPortHint);
        }
        if (ctx._lastPort !== undefined) {
            ports.push(ctx._lastPort);
        }
        for (const port of extractDevOutputProbePorts(ctx.devOutputTail)) {
            ports.push(port);
        }
        return [...new Set(ports.filter(p => p > 0 && p < 65536 && p !== idePort))];
}

export function scheduleDevPreviewFallbackExtracted(ctx: any, runId: number, port: number): void {
        const tryOpen = async (): Promise<void> => {
            if (runId !== ctx.devRunGeneration) {
                return;
            }
            if (ctx._phase !== 'starting' || ctx._previewUrl) {
                return;
            }
            if (ctx._forwardedPorts.some(p => p.port === port)) {
                return;
            }
            await ctx.tryAttachToExistingServer([port]);
        };
        ctx.devPreviewFallbackTimers.push(
            window.setTimeout(() => {
                void tryOpen();
            }, 1200),
            window.setTimeout(() => {
                void tryOpen();
            }, DEV_PREVIEW_FALLBACK_MS),
        );
}

export async function tryAttachToExistingServerExtracted(ctx: any, ports: number[]): Promise<boolean> {
        if (ports.length === 0 || ctx._previewUrl) {
            return !!ctx._previewUrl;
        }
        for (const port of ports) {
            if (isReservedIdePort(port)) {
                continue;
            }
            // Refresh only the owner/port gate before probing. A process-scoped claim here can
            // replace the durable identity before the probe tells us which process is actually
            // listening (observed after reload with multiple restored Dev terminals). The legacy
            // claim is non-stealing and cannot adopt an unregistered listener in cloud mode.
            await ctx.previewPortClaimService.claim(port);
            const probe = await probeQaapDevPreviewPort(port);
            if (!probe.ready || !ctx.probeBelongsToActiveProject(probe.projectId)) {
                continue;
            }
            ctx.adoptExistingPreviewIdentity(port, probe);
            const plan = ctx.resolveDevPlan();
            const descriptor = ctx._descriptor;
            if (plan && descriptor) {
                const label = ctx._selectedApp?.name ?? descriptor.name;
                // Every adoption path (warmup, reload, section switch, manual open) converges here.
                // Retain only the restored terminal whose allocator marker names this claim's port.
                const restoredTerminal = await ctx.disposeRestoredPreviewTerminals(plan.cwd, `Dev (${label})`, port);
                if (restoredTerminal) {
                    ctx.watchAttachedDevTerminal(restoredTerminal, plan);
                }
            }
            ctx._portConflictPort = port;
            ctx.recordForwardedPort(port, probe.previewUrl, { alreadyReady: true });
            return true;
        }
        return false;
}

export function adoptExistingPreviewIdentityExtracted(ctx: any, port: number, probe: QaapDevPreviewProbeResponse): void {
        const restored = resolveQaapReattachedPreviewIdentity(port, probe);
        if (!restored) {
            return;
        }
        ctx.activePreviewRunId = restored.processId;
        ctx.previewRunIdByConversation.set(ctx.activePreviewConversationId, restored.processId);
        ctx.rememberActivePreviewClaim(restored.claim);
}

export function probeBelongsToActiveProjectExtracted(ctx: any, projectId: string | undefined): boolean {
        const workspaceRoot = ctx.activeWorkspaceRoot ?? ctx._descriptor?.rootUri;
        if (!workspaceRoot) {
            return true;
        }
        if (projectId) {
            return qaapPreviewProjectIdMatches(
                projectId,
                ctx.previewProjectId(workspaceRoot),
                ctx.activeProjectId,
            );
        }
        return isLocalQaapPreviewOrigin(resolveDevPreviewPublicOrigin());
}

export function monitorPreviewProcessLifetimeExtracted(ctx: any, terminal: TerminalWidget, previewId: string): void {
        const lifecycle = new DisposableCollection();
        let settled = false;
        const release = (): void => {
            if (settled) {
                return;
            }
            settled = true;
            lifecycle.dispose();
            void ctx.previewPortClaimService.release?.(previewId);
        };
        lifecycle.push(ctx.terminalWatcher.onTerminalExit(event => {
            if (event.terminalId === terminal.terminalId) {
                release();
            }
        }));
        lifecycle.push(terminal.onTerminalDidClose(release));
        ctx.toDispose.push(lifecycle);
}

export function attachTerminalOsProcessIdExtracted(ctx: any, terminal: TerminalWidget, previewId: string, port: number, cwd: URI): void {
        void terminal.processId.then(pid => {
            if (ctx.activePreviewClaim?.previewId === previewId) {
                void ctx.reserveActivePreview(port, cwd, pid);
            }
        }).catch(() => undefined);
}

