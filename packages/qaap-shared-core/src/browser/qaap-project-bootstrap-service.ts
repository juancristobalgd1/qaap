// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import URI from '@theia/core/lib/common/uri';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { QaapPreviewPortClaimService } from '@theia/qaap-adapters/lib/browser/qaap-preview-port-claim-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { TerminalWatcher } from '@theia/terminal/lib/common/terminal-watcher';
import { MiniBrowserOpenHandler } from '@theia/mini-browser/lib/browser/mini-browser-open-handler';
import { QaapPreviewWidgetKey } from './qaap-project-preview-opener';
import { QaapProjectBootstrapDetector } from './qaap-project-bootstrap-detector';
import {
    QaapBootstrapPhase,
    QaapForwardedPort,
    QaapMonorepoAppCandidate,
    QaapPreviewReadiness,
    QaapProjectDescriptor,
    QaapProjectKind,
} from './qaap-project-bootstrap-types';
import {
    waitForQaapDevPreviewPort,
} from './qaap-dev-preview-client';
import {
    type QaapBootstrapFailureKind,
} from './qaap-project-bootstrap-dev-errors';
import { MobileProjectsService } from './mobile-projects-service';
import {
    enrichBootstrapDevRunError,
} from '../common/qaap-project-bootstrap-scaffold-plan';
import type { QaapPreviewPortClaimResult } from '@theia/qaap-adapters/lib/browser/qaap-preview-port-claim-service';
import { type QaapDevPreviewProbeResponse } from '../common/qaap-dev-preview';
import {
    QAAP_DEFAULT_PREVIEW_CONVERSATION_ID,
} from '../common/qaap-preview-identity';
import {
    previewProjectId as previewProjectIdHelper,
    normalizeDevUrl as normalizeDevUrlHelper,
    extractPortFromInUseMessage as extractPortFromInUseMessageHelper,
    normalizeRestoredPhase as normalizeRestoredPhaseHelper,
    readTerminalTail as readTerminalTailHelper,
    disposeBootstrapTerminal as disposeBootstrapTerminalHelper,
    delay as delayHelper,
} from './qaap-project-bootstrap-helpers';
import { buildShellInvocationExtracted, disposeRestoredPreviewTerminalsExtracted, failDevRunExtracted, openPreviewExtracted, openPreviewWidgetExtracted, previewWidgetKeyExtracted, reconcileRestoredPreviewTerminalsExtracted, refreshDescriptorAfterInstallExtracted, spawnCommandExtracted, spawnCommandWithRetryExtracted, syncMiniBrowserPreviewSuspensionAfterOpenExtracted, toUserFacingDevErrorExtracted, watchAttachedDevTerminalExtracted } from './qaap-project-bootstrap-service-activity';
import { adoptSupersedingPreviewClaimExtracted, bindPreviewConversationExtracted, buildDevSpawnPlanExtracted, claimPreviewExecutionExtracted, describeRunnableAppExtracted, ensurePreviewProcessIdForConversationExtracted, getBootstrapFailureDetailExtracted, getMissingDescriptorHintExtracted, initExtracted, reconcileSupersededPreviewClaimExtracted, refreshFromProjectRootExtracted, rememberActivePreviewClaimExtracted, reserveActivePreviewExtracted, resolveDevPlanExtracted, resolveInstallPlanExtracted, selectMonorepoAppExtracted, stopManagedDevServerForAppSwitchExtracted, switchMonorepoAppExtracted } from './qaap-project-bootstrap-service-render';
import { cancelActivePreviewLaunchExtracted, focusPreviewExtracted, openExistingPreviewExtracted, refreshFromCurrentWorkspaceExtracted, refreshFromRootExtracted, resetExtracted, runDevServerExtracted, runInstallExtracted, scheduleRefreshFromCurrentWorkspaceExtracted, skipExtracted, startDevServerExtracted } from './qaap-project-bootstrap-service-streaming';
import { adoptExistingPreviewIdentityExtracted, attachTerminalOsProcessIdExtracted, claimDevPreviewPortExtracted, collectProbePortsExtracted, extractPortExtracted, healPreviewClaimToListeningPortExtracted, markPortOpenedExtracted, mayAutoOpenPreviewNowExtracted, monitorPreviewProcessLifetimeExtracted, openPrimaryPreviewWhenReadyExtracted, probeBelongsToActiveProjectExtracted, recordForwardedPortExtracted, resolvePrimaryPreviewTargetExtracted, scanDevOutputExtracted, scanForDevUrlExtracted, scheduleDevPreviewFallbackExtracted, tryAttachToExistingServerExtracted } from './qaap-project-bootstrap-service-timeline';
import { beginDevRunExtracted, buildStateChangeExtracted, cancelDevPreviewFallbacksExtracted, cancelDevPreviewHealthMonitorExtracted, cancelDevPreviewWarmupExtracted, cleanupDevTerminalExtracted, clearForwardedPortsExtracted, persistPhaseExtracted, readAllPersistedExtracted, registerDevTerminalForConversationExtracted, releaseActivePreviewExtracted, releaseDevTerminalForConversationExtracted, releasePreviewForConversationExtracted, resetBootstrapSessionForWorkspaceExtracted, scheduleDevPreviewWarmupExtracted, setPhaseExtracted, startDevPreviewHealthMonitorExtracted, syncHubSessionExtracted, waitForExitExtracted, warmupDevPreviewExtracted } from './qaap-project-bootstrap-service-tool-pills';

