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
    parsePreviewIdentityPath,
    parsePreviewProxyPath,
    rebasePreviewUrlToIdentityClaim,
} from '@theia/qaap-adapters/lib/browser/qaap-preview-url-utils';
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
    shouldIgnoreWorkspaceRefreshForHubPin,
    normalizeDevUrl as normalizeDevUrlHelper,
    extractPortFromInUseMessage as extractPortFromInUseMessageHelper,
    normalizeRestoredPhase as normalizeRestoredPhaseHelper,
    readTerminalTail as readTerminalTailHelper,
    disposeBootstrapTerminal as disposeBootstrapTerminalHelper,
    delay as delayHelper,
} from './qaap-project-bootstrap-helpers';

export async function runInstallExtracted(ctx: any): Promise<void> {
        const descriptor = ctx._descriptor;
        if (!descriptor || ctx._phase === 'installing') {
            return;
        }
        if (descriptor.nodeModulesPresent && !ctx._needsInstall) {
            ctx.persistPhase('ready-to-run');
            ctx.setPhase('ready-to-run');
            if (ctx.resolveDevPlan()) {
                await ctx.runDevServer();
            }
            return;
        }
        const installId = ++ctx.installGeneration;
        ctx.setPhase('installing');
        try {
            const installPlan = ctx.resolveInstallPlan();
            if (!installPlan) {
                ctx.setPhase('install-failed');
                ctx._error = 'No install target for this workspace.';
                return;
            }
            const terminal = await ctx.spawnCommandWithRetry({
                title: `Install (${descriptor.packageManager})`,
                // NODE_ENV=production hosts would otherwise skip devDependencies (vite & friends).
                command: wrapCommandForDevNodeEnv(installPlan.command),
                cwd: installPlan.cwd,
                reveal: false,
            });
            if (installId !== ctx.installGeneration) {
                ctx.disposeBootstrapTerminal(terminal);
                return;
            }
            ctx.installTerminal = terminal;
            const exitCode = await ctx.waitForExit(terminal);
            if (installId !== ctx.installGeneration || terminal.isDisposed) {
                return;
            }
            // node-pty / Theia can emit `code: undefined` on clean exits (see node-pty#751); treat
            // a missing code as a successful exit so a working install doesn't get flagged as
            // failed just because the kernel didn't surface the exit syscall value.
            if (exitCode !== undefined && exitCode !== 0) {
                const tail = ctx.readTerminalTail(terminal);
                ctx._needsInstall = terminalOutputNeedsInstall(tail);
                ctx._error = extractTerminalFailureLine(tail, `Install exited with code ${exitCode}`);
                ctx.setPhase('install-failed');
                return;
            }
            ctx._needsInstall = false;
            await ctx.refreshDescriptorAfterInstall();
            ctx.persistPhase('ready-to-run');
            ctx.setPhase('ready-to-run');
            // Auto-chain to dev server when a runnable plan is available (single-package script or a
            // selected monorepo app). For monorepos with no app picked yet we stop here so the user
            // can choose which app to preview — running an arbitrary one would be surprising.
            if (ctx.resolveDevPlan()) {
                await ctx.runDevServer();
            }
        } catch (e) {
            const raw = e instanceof Error ? e.message : String(e);
            ctx._error = ctx.toUserFacingDevError(raw);
            ctx.setPhase('install-failed');
        } finally {
            ctx.installTerminal = undefined;
        }
}

export async function runDevServerExtracted(ctx: any, options?: { conversationId?: string }): Promise<void> {
        if (options?.conversationId !== undefined) {
            ctx.bindPreviewConversation(options.conversationId);
        }
        const plan = ctx.resolveDevPlan();
        const descriptor = ctx._descriptor;
        if (!plan || !descriptor) {
            return;
        }
        const busyForActiveConversation = (ctx._phase === 'starting' || ctx._phase === 'running')
            && ctx.devTerminalConversationId === ctx.activePreviewConversationId;
        if (busyForActiveConversation) {
            return;
        }
        ctx.devPortOverride = undefined;
        ctx.automaticPortRecoveryAttempts = 0;
        ctx.attemptedDevPorts.clear();
        ctx.portRecoveryFrom = undefined;
        await ctx.startDevServer(plan, descriptor);
}

