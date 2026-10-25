import type { QaapProjectBootstrapServiceContext } from './qaap-project-bootstrap-service-context';
// Extracted from qaap-project-bootstrap-service.ts

import type { PersistedEntry, QaapBootstrapStateChange } from './qaap-project-bootstrap-service';
import { Disposable } from '@theia/core/lib/common/disposable';
import type URI from '@theia/core/lib/common/uri';
import { isQaapWorkspaceRefreshReplayPhase } from '../common/qaap-project-bootstrap-phase';
import { nls } from '@theia/core/lib/common/nls';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import {
    QaapBootstrapPhase,
    QaapMonorepoAppCandidate,
} from './qaap-project-bootstrap-types';
import {
    probeQaapDevPreviewPort,
} from './qaap-dev-preview-client';
import {
    diagnoseBootstrapFailure,
    extractDevOutputProbePorts,
    terminalOutputNextDevLock,
} from './qaap-project-bootstrap-dev-errors';
import {
    normalizeQaapPreviewConversationId,
    QAAP_DEFAULT_PREVIEW_CONVERSATION_ID,
} from '../common/qaap-preview-identity';
import { DEV_PREVIEW_HEALTH_FAILURE_LIMIT, DEV_PREVIEW_HEALTH_INTERVAL_MS, DEV_PREVIEW_WARMUP_DELAY_MS, PORT_IN_USE_REGEX, STORAGE_KEY } from './qaap-project-bootstrap-service';

export function waitForExitExtracted(ctx: QaapProjectBootstrapServiceContext, terminal: TerminalWidget): Promise<number | undefined> {
        return new Promise(resolve => {
            // Edge case: the process may already be gone by the time we subscribe (very fast
            // commands), so check the synchronous status first.
            if (terminal.exitStatus) {
                resolve(terminal.exitStatus.code);
                return;
            }
            const subscription = ctx.terminalWatcher.onTerminalExit(event => {
                if (event.terminalId === terminal.terminalId) {
                    subscription.dispose();
                    closeSub.dispose();
                    resolve(event.code);
                }
            });
            // Also unblock if the widget is closed before the process emits exit (user clicks X).
            const closeSub = terminal.onTerminalDidClose(() => {
                subscription.dispose();
                closeSub.dispose();
                resolve(terminal.exitStatus?.code);
            });
        });
}

/** Diagnostic line for every path that releases or disposes a running preview (no secrets). */
export function logBootstrapReleaseExtracted(ctx: QaapProjectBootstrapServiceContext, reason: string): void {
        console.info('[qaap-bootstrap] release', {
            reason,
            previewId: ctx.activePreviewClaim?.previewId,
            root: ctx._descriptor?.rootUri.toString(),
            conversationId: ctx.activePreviewConversationId,
        });
}

export function beginDevRunExtracted(ctx: QaapProjectBootstrapServiceContext): void {
        logBootstrapReleaseExtracted(ctx, 'beginDevRun');
        ctx.devRunCancelledByUser = false;
        ctx.devRunGeneration++;
        ctx.releaseActivePreview('beginDevRun');
        ctx.cancelDevPreviewFallbacks();
        if (ctx.devTerminalConversationId === ctx.activePreviewConversationId) {
            ctx.cleanupDevTerminal();
        }
}

export function releaseActivePreviewExtracted(ctx: QaapProjectBootstrapServiceContext, reason: string): void {
        logBootstrapReleaseExtracted(ctx, reason);
        const scope = ctx.activePreviewConversationId;
        const claim = ctx.previewClaimByConversation.get(scope);
        ctx.previewClaimByConversation.delete(scope);
        ctx.activePreviewClaim = undefined;
        if (claim) {
            void ctx.previewPortClaimService.release?.(claim.previewId);
        }
        ctx.activePreviewRunId = ctx.previewRunIdByConversation.get(scope);
}

