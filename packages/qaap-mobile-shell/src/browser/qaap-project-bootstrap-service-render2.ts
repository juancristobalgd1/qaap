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
    resolvePreviewClaimWorkspaceRoot,
    normalizeDevUrl as normalizeDevUrlHelper,
    extractPortFromInUseMessage as extractPortFromInUseMessageHelper,
    normalizeRestoredPhase as normalizeRestoredPhaseHelper,
    readTerminalTail as readTerminalTailHelper,
    disposeBootstrapTerminal as disposeBootstrapTerminalHelper,
    delay as delayHelper,
} from './qaap-project-bootstrap-helpers';
import { RESTORED_PREVIEW_TERMINAL_STOP_DELAY_MS } from './qaap-project-bootstrap-service';

export function initExtracted(ctx: any): void {
        ctx.toDispose.push(ctx.workspaceService.onWorkspaceChanged(() => {
            ctx.scheduleRefreshFromCurrentWorkspace();
        }));
        ctx.toDispose.push(ctx.workspaceService.onWorkspaceLocationChanged(() => {
            ctx.scheduleRefreshFromCurrentWorkspace();
        }));
        ctx.toDispose.push(Disposable.create(() => {
            if (typeof window !== 'undefined' && ctx.refreshDebounceTimer !== undefined) {
                window.clearTimeout(ctx.refreshDebounceTimer);
            }
            ctx.cancelDevPreviewHealthMonitor();
        }));
        // Debug surface (used by integration tests and power users). Exposes the bare minimum to
        // simulate dev-server output and inspect state without hand-injecting through Inversify.
        if (typeof window !== 'undefined') {
            (window as unknown as { __qaapBootstrap?: object }).__qaapBootstrap = {
                getState: () => ({
                    phase: ctx._phase,
                    descriptor: ctx._descriptor?.name,
                    selectedApp: ctx._selectedApp?.relativePath,
                    scaffoldRelativePath: ctx._descriptor?.scaffoldRelativePath,
                    previewUrl: ctx._previewUrl,
                    forwardedPorts: ctx._forwardedPorts,
                    nodeModulesPresent: ctx._descriptor?.nodeModulesPresent,
                    needsInstall: ctx._needsInstall,
                }),
                refresh: () => ctx.refreshFromCurrentWorkspace(),
                runDevServer: () => ctx.runDevServer(),
                runInstall: () => ctx.runInstall(),
                feed: (chunk: string) => ctx.scanForDevUrl(chunk),
                setRunning: () => ctx.setPhase('running'),
                clearPorts: () => ctx.clearForwardedPorts(),
                // Integration test helper: spawns an arbitrary command and resolves with
                // `{ code, elapsedMs }` once `waitForExit` returns. Use to validate the new
                // exit-detection path without waiting for a real `npm install`.
                probeExit: async (command: string) => {
                    const t0 = Date.now();
                    const terminal = await ctx.spawnCommand({
                        title: 'qaap-probe',
                        command,
                        cwd: URI.fromFilePath('/tmp'),
                    });
                    const code = await ctx.waitForExit(terminal);
                    return { code, elapsedMs: Date.now() - t0 };
                },
            };
        }
}

export function bindPreviewConversationExtracted(ctx: any, conversationId?: string): string {
        ctx.activePreviewConversationId = normalizeQaapPreviewConversationId(conversationId);
        const remembered = ctx.previewRunIdByConversation.get(ctx.activePreviewConversationId);
        if (remembered) {
            ctx.activePreviewRunId = remembered;
        }
        // Restore this section's claim into the active slot without touching other sections.
        ctx.activePreviewClaim = ctx.previewClaimByConversation.get(ctx.activePreviewConversationId);
        return ctx.activePreviewConversationId;
}

export function rememberActivePreviewClaimExtracted(ctx: any, claim: {
        readonly previewId: string;
        readonly previewUrl: string;
        readonly port: number;
    }): void {
        ctx.activePreviewClaim = claim;
        ctx.previewClaimByConversation.set(ctx.activePreviewConversationId, claim);
}

export function ensurePreviewProcessIdForConversationExtracted(ctx: any, conversationId?: string): string {
        const scope = ctx.bindPreviewConversation(conversationId);
        let processId = ctx.previewRunIdByConversation.get(scope);
        if (!processId) {
            processId = generateUuid();
            ctx.previewRunIdByConversation.set(scope, processId);
        }
        ctx.activePreviewRunId = processId;
        return processId;
}