export async function startDevServerExtracted(ctx: any, plan: { command: string; cwd: URI; expectedPort?: number; kind: QaapProjectKind },
        descriptor: QaapProjectDescriptor,): Promise<void> {
        ctx.beginDevRun();
        ctx.clearForwardedPorts();
        ctx._portConflictDetected = false;
        ctx._portConflictPort = undefined;
        ctx._error = undefined;
        ctx._needsInstall = false;
        ctx.devOutputTail = '';
        ctx.activeDevPortHint = undefined;
        const runId = ++ctx.devRunGeneration;
        ctx.setPhase('starting');

        let spawnPlan = ctx.buildDevSpawnPlan(plan);
        ctx.activeDevPortHint = spawnPlan.targetPort;
        const label = ctx._selectedApp?.name ?? descriptor.name;
        // Reattach only to THIS section's claim. Using the global `_lastPort` would collapse a new
        // conversation onto another section's live server (shared project, independent previews).
        const sectionPort = ctx.previewClaimByConversation.get(ctx.activePreviewConversationId)?.port;
        if (sectionPort !== undefined && await ctx.tryAttachToExistingServer([sectionPort])) {
            return;
        }

        // VPS/container restore can resurrect Dev terminals whose durable claim was already reaped.
        // Reconcile globally before cwd-scoped disposal so orphan listeners do not respawn.
        await ctx.reconcileRestoredPreviewTerminals();

        // Persistent Theia terminals can be reconstructed after a backend/workspace restore after
        // their durable claim has already been reaped. Letting that old Dev terminal keep booting
        // while allocating a fresh claim produces two servers for the same project (observed on the
        // VPS at :3002 and :3003). A live registered process returned above; anything matched here
        // is an unclaimed restored terminal for this exact cwd and must be stopped before restart.
        await ctx.disposeRestoredPreviewTerminals(plan.cwd, `Dev (${label})`);

        ctx.ensurePreviewProcessIdForConversation(ctx.activePreviewConversationId);
        if (spawnPlan.targetPort !== undefined) {
            ctx.attemptedDevPorts.add(spawnPlan.targetPort);
            const reservation = await ctx.reserveActivePreview(spawnPlan.targetPort, plan.cwd);
            if (runId !== ctx.devRunGeneration) {
                if (reservation.kind === 'claimed' && reservation.previewId) {
                    void ctx.previewPortClaimService.release?.(reservation.previewId);
                }
                return;
            }
            if (reservation.kind !== 'claimed' || reservation.port === undefined
                || !reservation.previewId || !reservation.previewUrl) {
                ctx._error = reservation.kind === 'conflict'
                    ? nls.localize('qaap/projectBootstrap/previewIdentityConflict', 'The requested preview identity is already in use.')
                    : nls.localize('qaap/projectBootstrap/previewReservationFailed', 'Qaap could not reserve an isolated preview port.');
                ctx.setPhase('run-failed');
                return;
            }
            ctx.rememberActivePreviewClaim({
                previewId: reservation.previewId,
                previewUrl: reservation.previewUrl,
                port: reservation.port,
            });
            // Persist the stable identity URL as soon as the reservation exists. If the user
            // switches projects while the process is still booting, the other section can resolve
            // this exact preview instead of scanning global ports.
            void ctx.hubProjects.recordProjectSession({
                repoKey: ctx.activeProjectId,
                bootstrapPhase: 'starting',
                previewUrl: reservation.previewUrl,
                agentState: 'working',
                lastTask: nls.localize('qaap/projectBootstrap/startingDevServer', 'Starting dev server…'),
            }).catch(() => undefined);
            if (reservation.port !== spawnPlan.targetPort) {
                ctx.devPortOverride = reservation.port;
                spawnPlan = ctx.buildDevSpawnPlan(plan);
                ctx.activeDevPortHint = reservation.port;
                ctx.attemptedDevPorts.add(reservation.port);
            }
        }

        try {
            const spawnOptions = {
                title: `Dev (${label})`,
                command: spawnPlan.command,
                cwd: plan.cwd,
                kind: QAAP_PREVIEW_TERMINAL_KIND,
                // Work Hub owns this terminal; revealing the bottom-panel terminal on mobile can
                // dispose/recreate the widget while it is starting and lose its launch options.
                reveal: false,
            };
            const terminal = matchesMobileOneColumnLayout()
                ? await ctx.spawnCommandWithRetry(spawnOptions)
                : await ctx.spawnCommand(spawnOptions);
            if (runId !== ctx.devRunGeneration) {
                return;
            }
            const processClaim = ctx.activePreviewClaim;
            if (processClaim) {
                ctx.monitorPreviewProcessLifetime(terminal, processClaim.previewId);
                ctx.attachTerminalOsProcessId(terminal, processClaim.previewId, processClaim.port, plan.cwd);
            }
            ctx.devTerminal = terminal;
            ctx.devTerminalConversationId = ctx.activePreviewConversationId;
            ctx.devTerminalListener.dispose();
            const onOutput = terminal.onOutput(data => {
                ctx.appendDevOutput(data);
                ctx.scanDevOutput(data, { expectedPort: spawnPlan.targetPort });
            });
            // Process exit is broadcast through TerminalWatcher (not via onTerminalDidClose, which
            // only fires when the *widget* is disposed). We filter by terminalId so a parallel
            // install terminal exiting doesn't accidentally flip the dev phase.
            const onProcessExit = ctx.terminalWatcher.onTerminalExit(event => {
                if (event.terminalId !== terminal.terminalId
                    || runId !== ctx.devRunGeneration
                    || ctx.devRunCancelledByUser) {
                    return;
                }
                if (ctx._phase === 'starting' || ctx._phase === 'running') {
                    void ctx.failDevRun(nls.localize(
                        'qaap/projectBootstrap/devServerExited',
                        'Dev server exited with code {0}.',
                        String(event.code ?? '?'),
                    ), plan, runId);
                }
            });
            const onWidgetClose = terminal.onTerminalDidClose(() => {
                if (runId !== ctx.devRunGeneration || ctx.devRunCancelledByUser) {
                    return;
                }
                if (ctx._phase === 'starting' || ctx._phase === 'running') {
                    void ctx.failDevRun(nls.localize(
                        'qaap/projectBootstrap/devServerTabClosed',
                        'Dev server tab closed.',
                    ), plan, runId);
                }
            });
            ctx.devTerminalListener = new DisposableCollection(onOutput, onProcessExit, onWidgetClose);
            ctx.toDispose.push(ctx.devTerminalListener);
            // Register in the per-conversation map (multi-preview support).
            ctx.registerDevTerminalForConversation(ctx.activePreviewConversationId, terminal, ctx.devTerminalListener);

            // Fallback: if the user has a known framework we already know the default port; route
            // through the port-forwarding machinery so the fallback shows up in the strip just like
            // a stdout-detected URL would.
            if (spawnPlan.targetPort) {
                ctx.scheduleDevPreviewFallback(runId, spawnPlan.targetPort);
            }
        } catch (e) {
            if (runId !== ctx.devRunGeneration) {
                return;
            }
            const raw = e instanceof Error ? e.message : String(e);
            await ctx.failDevRun(ctx.toUserFacingDevError(raw), plan, runId);
        }
}

