// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

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

/** Storage key used to remember per-workspace user intent (skip / installed). */
const STORAGE_KEY = 'qaap.projectBootstrap.state.v1';

/**
 * Matches `http(s)://host:port` tokens printed by common dev servers (Vite, Next, CRA, Astro,
 * Remix, Nuxt). Hosts are restricted to local addresses so we do not pick up unrelated URLs that
 * the user may print in logs (e.g. external API endpoints in startup banners).
 * Used with `matchAll` so a single chunk can yield multiple ports.
 */
const DEV_URL_REGEX = /\b(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::(\d{2,5}))?\/?[^\s\u001b]*)/gi;

/** Strip ANSI escape sequences so URL detection works against raw xterm output. */
const ANSI_REGEX = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** Node / Theia emit this when the dev port is already bound by another process. */
const PORT_IN_USE_REGEX = /EADDRINUSE|address already in use/i;

/** Keep only the tail of dev stdout so we can surface the last error line on fast exit. */
const DEV_OUTPUT_TAIL_MAX = 12_000;

/** Retries when mobile UI disposes the terminal widget before the backend session is ready. */
const TERMINAL_SPAWN_MAX_ATTEMPTS = 3;
const TERMINAL_SPAWN_RETRY_DELAY_MS = 450;
const TERMINAL_READY_DELAY_MS = 120;
/** Let destroyTermOnClose release a restored preview's listener before reserving its replacement. */
const RESTORED_PREVIEW_TERMINAL_STOP_DELAY_MS = 500;

/** Extracts `127.0.0.1:3000` / `localhost:5173` from an `EADDRINUSE` line. */
const PORT_IN_USE_ADDR_REGEX = /(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]|::1):(\d{2,5})/i;

/** After this delay, open the hinted preview URL even when stdout never prints a parseable URL. */
const DEV_PREVIEW_FALLBACK_MS = 2500;

/** Poll the backend probe before opening preview (Replit-style: wait until the port responds). */
const DEV_PREVIEW_OPEN_PROBE_ATTEMPTS = 40;
const DEV_PREVIEW_OPEN_PROBE_INTERVAL_MS = 250;

/** Delay before auto-attaching or restarting a remembered dev port after workspace load. */
const DEV_PREVIEW_WARMUP_DELAY_MS = 800;
/** Detect a dead restored process even when Theia reconstructs its terminal after the preview URL. */
const DEV_PREVIEW_HEALTH_INTERVAL_MS = 2500;
const DEV_PREVIEW_HEALTH_FAILURE_LIMIT = 2;
/** Bounded conflict recovery: enough to escape a cluster of stale dev servers without looping forever. */
const DEV_PORT_RECOVERY_MAX_ATTEMPTS = 8;

export interface QaapBootstrapStateChange {
    readonly phase: QaapBootstrapPhase;
    readonly descriptor?: QaapProjectDescriptor;
    /** Set when the dev server printed a URL we could open. */
    readonly previewUrl?: string;
    /** Optional error message; populated for `install-failed` / `run-failed`. */
    readonly error?: string;
    /** When true, run Install (not another bare dev retry) to recover. */
    readonly needsInstall?: boolean;
    /** True when the last run failed because the dev port was already taken. */
    readonly portInUse?: boolean;
    /** Port we believe is already serving the app (for "Open preview" recovery). */
    readonly existingServerPort?: number;
    /** Classified cause used by the UI and agent tools to offer the right recovery action. */
    readonly failureKind?: QaapBootstrapFailureKind;
    /** Port currently being started, including an automatic conflict-recovery retry. */
    readonly activePort?: number;
    /** Stable for the lifetime of one spawned/reattached dev-server process. */
    readonly previewRunId?: string;
    /** Original occupied port when Qaap automatically moved this run to {@link activePort}. */
    readonly portRecoveryFrom?: number;
    /** The monorepo app currently selected, when applicable. */
    readonly selectedApp?: QaapMonorepoAppCandidate;
    /**
     * Primary port the dev server bound to in a previous session. Lets the UI surface
     * "Resume preview · :3001" instead of a generic call to action once the user has at least once
     * successfully launched this workspace.
     */
    readonly lastPort?: number;
    /** Actionable hint when no runnable project was detected (orphan scaffold vs empty workspace). */
    readonly missingDescriptorHint?: string;
}

interface PersistedEntry {
    /** Workspace root URI string, used as map key. */
    readonly root: string;
    /** Phase the user "left" the bootstrap in; used so we do not re-prompt forever. */
    readonly phase: QaapBootstrapPhase;
    /** Last detected `package.json` name (so a rename forces a redetect). */
    readonly name?: string;
    /** Last selected monorepo app, keyed by relative path (so we restore it on reload). */
    readonly selectedAppPath?: string;
    /** Primary port observed on the most recent successful run, used to label the resume action. */
    readonly lastPort?: number;
}

/**
 * Drives the "open a repo → install deps → run dev server → show preview" experience.
 * Pure orchestrator: it does not render UI, instead it exposes state through {@link onStateChange}
 * so contributions can surface banners/snackbars/preview tabs at the right time.
 */
@injectable()
export class QaapProjectBootstrapService {

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(QaapProjectBootstrapDetector)
    protected readonly detector: QaapProjectBootstrapDetector;

    @inject(TerminalService)
    protected readonly terminalService: TerminalService;

    @inject(TerminalWatcher)
    protected readonly terminalWatcher: TerminalWatcher;

    @inject(MiniBrowserOpenHandler)
    protected readonly miniBrowser: MiniBrowserOpenHandler;

    @inject(MobileProjectsService)
    protected readonly hubProjects: MobileProjectsService;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(QaapPreviewPortClaimService)
    protected readonly previewPortClaimService: QaapPreviewPortClaimService;

    protected readonly toDispose = new DisposableCollection();
    protected readonly stateEmitter = new Emitter<QaapBootstrapStateChange>();
    readonly onStateChange: Event<QaapBootstrapStateChange> = this.stateEmitter.event;

    protected readonly forwardedPortsEmitter = new Emitter<QaapForwardedPort[]>();
    /** Fires whenever the list of detected ports changes (added / removed / opened in preview). */
    readonly onForwardedPortsChanged: Event<QaapForwardedPort[]> = this.forwardedPortsEmitter.event;

    protected _forwardedPorts: QaapForwardedPort[] = [];
    get forwardedPorts(): QaapForwardedPort[] { return this._forwardedPorts.slice(); }