export async function claimPreviewExecutionExtracted(ctx: any, port: number, conversationId?: string): Promise<QaapPreviewPortClaimResult> {
        ctx.bindPreviewConversation(conversationId);
        ctx.ensurePreviewProcessIdForConversation(conversationId);
        const processRoot = ctx._descriptor?.rootUri ?? ctx.activeWorkspaceRoot;
        if (!ctx.activePreviewRunId || !processRoot) {
            return { kind: 'error' };
        }
        const claim = await ctx.reserveActivePreview(port, processRoot);
        if (claim.kind === 'claimed' && claim.previewId && claim.previewUrl && claim.port !== undefined) {
            ctx.rememberActivePreviewClaim({
                previewId: claim.previewId,
                previewUrl: claim.previewUrl,
                port: claim.port,
            });
        }
        return claim;
}

export function adoptSupersedingPreviewClaimExtracted(ctx: any, current: QaapDevPreviewProbeResponse): boolean {
        if (!current.previewId || !current.previewUrl || current.port === undefined) {
            return false;
        }
        if (ctx.activePreviewClaim?.previewId === current.previewId
            && ctx.activePreviewClaim.previewUrl === current.previewUrl) {
            return false;
        }
        // Same guard as reattach: never adopt a claim that names a different project.
        if (!ctx.probeBelongsToActiveProject(current.projectId)) {
            return false;
        }
        if (current.processId) {
            ctx.activePreviewRunId = current.processId;
            ctx.previewRunIdByConversation.set(ctx.activePreviewConversationId, current.processId);
        }
        ctx.rememberActivePreviewClaim({
            previewId: current.previewId,
            previewUrl: current.previewUrl,
            port: current.port,
        });
        ctx._lastPort = current.port;
        if (ctx._previewUrl) {
            // Only replace an already-published URL; first publication stays with the run flow.
            ctx._previewUrl = current.previewUrl;
        }
        ctx.stateEmitter.fire(ctx.buildStateChange(ctx._phase));
        if (ctx.activeProjectId) {
            void ctx.hubProjects.recordProjectSession({
                repoKey: ctx.activeProjectId,
                previewUrl: current.previewUrl,
            }).catch(() => undefined);
        }
        return true;
}

export async function reconcileSupersededPreviewClaimExtracted(ctx: any): Promise<boolean> {
        const workspaceRoot = ctx.activeWorkspaceRoot ?? ctx._descriptor?.rootUri;
        if (!workspaceRoot) {
            return false;
        }
        // Scope to this session's section so it never adopts another section's live claim.
        const current = await fetchQaapCurrentDevPreview([
            ctx.previewProjectId(workspaceRoot),
            ctx.activeProjectId,
        ], ctx.activePreviewConversationId);
        if (!current?.ready) {
            return false;
        }
        return ctx.adoptSupersedingPreviewClaim(current);
}

export async function refreshFromProjectRootExtracted(ctx: any, root: string | URI, projectId: string): Promise<void> {
        const resource = typeof root === 'string'
            ? (root.startsWith('file:') ? new URI(root) : URI.fromFilePath(root))
            : root;
        ctx.activeProjectId = projectId.startsWith('/') || projectId.startsWith('file:')
            ? `ws:${resource.toString()}`
            : projectId;
        ctx.activeWorkspaceRoot = resource;
        ctx.hubPinnedWorkspaceRoot = resource;
        await ctx.refreshFromRoot(resource);
}

export function getBootstrapFailureDetailExtracted(ctx: any): { terminalFailure: string; terminalTail?: string } | undefined {
        const phase = ctx._phase;
        if (phase !== 'install-failed' && phase !== 'run-failed') {
            return undefined;
        }
        const terminal = phase === 'install-failed' ? ctx.installTerminal : ctx.devTerminal;
        const tail = terminal && !terminal.isDisposed
            ? ctx.readTerminalTail(terminal, 80)
            : ctx.devOutputTail;
        const fallback = ctx._error ?? (phase === 'install-failed' ? 'Install failed' : 'Dev server failed');
        return {
            terminalFailure: extractTerminalFailureLine(tail, fallback),
            terminalTail: tail.length > 0 ? tail.slice(-1500) : undefined,
        };
}