export function cancelActivePreviewLaunchExtracted(ctx: any): void {
        ctx.devRunCancelledByUser = true;
        ctx.devRunGeneration++;
        ctx.installGeneration++;
        ctx.releaseActivePreview();
        ctx.cancelDevPreviewFallbacks();
        ctx.cancelDevPreviewHealthMonitor();
        ctx.cleanupDevTerminal();
        ctx.disposeBootstrapTerminal(ctx.installTerminal);
        ctx.installTerminal = undefined;
        ctx.devTerminalConversationId = undefined;
        ctx._previewUrl = undefined;
        ctx._error = undefined;
        ctx._needsInstall = false;
        if (ctx._phase === 'installing' || ctx._phase === 'starting' || ctx._phase === 'running') {
            ctx.setPhase(ctx._descriptor?.nodeModulesPresent ? 'ready-to-run' : 'detected');
        }
}

export function skipExtracted(ctx: any): void {
        if (ctx._descriptor) {
            ctx.persistPhase('dismissed');
        }
        ctx.setPhase('dismissed');
}

export function resetExtracted(ctx: any): void {
        ctx.hubPinnedWorkspaceRoot = undefined;
        if (ctx._descriptor) {
            ctx.persistPhase(ctx._descriptor.nodeModulesPresent ? 'ready-to-run' : 'detected');
        }
        void ctx.refreshFromCurrentWorkspace();
}

