// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { BackendApplicationContribution, FileUri } from '@theia/core/lib/node';
import * as fs from 'fs';
import * as path from 'path';
import { isQaapDesktopRuntime } from '@theia/qaap-adapters/lib/common/qaap-desktop-runtime';
import { isQaapHostedEnvironment } from '@theia/qaap-adapters/lib/common/qaap-hosted-runtime';
import {
    QAAP_AGENT_PREVIEW_UNTRUSTED_NOTE,
    QAAP_PREVIEW_LOGS_DEFAULT_LINES,
    QAAP_PREVIEW_START_DEFAULT_TIMEOUT_SEC,
    QaapAgentPreviewError,
    isQaapPreviewServiceEnabled,
    type QaapAgentPreviewFailure,
    type QaapAgentPreviewFailureKind,
    type QaapAgentPreviewLogsResult,
    type QaapAgentPreviewSnapshotResult,
    type QaapAgentPreviewState,
    type QaapAgentPreviewStatus,
    type QaapPreviewLogsRequest,
    type QaapPreviewSnapshotRequest,
    type QaapPreviewStartRequest,
    type QaapPreviewStatusRequest,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-preview-protocol';
import { QAAP_IDENTITY_PREVIEW_PREFIX } from '@theia/qaap-shared-core/lib/common/qaap-dev-preview';
import {
    isQaapProcessPreviewIdentity,
    resolveQaapPreviewIdentity,
    type QaapProcessPreviewIdentity,
} from '@theia/qaap-shared-core/lib/common/qaap-preview-identity';
import { materializeQaapPreviewLaunchPlan } from '@theia/qaap-shared-core/lib/common/qaap-preview-launch-plan';
import { QaapDevPreviewEndpoint, canonicalizeQaapPreviewRoot } from '@theia/qaap-shared-core/lib/node/qaap-dev-preview-endpoint';
import { QaapDevPreviewPortRegistry, type QaapDevPreviewRecord } from '@theia/qaap-shared-core/lib/node/qaap-dev-preview-port-registry';
import { normalizeQaapPublicUrl } from '@theia/qaap-shared-core/lib/node/qaap-github-oauth-config';
import type { QaapPreviewLogRing } from '../common/qaap-preview-supervisor-types';
import { resolveHeadlessCaptureAppTarget } from './qaap-headless-visual-capture';
import { QaapPreviewPageInspector } from './qaap-preview-page-inspector';
import {
    classifyQaapPreviewHttpStatus,
    extractQaapAnnouncedPorts,
    probeQaapPreviewHttp,
    resolveQaapPreviewPortOwnership,
    type QaapPreviewHttpProbe,
    type QaapPreviewPortOwnership,
} from './qaap-preview-readiness';
import {
    QaapPreviewSupervisor,
    buildQaapPreviewScriptCommand,
    detectQaapPreviewPackageManager,
    type QaapPreviewSupervisorLaunch,
} from './qaap-preview-supervisor';
import { QaapTaskSandboxService } from './qaap-task-sandbox';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';

/** `processId` of every agent preview identity: one agent preview per conversation. */
export const QAAP_AGENT_PREVIEW_PROCESS_ID = 'agent-dev';
/** Idle lifetime override in minutes (`0` = never reap). Default: 60 hosted, never on the local desktop app (D6). */
export const QAAP_AGENT_PREVIEW_IDLE_MIN_ENV = 'QAAP_AGENT_PREVIEW_IDLE_MIN';
export const QAAP_AGENT_PREVIEW_DEFAULT_IDLE_MIN = 60;
/** How long a stopped/exited preview keeps its log for `preview_logs`. */
export const QAAP_AGENT_PREVIEW_POST_MORTEM_MS = 15 * 60_000;
/** Silence on the allocated port after which the service looks for a port the app announced itself. */
export const QAAP_AGENT_PREVIEW_DISCOVERY_GRACE_MS = 8000;
const POLL_INTERVAL_MS = 500;
const REAP_INTERVAL_MS = 60_000;
const STOP_CONFIRM_MS = 5000;
const DEFAULT_PREFERRED_PORT = 3000;
const LOG_TAIL_LINES = 60;

/** Who calls, as derived from the authenticated token or session (never from the request body). */
export interface QaapAgentPreviewCaller {
    readonly ownerLogin: string;
    /** Conversation whose preview is addressed (a delegated child addresses its parent's). */
    readonly conversationId: string;
    /** Working directory of the task (or the user's workspace path): the root every `cwd` is resolved against. */
    readonly cwd: string;
    /** False for plan-mode / read-only turns and delegated children: they may only read (D3, D7). */
    readonly canControl: boolean;
    /** Why {@link canControl} is false, shown to the agent. */
    readonly controlRefusal?: string;
    /** Who starts processes through this caller. */
    readonly ownership: 'agent' | 'user';
}

/** What will run, resolved before any port is allocated. */
interface QaapAgentPreviewPlan {
    readonly runDir: string;
    readonly command: string;
    readonly args: readonly string[];
    readonly preferredPort: number;
    readonly readyPath: string;
    readonly env?: Readonly<Record<string, string>>;
    /** Stable string to compare plans (idempotent start). */
    readonly signature: string;
}

interface QaapAgentPreviewEntry {
    readonly key: string;
    readonly ownerLogin: string;
    readonly conversationId: string;
    readonly identity: QaapProcessPreviewIdentity & { readonly previewId: string };
    readonly plan: QaapAgentPreviewPlan;
    readonly taskCwd: string;
    readonly ownership: 'agent' | 'user';
    port: number;
    status: QaapAgentPreviewStatus;
    startedAt: number;
    lastUseAt: number;
    retiredAt?: number;
    httpStatus?: number;
    failure?: QaapAgentPreviewFailure;
    warning?: string;
    /** Port tried for discovery already (so a silent app is not re-probed every round). */
    discoveryDone?: boolean;
    leaseId?: string;
    /** Last log ring, kept after the supervisor retires its record (post-mortem `preview_logs`). */
    log?: QaapPreviewLogRing;
    pid?: number;
    exitCode?: number;
    signal?: string;
    exitedAt?: number;
}

/** The env value as minutes, or the default for this runtime (hosted 60, local desktop never). */
export function resolveQaapAgentPreviewIdleMs(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env[QAAP_AGENT_PREVIEW_IDLE_MIN_ENV]?.trim();
    if (raw) {
        const minutes = Number(raw);
        if (Number.isFinite(minutes) && minutes >= 0) {
            return Math.round(minutes * 60_000);
        }
    }
    if (isQaapDesktopRuntime(env) && !isQaapHostedEnvironment(env)) {
        return 0;
    }
    return QAAP_AGENT_PREVIEW_DEFAULT_IDLE_MIN * 60_000;
}

/** Classifies a failed start from its last output lines. */
export function classifyQaapAgentPreviewFailure(lines: readonly string[], exitCode: number | undefined, signal: string | undefined): QaapAgentPreviewFailureKind {
    const text = lines.join('\n');
    if (/EADDRINUSE|address already in use|Port \d+ is (?:already )?in use|port is already allocated/i.test(text)) {
        return 'port-in-use';
    }
    if (/JavaScript heap out of memory|ENOMEM|Cannot allocate memory/i.test(text) || signal === 'SIGKILL') {
        return 'out-of-memory';
    }
    if (/Cannot find module|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|command not found|is not recognized as an internal|: not found\b|sh: \S+: not found/i.test(text)) {
        return 'needs-install';
    }
    return exitCode === undefined && !signal ? 'unknown' : 'process-exit';
}

const FAILURE_HINTS: Readonly<Record<QaapAgentPreviewFailureKind, string>> = {
    'no-launch-plan': 'Pass script or argv to preview_start, or write .qaap/preview.json (version 1, argv form, "{{PORT}}"), then call preview_start again.',
    'spawn-refused': 'Qaap refused to start this command; read failure.message, change the command or project, then call preview_start again.',
    'process-exit': 'Read logTail (preview_logs for more), fix the cause in the project, then call preview_start again.',
    'port-in-use': 'The app binds a fixed port that is taken: make it listen on process.env.PORT (Qaap sets it), then call preview_start again.',
    'needs-install': 'A dependency or command is missing: install it with a one-shot command (for example npm install), then call preview_start again.',
    'out-of-memory': 'The server ran out of memory: reduce what it loads at startup or ask the user; retrying unchanged fails the same way.',
    'timeout': 'Still starting: call preview_status with waitSec, or read preview_logs to see where it is stuck.',
    'http-5xx': 'The server runs but answers with a server error: read preview_logs, fix the app, then call preview_restart if hot reload does not pick it up.',
    'http-4xx': 'The server answers but readyPath returns a client error: check the route, or pass readyPath for an app without "/".',
    'port-foreign': 'Another process answers on the allocated port: call preview_restart; if it repeats, stop the other server.',
    'no-port': 'The process runs but nothing answers on the port Qaap passed: make the app listen on process.env.PORT, then call preview_restart.',
    'unknown': 'Read preview_logs, fix the cause, then call preview_start again.',
};

/**
 * Runs a project's app for an agent (or the user's Run button) and tells it, truthfully, whether the app answers.
 * One preview per conversation, identity `{user, root, root, conversation, 'agent-dev'}`; the process is supervised
 * by {@link QaapPreviewSupervisor} (tenant uid, task sandbox + forwarder, desktop Seatbelt), registered in the port
 * registry (so the Preview pane and `/qaap-preview/<id>/` reach it) and probed over HTTP before it counts as ready.
 * Starts never auto-retry: the agent reads the failure and fixes it (design §3, decision D5).
 */
@injectable()
export class QaapAgentPreviewService implements BackendApplicationContribution {

    @inject(QaapPreviewSupervisor)
    protected readonly supervisor: QaapPreviewSupervisor;

    @inject(QaapDevPreviewPortRegistry)
    protected readonly registry: QaapDevPreviewPortRegistry;

    @inject(QaapDevPreviewEndpoint)
    protected readonly previewEndpoint: QaapDevPreviewEndpoint;

    @inject(QaapTenantSpawnService)
    protected readonly tenantSpawn: QaapTenantSpawnService;

    @inject(QaapTaskSandboxService) @optional()
    protected readonly taskSandbox?: QaapTaskSandboxService;

    @inject(QaapPreviewPageInspector)
    protected readonly inspector: QaapPreviewPageInspector;

    protected readonly entries = new Map<string, QaapAgentPreviewEntry>();
    /** Serializes start/stop/restart per conversation preview. */
    protected readonly locks = new Map<string, Promise<unknown>>();
    protected reaper?: ReturnType<typeof setInterval>;

    onStart(): void {
        if (!this.enabled()) {
            return;
        }
        this.reaper = setInterval(() => this.reapIdle(), REAP_INTERVAL_MS);
        this.reaper.unref?.();
    }

    onStop(): void {
        if (this.reaper) {
            clearInterval(this.reaper);
            this.reaper = undefined;
        }
    }

    /** Process env; a seam for tests. */
    protected env(): NodeJS.ProcessEnv {
        return process.env;
    }

    enabled(): boolean {
        return isQaapPreviewServiceEnabled(this.env());
    }

    protected now(): number {
        return Date.now();
    }

    protected sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    protected keyOf(caller: Pick<QaapAgentPreviewCaller, 'ownerLogin' | 'conversationId'>): string {
        return `${caller.ownerLogin}\u0000${caller.conversationId}`;
    }

    protected withLock<T>(key: string, run: () => Promise<T>): Promise<T> {
        const previous = this.locks.get(key) ?? Promise.resolve();
        const next = previous.then(run, run);
        const settled = next.catch(() => undefined);
        this.locks.set(key, settled);
        void settled.then(() => {
            if (this.locks.get(key) === settled) {
                this.locks.delete(key);
            }
        });
        return next;
    }

    protected assertControl(caller: QaapAgentPreviewCaller): void {
        if (!caller.canControl) {
            throw new QaapAgentPreviewError('read-only', caller.controlRefusal
                ?? 'This turn may only read the preview (preview_status, preview_logs, preview_snapshot); it cannot start, restart or stop it.');
        }
    }

    // -----------------------------------------------------------------------------------------
    // Operations
    // -----------------------------------------------------------------------------------------

    async start(caller: QaapAgentPreviewCaller, request: QaapPreviewStartRequest): Promise<QaapAgentPreviewState> {
        this.assertControl(caller);
        const key = this.keyOf(caller);
        const timeoutMs = (request.timeoutSec ?? QAAP_PREVIEW_START_DEFAULT_TIMEOUT_SEC) * 1000;
        const entry = await this.withLock(key, async () => {
            const plan = this.resolvePlan(caller.cwd, request);
            const current = this.entries.get(key);
            if (current && !request.restart && this.isLive(current) && current.plan.signature === plan.signature) {
                current.lastUseAt = this.now();
                return current;
            }
            if (!current || !this.isLive(current)) {
                const shared = await this.findLiveUserPreview(caller, plan.runDir);
                if (shared && !request.restart) {
                    return shared;
                }
            }
            if (current) {
                await this.retire(current, 'restarted');
            }
            return this.launch(caller, plan);
        });
        return this.awaitReadiness(entry, timeoutMs);
    }

    async restart(caller: QaapAgentPreviewCaller, request: QaapPreviewStartRequest): Promise<QaapAgentPreviewState> {
        return this.start(caller, { ...request, restart: true });
    }

    async status(caller: QaapAgentPreviewCaller, request: QaapPreviewStatusRequest = {}): Promise<QaapAgentPreviewState> {
        const entry = this.entries.get(this.keyOf(caller));
        if (!entry) {
            const shared = await this.findLiveUserPreview(caller, undefined);
            return shared ? this.toState(shared) : {
                status: 'none',
                hint: caller.canControl ? 'No preview runs for this conversation: call preview_start.' : 'No preview runs for this conversation.',
            };
        }
        entry.lastUseAt = this.now();
        if (entry.status === 'starting' && (request.waitSec ?? 0) > 0) {
            return this.awaitReadiness(entry, (request.waitSec ?? 0) * 1000);
        }
        await this.refresh(entry);
        return this.toState(entry);
    }

    logs(caller: QaapAgentPreviewCaller, request: QaapPreviewLogsRequest = {}): QaapAgentPreviewLogsResult {
        const entry = this.entries.get(this.keyOf(caller));
        const ring = entry && (this.supervisor.logOf(entry.identity.previewId) ?? entry.log);
        if (!entry || !ring) {
            return {
                lines: [],
                droppedLines: 0,
                note: entry?.ownership === 'user'
                    ? 'This preview was started from the Preview tab; Qaap does not hold its output here.'
                    : 'No preview output for this conversation.',
            };
        }
        entry.lastUseAt = this.now();
        entry.log = ring;
        const lines = ring.tail(request.lines ?? QAAP_PREVIEW_LOGS_DEFAULT_LINES, { stream: request.stream, grep: request.grep })
            .map(line => line.stream === 'stderr' ? `[err] ${line.text}` : line.stream === 'qaap' ? line.text : line.text);
        return { previewId: entry.identity.previewId, lines, droppedLines: ring.droppedLines(), note: QAAP_AGENT_PREVIEW_UNTRUSTED_NOTE };
    }

    async stop(caller: QaapAgentPreviewCaller): Promise<QaapAgentPreviewState> {
        this.assertControl(caller);
        const key = this.keyOf(caller);
        return this.withLock(key, async () => {
            const entry = this.entries.get(key);
            if (!entry) {
                return { status: 'none', hint: 'No preview of this conversation is running.' };
            }
            await this.retire(entry, 'stopped');
            return this.toState(entry);
        });
    }

    async snapshot(caller: QaapAgentPreviewCaller, request: QaapPreviewSnapshotRequest): Promise<QaapAgentPreviewSnapshotResult> {
        const entry = this.entries.get(this.keyOf(caller)) ?? await this.findLiveUserPreview(caller, undefined);
        if (!entry) {
            throw new QaapAgentPreviewError('not-found', 'No preview runs for this conversation: call preview_start first.');
        }
        entry.lastUseAt = this.now();
        await this.refresh(entry);
        if (entry.status !== 'ready') {
            throw new QaapAgentPreviewError('not-found', `The preview is ${entry.status}, not ready: call preview_status or preview_start first.`);
        }
        const host = await this.previewEndpoint.resolveTargetHost(entry.port, entry.ownerLogin) ?? '127.0.0.1';
        const url = `http://${host.includes(':') ? `[${host}]` : host}:${entry.port}${request.path ?? '/'}`;
        try {
            return await this.inspector.snapshot(url, request, entry.httpStatus);
        } catch (error) {
            throw new QaapAgentPreviewError('internal',
                `Qaap could not load the page in its headless browser: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
        }
    }

    // -----------------------------------------------------------------------------------------
    // Plan
    // -----------------------------------------------------------------------------------------

    /** Real path of `relative` inside `root`, or an error when it escapes it (symlinks included). */
    protected resolveInside(root: string, relative: string | undefined): string {
        const realRoot = this.realpath(root);
        if (!relative || relative === '.') {
            return realRoot;
        }
        if (path.isAbsolute(relative)) {
            throw new QaapAgentPreviewError('invalid-request', 'cwd must be relative to your working directory.');
        }
        const target = this.realpath(path.resolve(realRoot, relative));
        const rel = path.relative(realRoot, target);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            throw new QaapAgentPreviewError('invalid-request', 'cwd must stay inside your working directory.');
        }
        return target;
    }

    protected realpath(value: string): string {
        try {
            return fs.realpathSync.native(value);
        } catch {
            throw new QaapAgentPreviewError('invalid-request', `The directory ${path.basename(value) || value} does not exist.`);
        }
    }

    protected readScripts(dir: string): Record<string, string> | undefined {
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> };
            const scripts: Record<string, string> = {};
            for (const [name, value] of Object.entries(manifest.scripts ?? {})) {
                if (typeof value === 'string') {
                    scripts[name] = value;
                }
            }
            return scripts;
        } catch {
            return undefined;
        }
    }

    protected resolvePlan(taskCwd: string, request: QaapPreviewStartRequest): QaapAgentPreviewPlan {
        let runDir = this.resolveInside(taskCwd, request.cwd);
        let launch: QaapPreviewSupervisorLaunch | undefined;
        let preferredPort = request.port ?? DEFAULT_PREFERRED_PORT;
        if (request.argv) {
            launch = { command: request.argv[0], args: request.argv.slice(1) };
        } else if (request.script) {
            const scripts = this.readScripts(runDir);
            if (!scripts) {
                throw new QaapAgentPreviewError('invalid-request', 'There is no readable package.json in that directory.');
            }
            if (!scripts[request.script]) {
                const names = Object.keys(scripts).slice(0, 20).join(', ') || 'none';
                throw new QaapAgentPreviewError('invalid-request', `package.json has no "${request.script}" script (scripts: ${names}).`);
            }
            launch = buildQaapPreviewScriptCommand(detectQaapPreviewPackageManager(runDir), request.script);
        } else {
            const target = resolveHeadlessCaptureAppTarget(runDir);
            if (!target) {
                throw new QaapAgentPreviewError('invalid-request', `${FAILURE_HINTS['no-launch-plan']} No dev/start script, .qaap/preview.json or known runtime was found.`);
            }
            if (target.kind === 'static') {
                throw new QaapAgentPreviewError('invalid-request', 'This looks like a static site without a server: pass argv, for example '
                    + '["npx","--yes","serve","-l","{{PORT}}"] or ["python3","-m","http.server","{{PORT}}"].');
            }
            runDir = this.realpath(target.root);
            if (request.port === undefined && target.expectedPort > 0) {
                preferredPort = target.expectedPort;
            }
            if (target.launch) {
                launch = { command: target.launch.command, args: [...target.launch.args] };
                runDir = this.resolveInside(runDir, target.launch.cwd);
                if (request.port === undefined) {
                    preferredPort = target.launch.port;
                }
            } else {
                const scripts = this.readScripts(runDir) ?? {};
                const script = scripts.dev ? 'dev' : scripts.start ? 'start' : undefined;
                if (!script) {
                    throw new QaapAgentPreviewError('invalid-request', FAILURE_HINTS['no-launch-plan']);
                }
                launch = buildQaapPreviewScriptCommand(detectQaapPreviewPackageManager(runDir), script);
            }
        }
        const readyPath = request.readyPath ?? '/';
        const env = request.env && Object.keys(request.env).length > 0 ? request.env : undefined;
        return {
            runDir,
            command: launch.command,
            args: launch.args,
            preferredPort,
            readyPath,
            ...(env ? { env } : {}),
            signature: JSON.stringify([runDir, launch.command, launch.args, readyPath, env ?? {}]),
        };
    }

    // -----------------------------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------------------------

    protected isLive(entry: QaapAgentPreviewEntry): boolean {
        return entry.status === 'starting' || entry.status === 'ready';
    }

    protected async launch(caller: QaapAgentPreviewCaller, plan: QaapAgentPreviewPlan): Promise<QaapAgentPreviewEntry> {
        const root = canonicalizeQaapPreviewRoot(plan.runDir);
        // The preview registry stores canonical file:// URIs for workspaceId/projectId so
        // Work Hub's `/qaap-dev/api/current` and `previewUrlMatchesProject` recognize the claim.
        // Anchor the project URI at the caller's workspace root so subdirectory previews still
        // bind to the Work Hub project card.
        const projectRoot = canonicalizeQaapPreviewRoot(this.safeRealpath(caller.cwd));
        const projectRootUri = FileUri.create(projectRoot).toString();
        const identity = resolveQaapPreviewIdentity({
            userId: caller.ownerLogin,
            workspaceId: projectRootUri,
            projectId: projectRootUri,
            conversationId: caller.conversationId,
            processId: QAAP_AGENT_PREVIEW_PROCESS_ID,
        });
        // A leftover of this identity (backend restart, crashed job) would block the registration below.
        this.supervisor.stop(identity.previewId);
        this.registry.releasePreview(identity.previewId, caller.ownerLogin);
        const now = this.now();
        const entry: QaapAgentPreviewEntry = {
            key: this.keyOf(caller),
            ownerLogin: caller.ownerLogin,
            conversationId: caller.conversationId,
            identity,
            plan,
            taskCwd: caller.cwd,
            ownership: caller.ownership,
            port: 0,
            status: 'starting',
            startedAt: now,
            lastUseAt: now,
        };
        this.entries.set(entry.key, entry);
        const record = await this.previewEndpoint.allocatePreviewPort({ ...identity, ownerLogin: caller.ownerLogin, root }, plan.preferredPort);
        if (!record) {
            return this.fail(entry, 'spawn-refused', 'No preview port is available (the per-user preview limit may be reached): stop another preview first.');
        }
        entry.port = record.port;
        // The conversation keeps one preview: a frontend-started run of the same project and conversation is replaced.
        this.previewEndpoint.supersedeConversationPreviews(identity, caller.ownerLogin);
        await this.acquireLease(entry);
        const port = record.port;
        const replace = (value: string): string => value.split('{{PORT}}').join(String(port));
        const launch = materializeQaapPreviewLaunchPlan({ version: 1, runtime: 'custom', cwd: '.', command: plan.command, args: [...plan.args], port }, port);
        let started: string;
        try {
            const argv = { command: replace(launch.command), args: launch.args.map(replace) };
            started = await this.supervisor.start(plan.runDir, port, { ...identity, ownerLogin: caller.ownerLogin }, argv, {
                autoRestart: 'never',
                detached: true,
                ...(plan.env ? { extraEnv: plan.env } : {}),
            });
        } catch (error) {
            return this.fail(entry, 'spawn-refused', error instanceof Error ? error.message : String(error));
        }
        const snapshot = this.supervisor.describe(identity.previewId);
        entry.log = this.supervisor.logOf(identity.previewId);
        // `exited` straight from start means nothing was spawned (refused by the spawn policy or the sandbox).
        if (started === 'exited' || !snapshot) {
            const reason = snapshot?.stderrTail.join(' ').trim() || 'The dev server could not be started.';
            return this.fail(entry, 'spawn-refused', reason);
        }
        entry.pid = snapshot.processId;
        if (snapshot.processId) {
            this.registry.attachProcess(identity.previewId, caller.ownerLogin, snapshot.processId);
        }
        return entry;
    }

    protected fail(entry: QaapAgentPreviewEntry, kind: QaapAgentPreviewFailureKind, message: string): QaapAgentPreviewEntry {
        entry.status = 'failed';
        entry.failure = { kind, message };
        this.registry.releasePreview(entry.identity.previewId, entry.ownerLogin);
        this.releaseLease(entry);
        return entry;
    }

    /** Polls the process and its port until it is ready, fails, or `timeoutMs` passes (it then stays `starting`). */
    protected async awaitReadiness(entry: QaapAgentPreviewEntry, timeoutMs: number): Promise<QaapAgentPreviewState> {
        const deadline = this.now() + timeoutMs;
        for (;;) {
            await this.refresh(entry);
            if (entry.status !== 'starting' || this.now() >= deadline) {
                break;
            }
            await this.sleep(POLL_INTERVAL_MS);
        }
        if (entry.status === 'starting') {
            const lastHttp = entry.httpStatus;
            return {
                ...this.toState(entry),
                hint: lastHttp !== undefined && lastHttp >= 500
                    ? `The server answers HTTP ${lastHttp} so far. ${FAILURE_HINTS['http-5xx']}`
                    : FAILURE_HINTS.timeout,
            };
        }
        return this.toState(entry);
    }

    /** One readiness round: process alive? port answers? answer from our process tree? */
    protected async refresh(entry: QaapAgentPreviewEntry): Promise<void> {
        if (entry.ownership === 'user' && entry.pid === undefined && !this.supervisor.describe(entry.identity.previewId)) {
            // A preview Qaap's Preview tab started (not supervised here): only its port tells.
            const userProbe = await this.probe(entry, entry.port);
            entry.status = userProbe.kind === 'answered' && classifyQaapPreviewHttpStatus(userProbe.status) !== 'server-error' ? 'ready' : 'exited';
            entry.httpStatus = userProbe.kind === 'answered' ? userProbe.status : undefined;
            return;
        }
        if (!this.isLive(entry)) {
            return;
        }
        const snapshot = this.supervisor.describe(entry.identity.previewId);
        if (!snapshot || snapshot.status === 'exited') {
            this.onExited(entry, snapshot?.exitCode, snapshot?.signal, snapshot?.exitedAt);
            return;
        }
        entry.pid = snapshot.processId ?? entry.pid;
        const probe = await this.probe(entry, entry.port);
        if (probe.kind === 'answered') {
            this.onAnswered(entry, entry.port, probe.status);
            return;
        }
        if (entry.status === 'ready') {
            // It answered before and stopped answering while the process lives (restarting, hung).
            entry.status = 'starting';
            entry.warning = 'The server stopped answering after it was ready.';
        }
        if (!entry.discoveryDone && this.now() - entry.startedAt >= QAAP_AGENT_PREVIEW_DISCOVERY_GRACE_MS) {
            await this.discoverAnnouncedPort(entry);
        }
    }

    protected onAnswered(entry: QaapAgentPreviewEntry, port: number, status: number): void {
        entry.httpStatus = status;
        const verdict = classifyQaapPreviewHttpStatus(status);
        if (verdict === 'server-error') {
            entry.status = 'starting';
            entry.failure = { kind: 'http-5xx', message: `The server answers HTTP ${status} on ${entry.plan.readyPath}.` };
            return;
        }
        const ownership = this.portOwnership(entry, port);
        if (ownership === 'foreign') {
            entry.status = 'failed';
            entry.failure = { kind: 'port-foreign', message: `Port ${port} is answered by a process Qaap did not start for this preview.` };
            this.supervisor.stop(entry.identity.previewId);
            this.registry.releasePreview(entry.identity.previewId, entry.ownerLogin);
            this.releaseLease(entry);
            return;
        }
        if (entry.status !== 'ready') {
            // Answered once: from now on a crash while the user browses is restarted (bounded) instead of reported only.
            this.supervisor.setAutoRestart(entry.identity.previewId, 'bounded');
            this.registry.touchPreview(entry.identity.previewId, entry.ownerLogin);
        }
        entry.status = 'ready';
        entry.failure = undefined;
        if (verdict === 'ready-4xx') {
            entry.warning = `The server answers HTTP ${status} on ${entry.plan.readyPath}: it runs, but that route is missing.`;
        } else if (entry.warning?.startsWith('The server stopped answering')) {
            entry.warning = undefined;
        }
    }

    protected onExited(entry: QaapAgentPreviewEntry, exitCode: number | undefined, signal: string | undefined, exitedAt: string | undefined): void {
        const ring = this.supervisor.logOf(entry.identity.previewId) ?? entry.log;
        entry.log = ring;
        const tail = ring?.tail(LOG_TAIL_LINES).map(line => line.text) ?? [];
        entry.exitCode = exitCode;
        entry.signal = signal;
        entry.exitedAt = exitedAt ? Date.parse(exitedAt) : this.now();
        const wasReady = entry.status === 'ready';
        const kind = classifyQaapAgentPreviewFailure(tail, exitCode, signal);
        entry.status = wasReady ? 'exited' : 'failed';
        entry.failure = {
            kind,
            message: wasReady
                ? `The app stopped after it was ready (${signal ? `signal ${signal}` : `exit code ${exitCode ?? '?'}`}).`
                : `The dev server exited before it answered (${signal ? `signal ${signal}` : `exit code ${exitCode ?? '?'}`}).`,
        };
        this.supervisor.stop(entry.identity.previewId);
        this.registry.releasePreview(entry.identity.previewId, entry.ownerLogin);
        this.releaseLease(entry);
    }

    protected async probe(entry: QaapAgentPreviewEntry, port: number): Promise<QaapPreviewHttpProbe> {
        if (!port) {
            return { kind: 'refused' };
        }
        const host = await this.previewEndpoint.resolveTargetHost(port, entry.ownerLogin) ?? '127.0.0.1';
        return probeQaapPreviewHttp({
            host,
            port,
            path: entry.plan.readyPath,
            agent: this.previewEndpoint.upstreamAgentFor(port, entry.ownerLogin),
        });
    }

    protected portOwnership(entry: QaapAgentPreviewEntry, port: number): QaapPreviewPortOwnership {
        // In a task sandbox the listener lives in the container: the forwarder on the backend proves nothing.
        if (this.tenantSpawn.agentSandboxFor(entry.plan.runDir)) {
            return 'unknown';
        }
        return resolveQaapPreviewPortOwnership(port, entry.pid);
    }

    /**
     * For apps that ignore `PORT`: a port the app printed (`http://localhost:5173`) that answers HTTP from our process
     * tree becomes the preview's port (registry rebind), reported as a warning so the agent can fix the app.
     */
    protected async discoverAnnouncedPort(entry: QaapAgentPreviewEntry): Promise<void> {
        entry.discoveryDone = true;
        const ring = this.supervisor.logOf(entry.identity.previewId);
        const candidates = extractQaapAnnouncedPorts(ring?.tail(200).map(line => line.text) ?? []).filter(port => port !== entry.port);
        for (const candidate of candidates.slice(0, 3)) {
            const probe = await this.probe(entry, candidate);
            if (probe.kind !== 'answered' || this.portOwnership(entry, candidate) !== 'owned') {
                continue;
            }
            const rebound = this.registry.rebindPort(entry.identity.previewId, entry.ownerLogin, candidate);
            if (!rebound) {
                continue;
            }
            const previous = entry.port;
            entry.port = candidate;
            entry.warning = `The app ignored PORT=${previous} and listens on ${candidate}; Qaap follows it, but make the app read process.env.PORT.`;
            this.onAnswered(entry, candidate, probe.status);
            return;
        }
        entry.discoveryDone = candidates.length === 0;
        if (entry.status === 'starting' && !entry.failure) {
            entry.failure = { kind: 'no-port', message: `Nothing answers yet on the port Qaap passed (PORT=${entry.port}).` };
        }
    }

    /**
     * A live preview of the same project that Qaap's Preview tab started (registry record of this owner and root,
     * not supervised here), so the agent reuses it instead of starting a second server. `runDir` undefined: any root.
     */
    protected async findLiveUserPreview(caller: QaapAgentPreviewCaller, runDir: string | undefined): Promise<QaapAgentPreviewEntry | undefined> {
        const root = runDir ? canonicalizeQaapPreviewRoot(runDir) : undefined;
        const callerRoot = canonicalizeQaapPreviewRoot(this.safeRealpath(caller.cwd));
        const candidates = this.registry.records()
            .filter((record): record is QaapDevPreviewRecord & QaapProcessPreviewIdentity => record.ownerLogin === caller.ownerLogin
                && isQaapProcessPreviewIdentity(record)
                && record.processId !== QAAP_AGENT_PREVIEW_PROCESS_ID
                && !record.processId.startsWith('visual-')
                && (root ? record.root === root : record.root === callerRoot || record.root.startsWith(callerRoot + path.sep))
                && !this.supervisor.describe(record.previewId))
            .sort((left, right) => right.touchedAt - left.touchedAt);
        for (const record of candidates) {
            if (this.previewEndpoint.isPreviewProcessDead(record)) {
                continue;
            }
            const now = this.now();
            const entry: QaapAgentPreviewEntry = {
                key: this.keyOf(caller),
                ownerLogin: caller.ownerLogin,
                conversationId: caller.conversationId,
                identity: { ...record, previewId: record.previewId },
                plan: { runDir: record.root, command: '', args: [], preferredPort: record.port, readyPath: '/', signature: `user:${record.previewId}` },
                taskCwd: caller.cwd,
                ownership: 'user',
                port: record.port,
                status: 'starting',
                startedAt: record.claimedAt,
                lastUseAt: now,
            };
            await this.refresh(entry);
            if (entry.status === 'ready') {
                return entry;
            }
        }
        return undefined;
    }

    protected safeRealpath(value: string): string {
        try {
            return fs.realpathSync.native(value);
        } catch {
            return path.resolve(value);
        }
    }

    /** Stops the process, releases the registration and the sandbox lease; keeps the entry for post-mortem logs. */
    protected async retire(entry: QaapAgentPreviewEntry, reason: 'stopped' | 'restarted' | 'idle'): Promise<void> {
        if (entry.ownership === 'user' && !this.supervisor.describe(entry.identity.previewId)) {
            // Not ours to kill here: replacing it happens through the conversation supersede on the next launch.
            entry.status = 'stopped';
            return;
        }
        entry.log = this.supervisor.logOf(entry.identity.previewId) ?? entry.log;
        if (reason === 'idle') {
            entry.log?.push('qaap', '[qaap] stopped: the preview was not used for a while.\n');
        }
        const signalled = this.supervisor.stop(entry.identity.previewId);
        if (signalled) {
            const deadline = this.now() + STOP_CONFIRM_MS;
            while (this.supervisor.describe(entry.identity.previewId) && this.now() < deadline) {
                await this.sleep(100);
            }
            if (this.supervisor.describe(entry.identity.previewId)) {
                entry.warning = 'Qaap signalled the dev server to stop but it has not exited yet.';
            }
        }
        this.registry.releasePreview(entry.identity.previewId, entry.ownerLogin);
        this.releaseLease(entry);
        entry.status = 'stopped';
        entry.retiredAt = this.now();
    }

    protected async acquireLease(entry: QaapAgentPreviewEntry): Promise<void> {
        if (!this.taskSandbox || !this.tenantSpawn.agentSandboxFor(entry.plan.runDir)) {
            return;
        }
        const leaseId = `preview:${entry.identity.previewId}`;
        try {
            // Joins the live sandbox of the worktree; keeps it past the task's linger while the preview runs.
            await this.taskSandbox.acquire({ taskId: leaseId, cwd: entry.plan.runDir, ownerLogin: entry.ownerLogin });
            entry.leaseId = leaseId;
        } catch (error) {
            console.warn(`[qaap-agent-preview] could not hold the task sandbox for ${entry.identity.previewId}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    protected releaseLease(entry: QaapAgentPreviewEntry): void {
        if (entry.leaseId && this.taskSandbox) {
            this.taskSandbox.release(entry.leaseId);
        }
        entry.leaseId = undefined;
    }

    /** Stops agent previews unused for the idle lifetime (D6) and forgets retired entries after the post-mortem window. */
    reapIdle(): void {
        const idleMs = resolveQaapAgentPreviewIdleMs(this.env());
        const now = this.now();
        for (const entry of [...this.entries.values()]) {
            if (!this.isLive(entry)) {
                const endedAt = entry.retiredAt ?? entry.exitedAt ?? entry.startedAt;
                if (now - endedAt > QAAP_AGENT_PREVIEW_POST_MORTEM_MS && this.entries.get(entry.key) === entry) {
                    this.entries.delete(entry.key);
                }
                continue;
            }
            if (idleMs <= 0 || entry.ownership !== 'agent') {
                continue;
            }
            const touchedAt = this.registry.get(entry.identity.previewId)?.touchedAt ?? 0;
            if (now - Math.max(entry.lastUseAt, touchedAt) > idleMs) {
                void this.withLock(entry.key, () => this.retire(entry, 'idle'));
            }
        }
    }

    // -----------------------------------------------------------------------------------------
    // Results
    // -----------------------------------------------------------------------------------------

    /**
     * Absolute preview URL only from configuration (hosted `QAAP_OAUTH_PUBLIC_URL`), never from the request: the MCP
     * shim calls the backend on a loopback or container address that the user cannot open.
     */
    protected publicUrlFor(previewPath: string): string | undefined {
        const env = this.env();
        if (isQaapDesktopRuntime(env) && !isQaapHostedEnvironment(env)) {
            return undefined;
        }
        const configured = env.QAAP_OAUTH_PUBLIC_URL?.trim();
        if (!configured) {
            return undefined;
        }
        try {
            return `${normalizeQaapPublicUrl(configured)}${previewPath}`;
        } catch {
            return undefined;
        }
    }

    protected toState(entry: QaapAgentPreviewEntry): QaapAgentPreviewState {
        const previewPath = `${QAAP_IDENTITY_PREVIEW_PREFIX}/${encodeURIComponent(entry.identity.previewId)}/`;
        const url = entry.status === 'ready' ? this.publicUrlFor(previewPath) : undefined;
        const ring = this.supervisor.logOf(entry.identity.previewId) ?? entry.log;
        const showLog = entry.status !== 'ready' && ring !== undefined;
        const command = entry.plan.command ? [entry.plan.command, ...entry.plan.args].join(' ') : undefined;
        const rel = path.relative(this.safeRealpath(entry.taskCwd), entry.plan.runDir) || '.';
        const hint = entry.status === 'ready'
            ? 'The app is up. Tell the user it is live in the Preview tab (never cite localhost or a port); check a page with preview_snapshot.'
            : entry.status === 'stopped'
                ? 'The preview is stopped.'
                : entry.failure ? FAILURE_HINTS[entry.failure.kind] : undefined;
        return {
            status: entry.status,
            previewId: entry.identity.previewId,
            ...(entry.status === 'ready' || entry.status === 'starting' ? { previewPath } : {}),
            ...(url ? { url } : {}),
            ...(entry.port ? { port: entry.port } : {}),
            ...(entry.httpStatus !== undefined ? { httpStatus: entry.httpStatus } : {}),
            ...(command ? { command } : {}),
            cwd: rel.startsWith('..') ? entry.plan.runDir : rel,
            ...(entry.pid ? { pid: entry.pid } : {}),
            startedAt: new Date(entry.startedAt).toISOString(),
            ...(entry.exitedAt ? { exitedAt: new Date(entry.exitedAt).toISOString() } : {}),
            ...(entry.exitCode !== undefined ? { exitCode: entry.exitCode } : {}),
            ...(entry.signal ? { signal: entry.signal } : {}),
            ...(entry.failure && entry.status !== 'ready' ? { failure: entry.failure } : {}),
            ...(entry.warning ? { warning: entry.warning } : {}),
            ...(showLog ? { logTail: ring!.tail(LOG_TAIL_LINES).map(line => line.text), logNote: QAAP_AGENT_PREVIEW_UNTRUSTED_NOTE } : {}),
            ownership: entry.ownership,
            ...(hint ? { hint } : {}),
        };
    }
}