export function releasePreviewForConversationExtracted(ctx: QaapProjectBootstrapServiceContext, conversationId: string | undefined): void {
        const scope = normalizeQaapPreviewConversationId(conversationId);
        const claim = ctx.previewClaimByConversation.get(scope);
        if (!claim) {
            return;
        }
        ctx.previewClaimByConversation.delete(scope);
        ctx.previewRunIdByConversation.delete(scope);
        if (ctx.activePreviewConversationId === scope) {
            ctx.activePreviewClaim = undefined;
        }
        void ctx.previewPortClaimService.release?.(claim.previewId);
        // Dispose the dev-server terminal if it belongs to this conversation. The terminal is
        // per-section (keyed by devTerminalConversationId), so closing a task must release its
        // terminal without killing another section's dev terminal.
        if (ctx.devTerminalConversationId === scope) {
            ctx.devTerminalListener.dispose();
            ctx.devTerminalListener = Disposable.NULL;
            ctx.disposeBootstrapTerminal(ctx.devTerminal);
            ctx.devTerminal = undefined;
            ctx.devTerminalConversationId = undefined;
        }
        // Also clean up the per-conversation map entry (multi-preview support).
        ctx.releaseDevTerminalForConversation(scope);
}

export function registerDevTerminalForConversationExtracted(ctx: QaapProjectBootstrapServiceContext, conversationId: string | undefined,
        terminal: TerminalWidget,
        listener: Disposable,
        rootKey?: string,): void {
        if (!conversationId) {
            return;
        }
        // Dispose any previous terminal for this conversation before registering the new one.
        const existing = ctx.devTerminalByConversationId.get(conversationId);
        if (existing && existing.terminal !== terminal) {
            existing.listener.dispose();
            ctx.disposeBootstrapTerminal(existing.terminal);
        }
        ctx.devTerminalByConversationId.set(conversationId, { terminal, listener, rootKey });
}

export function releaseDevTerminalForConversationExtracted(ctx: QaapProjectBootstrapServiceContext, conversationId: string): void {
        const entry = ctx.devTerminalByConversationId.get(conversationId);
        if (!entry) {
            return;
        }
        entry.listener.dispose();
        ctx.disposeBootstrapTerminal(entry.terminal);
        ctx.devTerminalByConversationId.delete(conversationId);
}

export function resetBootstrapSessionForWorkspaceExtracted(ctx: QaapProjectBootstrapServiceContext, reason: string, rootKey?: string): void {
        logBootstrapReleaseExtracted(ctx, reason);
        ctx.installGeneration++;
        // A hosted Work Hub switches between many project roots inside one Theia workspace. Only the
        // root being reset loses its dev terminals; other projects' previews keep running (see the
        // scoped disposal below). Disposing them here made every project switch kill a booting server.
        ctx.devRunGeneration++;
        ctx.cancelDevPreviewFallbacks();
        ctx.cancelDevPreviewHealthMonitor();
        ctx.activePreviewClaim = undefined;
        ctx.devPortOverride = undefined;
        ctx.automaticPortRecoveryAttempts = 0;
        ctx.attemptedDevPorts.clear();
        ctx.portRecoveryFrom = undefined;
        ctx.activeDevPortHint = undefined;
        ctx.activePreviewRunId = undefined;
        ctx.activePreviewConversationId = QAAP_DEFAULT_PREVIEW_CONVERSATION_ID;
        // Dispose only the dev terminals started for the root being reset (the workspace root when
        // the caller does not name one). Entries without a known root belong to no reset root.
        const disposedConversationIds = new Set<string>();
        if (rootKey !== undefined) {
            for (const [conversationId, entry] of ctx.devTerminalByConversationId) {
                if (entry.rootKey !== rootKey) {
                    continue;
                }
                entry.listener.dispose();
                ctx.disposeBootstrapTerminal(entry.terminal);
                ctx.devTerminalByConversationId.delete(conversationId);
                disposedConversationIds.add(conversationId);
            }
        }
        // Per-conversation run ids and claims are dropped only for the conversations that were disposed,
        // so another project's preview keeps its process identity and claim.
        for (const conversationId of disposedConversationIds) {
            ctx.previewRunIdByConversation.delete(conversationId);
            ctx.previewClaimByConversation.delete(conversationId);
        }
        // The singular pointer follows the conversation it belongs to: keep it when that terminal is
        // another project's live dev server.
        if (ctx.devTerminalConversationId === undefined || disposedConversationIds.has(ctx.devTerminalConversationId)) {
            ctx.devTerminalListener.dispose();
            ctx.devTerminalListener = Disposable.NULL;
            ctx.devTerminal = undefined;
            ctx.devTerminalConversationId = undefined;
        }
        ctx.disposeBootstrapTerminal(ctx.installTerminal);
        ctx.installTerminal = undefined;
}