export async function focusPreviewExtracted(ctx: any): Promise<void> {
        const rememberedPort = ctx._previewUrl ? ctx.extractPort(ctx._previewUrl) : ctx._lastPort;
        if (rememberedPort !== undefined && !isReservedIdePort(rememberedPort)) {
            // The probe endpoint fails closed on unclaimed ports (SEC-8) — re-claim before probing
            // so a backend restart or an expired claim does not lock the owner out of their preview.
            await ctx.claimDevPreviewPort(rememberedPort);
            // The claim may resolve to a different allocated port than the remembered one (stale
            // localStorage, inline PORT=… in the dev script) — probe the authoritative target.
            const target = ctx.resolvePrimaryPreviewTarget(rememberedPort, '');
            const probe = await probeQaapDevPreviewPort(target.port);
            if (probe.ready) {
                await ctx.openPreview(target.url || probe.previewUrl);
                return;
            }
        }
        if (await ctx.tryAttachToExistingServer(ctx.collectProbePorts())) {
            return;
        }
        if (ctx.resolveDevPlan() && (ctx._phase === 'ready-to-run' || ctx._phase === 'run-failed' || ctx._phase === 'running')) {
            await ctx.runDevServer();
            return;
        }
        if (ctx._previewUrl) {
            await ctx.openPreview(ctx._previewUrl);
        }
}

export async function openExistingPreviewExtracted(ctx: any, options?: { auto?: boolean }): Promise<void> {
        // Default (user tap): if a ready URL was staged by the auto-open gate, honor the tap and
        // open it now. Agent/tool callers pass `{ auto: true }` to stage without navigating.
        if (ctx._previewUrl) {
            await ctx.openPreview(ctx._previewUrl, true, options);
            ctx._error = undefined;
            ctx._portConflictDetected = false;
            ctx._portConflictPort = undefined;
            return;
        }
        const plan = ctx.resolveDevPlan();
        // Attach path already uses `{ auto: true }` via recordForwardedPort → openPreview, so it
        // stages when the gate forbids navigation (agent/tool). User taps with a staged URL hit
        // the branch above and navigate via openPreview without auto.
        const attached = await ctx.tryAttachToExistingServer(ctx.collectProbePorts(plan));
        if (attached) {
            ctx._error = undefined;
            ctx._portConflictDetected = false;
            ctx._portConflictPort = undefined;
            ctx.cleanupDevTerminal();
            return;
        }
        ctx._error = 'No dev server responded on the expected port.';
        ctx.setPhase('run-failed');
}