export function resolveDevPlanExtracted(ctx: any): { command: string; cwd: URI; expectedPort?: number; kind: QaapProjectKind } | undefined {
        const descriptor = ctx._descriptor;
        if (!descriptor) {
            return undefined;
        }
        const app = ctx._selectedApp ?? (descriptor.apps.length === 1 ? descriptor.apps[0] : undefined);
        const plan = resolveBootstrapDevTarget(
            {
                rootKey: descriptor.rootUri.toString(),
                devCommand: descriptor.devCommand,
                installCommand: descriptor.installCommand,
                packageManager: descriptor.packageManager,
                expectedPort: descriptor.expectedPort,
                kind: descriptor.kind,
            },
            app ? {
                rootKey: app.rootUri.toString(),
                devCommand: app.devCommand,
                expectedPort: app.expectedPort,
                kind: app.kind,
            } : undefined,
            undefined,
        );
        if (!plan) {
            return undefined;
        }
        return {
            command: plan.command,
            cwd: descriptor.previewRootUri ?? new URI(plan.cwdKey),
            expectedPort: plan.expectedPort,
            kind: plan.kind as QaapProjectKind,
        };
}

export function resolveInstallPlanExtracted(ctx: any): { command: string; cwd: URI } | undefined {
        const descriptor = ctx._descriptor;
        if (!descriptor) {
            return undefined;
        }
        const fallbackApp = descriptor.apps.length === 1 ? descriptor.apps[0] : undefined;
        const plan = resolveBootstrapInstallTarget(
            {
                rootKey: descriptor.rootUri.toString(),
                devCommand: descriptor.devCommand,
                installCommand: descriptor.installCommand,
            },
            ctx._selectedApp ? {
                rootKey: ctx._selectedApp.rootUri.toString(),
                devCommand: ctx._selectedApp.devCommand,
            } : undefined,
            fallbackApp ? {
                rootKey: fallbackApp.rootUri.toString(),
                devCommand: fallbackApp.devCommand,
            } : undefined,
        );
        return { command: plan.command, cwd: new URI(plan.cwdKey) };
}

export async function describeRunnableAppExtracted(ctx: any, root: URI): Promise<{ runnable: boolean; hint?: string }> {
        const descriptor = await ctx.detector.detect(root);
        if (descriptor) {
            return { runnable: true };
        }
        return { runnable: false, hint: await ctx.getMissingDescriptorHint(root) };
}

export async function getMissingDescriptorHintExtracted(ctx: any, explicitRoot?: URI): Promise<string | undefined> {
        const roots = explicitRoot ? undefined : await ctx.workspaceService.roots;
        const workspaceRoot = explicitRoot ?? roots?.[0]?.resource;
        if (!workspaceRoot) {
            return undefined;
        }
        const candidates = await ctx.detector.listScaffoldSubfolderCandidates(workspaceRoot);
        return ctx.detector.formatMissingProjectHint(candidates.map(app => app.relativePath));
}

export function buildDevSpawnPlanExtracted(ctx: any, plan: {
        command: string;
        expectedPort?: number;
        kind: QaapProjectKind;
    }): { command: string; targetPort?: number } {
        const idePort = getQaapIdeListenPort();
        const frameworkPort = plan.expectedPort ?? getImplicitDevPort(plan.kind);
        const targetPort = ctx.devPortOverride ?? resolveBootstrapDevPort(frameworkPort, idePort);
        if (targetPort === undefined) {
            return { command: wrapCommandForDevNodeEnv(plan.command), targetPort: undefined };
        }
        return {
            command: wrapDevCommandForPort(plan.command, targetPort, plan.kind),
            targetPort,
        };
}

export function reserveActivePreviewExtracted(ctx: any, port: number, cwd: URI, osProcessId?: number): Promise<QaapPreviewPortClaimResult> {
        const processId = ctx.activePreviewRunId;
        const workspaceRoot = resolvePreviewClaimWorkspaceRoot(ctx, cwd);
        if (!processId || !workspaceRoot) {
            return Promise.resolve({ kind: 'error' });
        }
        return ctx.previewPortClaimService.claim(port, {
            workspaceId: workspaceRoot.toString(),
            projectId: ctx.previewProjectId(workspaceRoot),
            processId,
            root: workspaceRoot.toString(),
            conversationId: ctx.activePreviewConversationId,
            osProcessId,
        });
}