export function cancelDevPreviewFallbacksExtracted(ctx: QaapProjectBootstrapServiceContext): void {
        for (const timerId of ctx.devPreviewFallbackTimers) {
            window.clearTimeout(timerId);
        }
        ctx.devPreviewFallbackTimers = [];
        ctx.cancelDevPreviewWarmup();
}

export function scheduleDevPreviewWarmupExtracted(ctx: QaapProjectBootstrapServiceContext): void {
        if (typeof window === 'undefined') {
            return;
        }
        if (ctx._phase !== 'ready-to-run' || ctx._lastPort === undefined || !ctx.resolveDevPlan()) {
            return;
        }
        ctx.cancelDevPreviewWarmup();
        ctx.devPreviewWarmupTimer = window.setTimeout(() => {
            ctx.devPreviewWarmupTimer = undefined;
            void ctx.warmupDevPreview();
        }, DEV_PREVIEW_WARMUP_DELAY_MS);
}

export function cancelDevPreviewWarmupExtracted(ctx: QaapProjectBootstrapServiceContext): void {
        if (typeof window !== 'undefined' && ctx.devPreviewWarmupTimer !== undefined) {
            window.clearTimeout(ctx.devPreviewWarmupTimer);
            ctx.devPreviewWarmupTimer = undefined;
        }
}

export function startDevPreviewHealthMonitorExtracted(ctx: QaapProjectBootstrapServiceContext): void {
        ctx.cancelDevPreviewHealthMonitor();
        if (typeof window === 'undefined') {
            return;
        }
        const runId = ctx.devRunGeneration;
        const check = async (): Promise<void> => {
            ctx.devPreviewHealthTimer = undefined;
            if (ctx._phase !== 'running' || runId !== ctx.devRunGeneration) {
                return;
            }
            const port = ctx.activePreviewClaim?.port ?? ctx._lastPort;
            const plan = ctx.resolveDevPlan();
            if (port === undefined || !plan) {
                return;
            }
            const probe = await probeQaapDevPreviewPort(port);
            if (ctx._phase !== 'running' || runId !== ctx.devRunGeneration) {
                return;
            }
            if (probe.ready && ctx.probeBelongsToActiveProject(probe.projectId)) {
                ctx.devPreviewHealthFailures = 0;
            } else {
                ctx.devPreviewHealthFailures++;
                if (ctx.devPreviewHealthFailures >= DEV_PREVIEW_HEALTH_FAILURE_LIMIT) {
                    await ctx.failDevRun(
                        nls.localize(
                            'qaap/projectBootstrap/devServerUnavailable',
                            'The dev server stopped responding. Retry to start it again.',
                        ),
                        plan,
                        runId,
                    );
                    return;
                }
            }
            ctx.devPreviewHealthTimer = window.setTimeout(() => void check(), DEV_PREVIEW_HEALTH_INTERVAL_MS);
        };
        ctx.devPreviewHealthTimer = window.setTimeout(() => void check(), DEV_PREVIEW_HEALTH_INTERVAL_MS);
}

export function cancelDevPreviewHealthMonitorExtracted(ctx: QaapProjectBootstrapServiceContext): void {
        if (typeof window !== 'undefined' && ctx.devPreviewHealthTimer !== undefined) {
            window.clearTimeout(ctx.devPreviewHealthTimer);
        }
        ctx.devPreviewHealthTimer = undefined;
        ctx.devPreviewHealthFailures = 0;
}

export async function warmupDevPreviewExtracted(ctx: QaapProjectBootstrapServiceContext): Promise<void> {
        if (ctx._phase !== 'ready-to-run' || ctx._previewUrl || ctx._lastPort === undefined) {
            return;
        }
        await ctx.reconcileRestoredPreviewTerminals();
        if (await ctx.tryAttachToExistingServer([ctx._lastPort])) {
            return;
        }
        if (ctx.resolveDevPlan()) {
            await ctx.runDevServer();
        }
}

