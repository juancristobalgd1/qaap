// @ts-nocheck
// Extracted from qaap-project-bootstrap-service.ts

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { generateUuid } from '@theia/core/lib/common/uuid';
import { nls } from '@theia/core/lib/common/nls';
import URI from '@theia/core/lib/common/uri';
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
import { buildQaapManagedShellInvocation, resolveWorkspaceHostFsPath } from './qaap-project-bootstrap-shell';
import {
    previewProjectId as previewProjectIdHelper,
    normalizeDevUrl as normalizeDevUrlHelper,
    extractPortFromInUseMessage as extractPortFromInUseMessageHelper,
    normalizeRestoredPhase as normalizeRestoredPhaseHelper,
    readTerminalTail as readTerminalTailHelper,
    disposeBootstrapTerminal as disposeBootstrapTerminalHelper,
    delay as delayHelper,
} from './qaap-project-bootstrap-helpers';
import { DEV_PORT_RECOVERY_MAX_ATTEMPTS, PORT_IN_USE_REGEX, RESTORED_PREVIEW_TERMINAL_STOP_DELAY_MS, TERMINAL_READY_DELAY_MS, TERMINAL_SPAWN_MAX_ATTEMPTS, TERMINAL_SPAWN_RETRY_DELAY_MS } from './qaap-project-bootstrap-service';

export async function failDevRunExtracted(ctx: any, message: string,
        plan: { command: string; cwd: URI; expectedPort?: number; kind: QaapProjectKind },
        runId: number,): Promise<void> {
        if (runId !== ctx.devRunGeneration || ctx.devRunCancelledByUser) {
            return;
        }
        if (ctx._phase !== 'starting' && ctx._phase !== 'running') {
            return;
        }
        // A previously opened iframe is not proof that its process is still alive. Continue through
        // the ownership-scoped probe and failure path so closed/crashed servers release their
        // durable registration instead of leaving a stale "running" preview behind.
        ctx._previewUrl = undefined;
        const nextLock = terminalOutputNextDevLock(ctx.devOutputTail);
        const portConflict = ctx._portConflictDetected || PORT_IN_USE_REGEX.test(message) || nextLock;
        const conflictPort = ctx._portConflictPort
            ?? extractDevOutputProbePorts(ctx.devOutputTail)[0]
            ?? ctx.activeDevPortHint
            ?? plan.expectedPort;
        if (!portConflict) {
            const attached = await ctx.tryAttachToExistingServer(ctx.collectProbePorts(plan));
            if (runId !== ctx.devRunGeneration || ctx.devRunCancelledByUser) {
                return;
            }
            if (attached || ctx._previewUrl) {
                ctx._error = undefined;
                ctx._portConflictDetected = false;
                ctx.cleanupDevTerminal();
                return;
            }
        }
        const descriptor = ctx._descriptor;
        if (portConflict && conflictPort !== undefined && descriptor && !nextLock
            && ctx.automaticPortRecoveryAttempts < DEV_PORT_RECOVERY_MAX_ATTEMPTS) {
            const alternatePort = pickNextDevPort(conflictPort, [...ctx.attemptedDevPorts]);
            if (alternatePort !== undefined) {
                ctx.automaticPortRecoveryAttempts++;
                ctx.portRecoveryFrom = conflictPort;
                ctx.devPortOverride = alternatePort;
                ctx.cleanupDevTerminal();
                // startDevServer transitions to `starting` immediately; assigning directly avoids
                // flashing a misleading ready-to-run banner between the two attempts.
                ctx._phase = 'ready-to-run';
                await ctx.startDevServer({ ...plan }, descriptor);
                return;
            }
        }
        if (runId !== ctx.devRunGeneration || ctx.devRunCancelledByUser) {
            return;
        }
        ctx._needsInstall = terminalOutputNeedsInstall(ctx.devOutputTail);
        const diagnosedError = nextLock
            ? extractTerminalFailureLine(ctx.devOutputTail, ctx.toUserFacingDevError(message))
            : portConflict && conflictPort
                ? `Port :${conflictPort} is already in use. Qaap exhausted ${DEV_PORT_RECOVERY_MAX_ATTEMPTS} alternate ports; stop stale dev servers, then retry.`
                : extractTerminalFailureLine(ctx.devOutputTail, ctx.toUserFacingDevError(message));
        ctx._error = ctx.enrichDevRunError(diagnosedError);
        ctx.releaseActivePreview();
        ctx.setPhase('run-failed');
}