export function selectMonorepoAppExtracted(ctx: any, candidate: QaapMonorepoAppCandidate | undefined,
        options?: { readonly conversationId?: string },): Promise<void> {
        const descriptor = ctx._descriptor;
        // A single runnable app has no meaningful app switch. Keep its normal preview untouched.
        if (!descriptor || descriptor.apps.length <= 1) {
            return Promise.resolve();
        }
        const candidatePath = candidate?.relativePath;
        if (candidatePath === ctx._selectedApp?.relativePath) {
            return Promise.resolve();
        }
        if (candidatePath === ctx.pendingMonorepoAppPath && ctx.monorepoAppSwitchPromise) {
            return ctx.monorepoAppSwitchPromise;
        }

        const switchGeneration = ++ctx.monorepoAppSwitchGeneration;
        ctx.pendingMonorepoAppPath = candidatePath;
        const switching = ctx.switchMonorepoApp(candidate, descriptor, switchGeneration, options)
            .catch(error => {
                if (switchGeneration !== ctx.monorepoAppSwitchGeneration) {
                    return;
                }
                ctx._error = ctx.toUserFacingDevError(error instanceof Error ? error.message : String(error));
                ctx.setPhase('run-failed');
            })
            .finally(() => {
                if (switchGeneration === ctx.monorepoAppSwitchGeneration) {
                    ctx.pendingMonorepoAppPath = undefined;
                    ctx.monorepoAppSwitchPromise = undefined;
                }
            });
        ctx.monorepoAppSwitchPromise = switching;
        return switching;
}

export async function switchMonorepoAppExtracted(ctx: any, candidate: QaapMonorepoAppCandidate | undefined,
        descriptor: QaapProjectDescriptor,
        switchGeneration: number,
        options?: { readonly conversationId?: string },): Promise<void> {
        await switchQaapMonorepoPreviewApp({
            appCount: descriptor.apps.length,
            currentAppPath: ctx._selectedApp?.relativePath,
            nextApp: candidate,
            nextAppPath: candidate?.relativePath,
            previewIsActive: ctx._phase === 'starting' || ctx._phase === 'running',
            stopActivePreview: () => ctx.stopManagedDevServerForAppSwitch(),
            isCurrent: () => switchGeneration === ctx.monorepoAppSwitchGeneration,
            applySelection: nextApp => {
                ctx._selectedApp = nextApp;
                ctx._previewUrl = undefined;
                ctx._lastPort = undefined;
                ctx.activeDevPortHint = undefined;
                ctx._portConflictDetected = false;
                ctx._portConflictPort = undefined;
                ctx._error = undefined;
                ctx.clearForwardedPorts();
                if (nextApp) {
                    ctx.persistPhase(descriptor.nodeModulesPresent ? 'ready-to-run' : 'detected', nextApp);
                }
            },
            launchSelectedPreview: async () => {
                if (!candidate || !descriptor.nodeModulesPresent) {
                    ctx.setPhase(descriptor.nodeModulesPresent ? 'ready-to-run' : 'detected');
                    return;
                }
                // Publish the new selection as a transition, never as a false `running` state.
                // The launch path immediately creates a fresh process id and claim for this app.
                ctx.setPhase('starting');
                await ctx.runDevServer(options);
            },
        });
}

export async function stopManagedDevServerForAppSwitchExtracted(ctx: any): Promise<void> {
        ctx.devRunGeneration++;
        ctx.releaseActivePreview();
        // The replacement is a different app process, not a reattachment. Give it a new process
        // identity so a delayed probe/claim from the stopped app cannot be adopted as the new one.
        ctx.previewRunIdByConversation.delete(ctx.activePreviewConversationId);
        ctx.activePreviewRunId = undefined;
        ctx.cancelDevPreviewFallbacks();
        ctx.cancelDevPreviewHealthMonitor();
        const terminal = ctx.devTerminal;
        ctx.devTerminalListener.dispose();
        ctx.devTerminalListener = Disposable.NULL;
        ctx.devTerminal = undefined;
        ctx.devTerminalConversationId = undefined;
        if (terminal && !terminal.isDisposed) {
            ctx.disposeBootstrapTerminal(terminal);
            await ctx.delay(RESTORED_PREVIEW_TERMINAL_STOP_DELAY_MS);
        }
}