    protected _phase: QaapBootstrapPhase = 'idle';
    protected _descriptor: QaapProjectDescriptor | undefined;
    protected _previewUrl: string | undefined;
    protected _error: string | undefined;
    /** Set when dev stdout indicates missing devDependencies (typical on NODE_ENV=production hosts). */
    protected _needsInstall = false;
    protected _selectedApp: QaapMonorepoAppCandidate | undefined;
    /**
     * Monotonically invalidates an app switch which was overtaken by a later picker tap.
     * We keep the currently-running app selected until its Qaap-managed terminal is stopped, so
     * the UI can never label app B as running while app A is still the live process.
     */
    protected monorepoAppSwitchGeneration = 0;
    /** Target currently being switched to; makes a repeated tap on the same item idempotent. */
    protected pendingMonorepoAppPath: string | undefined;
    protected monorepoAppSwitchPromise: Promise<void> | undefined;
    /** Primary port the dev server last bound to. Used to label "resume preview" once we restore. */
    protected _lastPort: number | undefined;
    /** Set when stdout mentions `EADDRINUSE` so failure handlers can offer recovery. */
    protected _portConflictDetected = false;
    protected _portConflictPort: number | undefined;
    /** Invalidates stale terminal exit/close callbacks when a new dev run starts. */
    protected devRunGeneration = 0;
    /** Invalidates in-flight install when the workspace session is reset. */
    protected installGeneration = 0;
    protected refreshDebounceTimer: number | undefined;
    /** Port we asked the dev server to bind to (may differ from the framework default when Qaap uses :3000). */
    protected activeDevPortHint: number | undefined;
    protected activePreviewRunId: string | undefined;
    protected activePreviewConversationId: string = QAAP_DEFAULT_PREVIEW_CONVERSATION_ID;
    protected readonly previewRunIdByConversation = new Map<string, string>();
    /** Live claims keyed by conversation/section so section B cannot release section A's preview. */
    protected readonly previewClaimByConversation = new Map<string, {
        readonly previewId: string;
        readonly previewUrl: string;
        readonly port: number;
    }>();
    /** Conversation that owns {@link devTerminal}, when a dev run is in flight or attached. */
    protected devTerminalConversationId: string | undefined;
    /** Project selected in Work Hub; hosted `/workspace` is never a valid substitute. */
    protected activeProjectId: string | undefined;
    protected activeWorkspaceRoot: URI | undefined;
    protected activePreviewClaim: {
        readonly previewId: string;
        readonly previewUrl: string;
        readonly port: number;
    } | undefined;
    /** One-run override used after an occupied port fails to expose a usable HTTP preview. */
    protected devPortOverride: number | undefined;
    /** Prevents an unhealthy project from cycling through ports forever. */
    protected automaticPortRecoveryAttempts = 0;
    protected readonly attemptedDevPorts = new Set<number>();
    protected portRecoveryFrom: number | undefined;
    /** Tracks the in-flight install/dev terminals so we can clean up on workspace switch. */
    protected installTerminal: TerminalWidget | undefined;
    protected devTerminal: TerminalWidget | undefined;
    protected devTerminalListener = Disposable.NULL;
    protected devPreviewFallbackTimers: number[] = [];
    protected devPreviewWarmupTimer: number | undefined;
    protected devPreviewHealthTimer: number | undefined;
    protected devPreviewHealthFailures = 0;
    /** Rolling tail of the current dev terminal output for failure diagnostics. */
    protected devOutputTail = '';
    /** Set when detection finds no runnable project — explains orphan scaffolds vs empty workspace. */
    protected _missingDescriptorHint: string | undefined;

    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.workspaceService.onWorkspaceChanged(() => {
            this.scheduleRefreshFromCurrentWorkspace();
        }));
        this.toDispose.push(this.workspaceService.onWorkspaceLocationChanged(() => {
            this.scheduleRefreshFromCurrentWorkspace();
        }));
        this.toDispose.push(Disposable.create(() => {
            if (typeof window !== 'undefined' && this.refreshDebounceTimer !== undefined) {
                window.clearTimeout(this.refreshDebounceTimer);
            }
            this.cancelDevPreviewHealthMonitor();
        }));
        // Debug surface (used by integration tests and power users). Exposes the bare minimum to
        // simulate dev-server output and inspect state without hand-injecting through Inversify.
        if (typeof window !== 'undefined') {
            (window as unknown as { __qaapBootstrap?: object }).__qaapBootstrap = {
                getState: () => ({
                    phase: this._phase,
                    descriptor: this._descriptor?.name,
                    selectedApp: this._selectedApp?.relativePath,
                    scaffoldRelativePath: this._descriptor?.scaffoldRelativePath,
                    previewUrl: this._previewUrl,
                    forwardedPorts: this._forwardedPorts,
                    nodeModulesPresent: this._descriptor?.nodeModulesPresent,
                    needsInstall: this._needsInstall,
                }),
                refresh: () => this.refreshFromCurrentWorkspace(),
                runDevServer: () => this.runDevServer(),
                runInstall: () => this.runInstall(),
                feed: (chunk: string) => this.scanForDevUrl(chunk),
                setRunning: () => this.setPhase('running'),
                clearPorts: () => this.clearForwardedPorts(),
                // Integration test helper: spawns an arbitrary command and resolves with
                // `{ code, elapsedMs }` once `waitForExit` returns. Use to validate the new
                // exit-detection path without waiting for a real `npm install`.
                probeExit: async (command: string) => {
                    const t0 = Date.now();
                    const terminal = await this.spawnCommand({
                        title: 'qaap-probe',
                        command,
                        cwd: URI.fromFilePath('/tmp'),
                    });
                    const code = await this.waitForExit(terminal);
                    return { code, elapsedMs: Date.now() - t0 };
                },
            };
        }
    }

    get phase(): QaapBootstrapPhase { return this._phase; }
    get needsInstall(): boolean { return this._needsInstall; }
    get descriptor(): QaapProjectDescriptor | undefined { return this._descriptor; }
    get previewUrl(): string | undefined { return this._previewUrl; }
    get selectedApp(): QaapMonorepoAppCandidate | undefined { return this._selectedApp; }
    get lastPort(): number | undefined { return this._lastPort; }
    get previewProcessId(): string | undefined { return this.activePreviewRunId; }
    get previewId(): string | undefined { return this.activePreviewClaim?.previewId; }
    /** Stable identity URL of the live claim — the authoritative navigation target for the primary preview. */
    get previewClaimUrl(): string | undefined { return this.activePreviewClaim?.previewUrl; }

    /**
     * Re-claims the active process without letting a section invent another project identity.
     * The descriptor/root and process UUID are the same authority used by the initial reservation.
     */
    protected bindPreviewConversation(conversationId?: string): string {
        this.activePreviewConversationId = normalizeQaapPreviewConversationId(conversationId);
        const remembered = this.previewRunIdByConversation.get(this.activePreviewConversationId);
        if (remembered) {
            this.activePreviewRunId = remembered;
        }
        // Restore this section's claim into the active slot without touching other sections.
        this.activePreviewClaim = this.previewClaimByConversation.get(this.activePreviewConversationId);
        return this.activePreviewConversationId;
    }

    protected rememberActivePreviewClaim(claim: {
        readonly previewId: string;
        readonly previewUrl: string;
        readonly port: number;
    }): void {
        this.activePreviewClaim = claim;
        this.previewClaimByConversation.set(this.activePreviewConversationId, claim);
    }

    protected ensurePreviewProcessIdForConversation(conversationId?: string): string {
        const scope = this.bindPreviewConversation(conversationId);
        let processId = this.previewRunIdByConversation.get(scope);
        if (!processId) {
            processId = generateUuid();
            this.previewRunIdByConversation.set(scope, processId);
        }
        this.activePreviewRunId = processId;
        return processId;
    }

    async claimPreviewExecution(port: number, conversationId?: string): Promise<QaapPreviewPortClaimResult> {
        this.bindPreviewConversation(conversationId);
        this.ensurePreviewProcessIdForConversation(conversationId);
        const processRoot = this._descriptor?.rootUri ?? this.activeWorkspaceRoot;
        if (!this.activePreviewRunId || !processRoot) {
            return { kind: 'error' };
        }
        const claim = await this.reserveActivePreview(port, processRoot);
        if (claim.kind === 'claimed' && claim.previewId && claim.previewUrl && claim.port !== undefined) {
            this.rememberActivePreviewClaim({
                previewId: claim.previewId,
                previewUrl: claim.previewUrl,
                port: claim.port,
            });
        }
        return claim;
    }

    /**
     * Adopts a newer live claim for the active project when this session's claim was superseded
     * by a chained run (retry, second tab, backend restart). The retired `/qaap-preview/<id>/`
     * URL 403s in the identity proxy; adopting the successor lets every surface (transcript
     * iframe, composer pill, session store) re-resolve the preview without a page reload.
     * Returns true when a different live claim was adopted.
     */
    adoptSupersedingPreviewClaim(current: QaapDevPreviewProbeResponse): boolean {
        if (!current.previewId || !current.previewUrl || current.port === undefined) {
            return false;
        }
        if (this.activePreviewClaim?.previewId === current.previewId
            && this.activePreviewClaim.previewUrl === current.previewUrl) {
            return false;
        }
        // Same guard as reattach: never adopt a claim that names a different project.
        if (!this.probeBelongsToActiveProject(current.projectId)) {
            return false;
        }
        if (current.processId) {
            this.activePreviewRunId = current.processId;
            this.previewRunIdByConversation.set(this.activePreviewConversationId, current.processId);
        }
        this.rememberActivePreviewClaim({
            previewId: current.previewId,
            previewUrl: current.previewUrl,
            port: current.port,
        });
        this._lastPort = current.port;
        if (this._previewUrl) {
            // Only replace an already-published URL; first publication stays with the run flow.
            this._previewUrl = current.previewUrl;
        }
        this.stateEmitter.fire(this.buildStateChange(this._phase));
        if (this.activeProjectId) {
            void this.hubProjects.recordProjectSession({
                repoKey: this.activeProjectId,
                previewUrl: current.previewUrl,
            }).catch(() => undefined);
        }
        return true;
    }

    /**
     * Queries the backend for the newest live claim of the active project and adopts it when it
     * differs from this session's claim. Call when a mounted preview or its probe starts 403ing.
     */
    async reconcileSupersededPreviewClaim(): Promise<boolean> {
        const workspaceRoot = this.activeWorkspaceRoot ?? this._descriptor?.rootUri;
        if (!workspaceRoot) {
            return false;
        }
        // Scope to this session's section so it never adopts another section's live claim.
        const current = await fetchQaapCurrentDevPreview([
            this.previewProjectId(workspaceRoot),
            this.activeProjectId,
        ], this.activePreviewConversationId);
        if (!current?.ready) {
            return false;
        }
        return this.adoptSupersedingPreviewClaim(current);
    }

    /** Detects and runs the exact Work Hub project instead of the hosted multi-repo container. */
    async refreshFromProjectRoot(root: string | URI, projectId: string): Promise<void> {
        const resource = typeof root === 'string'
            ? (root.startsWith('file:') ? new URI(root) : URI.fromFilePath(root))
            : root;
        this.activeProjectId = projectId.startsWith('/') || projectId.startsWith('file:')
            ? `ws:${resource.toString()}`
            : projectId;
        this.activeWorkspaceRoot = resource;
        await this.refreshFromRoot(resource);
    }

    /** Current bootstrap state for UI contributions and AI tools. */
    getStateSnapshot(): QaapBootstrapStateChange {
        return this.buildStateChange(this._phase);
    }

    /** True when install finished (or was skipped) and a dev script can be spawned. */
    hasRunnableDevPlan(): boolean {
        return this.resolveDevPlan() !== undefined;
    }

    /**
     * Readable install/dev failure extracted from terminal output (for AI tools and `#qaap.bootstrap`).
     */
    getBootstrapFailureDetail(): { terminalFailure: string; terminalTail?: string } | undefined {
        const phase = this._phase;
        if (phase !== 'install-failed' && phase !== 'run-failed') {
            return undefined;
        }
        const terminal = phase === 'install-failed' ? this.installTerminal : this.devTerminal;
        const tail = terminal && !terminal.isDisposed
            ? this.readTerminalTail(terminal, 80)
            : this.devOutputTail;
        const fallback = this._error ?? (phase === 'install-failed' ? 'Install failed' : 'Dev server failed');
        return {
            terminalFailure: extractTerminalFailureLine(tail, fallback),
            terminalTail: tail.length > 0 ? tail.slice(-1500) : undefined,
        };
    }

    /**
     * Returns the dev command + cwd that should be spawned. For monorepos this is the selected
     * app's command (running inside the app's folder). For single-package projects it is the
     * descriptor-level dev command at the workspace root.
     */
    protected resolveDevPlan(): { command: string; cwd: URI; expectedPort?: number; kind: QaapProjectKind } | undefined {
        const descriptor = this._descriptor;
        if (!descriptor) {
            return undefined;
        }
        const app = this._selectedApp ?? (descriptor.apps.length === 1 ? descriptor.apps[0] : undefined);
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

    /** Install cwd/command — orphan scaffolds install inside the child app folder, not the workspace root. */
    protected resolveInstallPlan(): { command: string; cwd: URI } | undefined {
        const descriptor = this._descriptor;
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
            this._selectedApp ? {
                rootKey: this._selectedApp.rootUri.toString(),
                devCommand: this._selectedApp.devCommand,
            } : undefined,
            fallbackApp ? {
                rootKey: fallbackApp.rootUri.toString(),
                devCommand: fallbackApp.devCommand,
            } : undefined,
        );
        return { command: plan.command, cwd: new URI(plan.cwdKey) };
    }

    /**
     * Whether a runnable app exists at `root` (manifest at the root or a scaffolded subfolder),
     * with actionable copy when it does not. Root-agnostic on purpose: the hub Preview tab asks
     * about ANY project, not just the active workspace.
     */
    async describeRunnableApp(root: URI): Promise<{ runnable: boolean; hint?: string }> {
        const descriptor = await this.detector.detect(root);
        if (descriptor) {
            return { runnable: true };
        }
        return { runnable: false, hint: await this.getMissingDescriptorHint(root) };
    }

    /** Actionable copy when preview cannot run because no runnable project was detected. */
    async getMissingDescriptorHint(explicitRoot?: URI): Promise<string | undefined> {
        const roots = explicitRoot ? undefined : await this.workspaceService.roots;
        const workspaceRoot = explicitRoot ?? roots?.[0]?.resource;
        if (!workspaceRoot) {
            return undefined;
        }
        const candidates = await this.detector.listScaffoldSubfolderCandidates(workspaceRoot);
        return this.detector.formatMissingProjectHint(candidates.map(app => app.relativePath));
    }

    /**
     * Builds the shell command and target port for a dev run, shifting off the IDE port when needed
     * so `next dev` / CRA do not kill the Qaap backend on :3000.
     */
    protected buildDevSpawnPlan(plan: {
        command: string;
        expectedPort?: number;
        kind: QaapProjectKind;
    }): { command: string; targetPort?: number } {
        const idePort = getQaapIdeListenPort();
        const frameworkPort = plan.expectedPort ?? getImplicitDevPort(plan.kind);
        const targetPort = this.devPortOverride ?? resolveBootstrapDevPort(frameworkPort, idePort);
        if (targetPort === undefined) {
            return { command: wrapCommandForDevNodeEnv(plan.command), targetPort: undefined };
        }
        return {
            command: wrapDevCommandForPort(plan.command, targetPort, plan.kind),
            targetPort,
        };
    }

    protected reserveActivePreview(port: number, cwd: URI, osProcessId?: number): Promise<QaapPreviewPortClaimResult> {
        const processId = this.activePreviewRunId;
        const workspaceRoot = this.activeWorkspaceRoot ?? this._descriptor?.rootUri ?? cwd;
        if (!processId) {
            return Promise.resolve({ kind: 'error' });
        }
        return this.previewPortClaimService.claim(port, {
            workspaceId: workspaceRoot.toString(),
            projectId: this.previewProjectId(workspaceRoot),
            processId,
            root: workspaceRoot.toString(),
            conversationId: this.activePreviewConversationId,
            osProcessId,
        });
    }

    /**
     * Canonical project identity for previews: the workspace root URI.
     *
     * `activeProjectId` is a hub repo key whose spelling depends on the entry flow
     * (`github:owner/repo` from a transcript, `ws:file:///…` from an open workspace). Using it in
     * the preview identity made the SAME project claim two different `previewId`s — observed live
     * on the VPS as duplicate registry records (ports 3000 and 3003 for one project) that the
     * server-side supersede could not match. The root URI is invariant across flows: one project
     * root ⇒ one preview identity ⇒ one widget.
     */
    protected previewProjectId(workspaceRoot: URI): string {
        return workspaceRoot.toString();
    }

    /**
     * Selects a monorepo app. Switching while a preview is live is a real hand-off: stop only the
     * Qaap terminal/process group we own, release its identity claim, then start the selected app.
     * Updating `_selectedApp` before that hand-off used to make the banner say app B was running
     * while the terminal for app A still served the preview.
     */
    selectMonorepoApp(
        candidate: QaapMonorepoAppCandidate | undefined,
        options?: { readonly conversationId?: string },
    ): Promise<void> {
        const descriptor = this._descriptor;
        // A single runnable app has no meaningful app switch. Keep its normal preview untouched.
        if (!descriptor || descriptor.apps.length <= 1) {
            return Promise.resolve();
        }
        const candidatePath = candidate?.relativePath;
        if (candidatePath === this._selectedApp?.relativePath) {
            return Promise.resolve();
        }
        if (candidatePath === this.pendingMonorepoAppPath && this.monorepoAppSwitchPromise) {
            return this.monorepoAppSwitchPromise;
        }

        const switchGeneration = ++this.monorepoAppSwitchGeneration;
        this.pendingMonorepoAppPath = candidatePath;
        const switching = this.switchMonorepoApp(candidate, descriptor, switchGeneration, options)
            .catch(error => {
                if (switchGeneration !== this.monorepoAppSwitchGeneration) {
                    return;
                }
                this._error = this.toUserFacingDevError(error instanceof Error ? error.message : String(error));
                this.setPhase('run-failed');
            })
            .finally(() => {
                if (switchGeneration === this.monorepoAppSwitchGeneration) {
                    this.pendingMonorepoAppPath = undefined;
                    this.monorepoAppSwitchPromise = undefined;
                }
            });
        this.monorepoAppSwitchPromise = switching;
        return switching;
    }

    protected async switchMonorepoApp(
        candidate: QaapMonorepoAppCandidate | undefined,
        descriptor: QaapProjectDescriptor,
        switchGeneration: number,
        options?: { readonly conversationId?: string },
    ): Promise<void> {
        await switchQaapMonorepoPreviewApp({
            appCount: descriptor.apps.length,
            currentAppPath: this._selectedApp?.relativePath,
            nextApp: candidate,
            nextAppPath: candidate?.relativePath,
            previewIsActive: this._phase === 'starting' || this._phase === 'running',
            stopActivePreview: () => this.stopManagedDevServerForAppSwitch(),
            isCurrent: () => switchGeneration === this.monorepoAppSwitchGeneration,
            applySelection: nextApp => {
                this._selectedApp = nextApp;
                this._previewUrl = undefined;
                this._lastPort = undefined;
                this.activeDevPortHint = undefined;
                this._portConflictDetected = false;
                this._portConflictPort = undefined;
                this._error = undefined;
                this.clearForwardedPorts();
                if (nextApp) {
                    this.persistPhase(descriptor.nodeModulesPresent ? 'ready-to-run' : 'detected', nextApp);
                }
            },
            launchSelectedPreview: async () => {
                if (!candidate || !descriptor.nodeModulesPresent) {
                    this.setPhase(descriptor.nodeModulesPresent ? 'ready-to-run' : 'detected');
                    return;
                }
                // Publish the new selection as a transition, never as a false `running` state.
                // The launch path immediately creates a fresh process id and claim for this app.
                this.setPhase('starting');
                await this.runDevServer(options);
            },
        });
    }

    /**
     * Stops the one terminal that this bootstrap instance created. Terminal disposal closes its
     * PTY/process group; no process-name or global PID matching is used. Wait briefly for the
     * terminal backend to observe that close before a replacement attempts the same dev port.
     */
    protected async stopManagedDevServerForAppSwitch(): Promise<void> {
        this.devRunGeneration++;
        this.releaseActivePreview();
        // The replacement is a different app process, not a reattachment. Give it a new process
        // identity so a delayed probe/claim from the stopped app cannot be adopted as the new one.
        this.previewRunIdByConversation.delete(this.activePreviewConversationId);
        this.activePreviewRunId = undefined;
        this.cancelDevPreviewFallbacks();
        this.cancelDevPreviewHealthMonitor();
        const terminal = this.devTerminal;
        this.devTerminalListener.dispose();
        this.devTerminalListener = Disposable.NULL;
        this.devTerminal = undefined;
        this.devTerminalConversationId = undefined;
        if (terminal && !terminal.isDisposed) {
            this.disposeBootstrapTerminal(terminal);
            await this.delay(RESTORED_PREVIEW_TERMINAL_STOP_DELAY_MS);
        }
    }

    /**
     * Called by contributions when the user clicks "Install" on the banner.
     * Idempotent: no-ops when there is no actionable descriptor or an install is already running.
     */
    async runInstall(): Promise<void> {
        const descriptor = this._descriptor;
        if (!descriptor || this._phase === 'installing') {
            return;
        }
        if (descriptor.nodeModulesPresent && !this._needsInstall) {
            this.persistPhase('ready-to-run');
            this.setPhase('ready-to-run');
            if (this.resolveDevPlan()) {
                await this.runDevServer();
            }
            return;
        }
        const installId = ++this.installGeneration;
        this.setPhase('installing');
        try {
            const installPlan = this.resolveInstallPlan();
            if (!installPlan) {
                this.setPhase('install-failed');
                this._error = 'No install target for this workspace.';
                return;
            }
            const terminal = await this.spawnCommandWithRetry({
                title: `Install (${descriptor.packageManager})`,
                // NODE_ENV=production hosts would otherwise skip devDependencies (vite & friends).
                command: wrapCommandForDevNodeEnv(installPlan.command),
                cwd: installPlan.cwd,
                reveal: false,
            });
            if (installId !== this.installGeneration) {
                this.disposeBootstrapTerminal(terminal);
                return;
            }
            this.installTerminal = terminal;
            const exitCode = await this.waitForExit(terminal);
            if (installId !== this.installGeneration || terminal.isDisposed) {
                return;
            }
            // node-pty / Theia can emit `code: undefined` on clean exits (see node-pty#751); treat
            // a missing code as a successful exit so a working install doesn't get flagged as
            // failed just because the kernel didn't surface the exit syscall value.
            if (exitCode !== undefined && exitCode !== 0) {
                const tail = this.readTerminalTail(terminal);
                this._needsInstall = terminalOutputNeedsInstall(tail);
                this._error = extractTerminalFailureLine(tail, `Install exited with code ${exitCode}`);
                this.setPhase('install-failed');
                return;
            }
            this._needsInstall = false;
            await this.refreshDescriptorAfterInstall();
            this.persistPhase('ready-to-run');
            this.setPhase('ready-to-run');
            // Auto-chain to dev server when a runnable plan is available (single-package script or a
            // selected monorepo app). For monorepos with no app picked yet we stop here so the user
            // can choose which app to preview — running an arbitrary one would be surprising.
            if (this.resolveDevPlan()) {
                await this.runDevServer();
            }
        } catch (e) {
            const raw = e instanceof Error ? e.message : String(e);
            this._error = this.toUserFacingDevError(raw);
            this.setPhase('install-failed');
        } finally {
            this.installTerminal = undefined;
        }
    }

    /**
     * Called by contributions when the user clicks "Run" on the banner (or auto after install).
     * Spawns the dev script, listens to its output, and opens the preview when a URL appears.
     */
    async runDevServer(options?: { conversationId?: string }): Promise<void> {
        if (options?.conversationId !== undefined) {
            this.bindPreviewConversation(options.conversationId);
        }
        const plan = this.resolveDevPlan();
        const descriptor = this._descriptor;
        if (!plan || !descriptor) {
            return;
        }
        const busyForActiveConversation = (this._phase === 'starting' || this._phase === 'running')
            && this.devTerminalConversationId === this.activePreviewConversationId;
        if (busyForActiveConversation) {
            return;
        }
        this.devPortOverride = undefined;
        this.automaticPortRecoveryAttempts = 0;
        this.attemptedDevPorts.clear();
        this.portRecoveryFrom = undefined;
        await this.startDevServer(plan, descriptor);
    }

    /** Starts a dev process, preserving an internal port-recovery override when present. */
    protected async startDevServer(
        plan: { command: string; cwd: URI; expectedPort?: number; kind: QaapProjectKind },
        descriptor: QaapProjectDescriptor,
    ): Promise<void> {
        this.beginDevRun();
        this.clearForwardedPorts();
        this._portConflictDetected = false;
        this._portConflictPort = undefined;
        this._error = undefined;
        this._needsInstall = false;
        this.devOutputTail = '';
        this.activeDevPortHint = undefined;
        const runId = ++this.devRunGeneration;
        this.setPhase('starting');

        let spawnPlan = this.buildDevSpawnPlan(plan);
        this.activeDevPortHint = spawnPlan.targetPort;
        const label = this._selectedApp?.name ?? descriptor.name;
        // Reattach only to THIS section's claim. Using the global `_lastPort` would collapse a new
        // conversation onto another section's live server (shared project, independent previews).
        const sectionPort = this.previewClaimByConversation.get(this.activePreviewConversationId)?.port;
        if (sectionPort !== undefined && await this.tryAttachToExistingServer([sectionPort])) {
            return;
        }

        // VPS/container restore can resurrect Dev terminals whose durable claim was already reaped.
        // Reconcile globally before cwd-scoped disposal so orphan listeners do not respawn.
        await this.reconcileRestoredPreviewTerminals();

        // Persistent Theia terminals can be reconstructed after a backend/workspace restore after
        // their durable claim has already been reaped. Letting that old Dev terminal keep booting
        // while allocating a fresh claim produces two servers for the same project (observed on the
        // VPS at :3002 and :3003). A live registered process returned above; anything matched here
        // is an unclaimed restored terminal for this exact cwd and must be stopped before restart.
        await this.disposeRestoredPreviewTerminals(plan.cwd, `Dev (${label})`);

        this.ensurePreviewProcessIdForConversation(this.activePreviewConversationId);
        if (spawnPlan.targetPort !== undefined) {
            this.attemptedDevPorts.add(spawnPlan.targetPort);
            const reservation = await this.reserveActivePreview(spawnPlan.targetPort, plan.cwd);
            if (runId !== this.devRunGeneration) {
                if (reservation.kind === 'claimed' && reservation.previewId) {
                    void this.previewPortClaimService.release?.(reservation.previewId);
                }
                return;
            }
            if (reservation.kind !== 'claimed' || reservation.port === undefined
                || !reservation.previewId || !reservation.previewUrl) {
                this._error = reservation.kind === 'conflict'
                    ? nls.localize('qaap/projectBootstrap/previewIdentityConflict', 'The requested preview identity is already in use.')
                    : nls.localize('qaap/projectBootstrap/previewReservationFailed', 'Qaap could not reserve an isolated preview port.');
                this.setPhase('run-failed');
                return;
            }
            this.rememberActivePreviewClaim({
                previewId: reservation.previewId,
                previewUrl: reservation.previewUrl,
                port: reservation.port,
            });
            // Persist the stable identity URL as soon as the reservation exists. If the user
            // switches projects while the process is still booting, the other section can resolve
            // this exact preview instead of scanning global ports.
            void this.hubProjects.recordProjectSession({
                repoKey: this.activeProjectId,
                bootstrapPhase: 'starting',
                previewUrl: reservation.previewUrl,
                agentState: 'working',
                lastTask: nls.localize('qaap/projectBootstrap/startingDevServer', 'Starting dev server…'),
            }).catch(() => undefined);
            if (reservation.port !== spawnPlan.targetPort) {
                this.devPortOverride = reservation.port;
                spawnPlan = this.buildDevSpawnPlan(plan);
                this.activeDevPortHint = reservation.port;
                this.attemptedDevPorts.add(reservation.port);
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
                ? await this.spawnCommandWithRetry(spawnOptions)
                : await this.spawnCommand(spawnOptions);
            if (runId !== this.devRunGeneration) {
                return;
            }
            const processClaim = this.activePreviewClaim;
            if (processClaim) {
                this.monitorPreviewProcessLifetime(terminal, processClaim.previewId);
                this.attachTerminalOsProcessId(terminal, processClaim.previewId, processClaim.port, plan.cwd);
            }
            this.devTerminal = terminal;
            this.devTerminalConversationId = this.activePreviewConversationId;
            this.devTerminalListener.dispose();
            const onOutput = terminal.onOutput(data => {
                this.appendDevOutput(data);
                this.scanDevOutput(data, { expectedPort: spawnPlan.targetPort });
            });
            // Process exit is broadcast through TerminalWatcher (not via onTerminalDidClose, which
            // only fires when the *widget* is disposed). We filter by terminalId so a parallel
            // install terminal exiting doesn't accidentally flip the dev phase.
            const onProcessExit = this.terminalWatcher.onTerminalExit(event => {
                if (event.terminalId !== terminal.terminalId || runId !== this.devRunGeneration) {
                    return;
                }
                if (this._phase === 'starting' || this._phase === 'running') {
                    void this.failDevRun(nls.localize(
                        'qaap/projectBootstrap/devServerExited',
                        'Dev server exited with code {0}.',
                        String(event.code ?? '?'),
                    ), plan, runId);
                }
            });
            const onWidgetClose = terminal.onTerminalDidClose(() => {
                if (runId !== this.devRunGeneration) {
                    return;
                }
                if (this._phase === 'starting' || this._phase === 'running') {
                    void this.failDevRun(nls.localize(
                        'qaap/projectBootstrap/devServerTabClosed',
                        'Dev server tab closed.',
                    ), plan, runId);
                }
            });
            this.devTerminalListener = new DisposableCollection(onOutput, onProcessExit, onWidgetClose);
            this.toDispose.push(this.devTerminalListener);

            // Fallback: if the user has a known framework we already know the default port; route
            // through the port-forwarding machinery so the fallback shows up in the strip just like
            // a stdout-detected URL would.
            if (spawnPlan.targetPort) {
                this.scheduleDevPreviewFallback(runId, spawnPlan.targetPort);
            }
        } catch (e) {
            if (runId !== this.devRunGeneration) {
                return;
            }
            const raw = e instanceof Error ? e.message : String(e);
            await this.failDevRun(this.toUserFacingDevError(raw), plan, runId);
        }
    }

    /**
     * Cancels an in-flight install/dev launch and tears down the active preview terminal for the
     * current conversation. Used when the Work Hub header Stop control is pressed.
     */
    cancelActivePreviewLaunch(): void {
        this.devRunGeneration++;
        this.installGeneration++;
        this.releaseActivePreview();
        this.cancelDevPreviewFallbacks();
        this.cancelDevPreviewHealthMonitor();
        this.cleanupDevTerminal();
        this.disposeBootstrapTerminal(this.installTerminal);
        this.installTerminal = undefined;
        this.devTerminalConversationId = undefined;
        this._previewUrl = undefined;
        this._error = undefined;
        this._needsInstall = false;
        if (this._phase === 'installing' || this._phase === 'starting' || this._phase === 'running') {
            this.setPhase(this._descriptor?.nodeModulesPresent ? 'ready-to-run' : 'detected');
        }
    }

    /** User dismissed the banner; remember so we do not nag on every reload. */
    skip(): void {
        if (this._descriptor) {
            this.persistPhase('dismissed');
        }
        this.setPhase('dismissed');
    }

    /** Re-show the banner after a previous dismissal; called from the secondary action sheet. */
    reset(): void {
        if (this._descriptor) {
            this.persistPhase(this._descriptor.nodeModulesPresent ? 'ready-to-run' : 'detected');
        }
        void this.refreshFromCurrentWorkspace();
    }

    /** Focus the existing preview; re-probe, attach, or restart the dev server when it is down. */
    async focusPreview(): Promise<void> {
        const rememberedPort = this._previewUrl ? this.extractPort(this._previewUrl) : this._lastPort;
        if (rememberedPort !== undefined && !isReservedIdePort(rememberedPort)) {
            // The probe endpoint fails closed on unclaimed ports (SEC-8) — re-claim before probing
            // so a backend restart or an expired claim does not lock the owner out of their preview.
            await this.claimDevPreviewPort(rememberedPort);
            // The claim may resolve to a different allocated port than the remembered one (stale
            // localStorage, inline PORT=… in the dev script) — probe the authoritative target.
            const target = this.resolvePrimaryPreviewTarget(rememberedPort, '');
            const probe = await probeQaapDevPreviewPort(target.port);
            if (probe.ready) {
                await this.openPreview(target.url || probe.previewUrl);
                return;
            }
        }
        if (await this.tryAttachToExistingServer(this.collectProbePorts())) {
            return;
        }
        if (this.resolveDevPlan() && (this._phase === 'ready-to-run' || this._phase === 'run-failed' || this._phase === 'running')) {
            await this.runDevServer();
            return;
        }
        if (this._previewUrl) {
            await this.openPreview(this._previewUrl);
        }
    }

    /**
     * When the dev port is already bound, probe common ports and open the preview against the
     * server that is already listening instead of asking the user to free the port first.
     */
    async openExistingPreview(options?: { auto?: boolean }): Promise<void> {
        // Default (user tap): if a ready URL was staged by the auto-open gate, honor the tap and
        // open it now. Agent/tool callers pass `{ auto: true }` to stage without navigating.
        if (this._previewUrl) {
            await this.openPreview(this._previewUrl, true, options);
            this._error = undefined;
            this._portConflictDetected = false;
            this._portConflictPort = undefined;
            return;
        }
        const plan = this.resolveDevPlan();
        // Attach path already uses `{ auto: true }` via recordForwardedPort → openPreview, so it
        // stages when the gate forbids navigation (agent/tool). User taps with a staged URL hit
        // the branch above and navigate via openPreview without auto.
        const attached = await this.tryAttachToExistingServer(this.collectProbePorts(plan));
        if (attached) {
            this._error = undefined;
            this._portConflictDetected = false;
            this._portConflictPort = undefined;
            this.cleanupDevTerminal();
            return;
        }
        this._error = 'No dev server responded on the expected port.';
        this.setPhase('run-failed');
    }

    /**
     * Debounce workspace churn so we do not tear down install/dev terminals mid-flight.
     * {@link refreshFromCurrentWorkspace} re-runs detection and honors persisted user decisions.
     */
    protected scheduleRefreshFromCurrentWorkspace(): void {
        if (typeof window === 'undefined') {
            void this.refreshFromCurrentWorkspace();
            return;
        }
        if (this.refreshDebounceTimer !== undefined) {
            window.clearTimeout(this.refreshDebounceTimer);
        }
        this.refreshDebounceTimer = window.setTimeout(() => {
            this.refreshDebounceTimer = undefined;
            void this.refreshFromCurrentWorkspace();
        }, 450);
    }

    async refreshFromCurrentWorkspace(): Promise<void> {
        const roots = await this.workspaceService.roots;
        const first = roots[0];
        this.activeProjectId = first ? `ws:${first.resource.toString()}` : undefined;
        this.activeWorkspaceRoot = first?.resource;
        await this.refreshFromRoot(first?.resource);
    }

    protected async refreshFromRoot(resource: URI | undefined): Promise<void> {
        const nextRootKey = resource?.toString() ?? '';
        const currentRootKey = this._descriptor?.rootUri.toString() ?? '';
        if (
            (this._phase === 'installing' || this._phase === 'starting')
            && nextRootKey.length > 0
            && nextRootKey === currentRootKey
        ) {
            return;
        }
        this.resetBootstrapSessionForWorkspace();
        this.clearForwardedPorts();
        if (!resource) {
            this._descriptor = undefined;
            this._previewUrl = undefined;
            this._selectedApp = undefined;
            this.setPhase('idle');
            return;
        }
        const descriptor = await this.detector.detect(resource);
        this._descriptor = descriptor;
        this._previewUrl = undefined;
        this._error = undefined;
        this._selectedApp = undefined;
        this._lastPort = undefined;
        this._portConflictDetected = false;
        this._portConflictPort = undefined;
        if (!descriptor) {
            this._missingDescriptorHint = await this.getMissingDescriptorHint(resource);
            this.setPhase('idle');
            return;
        }
        this._missingDescriptorHint = undefined;
        const persisted = this.readPersisted(descriptor.rootUri.toString());
        // Restore the previously selected monorepo app when it still exists; this avoids the user
        // having to repick after a reload.
        if (persisted?.selectedAppPath) {
            this._selectedApp = descriptor.apps.find(app => app.relativePath === persisted.selectedAppPath);
        }
        if (persisted?.lastPort !== undefined) {
            this._lastPort = isReservedIdePort(persisted.lastPort)
                ? undefined
                : persisted.lastPort;
        }
        if (!this._selectedApp && descriptor.apps.length === 1) {
            // Only one runnable app — pick it implicitly so the user gets one-tap "Run & Preview".
            this._selectedApp = descriptor.apps[0];
        }
        if (persisted && persisted.name === descriptor.name) {
            // Transient phases (`running`, `starting`, `installing`) are not real after a reload:
            // the spawned terminal is gone, the dev URL no longer responds, and the user is back
            // at "ready to launch". Downgrade them so the banner reappears with a `Run & Preview`
            // (or `Install`) action instead of silently restoring a dead `running` state.
            const restored = normalizePersistedBootstrapPhase(persisted.phase, descriptor.nodeModulesPresent);
            this.setPhase(restored);
            this.scheduleDevPreviewWarmup();
            return;
        }
        this.setPhase(descriptor.nodeModulesPresent ? 'ready-to-run' : 'detected');
        this.scheduleDevPreviewWarmup();
    }

    /**
     * Maps a persisted phase to the phase we should boot into. Terminal phases (`dismissed`,
     * `ready-to-run`, failures) round-trip unchanged; transient ones collapse to the
     * appropriate "actionable" phase based on whether `node_modules` is on disk now.
     */
    protected normalizeRestoredPhase(phase: QaapBootstrapPhase, descriptor: QaapProjectDescriptor): QaapBootstrapPhase {
        return normalizePersistedBootstrapPhase(phase, descriptor.nodeModulesPresent);
    }

    protected scanDevOutput(data: string, plan: { expectedPort?: number }): void {
        if (this._phase !== 'starting' && this._phase !== 'running') {
            return;
        }
        const clean = data.replace(ANSI_REGEX, '');
        if (PORT_IN_USE_REGEX.test(clean)) {
            this._portConflictDetected = true;
            const fromLog = this.extractPortFromInUseMessage(clean);
            if (fromLog !== undefined) {
                this._portConflictPort = fromLog;
            }
            void this.tryAttachToExistingServer(this.collectProbePorts(plan));
        }
        for (const port of extractDevOutputProbePorts(clean)) {
            if (this._portConflictPort === undefined) {
                this._portConflictPort = port;
            }
            void this.tryAttachToExistingServer(this.collectProbePorts(plan));
        }
        this.scanForDevUrl(clean);
    }

    protected scanForDevUrl(data: string): void {
        if (this._phase !== 'starting' && this._phase !== 'running') {
            return;
        }
        const clean = data.replace(ANSI_REGEX, '');
        const matches = clean.matchAll(DEV_URL_REGEX);
        for (const match of matches) {
            const url = this.normalizeDevUrl(match[1]);
            if (!url) {
                continue;
            }
            const port = this.extractPort(url);
            if (port === undefined) {
                continue;
            }
            const effectivePort = isReservedIdePort(port) && this.activeDevPortHint !== undefined
                ? this.activeDevPortHint
                : port;
            if (isReservedIdePort(effectivePort)) {
                continue;
            }
            this.recordForwardedPort(effectivePort, toDevPreviewUrl(effectivePort));
        }
    }

    protected normalizeDevUrl(raw: string): string | undefined {
        try {
            // Trim trailing punctuation introduced by log decorations (e.g. `).`, `,`).
            const sanitized = raw.replace(/[),.;]+$/, '');
            const parsed = new URL(sanitized);
            // Drop empty paths so we keep the URL canonical for the dedup map.
            return parsed.toString().replace(/\/$/, '');
        } catch {
            return undefined;
        }
    }

    protected extractPort(url: string): number | undefined {
        try {
            const parsed = new URL(url);
            const proxied = parsePreviewProxyPath(parsed.pathname);
            if (proxied) {
                return proxied.port;
            }
            if (parsed.pathname.startsWith('/qaap-preview/')) {
                return this.activePreviewClaim?.port;
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

    /**
     * Adds (or refreshes) a forwarded-port entry. The first port observed becomes the "primary"
     * preview that is auto-opened; subsequent ports just appear in the strip and only open when the
     * user taps them. This mirrors Codespaces' "your dev server printed a URL" behavior while
     * still surfacing all the auxiliary endpoints (websockets, admin UI, mock APIs, …).
     */
    protected recordForwardedPort(
        port: number,
        url: string,
        options?: { alreadyReady?: boolean },
    ): void {
        if (isReservedIdePort(port)) {
            return;
        }
        this.ensurePreviewProcessIdForConversation(this.activePreviewConversationId);
        const existing = this._forwardedPorts.find(p => p.port === port);
        if (existing) {
            return;
        }
        // Claim the port for this workspace FIRST (proves ownership), then open the preview. The
        // backend proxy fails closed on unclaimed ports, so opening before the claim lands would
        // 403 the owner's own preview. claimDevPreviewPort is best-effort and resolves even on
        // failure, so a claim error still lets the preview attempt (and fail closed) rather than hang.
        const claimed = this.claimDevPreviewPort(port);
        const isPrimary = this._forwardedPorts.length === 0;
        const isolatedUrl = this.activePreviewClaim?.port === port
            ? this.activePreviewClaim.previewUrl
            : url;
        const next: QaapForwardedPort = {
            port,
            url: isolatedUrl,
            firstSeenAt: Date.now(),
            previewOpen: false,
            primary: isPrimary,
        };
        this._forwardedPorts = [...this._forwardedPorts, next].sort((a, b) => a.firstSeenAt - b.firstSeenAt);
        this.forwardedPortsEmitter.fire(this.forwardedPorts);
        if (isPrimary) {
            // Remember the primary port so the next session can offer a "resume preview · :3001"
            // action instead of a generic "Run & Preview" CTA.
            this._lastPort = port;
            if (options?.alreadyReady) {
                void claimed.then(() => {
                    const target = this.resolvePrimaryPreviewTarget(port, isolatedUrl);
                    this._lastPort = target.port;
                    return this.openPreview(target.url, /* primary */ true, { auto: true });
                });
            } else {
                void claimed.then(() => {
                    const target = this.resolvePrimaryPreviewTarget(port, isolatedUrl);
                    this._lastPort = target.port;
                    return this.openPrimaryPreviewWhenReady(target.port, target.url, { auto: true });
                });
            }
        }
    }

    /**
     * The port allocator is authoritative for the primary preview. Detected ports (terminal
     * output, persisted `lastPort`, an inline `PORT=…` in the project's own dev script) can
     * disagree with the allocated one — e.g. Lavadiario's dev script hardcodes `PORT=8080` while
     * the claim runs the server on 3003 — and a `/qaap-dev/:port` URL for a port the claim did not
     * grant always fails closed (403). Whenever an identity claim is live, route the primary
     * preview through the claim's port and stable identity URL instead.
     */
    protected resolvePrimaryPreviewTarget(port: number, url: string): { port: number; url: string } {
        const claim = this.activePreviewClaim;
        if (claim && claim.port !== undefined && claim.port !== port) {
            return { port: claim.port, url: claim.previewUrl };
        }
        return { port, url };
    }

    /**
     * Transcript UI hook: automatic preview opens (port detected, warmup, attach) must not yank
     * the user away from the live transcript. When the gate returns false, the ready preview is
     * STAGED — state flips to `running` with the URL recorded and the "Open preview" pill appears —
     * and navigation happens only on an explicit user tap. User-initiated opens ignore the gate.
     */
    setPreviewAutoOpenGate(gate: (() => boolean) | undefined): void {
        this.previewAutoOpenGate = gate;
    }

    protected previewAutoOpenGate: (() => boolean) | undefined;

    protected mayAutoOpenPreviewNow(): boolean {
        try {
            return this.previewAutoOpenGate?.() ?? true;
        } catch {
            return true;
        }
    }

    /**
     * Tells the backend that this workspace owns {@link port}. The `/qaap-dev/:port` proxy fails
     * closed — an authenticated user may only reach ports they have claimed — so this claim is what
     * lets the owner's own preview through while denying other tenants on the shared host. Awaited
     * before the preview opens. Best-effort: swallows errors and resolves, so a claim failure lets
     * the preview attempt (and be denied) rather than hang. Same-origin fetch carries the cookie.
     */
    protected async claimDevPreviewPort(port: number): Promise<void> {
        const processRoot = this._descriptor?.rootUri ?? this.activeWorkspaceRoot;
        const claim = this.activePreviewRunId && processRoot
            ? await this.reserveActivePreview(port, processRoot)
            : await this.previewPortClaimService.claim(port);
        if (claim.kind === 'claimed' && claim.previewId && claim.previewUrl && claim.port !== undefined) {
            this.rememberActivePreviewClaim({
                previewId: claim.previewId,
                previewUrl: claim.previewUrl,
                port: claim.port,
            });
        }
    }

    /**
     * Waits until the reserved claim (or a healed preferred port) is transport-ready, then opens
     * preview. Does not open the identity holding page on a dead reserved port — that produced
     * false "Dev server reachable" toasts while `/qaap-preview/` kept returning 503.
     */
    protected async openPrimaryPreviewWhenReady(port: number, url: string, options?: { auto?: boolean }): Promise<void> {
        if (this._previewUrl) {
            return;
        }
        ({ port, url } = this.resolvePrimaryPreviewTarget(port, url));
        let ready = await waitForQaapDevPreviewPort(port, {
            maxAttempts: DEV_PREVIEW_OPEN_PROBE_ATTEMPTS,
            intervalMs: DEV_PREVIEW_OPEN_PROBE_INTERVAL_MS,
        });
        if (!ready) {
            ready = await this.healPreviewClaimToListeningPort(port);
            if (ready && this.activePreviewClaim) {
                port = this.activePreviewClaim.port;
                url = this.activePreviewClaim.previewUrl;
            }
        }
        if (this._previewUrl) {
            return;
        }
        if (!ready) {
            return;
        }
        const activeUrl = this.activePreviewClaim?.port === port
            ? this.activePreviewClaim.previewUrl
            : undefined;
        const previewId = this.activePreviewClaim?.previewId;
        if (previewId) {
            const identity = await probeQaapIdentityPreview(previewId);
            if (!identity.ready) {
                return;
            }
            await this.openPreview(identity.previewUrl || activeUrl || ready.previewUrl || url, true, options);
            return;
        }
        await this.openPreview(activeUrl ?? ready.previewUrl ?? url, true, options);
    }

    /**
     * When the reserved claim port never answers but a detected/preferred port does, re-claim so
     * the registry rebinds the same process identity before the iframe opens.
     */
    protected async healPreviewClaimToListeningPort(
        deadPort: number,
    ): Promise<Awaited<ReturnType<typeof waitForQaapDevPreviewPort>>> {
        const candidates = [
            this.activeDevPortHint,
            this._lastPort,
            this._portConflictPort,
            ...this._forwardedPorts.map(entry => entry.port),
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
            await this.claimDevPreviewPort(candidate);
            const claim = this.activePreviewClaim;
            if (!claim || claim.port === deadPort) {
                continue;
            }
            const healed = await waitForQaapDevPreviewPort(claim.port, {
                maxAttempts: 8,
                intervalMs: DEV_PREVIEW_OPEN_PROBE_INTERVAL_MS,
            });
            if (healed?.ready) {
                this._lastPort = claim.port;
                return healed;
            }
            const identity = await probeQaapIdentityPreview(claim.previewId);
            if (identity.ready) {
                this._lastPort = claim.port;
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

    /**
     * Opens an additional forwarded port in its own mini-browser tab (not the shared "Preview"
     * widget that the primary port uses). The tab is keyed on the URL so re-tapping a pill simply
     * activates the existing tab.
     */
    async openForwardedPort(port: QaapForwardedPort): Promise<void> {
        if (port.primary) {
            // Primary ports go through the shared preview widget so users can swap between dev URLs
            // without spawning new tabs by accident.
            await this.openPrimaryPreviewWhenReady(port.port, port.url);
            return;
        }
        try {
            await this.miniBrowser.open(new URI(port.url));
            this.markPortOpened(port.port, true);
        } catch (e) {
            console.error('[qaap-project-bootstrap] failed to open forwarded port', e);
        }
    }

    protected markPortOpened(port: number, open: boolean): void {
        let changed = false;
        this._forwardedPorts = this._forwardedPorts.map(p => {
            if (p.port !== port || p.previewOpen === open) {
                return p;
            }
            changed = true;
            return { ...p, previewOpen: open };
        });
        if (changed) {
            this.forwardedPortsEmitter.fire(this.forwardedPorts);
        }
    }

    /**
     * Ports to probe when attaching to an already-running dev server, most specific first.
     */
    protected collectProbePorts(plan?: { expectedPort?: number }): number[] {
        const idePort = getQaapIdeListenPort();
        const ports: number[] = [];
        if (this._portConflictPort !== undefined) {
            ports.push(this._portConflictPort);
        }
        if (plan?.expectedPort !== undefined) {
            ports.push(plan.expectedPort);
        }
        if (this.activeDevPortHint !== undefined) {
            ports.push(this.activeDevPortHint);
        }
        if (this._lastPort !== undefined) {
            ports.push(this._lastPort);
        }
        for (const port of extractDevOutputProbePorts(this.devOutputTail)) {
            ports.push(port);
        }
        return [...new Set(ports.filter(p => p > 0 && p < 65536 && p !== idePort))];
    }

    protected extractPortFromInUseMessage(text: string): number | undefined {
        const match = PORT_IN_USE_ADDR_REGEX.exec(text);
        if (!match) {
            return undefined;
        }
        const port = Number(match[1]);
        return Number.isFinite(port) ? port : undefined;
    }

    /**
     * Opens the preview on the port we asked the dev server to bind to when stdout never prints a
     * URL (common when logs still mention :3000 while the process listens on :3001).
     */
    protected scheduleDevPreviewFallback(runId: number, port: number): void {
        const tryOpen = async (): Promise<void> => {
            if (runId !== this.devRunGeneration) {
                return;
            }
            if (this._phase !== 'starting' || this._previewUrl) {
                return;
            }
            if (this._forwardedPorts.some(p => p.port === port)) {
                return;
            }
            await this.tryAttachToExistingServer([port]);
        };
        this.devPreviewFallbackTimers.push(
            window.setTimeout(() => {
                void tryOpen();
            }, 1200),
            window.setTimeout(() => {
                void tryOpen();
            }, DEV_PREVIEW_FALLBACK_MS),
        );
    }

    /**
     * Returns true when a user dev server (not the Qaap IDE) is listening and the preview was opened.
     */
    protected async tryAttachToExistingServer(ports: number[]): Promise<boolean> {
        if (ports.length === 0 || this._previewUrl) {
            return !!this._previewUrl;
        }
        for (const port of ports) {
            if (isReservedIdePort(port)) {
                continue;
            }
            // Refresh only the owner/port gate before probing. A process-scoped claim here can
            // replace the durable identity before the probe tells us which process is actually
            // listening (observed after reload with multiple restored Dev terminals). The legacy
            // claim is non-stealing and cannot adopt an unregistered listener in cloud mode.
            await this.previewPortClaimService.claim(port);
            const probe = await probeQaapDevPreviewPort(port);
            if (!probe.ready || !this.probeBelongsToActiveProject(probe.projectId)) {
                continue;
            }
            this.adoptExistingPreviewIdentity(port, probe);
            const plan = this.resolveDevPlan();
            const descriptor = this._descriptor;
            if (plan && descriptor) {
                const label = this._selectedApp?.name ?? descriptor.name;
                // Every adoption path (warmup, reload, section switch, manual open) converges here.
                // Retain only the restored terminal whose allocator marker names this claim's port.
                const restoredTerminal = await this.disposeRestoredPreviewTerminals(plan.cwd, `Dev (${label})`, port);
                if (restoredTerminal) {
                    this.watchAttachedDevTerminal(restoredTerminal, plan);
                }
            }
            this._portConflictPort = port;
            this.recordForwardedPort(port, probe.previewUrl, { alreadyReady: true });
            return true;
        }
        return false;
    }

    /**
     * A process-scoped probe is authoritative for an owner who has already passed the port gate.
     * Restore its exact identity before {@link recordForwardedPort} refreshes the claim; otherwise a
     * page reload would generate a fresh process id and reserve an unused alternate port while the
     * original dev server continued running on the remembered one.
     */
    protected adoptExistingPreviewIdentity(port: number, probe: QaapDevPreviewProbeResponse): void {
        const restored = resolveQaapReattachedPreviewIdentity(port, probe);
        if (!restored) {
            return;
        }
        this.activePreviewRunId = restored.processId;
        this.previewRunIdByConversation.set(this.activePreviewConversationId, restored.processId);
        this.rememberActivePreviewClaim(restored.claim);
    }

    /** A shared-host port is reusable only when its backend record names the selected project. */
    protected probeBelongsToActiveProject(projectId: string | undefined): boolean {
        const workspaceRoot = this.activeWorkspaceRoot ?? this._descriptor?.rootUri;
        if (!workspaceRoot) {
            return true;
        }
        if (projectId) {
            return qaapPreviewProjectIdMatches(
                projectId,
                this.previewProjectId(workspaceRoot),
                this.activeProjectId,
            );
        }
        return isLocalQaapPreviewOrigin(resolveDevPreviewPublicOrigin());
    }

    /**
     * Keeps process cleanup alive after Work Hub switches to another project. The visible bootstrap
     * listeners are intentionally detached on a switch, but this owner-scoped listener keeps the
     * durable reservation from outliving the terminal process.
     */
    protected monitorPreviewProcessLifetime(terminal: TerminalWidget, previewId: string): void {
        const lifecycle = new DisposableCollection();
        let settled = false;
        const release = (): void => {
            if (settled) {
                return;
            }
            settled = true;
            lifecycle.dispose();
            void this.previewPortClaimService.release?.(previewId);
        };
        lifecycle.push(this.terminalWatcher.onTerminalExit(event => {
            if (event.terminalId === terminal.terminalId) {
                release();
            }
        }));
        lifecycle.push(terminal.onTerminalDidClose(release));
        this.toDispose.push(lifecycle);
    }

    /**
     * Best-effort: once node-pty resolves the shell's OS PID, re-sends the claim so the backend can
     * attach it to the registry record — release-time cleanup can then SIGTERM the process group
     * even where kill-by-port is unavailable (sandboxed containers without SYS_PTRACE/lsof). Only
     * attaches if this exact claim is still the section's active one; a mid-spawn project/section
     * switch must not attach the PID to a claim it no longer belongs to.
     */
    protected attachTerminalOsProcessId(terminal: TerminalWidget, previewId: string, port: number, cwd: URI): void {
        void terminal.processId.then(pid => {
            if (this.activePreviewClaim?.previewId === previewId) {
                void this.reserveActivePreview(port, cwd, pid);
            }
        }).catch(() => undefined);
    }

    /**
     * On dev failure, try to attach to an already-running server (port conflict / tab closed while
     * another terminal still serves the app) before surfacing `run-failed`.
     */
    protected async failDevRun(
        message: string,
        plan: { command: string; cwd: URI; expectedPort?: number; kind: QaapProjectKind },
        runId: number,
    ): Promise<void> {
        if (runId !== this.devRunGeneration) {
            return;
        }
        if (this._phase !== 'starting' && this._phase !== 'running') {
            return;
        }
        // A previously opened iframe is not proof that its process is still alive. Continue through
        // the ownership-scoped probe and failure path so closed/crashed servers release their
        // durable registration instead of leaving a stale "running" preview behind.
        this._previewUrl = undefined;
        const nextLock = terminalOutputNextDevLock(this.devOutputTail);
        const portConflict = this._portConflictDetected || PORT_IN_USE_REGEX.test(message) || nextLock;
        const conflictPort = this._portConflictPort
            ?? extractDevOutputProbePorts(this.devOutputTail)[0]
            ?? this.activeDevPortHint
            ?? plan.expectedPort;
        if (!portConflict) {
            const attached = await this.tryAttachToExistingServer(this.collectProbePorts(plan));
            if (attached || this._previewUrl) {
                this._error = undefined;
                this._portConflictDetected = false;
                this.cleanupDevTerminal();
                return;
            }
        }
        const descriptor = this._descriptor;
        if (portConflict && conflictPort !== undefined && descriptor && !nextLock
            && this.automaticPortRecoveryAttempts < DEV_PORT_RECOVERY_MAX_ATTEMPTS) {
            const alternatePort = pickNextDevPort(conflictPort, [...this.attemptedDevPorts]);
            if (alternatePort !== undefined) {
                this.automaticPortRecoveryAttempts++;
                this.portRecoveryFrom = conflictPort;
                this.devPortOverride = alternatePort;
                this.cleanupDevTerminal();
                // startDevServer transitions to `starting` immediately; assigning directly avoids
                // flashing a misleading ready-to-run banner between the two attempts.
                this._phase = 'ready-to-run';
                await this.startDevServer({ ...plan }, descriptor);
                return;
            }
        }
        this._needsInstall = terminalOutputNeedsInstall(this.devOutputTail);
        const diagnosedError = nextLock
            ? extractTerminalFailureLine(this.devOutputTail, this.toUserFacingDevError(message))
            : portConflict && conflictPort
                ? `Port :${conflictPort} is already in use. Qaap exhausted ${DEV_PORT_RECOVERY_MAX_ATTEMPTS} alternate ports; stop stale dev servers, then retry.`
                : extractTerminalFailureLine(this.devOutputTail, this.toUserFacingDevError(message));
        this._error = this.enrichDevRunError(diagnosedError);
        this.releaseActivePreview();
        this.setPhase('run-failed');
    }

    protected enrichDevRunError(message: string): string {
        const previewRoot = this._selectedApp?.relativePath ?? this._descriptor?.scaffoldRelativePath;
        return enrichBootstrapDevRunError(message, previewRoot);
    }

    protected appendDevOutput(data: string): void {
        this.devOutputTail = (this.devOutputTail + data).slice(-DEV_OUTPUT_TAIL_MAX);
    }

    protected readTerminalTail(terminal: TerminalWidget, maxLines: number = 40): string {
        try {
            const length = terminal.buffer.length;
            const start = Math.max(0, length - maxLines);
            return terminal.buffer.getLines(start, length - start, true).join('\n');
        } catch {
            return '';
        }
    }

    protected async spawnCommandWithRetry(options: {
        title: string;
        command: string;
        cwd: URI;
        reveal?: boolean;
    }): Promise<TerminalWidget> {
        let lastError: unknown;
        for (let attempt = 0; attempt < TERMINAL_SPAWN_MAX_ATTEMPTS; attempt++) {
            if (attempt > 0) {
                await this.delay(TERMINAL_SPAWN_RETRY_DELAY_MS * attempt);
            }
            try {
                const terminal = await this.spawnCommand(options);
                await this.delay(TERMINAL_READY_DELAY_MS);
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

    protected delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /** Re-scan `node_modules` / dev tooling after a successful install. */
    protected async refreshDescriptorAfterInstall(): Promise<void> {
        const roots = this.activeWorkspaceRoot ? undefined : await this.workspaceService.roots;
        const root = this.activeWorkspaceRoot ?? this._descriptor?.rootUri ?? roots?.[0]?.resource;
        if (!root) {
            return;
        }
        const descriptor = await this.detector.detect(root);
        if (descriptor) {
            this._descriptor = descriptor;
        }
    }

    /**
     * Identity of the preview surface for the active project.
     *
     * Must use the exact same fallback as {@link reserveActivePreview} so the widget key and the
     * server-side claim always describe the same project; a divergence would open two tabs.
     */
    protected previewWidgetKey(): QaapPreviewWidgetKey | undefined {
        const workspaceRoot = this.activeWorkspaceRoot ?? this._descriptor?.rootUri;
        if (!workspaceRoot) {
            return undefined;
        }
        return {
            workspaceId: workspaceRoot.toString(),
            projectId: this.previewProjectId(workspaceRoot)
        };
    }

    /** Routes to the project-scoped preview widget when the Qaap open handler is bound. */
    protected async openPreviewWidget(url: string): Promise<void> {
        const key = this.previewWidgetKey();
        const handler = this.miniBrowser as Partial<QaapProjectPreviewOpener>;
        if (key && typeof handler.openProjectPreview === 'function') {
            await handler.openProjectPreview(url, key);
            return;
        }
        await this.miniBrowser.openPreview(url);
    }

    /**
     * Open or stage a preview URL.
     * - `{ auto: true }` + gate closed → stage URL / Open-preview pill only (no navigation).
     * - `{ silent: true }` → mount the widget for capture without mirroring into the Work Hub tab.
     * - default (user tap / focusPreview) → navigate and emit `qaap-bootstrap-preview-opened`
     *   with `userInitiated: true` so the hub Preview tab can mirror the open.
     */
    async openPreview(
        url: string,
        isPrimary: boolean = true,
        options?: { auto?: boolean; silent?: boolean },
    ): Promise<void> {
        let identity: ReturnType<typeof parsePreviewIdentityPath>;
        try {
            identity = parsePreviewIdentityPath(new URL(url, resolveDevPreviewPublicOrigin()).pathname);
        } catch {
            identity = undefined;
        }
        if (identity) {
            const probe = await probeQaapIdentityPreview(identity.previewId);
            if (!probe.ready) {
                await this.reconcileSupersededPreviewClaim();
            }
        }
        // Re-claim the target port right before opening: claims are TTL'd server-side and the
        // proxy fails closed, so an open without a live claim 403s the owner's own preview.
        const targetPortForClaim = this.extractPort(url);
        if (targetPortForClaim !== undefined && !isReservedIdePort(targetPortForClaim)) {
            await this.claimDevPreviewPort(targetPortForClaim);
        }
        const activeClaim = this.activePreviewClaim;
        const targetUrl = activeClaim && activeClaim.port === targetPortForClaim
            ? rebasePreviewUrlToIdentityClaim(url, activeClaim.previewUrl)
            : url;
        if (options?.auto && !this.mayAutoOpenPreviewNow()) {
            // Stage instead of navigating: record the ready URL and flip to `running` so the
            // transcript listener offers the "Open preview" pill; the user performs navigation.
            this._previewUrl = targetUrl;
            this.persistPhase('running');
            this.setPhase('running');
            this.syncHubSession('running');
            return;
        }
        try {
            await this.openPreviewWidget(targetUrl);
            this._previewUrl = targetUrl;
            if (isPrimary) {
                const targetPort = this.extractPort(targetUrl);
                if (targetPort !== undefined) {
                    this.markPortOpened(targetPort, true);
                }
            }
            this.persistPhase('running');
            this.setPhase('running');
            this.syncHubSession('running');
            if (typeof window !== 'undefined' && !options?.silent) {
                window.dispatchEvent(new CustomEvent('qaap-bootstrap-preview-opened', {
                    detail: { url: targetUrl, userInitiated: !options?.auto },
                }));
            }
            this.syncMiniBrowserPreviewSuspensionAfterOpen();
        } catch (e) {
            console.error('[qaap-project-bootstrap] failed to open preview', e);
            this._error = e instanceof Error ? e.message : String(e);
            this.setPhase('run-failed');
        }
    }

    protected syncMiniBrowserPreviewSuspensionAfterOpen(): void {
        if (!matchesMobileOneColumnLayout()) {
            return;
        }
        syncQaapMiniBrowserPreviewSuspension(this.shell, peekPreferDesktopIde());
    }

    protected async spawnCommand(options: {
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
        const terminalCwd = FileUri.fsPath(options.cwd.toString());
        const { shellPath, shellArgs } = this.buildShellInvocation(options.command, terminalCwd);
        const terminal = await this.terminalService.newTerminal({
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
            this.terminalService.open(terminal, { mode: matchesMobileOneColumnLayout() ? 'open' : 'reveal' });
        }
        return terminal;
    }

    /** Disposes restored preview terminals whose port marker or backend claim is stale after reload. */
    protected async reconcileRestoredPreviewTerminals(): Promise<void> {
        const roots = await this.workspaceService.roots;
        const workspaceRoots = roots.map(entry => entry.resource.toString());
        if (workspaceRoots.length === 0) {
            return;
        }
        const toDispose: TerminalWidget[] = [];
        for (const terminal of [...this.terminalService.all]) {
            if (terminal === this.devTerminal || terminal.isDisposed) {
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
            this.disposeBootstrapTerminal(terminal);
        }
        await new Promise<void>(resolve => window.setTimeout(resolve, RESTORED_PREVIEW_TERMINAL_STOP_DELAY_MS));
    }

    /** Stops only stale preview terminals for the exact app root before a replacement is spawned. */
    protected async disposeRestoredPreviewTerminals(
        cwd: URI,
        title: string,
        keepPort?: number,
    ): Promise<TerminalWidget | undefined> {
        const expectedCwd = cwd.toString();
        const matches: TerminalWidget[] = [];
        let retained: TerminalWidget | undefined;
        for (const terminal of [...this.terminalService.all]) {
            if (terminal === this.devTerminal || terminal.isDisposed) {
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
            this.disposeBootstrapTerminal(terminal);
        }
        await new Promise<void>(resolve => window.setTimeout(resolve, RESTORED_PREVIEW_TERMINAL_STOP_DELAY_MS));
        return retained;
    }

    /** Restores crash/error handling as well as the URL when a live terminal survives a reload. */
    protected watchAttachedDevTerminal(
        terminal: TerminalWidget,
        plan: { command: string; cwd: URI; expectedPort?: number; kind: QaapProjectKind },
    ): void {
        if (terminal === this.devTerminal) {
            return;
        }
        const runId = this.devRunGeneration;
        this.devTerminal = terminal;
        this.devTerminalConversationId = this.activePreviewConversationId;
        this.devTerminalListener.dispose();
        const onOutput = terminal.onOutput(data => this.appendDevOutput(data));
        const onProcessExit = this.terminalWatcher.onTerminalExit(event => {
            if (event.terminalId === terminal.terminalId && runId === this.devRunGeneration) {
                void this.failDevRun(nls.localize(
                    'qaap/projectBootstrap/devServerExited',
                    'Dev server exited with code {0}.',
                    String(event.code ?? '?'),
                ), plan, runId);
            }
        });
        const onWidgetClose = terminal.onTerminalDidClose(() => {
            if (runId === this.devRunGeneration) {
                void this.failDevRun(nls.localize(
                    'qaap/projectBootstrap/devServerTabClosed',
                    'Dev server tab closed.',
                ), plan, runId);
            }
        });
        this.devTerminalListener = new DisposableCollection(onOutput, onProcessExit, onWidgetClose);
        this.toDispose.push(this.devTerminalListener);
        const previewId = this.activePreviewClaim?.previewId;
        if (previewId) {
            this.monitorPreviewProcessLifetime(terminal, previewId);
        }
    }

    /** Maps low-level terminal backend errors to actionable copy for the bootstrap banner. */
    protected toUserFacingDevError(message: string): string {
        if (isTerminalDoesNotExistError(message)) {
            return 'The install/dev terminal was closed too early (often a double tap on Preview or a workspace refresh). Wait a moment, then tap Retry once.';
        }
        if (/ENOENT|no such file or directory/i.test(message)) {
            return 'Project folder not found on the server. Re-open the repo from Projects.';
        }
        if (/command not found|not found:/i.test(message)) {
            const pm = this._descriptor?.packageManager ?? 'npm';
            const kind = this._descriptor?.kind;
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

    /** Picks the right shell wrapper for the host platform. */
    protected buildShellInvocation(command: string, cwd: string): { shellPath: string; shellArgs: string[] } {
        // Keep `cwd` in the terminal options for normal Theia behavior AND make it part of the
        // managed command. The latter is a fail-safe for mobile terminal restoration: live VPS
        // evidence showed a recreated widget falling back to the IDE's `/app/examples/browser`
        // working directory and running another package's npm scripts.
        return buildQaapManagedShellInvocation(command, cwd);
    }

    /**
     * Resolves once the spawned process exits. We do NOT rely on `onTerminalDidClose` here —
     * that only fires when the *widget* is disposed (e.g. user clicks the X tab). The actual
     * process exit is broadcast via {@link TerminalWatcher.onTerminalExit}; we filter by the
     * terminal's id so concurrent install / dev terminals don't cross-resolve.
     */
    protected waitForExit(terminal: TerminalWidget): Promise<number | undefined> {
        return new Promise(resolve => {
            // Edge case: the process may already be gone by the time we subscribe (very fast
            // commands), so check the synchronous status first.
            if (terminal.exitStatus) {
                resolve(terminal.exitStatus.code);
                return;
            }
            const subscription = this.terminalWatcher.onTerminalExit(event => {
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

    /** Stops listeners/timers and the current dev terminal before a new dev run (keeps other Dev tabs). */
    protected beginDevRun(): void {
        this.devRunGeneration++;
        this.releaseActivePreview();
        this.cancelDevPreviewFallbacks();
        if (this.devTerminalConversationId === this.activePreviewConversationId) {
            this.cleanupDevTerminal();
        }
    }

    protected releaseActivePreview(): void {
        const scope = this.activePreviewConversationId;
        const claim = this.previewClaimByConversation.get(scope);
        this.previewClaimByConversation.delete(scope);
        this.activePreviewClaim = undefined;
        if (claim) {
            void this.previewPortClaimService.release?.(claim.previewId);
        }
        this.activePreviewRunId = this.previewRunIdByConversation.get(scope);
    }

    /**
     * Releases the backend dev-preview claim AND the dev-server terminal owned by a specific
     * conversation/section — used when a task or project is deleted while it is NOT the active
     * section. {@link releaseActivePreview} only touches the active scope, so without this a closed
     * section's dev server keeps running on the VPS (holding a port + RAM) and its terminal widget
     * leaks. Never disturbs the active claim/terminal unless the released scope is the active one.
     */
    releasePreviewForConversation(conversationId: string | undefined): void {
        const scope = normalizeQaapPreviewConversationId(conversationId);
        const claim = this.previewClaimByConversation.get(scope);
        if (!claim) {
            return;
        }
        this.previewClaimByConversation.delete(scope);
        this.previewRunIdByConversation.delete(scope);
        if (this.activePreviewConversationId === scope) {
            this.activePreviewClaim = undefined;
        }
        void this.previewPortClaimService.release?.(claim.previewId);
        // Dispose the dev-server terminal if it belongs to this conversation. The terminal is
        // per-section (keyed by devTerminalConversationId), so closing a task must release its
        // terminal without killing another section's dev terminal.
        if (this.devTerminalConversationId === scope) {
            this.devTerminalListener.dispose();
            this.devTerminalListener = Disposable.NULL;
            this.disposeBootstrapTerminal(this.devTerminal);
            this.devTerminal = undefined;
            this.devTerminalConversationId = undefined;
        }
    }

    /** Full reset when switching workspace or reloading bootstrap state. */
    protected resetBootstrapSessionForWorkspace(): void {
        this.installGeneration++;
        // A hosted Work Hub switches between many project roots inside one Theia workspace. Do
        // not dispose the previous project's terminal/process here: doing so made simultaneous
        // previews impossible and turned every project switch into a race for the default port.
        this.devRunGeneration++;
        this.cancelDevPreviewFallbacks();
        this.cancelDevPreviewHealthMonitor();
        this.devTerminalListener.dispose();
        this.devTerminalListener = Disposable.NULL;
        this.devTerminal = undefined;
        this.activePreviewClaim = undefined;
        this.devPortOverride = undefined;
        this.automaticPortRecoveryAttempts = 0;
        this.attemptedDevPorts.clear();
        this.portRecoveryFrom = undefined;
        this.activeDevPortHint = undefined;
        this.activePreviewRunId = undefined;
        this.activePreviewConversationId = QAAP_DEFAULT_PREVIEW_CONVERSATION_ID;
        this.previewRunIdByConversation.clear();
        this.previewClaimByConversation.clear();
        this.devTerminalConversationId = undefined;
        this.disposeBootstrapTerminal(this.installTerminal);
        this.installTerminal = undefined;
    }

    protected cancelDevPreviewFallbacks(): void {
        for (const timerId of this.devPreviewFallbackTimers) {
            window.clearTimeout(timerId);
        }
        this.devPreviewFallbackTimers = [];
        this.cancelDevPreviewWarmup();
    }

    /**
     * After reload, try to attach to a remembered port or restart the dev server (v0 warmup).
     * Skipped when the user dismissed setup or dependencies are still missing.
     */
    protected scheduleDevPreviewWarmup(): void {
        if (typeof window === 'undefined') {
            return;
        }
        if (this._phase !== 'ready-to-run' || this._lastPort === undefined || !this.resolveDevPlan()) {
            return;
        }
        this.cancelDevPreviewWarmup();
        this.devPreviewWarmupTimer = window.setTimeout(() => {
            this.devPreviewWarmupTimer = undefined;
            void this.warmupDevPreview();
        }, DEV_PREVIEW_WARMUP_DELAY_MS);
    }

    protected cancelDevPreviewWarmup(): void {
        if (typeof window !== 'undefined' && this.devPreviewWarmupTimer !== undefined) {
            window.clearTimeout(this.devPreviewWarmupTimer);
            this.devPreviewWarmupTimer = undefined;
        }
    }

    /**
     * A restored iframe can keep displaying its last document after the process and claim are
     * gone. Poll the owner-scoped probe so that terminal restoration order cannot leave a stale
     * frame masquerading as a running preview.
     */
    protected startDevPreviewHealthMonitor(): void {
        this.cancelDevPreviewHealthMonitor();
        if (typeof window === 'undefined') {
            return;
        }
        const runId = this.devRunGeneration;
        const check = async (): Promise<void> => {
            this.devPreviewHealthTimer = undefined;
            if (this._phase !== 'running' || runId !== this.devRunGeneration) {
                return;
            }
            const port = this.activePreviewClaim?.port ?? this._lastPort;
            const plan = this.resolveDevPlan();
            if (port === undefined || !plan) {
                return;
            }
            const probe = await probeQaapDevPreviewPort(port);
            if (this._phase !== 'running' || runId !== this.devRunGeneration) {
                return;
            }
            if (probe.ready && this.probeBelongsToActiveProject(probe.projectId)) {
                this.devPreviewHealthFailures = 0;
            } else {
                this.devPreviewHealthFailures++;
                if (this.devPreviewHealthFailures >= DEV_PREVIEW_HEALTH_FAILURE_LIMIT) {
                    await this.failDevRun(
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
            this.devPreviewHealthTimer = window.setTimeout(() => void check(), DEV_PREVIEW_HEALTH_INTERVAL_MS);
        };
        this.devPreviewHealthTimer = window.setTimeout(() => void check(), DEV_PREVIEW_HEALTH_INTERVAL_MS);
    }

    protected cancelDevPreviewHealthMonitor(): void {
        if (typeof window !== 'undefined' && this.devPreviewHealthTimer !== undefined) {
            window.clearTimeout(this.devPreviewHealthTimer);
        }
        this.devPreviewHealthTimer = undefined;
        this.devPreviewHealthFailures = 0;
    }

    protected async warmupDevPreview(): Promise<void> {
        if (this._phase !== 'ready-to-run' || this._previewUrl || this._lastPort === undefined) {
            return;
        }
        await this.reconcileRestoredPreviewTerminals();
        if (await this.tryAttachToExistingServer([this._lastPort])) {
            return;
        }
        if (this.resolveDevPlan()) {
            await this.runDevServer();
        }
    }

    protected cleanupDevTerminal(): void {
        this.devTerminalListener.dispose();
        this.devTerminalListener = Disposable.NULL;
        this.disposeBootstrapTerminal(this.devTerminal);
        this.devTerminal = undefined;
    }

    protected disposeBootstrapTerminal(terminal: TerminalWidget | undefined): void {
        if (!terminal) {
            return;
        }
        try {
            if (!terminal.isDisposed) {
                terminal.dispose();
            }
        } catch {
            /* widget may already be gone after a full page reload */
        }
    }

    protected clearForwardedPorts(): void {
        if (this._forwardedPorts.length === 0) {
            return;
        }
        this._forwardedPorts = [];
        this.forwardedPortsEmitter.fire([]);
    }

    protected buildStateChange(phase: QaapBootstrapPhase): QaapBootstrapStateChange {
        const portInUse = phase === 'run-failed'
            && (this._portConflictDetected
                || PORT_IN_USE_REGEX.test(this._error ?? '')
                || terminalOutputNextDevLock(this.devOutputTail));
        const existingServerPort = this._portConflictPort
            ?? extractDevOutputProbePorts(this.devOutputTail)[0]
            ?? this._lastPort;
        const failure = phase === 'install-failed' || phase === 'run-failed'
            ? diagnoseBootstrapFailure(this.devOutputTail || this._error || '', this._error ?? 'Dev server failed')
            : undefined;
        return {
            phase,
            descriptor: this._descriptor,
            previewUrl: this._previewUrl,
            error: this._error,
            needsInstall: this._needsInstall || undefined,
            selectedApp: this._selectedApp,
            lastPort: this._lastPort,
            portInUse: portInUse || undefined,
            existingServerPort: portInUse ? existingServerPort : undefined,
            failureKind: terminalOutputNextDevLock(this.devOutputTail)
                ? 'next-lock'
                : portInUse ? 'port-conflict' : failure?.kind,
            activePort: this.activeDevPortHint,
            previewRunId: this.activePreviewRunId,
            portRecoveryFrom: this.portRecoveryFrom,
            missingDescriptorHint: this._missingDescriptorHint,
        };
    }

    protected setPhase(phase: QaapBootstrapPhase): void {
        const previousPhase = this._phase;
        this._phase = phase;
        if (phase === 'running') {
            // Several preview surfaces can report the same ready URL concurrently. Do not keep
            // postponing the health check every time a duplicate `running` state is published.
            if (previousPhase !== 'running') {
                this.startDevPreviewHealthMonitor();
            }
        } else {
            this.cancelDevPreviewHealthMonitor();
        }
        this.stateEmitter.fire(this.buildStateChange(phase));
        this.syncHubSession(phase);
    }

    protected syncHubSession(phase: QaapBootstrapPhase): void {
        const agentState = phase === 'running' ? 'working'
            : phase === 'install-failed' || phase === 'run-failed' ? 'review'
                : phase === 'idle' || phase === 'dismissed' ? 'idle'
                    : 'working';
        void this.hubProjects.recordProjectSession({
            repoKey: this.activeProjectId,
            bootstrapPhase: phase,
            previewUrl: this._previewUrl,
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

    protected persistPhase(phase: QaapBootstrapPhase, selectedApp?: QaapMonorepoAppCandidate): void {
        const descriptor = this._descriptor;
        if (!descriptor || typeof localStorage === 'undefined') {
            return;
        }
        const all = this.readAllPersisted();
        const next: PersistedEntry = {
            root: descriptor.rootUri.toString(),
            phase,
            name: descriptor.name,
            selectedAppPath: (selectedApp ?? this._selectedApp)?.relativePath,
            lastPort: this._lastPort,
        };
        all[next.root] = next;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
        } catch {
            /* quota exceeded — non-fatal */
        }
    }

    protected readPersisted(rootKey: string): PersistedEntry | undefined {
        return this.readAllPersisted()[rootKey];
    }

    protected readAllPersisted(): Record<string, PersistedEntry> {
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
}