/** Storage key used to remember per-workspace user intent (skip / installed). */
export const STORAGE_KEY = 'qaap.projectBootstrap.state.v1';

/**
 * Matches `http(s)://host:port` tokens printed by common dev servers (Vite, Next, CRA, Astro,
 * Remix, Nuxt). Hosts are restricted to local addresses so we do not pick up unrelated URLs that
 * the user may print in logs (e.g. external API endpoints in startup banners).
 * Used with `matchAll` so a single chunk can yield multiple ports.
 */
export const DEV_URL_REGEX = /\b(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::(\d{2,5}))?\/?[^\s\u001b]*)/gi;

/** Strip ANSI escape sequences so URL detection works against raw xterm output. */
export const ANSI_REGEX = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** Node / Theia / Vite emit this when the dev port is already bound by another process. */
export { PORT_IN_USE_REGEX } from './qaap-project-bootstrap-dev-errors';

/** Keep only the tail of dev stdout so we can surface the last error line on fast exit. */
const DEV_OUTPUT_TAIL_MAX = 12_000;

/** Retries when mobile UI disposes the terminal widget before the backend session is ready. */
export const TERMINAL_SPAWN_MAX_ATTEMPTS = 3;
export const TERMINAL_SPAWN_RETRY_DELAY_MS = 450;
export const TERMINAL_READY_DELAY_MS = 120;
/** Let destroyTermOnClose release a restored preview's listener before reserving its replacement. */
export const RESTORED_PREVIEW_TERMINAL_STOP_DELAY_MS = 500;

/** After this delay, open the hinted preview URL even when stdout never prints a parseable URL. */
export const DEV_PREVIEW_FALLBACK_MS = 2500;

/** Poll the backend probe before opening preview (Replit-style: wait until the port responds). */
export const DEV_PREVIEW_OPEN_PROBE_ATTEMPTS = 60;
export const DEV_PREVIEW_OPEN_PROBE_INTERVAL_MS = 500;

/** Give slower package managers/frameworks enough time to expose their first HTTP response. */
/** Retry only transient process exits; never loop on install or port conflicts. */
export const DEV_PREVIEW_AUTO_RETRY_MAX_ATTEMPTS = 2;
export const DEV_PREVIEW_AUTO_RETRY_DELAY_MS = 1_500;

/** Delay before auto-attaching or restarting a remembered dev port after workspace load. */
export const DEV_PREVIEW_WARMUP_DELAY_MS = 800;
/** Detect a dead restored process even when Theia reconstructs its terminal after the preview URL. */
export const DEV_PREVIEW_HEALTH_INTERVAL_MS = 2500;
export const DEV_PREVIEW_HEALTH_FAILURE_LIMIT = 2;
/** Bounded conflict recovery: enough to escape a cluster of stale dev servers without looping forever. */
export const DEV_PORT_RECOVERY_MAX_ATTEMPTS = 8;

export interface QaapBootstrapStateChange {
    readonly phase: QaapBootstrapPhase;
    /** Fine-grained readiness while the durable phase remains `starting`/`running`. */
    readonly previewReadiness?: QaapPreviewReadiness;
    /** Recent dev-server output for startup diagnostics and the visible Preview log. */
    readonly previewLogTail?: string;
    /** True when the server did not answer within the bounded readiness window. */
    readonly previewWaitTimedOut?: boolean;
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

export interface PersistedEntry {
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
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public readonly workspaceService: WorkspaceService;