export async function spawnCommandWithRetryExtracted(ctx: any, options: {
        title: string;
        command: string;
        cwd: URI;
        reveal?: boolean;
    }): Promise<TerminalWidget> {
        let lastError: unknown;
        for (let attempt = 0; attempt < TERMINAL_SPAWN_MAX_ATTEMPTS; attempt++) {
            if (attempt > 0) {
                await ctx.delay(TERMINAL_SPAWN_RETRY_DELAY_MS * attempt);
            }
            try {
                const terminal = await ctx.spawnCommand(options);
                await ctx.delay(TERMINAL_READY_DELAY_MS);
                return terminal;
            } catch (e) {
                lastError = e;
                const message = e instanceof Error ? e.message : String(e);
                if (!isTerminalDoesNotExistError(message)) {
                    throw e;
                }
            }
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function refreshDescriptorAfterInstallExtracted(ctx: any): Promise<void> {
        const roots = ctx.activeWorkspaceRoot ? undefined : await ctx.workspaceService.roots;
        const root = ctx.activeWorkspaceRoot ?? ctx._descriptor?.rootUri ?? roots?.[0]?.resource;
        if (!root) {
            return;
        }
        const descriptor = await ctx.detector.detect(root);
        if (descriptor) {
            ctx._descriptor = descriptor;
        }
}

export function previewWidgetKeyExtracted(ctx: any): QaapPreviewWidgetKey | undefined {
        const workspaceRoot = ctx.activeWorkspaceRoot ?? ctx._descriptor?.rootUri;
        if (!workspaceRoot) {
            return undefined;
        }
        return {
            workspaceId: workspaceRoot.toString(),
            projectId: ctx.previewProjectId(workspaceRoot)
        };
}

export async function openPreviewWidgetExtracted(ctx: any, url: string): Promise<void> {
        const key = ctx.previewWidgetKey();
        const handler = ctx.miniBrowser as Partial<QaapProjectPreviewOpener>;
        if (key && typeof handler.openProjectPreview === 'function') {
            await handler.openProjectPreview(url, key);
            return;
        }
        await ctx.miniBrowser.openPreview(url);
}

export async function openPreviewExtracted(ctx: any, url: string,
        isPrimary: boolean = true,
        options?: { auto?: boolean; silent?: boolean },): Promise<void> {
        let identity: ReturnType<typeof parsePreviewIdentityPath>;
        try {
            identity = parsePreviewIdentityPath(new URL(url, resolveDevPreviewPublicOrigin()).pathname);
        } catch {
            identity = undefined;
        }
        if (identity) {
            const probe = await probeQaapIdentityPreview(identity.previewId);
            if (!probe.ready) {
                await ctx.reconcileSupersededPreviewClaim();
            }
        }
        // Re-claim the target port right before opening: claims are TTL'd server-side and the
        // proxy fails closed, so an open without a live claim 403s the owner's own preview.
        const targetPortForClaim = ctx.extractPort(url);
        if (targetPortForClaim !== undefined && !isReservedIdePort(targetPortForClaim)) {
            await ctx.claimDevPreviewPort(targetPortForClaim);
        }
        const activeClaim = ctx.activePreviewClaim;
        const targetUrl = activeClaim && activeClaim.port === targetPortForClaim
            ? rebasePreviewUrlToIdentityClaim(url, activeClaim.previewUrl)
            : url;
        if (options?.auto && !ctx.mayAutoOpenPreviewNow()) {
            // Stage instead of navigating: record the ready URL and flip to `running` so the
            // transcript listener offers the "Open preview" pill; the user performs navigation.
            ctx._previewUrl = targetUrl;
            ctx.persistPhase('running');
            ctx.setPhase('running');
            ctx.syncHubSession('running');
            return;
        }
        try {
            await ctx.openPreviewWidget(targetUrl);
            ctx._previewUrl = targetUrl;
            if (isPrimary) {
                const targetPort = ctx.extractPort(targetUrl);
                if (targetPort !== undefined) {
                    ctx.markPortOpened(targetPort, true);
                }
            }
            ctx.persistPhase('running');
            ctx.setPhase('running');
            ctx.syncHubSession('running');
            if (typeof window !== 'undefined' && !options?.silent) {
                window.dispatchEvent(new CustomEvent('qaap-bootstrap-preview-opened', {
                    detail: { url: targetUrl, userInitiated: !options?.auto },
                }));
            }
            ctx.syncMiniBrowserPreviewSuspensionAfterOpen();
        } catch (e) {
            console.error('[qaap-project-bootstrap] failed to open preview', e);
            ctx._error = e instanceof Error ? e.message : String(e);
            ctx.setPhase('run-failed');
        }
}

export function syncMiniBrowserPreviewSuspensionAfterOpenExtracted(ctx: any): void {
        if (!matchesMobileOneColumnLayout()) {
            return;
        }
        syncQaapMiniBrowserPreviewSuspension(ctx.shell, peekPreferDesktopIde());
}

export async function spawnCommandExtracted(ctx: any, options: {
        title: string;
        command: string;
        cwd: URI;
        kind?: string;
        /** When false, skip `terminalService.open` (avoids mobile races during long installs). */
        reveal?: boolean;
    }): Promise<TerminalWidget> {
        // Spawn the command DIRECTLY (no interactive shell wrapper) so the process actually exits
        // when the command completes. We use a login shell so the user's `node` / `pnpm` / `npm`
        // resolve from `~/.nvm`, `/opt/homebrew/bin`, etc. Without `-l` the PATH would be the
        // minimal one inherited from the IDE, which on macOS often lacks node entirely.
        const terminalCwd = resolveWorkspaceHostFsPath(options.cwd);
        const { shellPath, shellArgs } = ctx.buildShellInvocation(options.command, terminalCwd);
        const terminal = await ctx.terminalService.newTerminal({
            title: options.title,
            cwd: terminalCwd,
            shellPath,
            shellArgs,
            destroyTermOnClose: true,
            kind: options.kind,
        });
        await terminal.start();
        if (options.reveal !== false) {
            // On mobile, revealing the bottom terminal panel can dispose/recreate widgets mid-start.
            ctx.terminalService.open(terminal, { mode: matchesMobileOneColumnLayout() ? 'open' : 'reveal' });
        }
        return terminal;
}

export async function reconcileRestoredPreviewTerminalsExtracted(ctx: any): Promise<void> {
        const roots = await ctx.workspaceService.roots;
        const workspaceRoots = roots.map(entry => entry.resource.toString());
        if (workspaceRoots.length === 0) {
            return;
        }
        const toDispose: TerminalWidget[] = [];
        for (const terminal of [...ctx.terminalService.all]) {
            if (terminal === ctx.devTerminal || terminal.isDisposed) {
                continue;
            }
            let terminalCwd = terminal.lastCwd?.toString() ?? '';
            try {
                const resolved = await (terminal as TerminalWidget & { readonly cwd?: Promise<URI> }).cwd;
                terminalCwd = resolved?.toString() || terminalCwd;
            } catch {
                // A restoring terminal may not have a backend id yet; use its last known cwd.
            }
            if (!isQaapBootRestoredPreviewTerminal({
                kind: terminal.kind,
                title: terminal.title.label,
                cwd: terminalCwd,
                disposed: terminal.isDisposed,
            }, workspaceRoots)) {
                continue;
            }
            let hasPortMarker = false;
            let port: number | undefined;
            try {
                port = extractQaapPreviewTerminalPort((await terminal.processInfo).arguments);
                hasPortMarker = port !== undefined;
            } catch {
                hasPortMarker = false;
            }
            let probeReady = false;
            let probeOwned = false;
            if (hasPortMarker && port !== undefined) {
                const probe = await probeQaapDevPreviewPort(port);
                probeReady = probe.ready;
                probeOwned = isRestoredPreviewProbeOwned(probe);
            }
            if (shouldDisposeRestoredPreviewTerminal({ hasPortMarker, probeReady, probeOwned })) {
                toDispose.push(terminal);
            }
        }
        if (toDispose.length === 0) {
            return;
        }
        for (const terminal of toDispose) {
            ctx.disposeBootstrapTerminal(terminal);
        }
        await new Promise<void>(resolve => window.setTimeout(resolve, RESTORED_PREVIEW_TERMINAL_STOP_DELAY_MS));
}

export async function disposeRestoredPreviewTerminalsExtracted(ctx: any, cwd: URI,
        title: string,
        keepPort?: number,): Promise<TerminalWidget | undefined> {
        const expectedCwd = cwd.toString();
        const matches: TerminalWidget[] = [];
        let retained: TerminalWidget | undefined;
        for (const terminal of [...ctx.terminalService.all]) {
            if (terminal === ctx.devTerminal || terminal.isDisposed) {
                continue;
            }
            let terminalCwd = terminal.lastCwd?.toString() ?? '';
            try {
                const resolved = await (terminal as TerminalWidget & { readonly cwd?: Promise<URI> }).cwd;
                terminalCwd = resolved?.toString() || terminalCwd;
            } catch {
                // A restoring terminal may not have a backend id yet; use its last known cwd.
            }
            if (isQaapRestoredPreviewTerminal({
                kind: terminal.kind,
                title: terminal.title.label,
                cwd: terminalCwd,
                disposed: terminal.isDisposed,
            }, title, expectedCwd)) {
                if (keepPort !== undefined) {
                    try {
                        const terminalPort = extractQaapPreviewTerminalPort((await terminal.processInfo).arguments);
                        // Keep the terminal serving the authoritative claim. Fail closed when a
                        // restored command has no allocator marker: do not kill an unknown process.
                        if (terminalPort === undefined) {
                            continue;
                        }
                        if (terminalPort === keepPort && !retained) {
                            retained = terminal;
                            continue;
                        }
                    } catch {
                        continue;
                    }
                }
                matches.push(terminal);
            }
        }
        if (matches.length === 0) {
            return retained;
        }
        for (const terminal of matches) {
            ctx.disposeBootstrapTerminal(terminal);
        }
        await new Promise<void>(resolve => window.setTimeout(resolve, RESTORED_PREVIEW_TERMINAL_STOP_DELAY_MS));
        return retained;
}

export function watchAttachedDevTerminalExtracted(ctx: any, terminal: TerminalWidget,
        plan: { command: string; cwd: URI; expectedPort?: number; kind: QaapProjectKind },): void {
        if (terminal === ctx.devTerminal) {
            return;
        }
        const runId = ctx.devRunGeneration;
        ctx.devTerminal = terminal;
        ctx.devTerminalConversationId = ctx.activePreviewConversationId;
        ctx.devTerminalListener.dispose();
        const onOutput = terminal.onOutput(data => ctx.appendDevOutput(data));
        const onProcessExit = ctx.terminalWatcher.onTerminalExit(event => {
            if (event.terminalId === terminal.terminalId && runId === ctx.devRunGeneration) {
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
        const previewId = ctx.activePreviewClaim?.previewId;
        if (previewId) {
            ctx.monitorPreviewProcessLifetime(terminal, previewId);
        }
}

export function toUserFacingDevErrorExtracted(ctx: any, message: string): string {
        if (isTerminalDoesNotExistError(message)) {
            return 'The install/dev terminal was closed too early (often a double tap on Preview or a workspace refresh). Wait a moment, then tap Retry once.';
        }
        if (/ENOENT|no such file or directory/i.test(message)) {
            return 'Project folder not found on the server. Re-open the repo from Projects.';
        }
        if (/command not found|not found:/i.test(message)) {
            const pm = ctx._descriptor?.packageManager ?? 'npm';
            const kind = ctx._descriptor?.kind;
            if (pm === 'native') {
                const runtime = kind === 'python-django' || kind === 'python-fastapi'
                    || kind === 'python-flask' || kind === 'python-generic'
                    ? 'Python'
                    : kind === 'dotnet' ? '.NET' : kind === 'custom' ? 'configured runtime' : kind ?? 'runtime';
                return `${runtime} is not available in the workspace environment. Install its runtime in the Qaap image or update .qaap/preview.json to an available executable.`;
            }
            if (pm === 'pnpm' && /pnpm/.test(message)) {
                return 'pnpm is not available in this environment. Rebuild the Qaap Docker image (Corepack + pnpm) or run Install from a terminal with pnpm in PATH.';
            }
            return `Node/${pm} not available in the server shell. Install Node and ${pm} in the Docker image or run Install first.`;
        }
        return message;
}

export function buildShellInvocationExtracted(ctx: any, command: string, cwd: string): { shellPath: string; shellArgs: string[] } {
        // Keep `cwd` in the terminal options for normal Theia behavior AND make it part of the
        // managed command. The latter is a fail-safe for mobile terminal restoration: live VPS
        // evidence showed a recreated widget falling back to the IDE's `/app/examples/browser`
        // working directory and running another package's npm scripts.
        return buildQaapManagedShellInvocation(command, cwd);
}