export function cleanupDevTerminalExtracted(ctx: QaapProjectBootstrapServiceContext): void {
        ctx.devTerminalListener.dispose();
        ctx.devTerminalListener = Disposable.NULL;
        ctx.disposeBootstrapTerminal(ctx.devTerminal);
        ctx.devTerminal = undefined;
        // Clean up the active conversation's entry from the per-conversation map.
        if (ctx.devTerminalConversationId) {
            ctx.devTerminalByConversationId.delete(ctx.devTerminalConversationId);
        }
        ctx.devTerminalConversationId = undefined;
}

export function clearForwardedPortsExtracted(ctx: QaapProjectBootstrapServiceContext): void {
        if (ctx._forwardedPorts.length === 0) {
            return;
        }
        ctx._forwardedPorts = [];
        ctx.forwardedPortsEmitter.fire([]);
}

export function buildStateChangeExtracted(ctx: QaapProjectBootstrapServiceContext, phase: QaapBootstrapPhase): QaapBootstrapStateChange {
        const portInUse = phase === 'run-failed'
            && (ctx._portConflictDetected
                || PORT_IN_USE_REGEX.test(ctx._error ?? '')
                || terminalOutputNextDevLock(ctx.devOutputTail));
        const existingServerPort = ctx._portConflictPort
            ?? extractDevOutputProbePorts(ctx.devOutputTail)[0]
            ?? ctx._lastPort;
        const failure = phase === 'install-failed' || phase === 'run-failed'
            ? diagnoseBootstrapFailure(ctx.devOutputTail || ctx._error || '', ctx._error ?? 'Dev server failed')
            : undefined;
        return {
            phase,
            descriptor: ctx._descriptor,
            previewReadiness: ctx._previewReadiness,
            previewLogTail: ctx.devOutputTail ? ctx.devOutputTail.slice(-2400) : undefined,
            previewWaitTimedOut: ctx._previewWaitTimedOut || undefined,
            previewUrl: ctx._previewUrl,
            error: ctx._error,
            needsInstall: ctx._needsInstall || undefined,
            selectedApp: ctx._selectedApp,
            lastPort: ctx._lastPort,
            portInUse: portInUse || undefined,
            existingServerPort: portInUse ? existingServerPort : undefined,
            failureKind: terminalOutputNextDevLock(ctx.devOutputTail)
                ? 'next-lock'
                : portInUse ? 'port-conflict' : failure?.kind,
            activePort: ctx.activeDevPortHint,
            previewRunId: ctx.activePreviewRunId,
            portRecoveryFrom: ctx.portRecoveryFrom,
            missingDescriptorHint: ctx._missingDescriptorHint,
        };
}

export function setPhaseExtracted(ctx: QaapProjectBootstrapServiceContext, phase: QaapBootstrapPhase): void {
        const previousPhase = ctx._phase;
        ctx._phase = phase;
        if (phase === 'running') {
            ctx._previewReadiness = 'transport-ready';
            ctx._previewWaitTimedOut = false;
        } else if (phase === 'run-failed') {
            ctx._previewReadiness = 'failed';
        }
        if (phase === 'running') {
            // Several preview surfaces can report the same ready URL concurrently. Do not keep
            // postponing the health check every time a duplicate `running` state is published.
            if (previousPhase !== 'running') {
                ctx.startDevPreviewHealthMonitor();
            }
        } else {
            ctx.cancelDevPreviewHealthMonitor();
        }
        ctx.stateEmitter.fire(ctx.buildStateChange(phase));
        ctx.syncHubSession(phase);
        if (ctx.deferredWorkspaceRefresh && isQaapWorkspaceRefreshReplayPhase(phase)) {
            scheduleDeferredWorkspaceRefreshReplayExtracted(ctx);
        }
}

/** Delay before a deferred workspace refresh replays; matches the workspace refresh debounce. */
export const DEFERRED_WORKSPACE_REFRESH_REPLAY_DELAY_MS = 450;