    @inject(QaapProjectBootstrapDetector)
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public readonly detector: QaapProjectBootstrapDetector;

    @inject(TerminalService)
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public readonly terminalService: TerminalService;

    @inject(TerminalWatcher)
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public readonly terminalWatcher: TerminalWatcher;

    @inject(MiniBrowserOpenHandler)
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public readonly miniBrowser: MiniBrowserOpenHandler;

    @inject(MobileProjectsService)
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public readonly hubProjects: MobileProjectsService;

    @inject(ApplicationShell)
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public readonly shell: ApplicationShell;

    @inject(QaapPreviewPortClaimService)
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public readonly previewPortClaimService: QaapPreviewPortClaimService;

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public readonly toDispose = new DisposableCollection();
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public readonly stateEmitter = new Emitter<QaapBootstrapStateChange>();
    readonly onStateChange: Event<QaapBootstrapStateChange> = this.stateEmitter.event;

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public readonly forwardedPortsEmitter = new Emitter<QaapForwardedPort[]>();

    protected readonly devOutputEmitter = new Emitter<string>();
    /** Fires whenever new dev-server output is appended (for live streaming in the Preview tab). */
    readonly onDevOutput: Event<string> = this.devOutputEmitter.event;

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public _forwardedPorts: QaapForwardedPort[] = [];
    get forwardedPorts(): QaapForwardedPort[] { return this._forwardedPorts.slice(); }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public _phase: QaapBootstrapPhase = 'idle';
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public _descriptor: QaapProjectDescriptor | undefined;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public _previewUrl: string | undefined;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public _previewReadiness: QaapPreviewReadiness | undefined;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public _previewWaitTimedOut = false;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public _error: string | undefined;
    /**
     * Set when dev stdout indicates missing devDependencies (typical on NODE_ENV=production hosts).
     * @internal Used by the extracted qaap-project-bootstrap-service-* modules.
     */
    public _needsInstall = false;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public _selectedApp: QaapMonorepoAppCandidate | undefined;
    /**
     * Monotonically invalidates an app switch which was overtaken by a later picker tap.
     * We keep the currently-running app selected until its Qaap-managed terminal is stopped, so
     * the UI can never label app B as running while app A is still the live process.
     * @internal Used by the extracted qaap-project-bootstrap-service-* modules.
     */
    public monorepoAppSwitchGeneration = 0;
    /**
     * Target currently being switched to; makes a repeated tap on the same item idempotent.
     * @internal Used by the extracted qaap-project-bootstrap-service-* modules.
     */
    public pendingMonorepoAppPath: string | undefined;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public monorepoAppSwitchPromise: Promise<void> | undefined;
    /**
     * Primary port the dev server last bound to. Used to label "resume preview" once we restore.
     * @internal Used by the extracted qaap-project-bootstrap-service-* modules.
     */
    public _lastPort: number | undefined;
    /**
     * Set when stdout mentions `EADDRINUSE` so failure handlers can offer recovery.
     * @internal Used by the extracted qaap-project-bootstrap-service-* modules.
     */
    public _portConflictDetected = false;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public _portConflictPort: number | undefined;
    /**
     * Invalidates stale terminal exit/close callbacks when a new dev run starts.
     * @internal Used by the extracted qaap-project-bootstrap-service-* modules.
     */
    public devRunGeneration = 0;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public devRunCancelledByUser = false;
    /**
     * Invalidates in-flight install when the workspace session is reset.
     * @internal Used by the extracted qaap-project-bootstrap-service-* modules.
     */
    public installGeneration = 0;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public refreshDebounceTimer: number | undefined;
    /**
     * Port we asked the dev server to bind to (may differ from the framework default when Qaap uses :3000).
     * @internal Used by the extracted qaap-project-bootstrap-service-* modules.
     */
    public activeDevPortHint: number | undefined;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public activePreviewRunId: string | undefined;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public activePreviewConversationId: string = QAAP_DEFAULT_PREVIEW_CONVERSATION_ID;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public readonly previewRunIdByConversation = new Map<string, string>();
    /**
     * Live claims keyed by conversation/section so section B cannot release section A's preview.
     * @internal Used by the extracted qaap-project-bootstrap-service-* modules.
     */
    public readonly previewClaimByConversation = new Map<string, {
        readonly previewId: string;
        readonly previewUrl: string;
        readonly port: number;
    }>();
    /**
     * Per-conversation dev terminal registry: supports multiple simultaneous dev servers
     * (one per section/conversation). The singular {@link devTerminal} field remains as
     * a pointer to the active conversation's terminal for backward compatibility with the
     * ~75 existing references; this map is the source of truth.
     * @internal Used by the extracted qaap-project-bootstrap-service-* modules.
     */
    public readonly devTerminalByConversationId = new Map<string, {
        readonly terminal: TerminalWidget;
        readonly listener: Disposable;
    }>();
    /**
     * Conversation that owns {@link devTerminal}, when a dev run is in flight or attached.
     * @internal Used by the extracted qaap-project-bootstrap-service-* modules.
     */
    public devTerminalConversationId: string | undefined;
    /**
     * Project selected in Work Hub; hosted `/workspace` is never a valid substitute.
     * @internal Used by the extracted qaap-project-bootstrap-service-* modules.
     */
    public activeProjectId: string | undefined;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public activeWorkspaceRoot: URI | undefined;
    /**
     * Work Hub project root pinned by {@link refreshFromProjectRoot}. While set, Theia workspace
     * change events must not rewrite preview identity back to the currently open IDE folder.
     * @internal Used by the extracted qaap-project-bootstrap-service-* modules.
     */
    public hubPinnedWorkspaceRoot: URI | undefined;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public activePreviewClaim: {
        readonly previewId: string;
        readonly previewUrl: string;
        readonly port: number;
    } | undefined;
    /**
     * One-run override used after an occupied port fails to expose a usable HTTP preview.
     * @internal Used by the extracted qaap-project-bootstrap-service-* modules.
     */
    public devPortOverride: number | undefined;
    /**
     * Prevents an unhealthy project from cycling through ports forever.
     * @internal Used by the extracted qaap-project-bootstrap-service-* modules.
     */
    public automaticPortRecoveryAttempts = 0;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public readonly attemptedDevPorts = new Set<number>();
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public portRecoveryFrom: number | undefined;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public previewAutoRetryAttempts = 0;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public previewAutoRetryTimer: number | undefined;
    /**
     * Tracks the in-flight install/dev terminals so we can clean up on workspace switch.
     * @internal Used by the extracted qaap-project-bootstrap-service-* modules.
     */
    public installTerminal: TerminalWidget | undefined;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public devTerminal: TerminalWidget | undefined;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public devTerminalListener = Disposable.NULL;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public devPreviewFallbackTimers: number[] = [];
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public devPreviewWarmupTimer: number | undefined;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public devPreviewHealthTimer: number | undefined;
    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public devPreviewHealthFailures = 0;
    /**
     * Rolling tail of the current dev terminal output for failure diagnostics.
     * @internal Used by the extracted qaap-project-bootstrap-service-* modules.
     */
    public devOutputTail = '';
    /**
     * Set when detection finds no runnable project — explains orphan scaffolds vs empty workspace.
     * @internal Used by the extracted qaap-project-bootstrap-service-* modules.
     */
    public _missingDescriptorHint: string | undefined;