export function scheduleRefreshFromCurrentWorkspaceExtracted(ctx: any): void {
        if (typeof window === 'undefined') {
            void ctx.refreshFromCurrentWorkspace();
            return;
        }
        if (ctx.refreshDebounceTimer !== undefined) {
            window.clearTimeout(ctx.refreshDebounceTimer);
        }
        ctx.refreshDebounceTimer = window.setTimeout(() => {
            ctx.refreshDebounceTimer = undefined;
            void ctx.refreshFromCurrentWorkspace();
        }, 450);
}

export async function refreshFromCurrentWorkspaceExtracted(ctx: any): Promise<void> {
        const roots = await ctx.workspaceService.roots;
        const first = roots[0];
        const pinned = ctx.hubPinnedWorkspaceRoot?.toString();
        if (shouldIgnoreWorkspaceRefreshForHubPin(pinned, first?.resource.toString())) {
            return;
        }
        ctx.activeProjectId = first ? `ws:${first.resource.toString()}` : undefined;
        ctx.activeWorkspaceRoot = first?.resource;
        await ctx.refreshFromRoot(first?.resource);
}

export async function refreshFromRootExtracted(ctx: any, resource: URI | undefined): Promise<void> {
        const nextRootKey = resource?.toString() ?? '';
        const currentRootKey = ctx._descriptor?.rootUri.toString() ?? '';
        if (
            (ctx._phase === 'installing' || ctx._phase === 'starting')
            && nextRootKey.length > 0
            && nextRootKey === currentRootKey
        ) {
            return;
        }
        ctx.resetBootstrapSessionForWorkspace();
        ctx.clearForwardedPorts();
        if (!resource) {
            ctx._descriptor = undefined;
            ctx._previewUrl = undefined;
            ctx._selectedApp = undefined;
            ctx.setPhase('idle');
            return;
        }
        const descriptor = await ctx.detector.detect(resource);
        ctx._descriptor = descriptor;
        ctx._previewUrl = undefined;
        ctx._error = undefined;
        ctx._selectedApp = undefined;
        ctx._lastPort = undefined;
        ctx._portConflictDetected = false;
        ctx._portConflictPort = undefined;
        if (!descriptor) {
            ctx._missingDescriptorHint = await ctx.getMissingDescriptorHint(resource);
            ctx.setPhase('idle');
            return;
        }
        ctx._missingDescriptorHint = undefined;
        const persisted = ctx.readPersisted(descriptor.rootUri.toString());
        // Restore the previously selected monorepo app when it still exists; this avoids the user
        // having to repick after a reload.
        if (persisted?.selectedAppPath) {
            ctx._selectedApp = descriptor.apps.find(app => app.relativePath === persisted.selectedAppPath);
        }
        if (persisted?.lastPort !== undefined) {
            ctx._lastPort = isReservedIdePort(persisted.lastPort)
                ? undefined
                : persisted.lastPort;
        }
        if (!ctx._selectedApp && descriptor.apps.length === 1) {
            // Only one runnable app — pick it implicitly so the user gets one-tap "Run & Preview".
            ctx._selectedApp = descriptor.apps[0];
        }
        if (persisted && persisted.name === descriptor.name) {
            // Transient phases (`running`, `starting`, `installing`) are not real after a reload:
            // the spawned terminal is gone, the dev URL no longer responds, and the user is back
            // at "ready to launch". Downgrade them so the banner reappears with a `Run & Preview`
            // (or `Install`) action instead of silently restoring a dead `running` state.
            const restored = normalizePersistedBootstrapPhase(persisted.phase, descriptor.nodeModulesPresent);
            ctx.setPhase(restored);
            ctx.scheduleDevPreviewWarmup();
            return;
        }
        ctx.setPhase(descriptor.nodeModulesPresent ? 'ready-to-run' : 'detected');
        ctx.scheduleDevPreviewWarmup();
}