/**
 * Postpones a refresh of `root` that a dev run/install blocked. While the run is busy or failed it
 * stays pending; `setPhase` schedules the replay on the next rest phase.
 */
export function deferWorkspaceRefreshUntilDevRunRestsExtracted(ctx: QaapProjectBootstrapServiceContext, root: URI): void {
        const pinned = ctx.hubPinnedWorkspaceRoot?.toString() === root.toString();
        ctx.deferredWorkspaceRefresh = { root, projectId: pinned ? ctx.activeProjectId : undefined };
        if (isQaapWorkspaceRefreshReplayPhase(ctx._phase)) {
            scheduleDeferredWorkspaceRefreshReplayExtracted(ctx);
        }
}

/**
 * Never replays in the tick that reached the rest phase: `ready-to-run` after an install is followed
 * at once by the chained `runDevServer()`, and a refresh there would reset the session under it.
 */
export function scheduleDeferredWorkspaceRefreshReplayExtracted(ctx: QaapProjectBootstrapServiceContext): void {
        if (ctx.deferredWorkspaceRefreshTimer !== undefined) {
            clearTimeout(ctx.deferredWorkspaceRefreshTimer);
        }
        ctx.deferredWorkspaceRefreshTimer = setTimeout(() => {
            ctx.deferredWorkspaceRefreshTimer = undefined;
            replayDeferredWorkspaceRefreshExtracted(ctx);
        }, DEFERRED_WORKSPACE_REFRESH_REPLAY_DELAY_MS);
}

export function replayDeferredWorkspaceRefreshExtracted(ctx: QaapProjectBootstrapServiceContext): void {
        const deferred = ctx.deferredWorkspaceRefresh;
        if (!deferred || !isQaapWorkspaceRefreshReplayPhase(ctx._phase)) {
            // A run started (or failed) again meanwhile; the next rest phase schedules the replay.
            return;
        }
        ctx.deferredWorkspaceRefresh = undefined;
        if (deferred.projectId !== undefined && ctx.hubPinnedWorkspaceRoot?.toString() === deferred.root.toString()) {
            // A plain workspace refresh is ignored while Work Hub pins a clone; replay the pin itself.
            void ctx.refreshFromProjectRoot(deferred.root, deferred.projectId);
            return;
        }
        void ctx.refreshFromCurrentWorkspace();
}

export function syncHubSessionExtracted(ctx: QaapProjectBootstrapServiceContext, phase: QaapBootstrapPhase): void {
        const agentState = phase === 'running' ? 'working'
            : phase === 'install-failed' || phase === 'run-failed' ? 'review'
                : phase === 'idle' || phase === 'dismissed' ? 'idle'
                    : 'working';
        void ctx.hubProjects.recordProjectSession({
            repoKey: ctx.activeProjectId,
            bootstrapPhase: phase,
            previewUrl: ctx._previewUrl,
            agentState,
            lastTask: phase === 'running'
                ? 'Dev preview running'
                : phase === 'installing'
                    ? 'Installing dependencies…'
                    : phase === 'starting'
                        ? 'Starting dev server…'
                        : undefined,
        }).catch(() => undefined);
}

export function persistPhaseExtracted(ctx: QaapProjectBootstrapServiceContext, phase: QaapBootstrapPhase, selectedApp?: QaapMonorepoAppCandidate): void {
        const descriptor = ctx._descriptor;
        if (!descriptor || typeof localStorage === 'undefined') {
            return;
        }
        const all = ctx.readAllPersisted();
        const next: PersistedEntry = {
            root: descriptor.rootUri.toString(),
            phase,
            name: descriptor.name,
            selectedAppPath: (selectedApp ?? ctx._selectedApp)?.relativePath,
            lastPort: ctx._lastPort,
        };
        all[next.root] = next;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
        } catch {
            /* quota exceeded — non-fatal */
        }
}

export function readAllPersistedExtracted(ctx: QaapProjectBootstrapServiceContext): Record<string, PersistedEntry> {
        if (typeof localStorage === 'undefined') {
            return {};
        }
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return {};
            }
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
}