    @postConstruct()
    protected init(): void {
        initExtracted(this);
    }

    get phase(): QaapBootstrapPhase { return this._phase; }
    get needsInstall(): boolean { return this._needsInstall; }
    get descriptor(): QaapProjectDescriptor | undefined { return this._descriptor; }
    get previewUrl(): string | undefined { return this._previewUrl; }
    get selectedApp(): QaapMonorepoAppCandidate | undefined { return this._selectedApp; }
    get lastPort(): number | undefined { return this._lastPort; }
    get previewId(): string | undefined { return this.activePreviewClaim?.previewId; }
    /** Stable identity URL of the live claim — the authoritative navigation target for the primary preview. */
    get previewClaimUrl(): string | undefined { return this.activePreviewClaim?.previewUrl; }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public bindPreviewConversation(conversationId?: string): string {
        return bindPreviewConversationExtracted(this, conversationId);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public rememberActivePreviewClaim(claim: { readonly previewId: string; readonly previewUrl: string; readonly port: number; }): void {
        rememberActivePreviewClaimExtracted(this, claim);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public ensurePreviewProcessIdForConversation(conversationId?: string): string {
        return ensurePreviewProcessIdForConversationExtracted(this, conversationId);
    }

    async claimPreviewExecution(port: number, conversationId?: string): Promise<QaapPreviewPortClaimResult> {
        return claimPreviewExecutionExtracted(this, port, conversationId);
    }

    adoptSupersedingPreviewClaim(current: QaapDevPreviewProbeResponse): boolean {
        return adoptSupersedingPreviewClaimExtracted(this, current);
    }

    async reconcileSupersededPreviewClaim(): Promise<boolean> {
        return reconcileSupersededPreviewClaimExtracted(this);
    }

    async refreshFromProjectRoot(root: string | URI, projectId: string): Promise<void> {
        return refreshFromProjectRootExtracted(this, root, projectId);
    }

    /** Current bootstrap state for UI contributions and AI tools. */
    getStateSnapshot(): QaapBootstrapStateChange {
        return this.buildStateChange(this._phase);
    }

    /** True when install finished (or was skipped) and a dev script can be spawned. */
    hasRunnableDevPlan(): boolean {
        return this.resolveDevPlan() !== undefined;
    }

    getBootstrapFailureDetail(): { terminalFailure: string; terminalTail?: string } | undefined {
        return getBootstrapFailureDetailExtracted(this);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public resolveDevPlan(): { command: string; cwd: URI; expectedPort?: number; kind: QaapProjectKind } | undefined {
        return resolveDevPlanExtracted(this);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public resolveInstallPlan(): { command: string; cwd: URI } | undefined {
        return resolveInstallPlanExtracted(this);
    }

    async describeRunnableApp(root: URI): Promise<{ runnable: boolean; hint?: string }> {
        return describeRunnableAppExtracted(this, root);
    }

    async getMissingDescriptorHint(explicitRoot?: URI): Promise<string | undefined> {
        return getMissingDescriptorHintExtracted(this, explicitRoot);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public buildDevSpawnPlan(plan: { command: string; expectedPort?: number; kind: QaapProjectKind; }): { command: string; targetPort?: number } {
        return buildDevSpawnPlanExtracted(this, plan);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public reserveActivePreview(port: number, cwd: URI, osProcessId?: number): Promise<QaapPreviewPortClaimResult> {
        return reserveActivePreviewExtracted(this, port, cwd, osProcessId);
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
     * @internal Used by the extracted qaap-project-bootstrap-service-* modules.
     */
    public previewProjectId(workspaceRoot: URI): string {
        return previewProjectIdHelper(workspaceRoot);
    }

    selectMonorepoApp(candidate: QaapMonorepoAppCandidate | undefined, options?: { readonly conversationId?: string },): Promise<void> {
        return selectMonorepoAppExtracted(this, candidate, options);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public async switchMonorepoApp(candidate: QaapMonorepoAppCandidate | undefined, descriptor: QaapProjectDescriptor, switchGeneration: number, options?: { readonly conversationId?: string },): Promise<void> {
        return switchMonorepoAppExtracted(this, candidate, descriptor, switchGeneration, options);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public async stopManagedDevServerForAppSwitch(): Promise<void> {
        return stopManagedDevServerForAppSwitchExtracted(this);
    }

    async runInstall(): Promise<void> {
        return runInstallExtracted(this);
    }

    async runDevServer(options?: { conversationId?: string }): Promise<void> {
        return runDevServerExtracted(this, options);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public async startDevServer(plan: { command: string; cwd: URI; expectedPort?: number; kind: QaapProjectKind }, descriptor: QaapProjectDescriptor,): Promise<void> {
        return startDevServerExtracted(this, plan, descriptor);
    }

    cancelActivePreviewLaunch(): void {
        cancelActivePreviewLaunchExtracted(this);
    }

    skip(): void {
        skipExtracted(this);
    }

    reset(): void {
        resetExtracted(this);
    }

    async focusPreview(): Promise<void> {
        return focusPreviewExtracted(this);
    }

    async openExistingPreview(options?: { auto?: boolean }): Promise<void> {
        return openExistingPreviewExtracted(this, options);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public scheduleRefreshFromCurrentWorkspace(): void {
        scheduleRefreshFromCurrentWorkspaceExtracted(this);
    }

    async refreshFromCurrentWorkspace(): Promise<void> {
        return refreshFromCurrentWorkspaceExtracted(this);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public async refreshFromRoot(resource: URI | undefined): Promise<void> {
        return refreshFromRootExtracted(this, resource);
    }

    /**
     * Maps a persisted phase to the phase we should boot into. Terminal phases (`dismissed`,
     * `ready-to-run`, failures) round-trip unchanged; transient ones collapse to the
     * appropriate "actionable" phase based on whether `node_modules` is on disk now.
     */
    protected normalizeRestoredPhase(phase: QaapBootstrapPhase, descriptor: QaapProjectDescriptor): QaapBootstrapPhase {
        return normalizeRestoredPhaseHelper(phase, descriptor);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public scanDevOutput(data: string, plan: { expectedPort?: number }): void {
        scanDevOutputExtracted(this, data, plan);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public scanForDevUrl(data: string): void {
        scanForDevUrlExtracted(this, data);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public normalizeDevUrl(raw: string): string | undefined {
        return normalizeDevUrlHelper(raw);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public extractPort(url: string): number | undefined {
        return extractPortExtracted(this, url);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public recordForwardedPort(port: number, url: string, options?: { alreadyReady?: boolean },): void {
        recordForwardedPortExtracted(this, port, url, options);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public resolvePrimaryPreviewTarget(port: number, url: string): { port: number; url: string } {
        return resolvePrimaryPreviewTargetExtracted(this, port, url);
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

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public previewAutoOpenGate: (() => boolean) | undefined;

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public mayAutoOpenPreviewNow(): boolean {
        return mayAutoOpenPreviewNowExtracted(this);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public async claimDevPreviewPort(port: number): Promise<void> {
        return claimDevPreviewPortExtracted(this, port);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public async openPrimaryPreviewWhenReady(port: number, url: string, options?: { auto?: boolean }): Promise<void> {
        return openPrimaryPreviewWhenReadyExtracted(this, port, url, options);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public async healPreviewClaimToListeningPort(deadPort: number,): Promise<Awaited<ReturnType<typeof waitForQaapDevPreviewPort>>> {
        return healPreviewClaimToListeningPortExtracted(this, deadPort);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public markPortOpened(port: number, open: boolean): void {
        markPortOpenedExtracted(this, port, open);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public collectProbePorts(plan?: { expectedPort?: number }): number[] {
        return collectProbePortsExtracted(this, plan);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public extractPortFromInUseMessage(text: string): number | undefined {
        return extractPortFromInUseMessageHelper(text);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public scheduleDevPreviewFallback(runId: number, port: number): void {
        scheduleDevPreviewFallbackExtracted(this, runId, port);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public async tryAttachToExistingServer(ports: number[]): Promise<boolean> {
        return tryAttachToExistingServerExtracted(this, ports);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public adoptExistingPreviewIdentity(port: number, probe: QaapDevPreviewProbeResponse): void {
        adoptExistingPreviewIdentityExtracted(this, port, probe);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public probeBelongsToActiveProject(projectId: string | undefined): boolean {
        return probeBelongsToActiveProjectExtracted(this, projectId);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public monitorPreviewProcessLifetime(terminal: TerminalWidget, previewId: string): void {
        monitorPreviewProcessLifetimeExtracted(this, terminal, previewId);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public attachTerminalOsProcessId(terminal: TerminalWidget, previewId: string, port: number, cwd: URI): void {
        attachTerminalOsProcessIdExtracted(this, terminal, previewId, port, cwd);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public async failDevRun(message: string, plan: { command: string; cwd: URI; expectedPort?: number; kind: QaapProjectKind }, runId: number,): Promise<void> {
        return failDevRunExtracted(this, message, plan, runId);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public enrichDevRunError(message: string): string {
        const previewRoot = this._selectedApp?.relativePath ?? this._descriptor?.scaffoldRelativePath;
        return enrichBootstrapDevRunError(message, previewRoot);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public appendDevOutput(data: string): void {
        this.devOutputTail = (this.devOutputTail + data).slice(-DEV_OUTPUT_TAIL_MAX);
        this.devOutputEmitter.fire(this.devOutputTail);
    }

    /** Returns the recent dev-server output tail (for live streaming in the Preview tab). */
    get devOutput(): string { return this.devOutputTail; }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public readTerminalTail(terminal: TerminalWidget, maxLines: number = 40): string {
        return readTerminalTailHelper(terminal, maxLines);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public async spawnCommandWithRetry(options: { title: string; command: string; cwd: URI; reveal?: boolean; }): Promise<TerminalWidget> {
        return spawnCommandWithRetryExtracted(this, options);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public delay(ms: number): Promise<void> {
        return delayHelper(ms);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public async refreshDescriptorAfterInstall(): Promise<void> {
        return refreshDescriptorAfterInstallExtracted(this);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public previewWidgetKey(): QaapPreviewWidgetKey | undefined {
        return previewWidgetKeyExtracted(this);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public async openPreviewWidget(url: string): Promise<void> {
        return openPreviewWidgetExtracted(this, url);
    }

    async openPreview(url: string, isPrimary: boolean = true, options?: { auto?: boolean; silent?: boolean },): Promise<void> {
        return openPreviewExtracted(this, url, isPrimary, options);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public syncMiniBrowserPreviewSuspensionAfterOpen(): void {
        syncMiniBrowserPreviewSuspensionAfterOpenExtracted(this);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public async spawnCommand(options: { title: string; command: string; cwd: URI; kind?: string; reveal?: boolean; }): Promise<TerminalWidget> {
        return spawnCommandExtracted(this, options);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public async reconcileRestoredPreviewTerminals(): Promise<void> {
        return reconcileRestoredPreviewTerminalsExtracted(this);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public async disposeRestoredPreviewTerminals(cwd: URI, title: string, keepPort?: number,): Promise<TerminalWidget | undefined> {
        return disposeRestoredPreviewTerminalsExtracted(this, cwd, title, keepPort);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public watchAttachedDevTerminal(terminal: TerminalWidget, plan: { command: string; cwd: URI; expectedPort?: number; kind: QaapProjectKind },): void {
        watchAttachedDevTerminalExtracted(this, terminal, plan);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public toUserFacingDevError(message: string): string {
        return toUserFacingDevErrorExtracted(this, message);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public buildShellInvocation(command: string, cwd: string): { shellPath: string; shellArgs: string[] } {
        return buildShellInvocationExtracted(this, command, cwd);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public waitForExit(terminal: TerminalWidget): Promise<number | undefined> {
        return waitForExitExtracted(this, terminal);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public beginDevRun(): void {
        beginDevRunExtracted(this);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public releaseActivePreview(): void {
        releaseActivePreviewExtracted(this);
    }

    releasePreviewForConversation(conversationId: string | undefined): void {
        releasePreviewForConversationExtracted(this, conversationId);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public registerDevTerminalForConversation(conversationId: string | undefined, terminal: TerminalWidget, listener: Disposable,): void {
        registerDevTerminalForConversationExtracted(this, conversationId, terminal, listener);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public releaseDevTerminalForConversation(conversationId: string): void {
        releaseDevTerminalForConversationExtracted(this, conversationId);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public resetBootstrapSessionForWorkspace(): void {
        resetBootstrapSessionForWorkspaceExtracted(this);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public cancelDevPreviewFallbacks(): void {
        cancelDevPreviewFallbacksExtracted(this);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public scheduleDevPreviewWarmup(): void {
        scheduleDevPreviewWarmupExtracted(this);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public cancelDevPreviewWarmup(): void {
        cancelDevPreviewWarmupExtracted(this);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public startDevPreviewHealthMonitor(): void {
        startDevPreviewHealthMonitorExtracted(this);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public cancelDevPreviewHealthMonitor(): void {
        cancelDevPreviewHealthMonitorExtracted(this);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public async warmupDevPreview(): Promise<void> {
        return warmupDevPreviewExtracted(this);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public cleanupDevTerminal(): void {
        cleanupDevTerminalExtracted(this);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public disposeBootstrapTerminal(terminal: TerminalWidget | undefined): void {
        disposeBootstrapTerminalHelper(terminal);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public clearForwardedPorts(): void {
        clearForwardedPortsExtracted(this);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public buildStateChange(phase: QaapBootstrapPhase): QaapBootstrapStateChange {
        return buildStateChangeExtracted(this, phase);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public setPhase(phase: QaapBootstrapPhase): void {
        setPhaseExtracted(this, phase);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public syncHubSession(phase: QaapBootstrapPhase): void {
        syncHubSessionExtracted(this, phase);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public persistPhase(phase: QaapBootstrapPhase, selectedApp?: QaapMonorepoAppCandidate): void {
        persistPhaseExtracted(this, phase, selectedApp);
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public readPersisted(rootKey: string): PersistedEntry | undefined {
        return this.readAllPersisted()[rootKey];
    }

    /** @internal Used by the extracted qaap-project-bootstrap-service-* modules. */
    public readAllPersisted(): Record<string, PersistedEntry> {
        return readAllPersistedExtracted(this);
    }
}
