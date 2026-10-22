// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { ChildProcess, execFile, spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { QaapDevcontainerResolver, type QaapTaskSandboxImagePlan } from './qaap-devcontainer-config';
import { qaapDockerName, qaapDockerNamespaceLabels } from './qaap-docker-namespace';
import { QaapTaskSandboxBrokerClient } from './qaap-task-sandbox-broker-client';
import type { QaapTaskSandboxBrokerSandbox } from './qaap-task-sandbox-broker-protocol';
import type { QaapSandboxExecClientRequest } from './qaap-task-sandbox-exec-client-main';
import { encodeQaapSandboxFrame, parseQaapListeningPorts, QaapSandboxFrame, QaapSandboxFrameDecoder } from './qaap-task-sandbox-exec-protocol';
import { QAAP_PERSISTENT_HOME_DIRECTORIES, QAAP_PERSISTENT_HOME_FILES } from './qaap-tenant-persistent-home';

/**
 * Per-task ephemeral sandbox (roadmap H2.2, design in doc/qaap-task-sandbox.md).
 *
 * Every agent task whose cwd is a git worktree runs in its own container: its own PID and network
 * namespaces (so two tasks can bind the same hardcoded port and cannot see or kill each other's
 * processes) and a filesystem that holds only that worktree, its git metadata and the agent's
 * credential directories. The container uses the repo's devcontainer image when there is one,
 * otherwise the base image, and is destroyed (or archived) once the last task using it ends.
 *
 * Two modes, both behind `QAAP_TASK_SANDBOX=1` (default off):
 * - "direct": the backend drives the Docker daemon it can reach (local dev with Docker, or a
 *   control plane in QAAP_CLOUD_MODE=docker) and runs processes with `docker exec`.
 * - "broker" (production, `QAAP_TENANT_BACKEND_MODE=1`): the tenant backend has no Docker socket,
 *   so it asks the control plane's {@link QaapTaskSandboxBroker} to create/destroy/list sandboxes
 *   and runs processes through the sandbox's exec server with a local node client.
 */

export const QAAP_TASK_SANDBOX_ENV = 'QAAP_TASK_SANDBOX';
export const QAAP_TASK_SANDBOX_LABEL = 'com.qaap.task-sandbox';
export const QAAP_TASK_SANDBOX_WORKTREE_LABEL = 'com.qaap.task-sandbox.worktree';
export const QAAP_TASK_SANDBOX_OWNER_LABEL = 'com.qaap.task-sandbox.owner';

/** In-container HOME: a private tmpfs owned by the task uid; agent credential dirs are bound under it. */
export const QAAP_TASK_SANDBOX_HOME = '/tmp/qaap-home';
/** Read-only toolchain mount (agent CLIs + node) for images that do not ship them. */
export const QAAP_TASK_SANDBOX_TOOLCHAIN_MOUNT = '/opt/qaap-agent';
const EXEC_DIR = '/tmp/.qaap-exec';
const DEFAULT_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const DEFAULT_HOME_DIRS = ['.claude', '.claude.json', '.codex', '.gemini', '.copilot', '.qaiq', '.config/qaiq', '.config/opencode'];
const DEFAULT_LINGER_MS = 10 * 60_000;
const DEFAULT_ARCHIVE_TTL_MS = 24 * 60 * 60_000;
const POST_CREATE_TIMEOUT_MS = 10 * 60_000;
const STOP_TIMEOUT_MS = 8_000;
const ARCHIVED_NAME = /-archived-(\d+)$/;

/**
 * Variables that describe the backend host, not the task: they are never forwarded into a sandbox
 * exec (the container sets its own PATH/HOME) and never reach Docker as `-e`.
 */
const EXEC_ENV_DENYLIST = new Set([
    'PATH', 'HOME', 'PWD', 'OLDPWD', 'TMPDIR', 'TMP', 'TEMP', 'SHELL', 'USER', 'LOGNAME', 'SHLVL', '_',
    'DOCKER_HOST', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'DOCKER_CONTEXT', 'DOCKER_CONFIG',
    'QAAP_DOCKER_NODES', 'QAAP_DOCKER_SOCKET_SOURCE', 'QAAP_DOCKER_SOCKET_TARGET',
    'QAAP_TENANT_BACKEND_SECRET', 'NODE_OPTIONS_HOST', 'XPC_SERVICE_NAME', 'XPC_FLAGS', '__CF_USER_TEXT_ENCODING',
    'TERM_PROGRAM', 'TERM_SESSION_ID', 'SSH_AUTH_SOCK', 'SSH_AGENT_PID', 'COMMAND_MODE',
]);

/**
 * Runs `"$@"` in a new session inside the container and records its pid (= process-group id) so a
 * killed `docker exec` client can take the in-container tree down with it: killing the client
 * alone leaves the process running and holding its ports.
 */
const EXEC_RUNNER = `#!/bin/sh
id="$1"; shift
if setsid -w true 2>/dev/null; then
  exec setsid -w /bin/sh -c 'echo $$ > "${EXEC_DIR}/$0.pid"; exec "$@"' "$id" "$@"
fi
echo $$ > "${EXEC_DIR}/$id.pid"
exec "$@"
`;

/**
 * Host-side wrapper around the docker exec client: `$1` docker CLI, `$2` sandbox, `$3` in-container
 * kill script, then the exec argv. stdin is handed to the background client explicitly (a
 * non-interactive sh would give it /dev/null). On TERM/INT/HUP it kills the in-container group.
 */
const SIGNAL_FORWARDER = 'cli="$1"; name="$2"; killcmd="$3"; shift 3; '
    + '"$cli" "$@" <&0 & pid=$!; '
    + 'trap \'"$cli" exec "$name" /bin/sh -c "$killcmd" >/dev/null 2>&1; kill -TERM "$pid" 2>/dev/null; exit 143\' TERM INT HUP; '
    + 'wait "$pid"';

/** {@link SIGNAL_FORWARDER} for terminals: `docker exec -i`, plus `-t` when stdin is a terminal. */
const TTY_FORWARDER = 'cli="$1"; name="$2"; killcmd="$3"; shift 3; tflag=""; [ -t 0 ] && tflag=-t; '
    + '"$cli" exec -i $tflag "$@" <&0 & pid=$!; '
    + 'trap \'"$cli" exec "$name" /bin/sh -c "$killcmd" >/dev/null 2>&1; kill -TERM "$pid" 2>/dev/null; exit 143\' TERM INT HUP; '
    + 'wait "$pid"';

/** Pipes stdin/stdout to a loopback port inside the container (preview tunnel), IPv4 then IPv6. */
const BRIDGE_JS = `const net=require('net');const port=Number(process.argv[process.argv.length-1]);
const go=(hosts)=>{const s=net.connect(port,hosts[0]);let ok=false;
s.on('connect',()=>{ok=true;process.stdin.pipe(s);s.pipe(process.stdout);});
s.on('error',()=>{if(!ok&&hosts.length>1){go(hosts.slice(1));}else{process.exit(1);}});
s.on('close',()=>process.exit(0));};go(['127.0.0.1','::1']);`;

const BRIDGE_RUNNER = `#!/bin/sh
if command -v node >/dev/null 2>&1; then exec node ${EXEC_DIR}/bridge.js "$1"; fi
exec bash -c 'exec 3<>/dev/tcp/127.0.0.1/'"$1"' && { cat <&3 & cat >&3; }'
`;

/** The in-container entrypoint: install the helpers into the tmpfs, then idle until stopped. */
const SANDBOX_ENTRYPOINT = `mkdir -p ${EXEC_DIR} && printf '%s' "$QAAP_SANDBOX_EXEC_RUNNER" > ${EXEC_DIR}/run `
    + `&& printf '%s' "$QAAP_SANDBOX_BRIDGE_RUNNER" > ${EXEC_DIR}/bridge && printf '%s' "$QAAP_SANDBOX_BRIDGE_JS" > ${EXEC_DIR}/bridge.js `
    + `&& chmod 755 ${EXEC_DIR}/run ${EXEC_DIR}/bridge && touch ${EXEC_DIR}/ready `
    + '&& trap "exit 0" TERM INT && while :; do sleep 3600 & wait $!; done';

export interface QaapTaskSandboxAcquireOptions {
    /** Task id; the sandbox lives while at least one acquired task has not been released. */
    readonly taskId: string;
    /** The task cwd (anywhere inside the worktree). */
    readonly cwd: string;
    /** Environment of the task: only `HOME` is read here (to find agent credential dirs). */
    readonly env?: NodeJS.ProcessEnv;
    readonly ownerLogin?: string;
    /** uid/gid the task runs as (the tenant identity); defaults to the backend's own. */
    readonly uid?: number;
    readonly gid?: number;
}

export interface QaapTaskSandbox {
    readonly name: string;
    /** Worktree root this sandbox owns (realpath). */
    readonly root: string;
    readonly image: string;
    readonly imageKind: QaapTaskSandboxImagePlan['kind'];
    /** Time from acquire() to a running, ready container (ms); 0 when an existing one was reused. */
    readonly startupMs: number;
    /** Time spent in the devcontainer postCreateCommand (outside the startup budget). */
    readonly postCreateMs?: number;
    readonly created: boolean;
    readonly forwardPorts: readonly number[];
    readonly remoteEnv: Readonly<Record<string, string>>;
    /** Broker mode: the sandbox's exec server on the tenant network and its per-sandbox token. */
    readonly exec?: { readonly host: string; readonly port: number; readonly token: string };
}

interface SandboxForward {
    readonly server: net.Server;
    /** Port inside the sandbox; retargeted when the app ignores the preview port it was given. */
    containerPort: number;
}

interface SandboxEntry {
    sandbox: QaapTaskSandbox;
    readonly tasks: Set<string>;
    teardownTimer?: ReturnType<typeof setTimeout>;
    /** Loopback forwarders on the backend, by HOST port. */
    readonly forwards: Map<number, SandboxForward>;
    /** Preview ports the backend expects (from PORT / QAAP_PREVIEW_PORT), with the ports already listening then. */
    readonly expectedPorts: Map<number, Set<number>>;
    /** A terminal is open: forward every port its commands bind, when the same host port is free. */
    watchAll: boolean;
    readonly unavailablePorts: Set<number>;
    lastPorts?: number[];
    portWatcher?: ReturnType<typeof setInterval>;
    portScan?: Promise<void>;
}

export type QaapTaskSandboxMode = 'direct' | 'broker';

export type QaapTaskSandboxEndMode = 'destroy' | 'archive';

@injectable()
export class QaapTaskSandboxService implements BackendApplicationContribution {

    @inject(QaapDevcontainerResolver) @optional()
    protected readonly devcontainers: QaapDevcontainerResolver = new QaapDevcontainerResolver();

    @inject(QaapTaskSandboxBrokerClient) @optional()
    protected readonly broker?: QaapTaskSandboxBrokerClient;

    protected readonly entries = new Map<string, SandboxEntry>();
    protected readonly pending = new Map<string, Promise<SandboxEntry>>();
    protected readonly taskRoots = new Map<string, string>();
    /** Ends in flight, per worktree root: an acquire waits for them instead of reusing a dying container. */
    protected readonly ending = new Map<string, Promise<void>>();
    /** Tasks whose acquire() has not resolved yet, and those of them released meanwhile. */
    protected readonly acquiring = new Set<string>();
    protected readonly releasedWhileAcquiring = new Set<string>();
    protected readonly backgroundBuilds = new Map<string, Promise<void>>();
    protected execCounter = 0;

    /** Reap sandboxes a previous backend left behind (crash, restart, deploy). Off with the flag. */
    onStart(): void {
        if (!this.isEnabled()) {
            return;
        }
        if (!this.isSupported()) {
            console.warn(`[qaap-task-sandbox] ${QAAP_TASK_SANDBOX_ENV}=1 is ignored on ${process.platform}: `
                + 'task sandboxes need a Linux/macOS host; agent tasks will refuse to start until it is unset.');
            return;
        }
        this.reapOrphans().then(removed => {
            if (removed) {
                console.info(`[qaap-task-sandbox] removed ${removed} orphaned sandbox container(s)`);
            }
        });
    }

    /**
     * End every live sandbox on a graceful shutdown (Theia awaits this); its worktree stays on disk.
     * A hard exit cannot wait: the boot-time reaper removes what this owner left behind.
     */
    async onStop(): Promise<void> {
        const ends = [...this.entries.keys()].map(root => this.end(root).catch(() => undefined));
        await Promise.race([
            Promise.all(ends),
            new Promise(resolve => setTimeout(resolve, STOP_TIMEOUT_MS).unref?.()),
        ]);
    }

    isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
        return /^(1|true)$/i.test(env[QAAP_TASK_SANDBOX_ENV]?.trim() ?? '');
    }

    /**
     * Whether this host can run task sandboxes. Each sandbox bind-mounts host paths at the same path
     * inside a Linux container (`<path>:<path>:rw`, `-w <path>`), which a Windows path (`C:\...`)
     * cannot express, and its exec helpers are POSIX shell. Production runs on Linux only.
     */
    isSupported(platform: NodeJS.Platform = process.platform): boolean {
        return platform !== 'win32';
    }

    /** Broker mode in a per-tenant backend (no Docker socket), direct mode everywhere else. */
    mode(env: NodeJS.ProcessEnv = process.env): QaapTaskSandboxMode {
        return /^(1|true)$/i.test(env.QAAP_TENANT_BACKEND_MODE?.trim() ?? '') ? 'broker' : 'direct';
    }

    /**
     * Ensure the sandbox for the worktree containing `cwd` and register `taskId` on it. Concurrent
     * acquires for one worktree share a single container; different worktrees get different ones.
     */
    async acquire(options: QaapTaskSandboxAcquireOptions): Promise<QaapTaskSandbox> {
        if (!this.isSupported()) {
            // Fail closed: the operator asked for isolation, so never run the task unsandboxed.
            throw new Error(`Task sandboxes are not supported on ${process.platform}; unset ${QAAP_TASK_SANDBOX_ENV} to run tasks without them.`);
        }
        const { taskId } = options;
        this.acquiring.add(taskId);
        let entry: SandboxEntry;
        try {
            entry = await this.ensureEntry(await this.resolveWorktreeRoot(options.cwd), options);
        } catch (error) {
            this.releasedWhileAcquiring.delete(taskId);
            throw error;
        } finally {
            this.acquiring.delete(taskId);
        }
        if (entry.teardownTimer) {
            clearTimeout(entry.teardownTimer);
            entry.teardownTimer = undefined;
        }
        if (this.releasedWhileAcquiring.delete(taskId)) {
            // The task ended (cancelled, failed) while its sandbox was still starting: never register
            // it, and end the sandbox as a normal last release would if nobody else uses it.
            if (entry.tasks.size === 0) {
                this.scheduleEnd(entry);
            }
            return entry.sandbox;
        }
        entry.tasks.add(taskId);
        this.taskRoots.set(taskId, entry.sandbox.root);
        return entry.sandbox;
    }

    /** The live entry of `root`, after any end in flight finished; created at most once at a time. */
    protected async ensureEntry(root: string, options: QaapTaskSandboxAcquireOptions): Promise<SandboxEntry> {
        for (;;) {
            const live = this.entries.get(root);
            if (live) {
                return live;
            }
            const ending = this.ending.get(root);
            if (!ending) {
                break;
            }
            await ending.catch(() => undefined);
        }
        let pending = this.pending.get(root);
        if (!pending) {
            pending = this.createEntry(root, options).finally(() => this.pending.delete(root));
            this.pending.set(root, pending);
        }
        return pending;
    }

    /** Unregister a task; when it was the last one the sandbox ends after the linger period. */
    release(taskId: string): void {
        if (this.acquiring.has(taskId)) {
            this.releasedWhileAcquiring.add(taskId);
            return;
        }
        const root = this.taskRoots.get(taskId);
        this.taskRoots.delete(taskId);
        const entry = root ? this.entries.get(root) : undefined;
        if (!entry || !entry.tasks.delete(taskId) || entry.tasks.size > 0) {
            return;
        }
        this.scheduleEnd(entry);
    }

    protected scheduleEnd(entry: SandboxEntry): void {
        const end = (): void => {
            this.end(entry.sandbox.root).catch(error =>
                console.warn(`[qaap-task-sandbox] ending ${entry.sandbox.name} failed: ${(error as Error).message}`));
        };
        const linger = this.lingerMs();
        if (linger <= 0) {
            end();
            return;
        }
        entry.teardownTimer = setTimeout(end, linger);
        entry.teardownTimer.unref?.();
    }

    /** End the sandbox of `root` now: destroy it, or stop and rename it for later inspection. */
    end(root: string, mode: QaapTaskSandboxEndMode = this.endMode()): Promise<void> {
        const entry = this.entries.get(root);
        if (!entry) {
            return this.ending.get(root) ?? Promise.resolve();
        }
        this.entries.delete(root);
        if (entry.teardownTimer) {
            clearTimeout(entry.teardownTimer);
        }
        if (entry.portWatcher) {
            clearInterval(entry.portWatcher);
        }
        for (const forward of entry.forwards.values()) {
            forward.server.close();
        }
        const job = (async (): Promise<void> => {
            if (entry.sandbox.exec) {
                await this.requireBroker().destroy({ name: entry.sandbox.name, mode });
            } else if (mode === 'archive') {
                // Docker labels are immutable: the archive marker is the stopped state plus a rename
                // that carries the archive time (the reaper's TTL starts there, not at creation).
                await this.docker(['stop', '-t', '5', entry.sandbox.name]).catch(() => undefined);
                await this.docker(['rename', entry.sandbox.name, `${entry.sandbox.name}-archived-${Date.now()}`]).catch(() => undefined);
            } else {
                await this.docker(['rm', '-f', entry.sandbox.name]);
            }
        })().finally(() => {
            if (this.ending.get(root) === job) {
                this.ending.delete(root);
            }
        });
        this.ending.set(root, job);
        return job;
    }

    /** The live sandbox whose worktree contains `cwd`, if any (synchronous: used on the spawn path). */
    sandboxFor(cwd: string): QaapTaskSandbox | undefined {
        const target = this.realpath(cwd);
        let best: SandboxEntry | undefined;
        for (const [root, entry] of this.entries) {
            if ((target === root || target.startsWith(root + path.sep)) && (!best || root.length > best.sandbox.root.length)) {
                best = entry;
            }
        }
        return best?.sandbox;
    }

    /**
     * `docker exec` argv that runs `file args` inside the sandbox at `cwd`. Task variables and the
     * devcontainer `remoteEnv` are passed by NAME only (the docker CLI copies the values from its
     * own env), so their values never appear on an argv or in the container's persisted config.
     * Launch the docker CLI with {@link execClientEnv} as its env.
     */
    wrapExec(sandbox: QaapTaskSandbox, cwd: string, file: string, args: readonly string[], env: NodeJS.ProcessEnv | undefined, execId: string): { file: string; args: string[] } {
        const envArgs: string[] = [];
        for (const [key, value] of Object.entries({ ...sandbox.remoteEnv, ...env })) {
            if (value === undefined || EXEC_ENV_DENYLIST.has(key) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
                continue;
            }
            envArgs.push('-e', key);
        }
        return {
            file: this.dockerCli(),
            args: [
                'exec', '-i',
                ...envArgs,
                '-e', `HOME=${QAAP_TASK_SANDBOX_HOME}`,
                '-e', `PATH=${this.containerPath()}`,
                '-w', this.realpath(cwd),
                sandbox.name,
                `${EXEC_DIR}/run`, execId,
                file, ...args,
            ],
        };
    }

    /**
     * Spawn `file args` inside the sandbox.
     *
     * Direct mode: the docker CLI swallows SIGTERM (it exits 0 and leaves the exec'd process
     * running), so it runs under a host `sh` whose trap kills the in-container process group when
     * the task is cancelled or a dev server restarts (group kill of the client).
     *
     * Broker mode: `launch` starts the local exec client (`node qaap-task-sandbox-exec-client-main.js`)
     * that streams stdio to the sandbox's exec server; signals and a dead client end the remote tree.
     */
    spawnInSandbox(
        sandbox: QaapTaskSandbox,
        file: string,
        args: readonly string[],
        options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ('pipe' | 'ignore')[]; detached?: boolean },
        launch: (file: string, args: string[], options: object) => ChildProcess = (f, a, o) => spawn(f, a, o as Parameters<typeof spawn>[2]),
    ): ChildProcess {
        const execId = `x${process.pid}-${Date.now().toString(36)}-${(this.execCounter++).toString(36)}`;
        let child: ChildProcess;
        if (sandbox.exec) {
            const client = this.execClientInvocation(sandbox, options.cwd, file, args, options.env, false);
            child = launch(client.file, client.args, {
                cwd: fs.existsSync(options.cwd) ? options.cwd : undefined,
                env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin' },
                stdio: options.stdio,
                detached: options.detached ?? process.platform !== 'win32',
            });
        } else {
            const wrapped = this.wrapExec(sandbox, options.cwd, file, args, options.env, execId);
            child = launch('/bin/sh', ['-c', SIGNAL_FORWARDER, 'qaap-sandbox-exec', wrapped.file, sandbox.name, this.killScript(execId), ...wrapped.args], {
                // The docker CLI runs on the host: its cwd only needs to exist.
                cwd: fs.existsSync(options.cwd) ? options.cwd : undefined,
                env: this.execClientEnv(sandbox, options.env),
                stdio: options.stdio,
                detached: options.detached ?? process.platform !== 'win32',
            });
        }
        // Only the preview supervisor's allocated port: `PORT` is inherited from the backend (the IDE
        // port in the production image) by every spawn and must not be forwarded.
        const port = Number(options.env.QAAP_PREVIEW_PORT);
        if (Number.isInteger(port) && port > 0 && port < 65536) {
            this.expectPreviewPort(sandbox, port);
        }
        return child;
    }

    /**
     * Env for the host-side docker exec client: the devcontainer `remoteEnv` under the task's own
     * variables (the task wins), plus what the docker CLI itself needs from the backend.
     */
    execClientEnv(sandbox: QaapTaskSandbox, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
        return { ...sandbox.remoteEnv, ...env, ...this.dockerClientEnv() };
    }

    /**
     * Interactive terminal shell inside the sandbox, for the node-pty seam (`wrapShellForTenant`).
     * The PTY env is merged after this wrapper runs, so the explicit `environment` is what the
     * shell gets. Broker mode runs it under a pseudo-terminal in the sandbox (`script`).
     */
    wrapInteractive(sandbox: QaapTaskSandbox, cwd: string, file: string, args: readonly string[], environment?: NodeJS.ProcessEnv): { file: string; args: string[] } {
        const entry = this.entries.get(sandbox.root);
        if (entry) {
            entry.watchAll = true;
            this.ensurePortWatcher(entry);
        }
        const previewPort = /(?:^|[\s'"])QAAP_PREVIEW_PORT=['"]?(\d{2,5})/.exec(args.join(' '));
        if (previewPort) {
            this.expectPreviewPort(sandbox, Number(previewPort[1]));
        }
        if (sandbox.exec) {
            return this.execClientInvocation(sandbox, cwd, file, args, environment ?? {}, true);
        }
        const execId = `t${process.pid}-${Date.now().toString(36)}-${(this.execCounter++).toString(36)}`;
        const envArgs: string[] = [];
        for (const [key, value] of Object.entries(environment ?? {})) {
            if (value !== undefined && !EXEC_ENV_DENYLIST.has(key) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
                envArgs.push('-e', `${key}=${value}`);
            }
        }
        for (const [key, value] of Object.entries(sandbox.remoteEnv)) {
            envArgs.push('-e', `${key}=${value}`);
        }
        return {
            file: '/bin/sh',
            args: ['-c', TTY_FORWARDER, 'qaap-sandbox-tty', this.dockerCli(), sandbox.name, this.killScript(execId),
                ...envArgs,
                '-e', `HOME=${QAAP_TASK_SANDBOX_HOME}`, '-e', `PATH=${this.containerPath()}`,
                '-w', this.realpath(cwd), sandbox.name, `${EXEC_DIR}/run`, execId, file, ...args],
        };
    }

    /**
     * Register a preview port the backend's proxy will target for this sandbox. It is forwarded to
     * the same port in the sandbox at once; if the app binds another port instead (it ignores
     * PORT), the port watcher retargets the forwarder to the port it actually bound.
     */
    expectPreviewPort(sandbox: QaapTaskSandbox, port: number): void {
        const entry = this.entries.get(sandbox.root);
        if (!entry || entry.expectedPorts.has(port)) {
            return;
        }
        entry.expectedPorts.set(port, new Set(entry.lastPorts ?? []));
        this.forwardPort(sandbox, port, port).catch(error =>
            console.warn(`[qaap-task-sandbox] preview forward ${port} → ${sandbox.name} failed: ${(error as Error).message}`));
        this.ensurePortWatcher(entry);
    }

    /**
     * Expose the sandbox's loopback `containerPort` on the backend's `127.0.0.1:hostPort` (0 picks a
     * free port). Each connection opens a bridge into the sandbox (direct: `docker exec … bridge`,
     * broker: the exec server's `connect`), so nothing is published and it works whatever address
     * the dev server bound inside its own network namespace. Direct mode costs one exec per TCP
     * connection (~100–300 ms); a long-lived in-container relay is a documented follow-up
     * (doc/qaap-task-sandbox.md). Resolves to the host port. An existing forwarder on `hostPort`
     * is retargeted to `containerPort`.
     */
    async forwardPort(sandbox: QaapTaskSandbox, containerPort: number, hostPort = 0): Promise<number> {
        const entry = this.entries.get(sandbox.root);
        if (!entry) {
            throw new Error(`Sandbox ${sandbox.name} is not running.`);
        }
        if (hostPort > 0) {
            const existing = entry.forwards.get(hostPort);
            if (existing) {
                existing.containerPort = containerPort;
                return hostPort;
            }
        } else {
            for (const [port, candidate] of entry.forwards) {
                if (candidate.containerPort === containerPort) {
                    return port;
                }
            }
        }
        const forward: SandboxForward = { server: net.createServer(socket => this.bridge(sandbox, forward.containerPort, socket)), containerPort };
        await new Promise<void>((resolve, reject) => {
            forward.server.once('error', reject);
            forward.server.listen(hostPort, '127.0.0.1', () => resolve());
        });
        const bound = (forward.server.address() as net.AddressInfo).port;
        if (!this.entries.has(sandbox.root)) {
            forward.server.close();
            throw new Error(`Sandbox ${sandbox.name} ended.`);
        }
        entry.forwards.set(bound, forward);
        return bound;
    }

    /** The backend host port that reaches `containerPort` in the sandbox owning `cwd`, if forwarded. */
    hostPortFor(cwd: string, containerPort: number): number | undefined {
        const sandbox = this.sandboxFor(cwd);
        const entry = sandbox ? this.entries.get(sandbox.root) : undefined;
        for (const [port, forward] of entry?.forwards ?? []) {
            if (forward.containerPort === containerPort) {
                return port;
            }
        }
        return undefined;
    }

    protected bridge(sandbox: QaapTaskSandbox, containerPort: number, socket: net.Socket): void {
        if (sandbox.exec) {
            const upstream = net.connect(sandbox.exec.port, sandbox.exec.host);
            let open = false;
            let header = '';
            socket.pause();
            upstream.on('connect', () => upstream.write(`${JSON.stringify({ token: sandbox.exec!.token, op: 'connect', port: containerPort })}\n`));
            const onHeader = (chunk: Buffer): void => {
                header += chunk.toString('latin1');
                const newline = header.indexOf('\n');
                if (newline < 0) {
                    return;
                }
                upstream.off('data', onHeader);
                if (!header.slice(0, newline).includes('"ok":true')) {
                    socket.destroy();
                    upstream.destroy();
                    return;
                }
                open = true;
                const rest = Buffer.from(header.slice(newline + 1), 'latin1');
                if (rest.length) {
                    socket.write(rest);
                }
                upstream.pipe(socket);
                socket.pipe(upstream);
            };
            upstream.on('data', onHeader);
            const closeBoth = (): void => {
                socket.destroy();
                upstream.destroy();
            };
            upstream.on('error', closeBoth);
            upstream.on('close', closeBoth);
            socket.on('error', closeBoth);
            socket.on('close', () => open ? upstream.end() : upstream.destroy());
            return;
        }
        const bridge = spawn(this.dockerCli(), ['exec', '-i', sandbox.name, `${EXEC_DIR}/bridge`, String(containerPort)], {
            stdio: ['pipe', 'pipe', 'ignore'],
        });
        socket.pipe(bridge.stdin!);
        bridge.stdout!.pipe(socket);
        const close = (): void => {
            socket.destroy();
            if (!bridge.killed && typeof bridge.exitCode !== 'number') {
                bridge.kill();
            }
        };
        bridge.on('exit', close);
        bridge.on('error', close);
        socket.on('error', close);
        socket.on('close', close);
    }

    /** TCP ports listening inside the sandbox (its own network namespace), read from /proc/net. */
    async listPorts(sandbox: QaapTaskSandbox): Promise<number[]> {
        if (sandbox.exec) {
            const answer = await this.execServerQuery(sandbox, 'ports');
            return Array.isArray(answer.ports) ? answer.ports.filter((port): port is number => typeof port === 'number') : [];
        }
        const text = await this.docker(['exec', sandbox.name, '/bin/sh', '-c', 'cat /proc/net/tcp /proc/net/tcp6 2>/dev/null; true'], 5_000);
        return parseQaapListeningPorts(text);
    }

    protected ensurePortWatcher(entry: SandboxEntry): void {
        if (entry.portWatcher) {
            return;
        }
        entry.portWatcher = setInterval(() => {
            if (!entry.portScan) {
                entry.portScan = this.scanPorts(entry).catch(() => undefined).finally(() => entry.portScan = undefined);
            }
        }, this.portWatchMs());
        entry.portWatcher.unref?.();
    }

    /**
     * Preview port detection. An expected port that is listening is forwarded 1:1. When it is not,
     * but a new port appeared since it was expected, the app ignored PORT (hardcoded `:5173`): the
     * backend's expected port is retargeted to the port the app actually bound, so the preview
     * proxy (which targets the expected port) reaches it unchanged. Other new ports are forwarded
     * 1:1 when that host port is free (terminal-started servers, legacy port URLs).
     */
    async scanPorts(entry: SandboxEntry): Promise<void> {
        const sandbox = entry.sandbox;
        const ports = await this.listPorts(sandbox);
        entry.lastPorts = ports;
        const listening = new Set(ports);
        const claimed = new Set<number>();
        for (const [expected, baseline] of entry.expectedPorts) {
            const forward = entry.forwards.get(expected);
            if (listening.has(expected)) {
                claimed.add(expected);
                if (forward && forward.containerPort !== expected) {
                    forward.containerPort = expected;
                }
                continue;
            }
            const current = forward?.containerPort;
            if (current !== undefined && current !== expected && listening.has(current)) {
                claimed.add(current);
                continue;
            }
            const candidate = ports.find(port => !baseline.has(port) && !claimed.has(port) && !entry.expectedPorts.has(port));
            if (candidate !== undefined) {
                claimed.add(candidate);
                await this.forwardPort(sandbox, candidate, expected);
                console.info(`[qaap-task-sandbox] preview port ${expected} → ${sandbox.name}:${candidate} (the app ignores PORT)`);
            }
        }
        if (!entry.watchAll && entry.expectedPorts.size === 0) {
            return;
        }
        for (const port of ports) {
            if (claimed.has(port) || entry.forwards.has(port) || entry.unavailablePorts.has(port) || this.hostPortForEntry(entry, port) !== undefined) {
                continue;
            }
            await this.forwardPort(sandbox, port, port).catch(() => entry.unavailablePorts.add(port));
        }
    }

    protected hostPortForEntry(entry: SandboxEntry, containerPort: number): number | undefined {
        for (const [port, forward] of entry.forwards) {
            if (forward.containerPort === containerPort) {
                return port;
            }
        }
        return undefined;
    }

    /**
     * Remove sandboxes THIS backend left behind (crash, restart, deploy) and expired archives.
     * Another backend sharing the daemon labels its sandboxes with a different owner, so its live
     * sandboxes are never touched; archives of any owner expire by the time in their name.
     */
    async reapOrphans(now: number = Date.now()): Promise<number> {
        // Starting sandboxes count as live too: an auto-resumed task may be adopting one right now.
        const live = new Set([...[...this.entries.values()].map(entry => entry.sandbox.name), ...[...this.pending.keys()].map(root => this.containerName(root))]);
        if (this.mode() === 'broker') {
            const broker = this.requireBroker();
            let reaped = 0;
            for (const sandbox of await broker.list().catch(() => [])) {
                if (live.has(sandbox.name)) {
                    continue;
                }
                const archivedAt = Number(/-archived-(\d+)$/.exec(sandbox.name)?.[1]);
                if (sandbox.archived && !sandbox.running && !(now - archivedAt > this.archiveTtlMs())) {
                    continue;
                }
                await broker.destroy({ name: sandbox.name }).catch(() => undefined);
                reaped++;
            }
            return reaped;
        }
        const listed = await this.docker([
            'ps', '-a', '--filter', `label=${QAAP_TASK_SANDBOX_LABEL}=true`,
            '--format', `{{.Names}}\t{{.State}}\t{{.Label "${QAAP_TASK_SANDBOX_OWNER_LABEL}"}}`,
        ]).catch(() => '');
        const prefix = qaapDockerName('qaap-task-');
        const owner = this.ownerId();
        let removed = 0;
        for (const line of listed.split('\n').filter(Boolean)) {
            const [name, state, labelOwner] = line.split('\t');
            if (!name.startsWith(prefix) || live.has(name)) {
                continue;
            }
            const archivedAt = ARCHIVED_NAME.exec(name);
            const expired = archivedAt ? state !== 'running' && now - Number(archivedAt[1]) > this.archiveTtlMs() : labelOwner === owner;
            if (!expired) {
                continue;
            }
            await this.docker(['rm', '-f', name]).catch(() => undefined);
            removed++;
        }
        return removed;
    }

    /**
     * Which backend owns a sandbox: `QAAP_TASK_SANDBOX_OWNER`, else the host name (a backend
     * container keeps its host name across restarts). Set distinct owners for several backends
     * that share one host and daemon.
     */
    ownerId(): string {
        return process.env.QAAP_TASK_SANDBOX_OWNER?.trim() || os.hostname();
    }

    protected newEntry(sandbox: QaapTaskSandbox): SandboxEntry {
        return { sandbox, tasks: new Set(), forwards: new Map(), expectedPorts: new Map(), watchAll: false, unavailablePorts: new Set() };
    }

    protected async createEntry(root: string, options: QaapTaskSandboxAcquireOptions): Promise<SandboxEntry> {
        if (this.mode() === 'broker') {
            return this.createBrokerEntry(root, options);
        }
        const started = Date.now();
        const name = this.containerName(root);
        const plan = await this.resolveImagePlan(root);
        const devcontainer = plan.kind === 'base' ? undefined : plan.devcontainer;
        let created = false;
        const state = await this.docker(['inspect', '--format', '{{.State.Running}}', name]).catch(() => undefined);
        if (state?.trim() !== 'true') {
            if (state !== undefined) {
                await this.docker(['rm', '-f', name]).catch(() => undefined);
            }
            await this.docker(await this.buildRunArgs(name, root, plan, options), 60_000,
                { ...process.env, ...(devcontainer?.containerEnv ?? {}) });
            created = true;
        }
        await this.waitReady(name);
        const startupMs = Date.now() - started;
        let postCreateMs: number | undefined;
        if (created && devcontainer?.postCreateCommand) {
            postCreateMs = await this.runPostCreate(name, root, devcontainer.postCreateCommand, options);
        }
        const sandbox: QaapTaskSandbox = {
            name,
            root,
            image: plan.image,
            imageKind: plan.kind,
            startupMs: created ? startupMs : 0,
            postCreateMs,
            created,
            forwardPorts: devcontainer?.forwardPorts ?? [],
            remoteEnv: devcontainer?.remoteEnv ?? {},
        };
        console.info(`[qaap-task-sandbox] ${created ? 'started' : 'reused'} ${name} for ${root} `
            + `(image ${plan.image}, ${plan.kind}) in ${startupMs} ms${postCreateMs !== undefined ? `, postCreate ${postCreateMs} ms` : ''}`);
        const entry = this.newEntry(sandbox);
        this.entries.set(root, entry);
        await this.seedPortBaseline(entry);
        return entry;
    }

    /** Ports already listening when the sandbox is handed out are never taken for an app's port. */
    protected async seedPortBaseline(entry: SandboxEntry): Promise<void> {
        entry.lastPorts = await this.listPorts(entry.sandbox).catch(() => []);
    }

    /**
     * Broker mode: the control plane creates the container (fixed tenant roots, tenant network,
     * exec server entrypoint). This backend only sends the worktree root, the devcontainer fields
     * the broker honours and the HOME links that point at the tenant's persistent agent storage.
     */
    protected async createBrokerEntry(root: string, options: QaapTaskSandboxAcquireOptions): Promise<SandboxEntry> {
        const started = Date.now();
        const plan = this.devcontainers.plan(root, 'base');
        const devcontainer = plan.kind === 'base' ? undefined : plan.devcontainer;
        if (plan.kind === 'build') {
            console.warn(`[qaap-task-sandbox] devcontainer Dockerfile builds are not supported in broker mode; ${root} uses the base image`);
        }
        const created: QaapTaskSandboxBrokerSandbox = await this.requireBroker().create({
            root,
            devcontainer: devcontainer ? {
                image: plan.kind === 'image' ? plan.image : undefined,
                containerEnv: devcontainer.containerEnv,
            } : undefined,
            homeLinks: this.homeLinks(options.env?.HOME),
        });
        const sandbox: QaapTaskSandbox = {
            name: created.name,
            root,
            image: created.image,
            imageKind: created.imageKind === 'image' && plan.kind === 'image' ? 'image' : 'base',
            startupMs: created.created ? Date.now() - started : 0,
            created: created.created,
            forwardPorts: devcontainer?.forwardPorts ?? [],
            remoteEnv: devcontainer?.remoteEnv ?? {},
            exec: { host: created.host, port: created.port, token: created.token },
        };
        const entry = this.newEntry(sandbox);
        this.entries.set(root, entry);
        await this.seedPortBaseline(entry);
        if (created.created && devcontainer?.postCreateCommand) {
            const marker = await this.postCreateMarker(root);
            if (!marker || !fs.existsSync(marker)) {
                const postStarted = Date.now();
                const result = await this.runRemote(sandbox, '/bin/sh', ['-c', devcontainer.postCreateCommand], root, POST_CREATE_TIMEOUT_MS)
                    .catch(error => ({ code: -1, output: (error as Error).message }));
                if (result.code === 0 && marker) {
                    fs.writeFileSync(marker, `${new Date().toISOString()}\n`);
                } else if (result.code !== 0) {
                    console.warn(`[qaap-task-sandbox] postCreateCommand failed in ${sandbox.name}: ${result.output.slice(-400)}`);
                }
                entry.sandbox = { ...sandbox, postCreateMs: Date.now() - postStarted };
            }
        }
        console.info(`[qaap-task-sandbox] ${created.created ? 'started' : 'reused'} ${sandbox.name} for ${root} via the broker `
            + `(image ${sandbox.image}) in ${Date.now() - started} ms`);
        return entry;
    }

    /** HOME entries that link to the tenant's persistent agent storage, recreated inside the sandbox. */
    protected homeLinks(home: string | undefined): Array<{ name: string; target: string }> {
        const links: Array<{ name: string; target: string }> = [];
        if (!home) {
            return links;
        }
        for (const name of [...QAAP_PERSISTENT_HOME_DIRECTORIES, ...QAAP_PERSISTENT_HOME_FILES]) {
            try {
                const link = path.join(home, name);
                if (fs.lstatSync(link).isSymbolicLink()) {
                    links.push({ name, target: path.resolve(path.dirname(link), fs.readlinkSync(link)) });
                }
            } catch {
                // not linked in this backend
            }
        }
        return links;
    }

    /**
     * Local exec-client invocation (broker mode). The endpoint, token and the command's exact
     * environment go into a 0600 request file in a backend-private directory, read and deleted by
     * the client at once: none of them is on an argv or in the client's own environment.
     */
    protected execClientInvocation(
        sandbox: QaapTaskSandbox, cwd: string, file: string, args: readonly string[], env: NodeJS.ProcessEnv, tty: boolean,
    ): { file: string; args: string[] } {
        const request: QaapSandboxExecClientRequest = {
            host: sandbox.exec!.host,
            port: sandbox.exec!.port,
            token: sandbox.exec!.token,
            file,
            args: [...args],
            cwd,
            env: this.sandboxExecEnv(sandbox, env),
            tty,
        };
        const dir = this.execRequestDir();
        const requestFile = path.join(dir, `${crypto.randomBytes(12).toString('hex')}.json`);
        fs.writeFileSync(requestFile, JSON.stringify(request), { mode: 0o600, flag: 'wx' });
        return { file: process.execPath, args: [path.join(__dirname, 'qaap-task-sandbox-exec-client-main.js'), requestFile] };
    }

    protected execRequestDir(): string {
        const dir = path.join(os.tmpdir(), `qaap-sandbox-exec-${process.getuid?.() ?? 'u'}`);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const stat = fs.lstatSync(dir);
        if (!stat.isDirectory() || (process.getuid && stat.uid !== process.getuid())) {
            throw new Error(`Refusing to write sandbox exec requests into ${dir}: not a private directory of this backend.`);
        }
        fs.chmodSync(dir, 0o700);
        return dir;
    }

    /** The environment a command gets inside the sandbox: the task env minus host-only variables. */
    protected sandboxExecEnv(sandbox: QaapTaskSandbox, env: NodeJS.ProcessEnv | undefined): Record<string, string> {
        const result: Record<string, string> = {};
        for (const [key, value] of Object.entries(env ?? {})) {
            if (value !== undefined && !EXEC_ENV_DENYLIST.has(key) && !key.startsWith('QAAP_SANDBOX_') && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
                result[key] = value;
            }
        }
        return { ...result, ...sandbox.remoteEnv, HOME: QAAP_TASK_SANDBOX_HOME, PATH: this.brokerContainerPath() };
    }

    /** Run a command to completion through the exec server (postCreateCommand); collects output. */
    protected runRemote(sandbox: QaapTaskSandbox, file: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; output: string }> {
        return new Promise((resolve, reject) => {
            const socket = net.connect(sandbox.exec!.port, sandbox.exec!.host);
            const decoder = new QaapSandboxFrameDecoder();
            let output = '';
            let done = false;
            const timer = setTimeout(() => {
                socket.write(encodeQaapSandboxFrame(QaapSandboxFrame.Signal, JSON.stringify({ signal: 'SIGKILL' })));
                socket.destroy();
                reject(new Error(`timed out after ${timeoutMs} ms`));
            }, timeoutMs);
            socket.on('connect', () => {
                socket.write(`${JSON.stringify({
                    token: sandbox.exec!.token, op: 'exec', file, args, cwd, env: this.sandboxExecEnv(sandbox, {}),
                })}\n`);
                socket.write(encodeQaapSandboxFrame(QaapSandboxFrame.StdinEnd));
            });
            socket.on('data', chunk => {
                for (const { type, payload } of decoder.push(chunk)) {
                    if (type === QaapSandboxFrame.Stdout || type === QaapSandboxFrame.Stderr) {
                        output = (output + payload.toString('utf8')).slice(-64 * 1024);
                    } else if (type === QaapSandboxFrame.Exit || type === QaapSandboxFrame.Error) {
                        done = true;
                        clearTimeout(timer);
                        const parsed = JSON.parse(payload.toString('utf8')) as { code?: number | null; message?: string };
                        resolve({ code: type === QaapSandboxFrame.Exit ? (parsed.code ?? 1) : 127, output: output + (parsed.message ?? '') });
                    }
                }
            });
            socket.on('error', error => {
                clearTimeout(timer);
                if (!done) {
                    reject(error);
                }
            });
            socket.on('close', () => {
                clearTimeout(timer);
                if (!done) {
                    reject(new Error('the exec server closed the connection'));
                }
            });
        });
    }

    /** One-line JSON request to the exec server (`ports`, `ping`). */
    protected execServerQuery(sandbox: QaapTaskSandbox, op: 'ports' | 'ping'): Promise<{ ok?: boolean; ports?: unknown[] }> {
        return new Promise((resolve, reject) => {
            const socket = net.connect(sandbox.exec!.port, sandbox.exec!.host);
            let text = '';
            socket.setTimeout(5_000, () => socket.destroy(new Error(`exec server ${op} timed out`)));
            socket.on('connect', () => socket.write(`${JSON.stringify({ token: sandbox.exec!.token, op })}\n`));
            socket.on('data', chunk => text += chunk.toString('utf8'));
            socket.on('error', reject);
            socket.on('close', () => {
                try {
                    resolve(JSON.parse(text.trim() || '{}'));
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    protected requireBroker(): QaapTaskSandboxBrokerClient {
        if (!this.broker?.isEnabled()) {
            throw new Error('Task sandboxes in a tenant backend need the control-plane broker (QAAP_TASK_SANDBOX=1 on the control plane).');
        }
        return this.broker;
    }

    protected brokerContainerPath(): string {
        return `${QAAP_TASK_SANDBOX_TOOLCHAIN_MOUNT}/current/bin:${DEFAULT_PATH}`;
    }

    protected portWatchMs(): number {
        return this.positiveInt('QAAP_TASK_SANDBOX_PORT_WATCH_MS', 1_000);
    }

    /** `docker run` argv for a sandbox: hardened like the tenant workers, holding only this worktree. */
    async buildRunArgs(name: string, root: string, plan: QaapTaskSandboxImagePlan, options: QaapTaskSandboxAcquireOptions): Promise<string[]> {
        const uid = options.uid ?? process.getuid?.() ?? 1000;
        const gid = options.gid ?? options.uid ?? process.getgid?.() ?? uid;
        const binds = await this.gitBinds(root);
        const home = options.env?.HOME ?? process.env.HOME;
        if (home && !this.isAncestor(this.realpath(home), root)) {
            for (const dir of this.homeDirs()) {
                const source = path.join(home, dir);
                if (fs.existsSync(source)) {
                    binds.push(`${this.realpath(source)}:${path.posix.join(QAAP_TASK_SANDBOX_HOME, dir)}:rw`);
                }
            }
        }
        const toolchain = process.env.QAAP_TASK_SANDBOX_TOOLCHAIN?.trim();
        if (toolchain && fs.existsSync(toolchain)) {
            const real = this.realpath(toolchain);
            // Also at its own path: agent commands may name the CLI by the absolute host path.
            binds.push(`${real}:${QAAP_TASK_SANDBOX_TOOLCHAIN_MOUNT}:ro`, `${real}:${real}:ro`);
        }
        const devcontainer = plan.kind === 'base' ? undefined : plan.devcontainer;
        const args = [
            'run', '-d',
            '--name', name,
            '--label', `${QAAP_TASK_SANDBOX_LABEL}=true`,
            '--label', `${QAAP_TASK_SANDBOX_WORKTREE_LABEL}=${root}`,
            '--label', `${QAAP_TASK_SANDBOX_OWNER_LABEL}=${this.ownerId()}`,
            '--label', `com.qaap.tenant-login=${(options.ownerLogin?.trim() || '__anonymous__').toLowerCase()}`,
            '--label', 'com.qaap.managed=true',
            ...Object.entries(qaapDockerNamespaceLabels()).flatMap(([key, value]) => ['--label', `${key}=${value}`]),
            '--init',
            '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges:true',
            '--pids-limit', String(this.positiveInt('QAAP_TASK_SANDBOX_PIDS', 1024)),
            '--memory', process.env.QAAP_TASK_SANDBOX_MEMORY?.trim() || '2g',
            '--cpus', process.env.QAAP_TASK_SANDBOX_CPUS?.trim() || '2',
            '--user', `${uid}:${gid}`,
            '--tmpfs', '/tmp:rw,exec,nosuid,size=2g,mode=1777',
            '--tmpfs', `${QAAP_TASK_SANDBOX_HOME}:rw,exec,nosuid,size=1g,mode=0700,uid=${uid},gid=${gid}`,
            '--network', process.env.QAAP_TASK_SANDBOX_NETWORK?.trim() || 'bridge',
            '-e', `HOME=${QAAP_TASK_SANDBOX_HOME}`,
            '-e', `QAAP_SANDBOX_EXEC_RUNNER=${EXEC_RUNNER}`,
            '-e', `QAAP_SANDBOX_BRIDGE_RUNNER=${BRIDGE_RUNNER}`,
            '-e', `QAAP_SANDBOX_BRIDGE_JS=${BRIDGE_JS}`,
            // By name: `docker run` is launched with these values in its env (see createEntry), so
            // they stay off the argv. They do persist in the container config, as containerEnv does.
            ...Object.keys(devcontainer?.containerEnv ?? {}).flatMap(key => ['-e', key]),
            ...binds.flatMap(bind => ['-v', bind]),
            '-w', root,
        ];
        if (plan.kind === 'base') {
            // The base image needs nothing written outside /tmp; devcontainer images may install
            // packages in postCreateCommand, so only the base sandbox gets a read-only rootfs.
            args.push('--read-only');
        }
        args.push('--entrypoint', '/bin/sh', plan.image, '-c', SANDBOX_ENTRYPOINT);
        return args;
    }

    /**
     * Bind the worktree read-write at its own path (paths need no translation), plus the git
     * metadata it needs. The repository's `config`, `hooks`, `info` and the worktree's own
     * link files are bound READ-ONLY on top: the backend later runs git (commit, merge-back) over
     * this metadata outside the sandbox, and a writable config or hook would run there.
     */
    protected async gitBinds(root: string): Promise<string[]> {
        const binds = [`${root}:${root}:rw`];
        const commonDir = await this.git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).catch(() => undefined);
        const gitDir = await this.git(root, ['rev-parse', '--path-format=absolute', '--git-dir']).catch(() => undefined);
        if (!commonDir || !gitDir) {
            return binds;
        }
        const common = this.realpath(commonDir);
        const own = this.realpath(gitDir);
        if (!this.isAncestor(root, common)) {
            binds.push(`${common}:${common}:rw`);
        }
        const readOnly = [
            path.join(common, 'config'),
            path.join(common, 'hooks'),
            path.join(common, 'info'),
            path.join(root, '.git'),
        ];
        if (own !== common) {
            readOnly.push(path.join(own, 'commondir'), path.join(own, 'gitdir'), path.join(own, 'config.worktree'));
        }
        for (const target of readOnly) {
            if (fs.existsSync(target)) {
                binds.push(`${target}:${target}:ro`);
            }
        }
        return binds;
    }

    protected async resolveImagePlan(root: string): Promise<QaapTaskSandboxImagePlan> {
        const base = this.baseImage();
        const plan = this.devcontainers.plan(root, base);
        if (plan.kind !== 'build') {
            return plan;
        }
        const built = await this.docker(['image', 'inspect', '--format', '{{.Id}}', plan.image]).then(() => true, () => false);
        if (built) {
            return plan;
        }
        // A cold devcontainer build can take minutes: start it in the background and run this task
        // on the base image so the sandbox still starts within the budget. Later tasks get the build.
        this.startBackgroundBuild(plan);
        console.warn(`[qaap-task-sandbox] devcontainer image ${plan.image} not built yet; building in the background, using ${base} for now`);
        return { kind: 'base', image: base };
    }

    protected startBackgroundBuild(plan: Extract<QaapTaskSandboxImagePlan, { kind: 'build' }>): void {
        if (this.backgroundBuilds.has(plan.image) || !plan.devcontainer.build) {
            return;
        }
        const build = plan.devcontainer.build;
        const args = ['build', '-t', plan.image, '-f', build.dockerfile, ...(build.target ? ['--target', build.target] : []),
            ...Object.entries(build.args).flatMap(([key, value]) => ['--build-arg', `${key}=${value}`]), build.context];
        const job = this.docker(args, 30 * 60_000)
            .then(() => console.info(`[qaap-task-sandbox] built devcontainer image ${plan.image}`))
            .catch(error => console.warn(`[qaap-task-sandbox] devcontainer build ${plan.image} failed: ${(error as Error).message}`))
            .finally(() => this.backgroundBuilds.delete(plan.image));
        this.backgroundBuilds.set(plan.image, job);
    }

    protected async runPostCreate(name: string, root: string, command: string, options: QaapTaskSandboxAcquireOptions): Promise<number> {
        const marker = await this.postCreateMarker(root);
        if (marker && fs.existsSync(marker)) {
            return 0;
        }
        const started = Date.now();
        try {
            await this.docker(['exec', '-w', root, '-e', `HOME=${QAAP_TASK_SANDBOX_HOME}`, '-e', `PATH=${this.containerPath()}`,
                name, '/bin/sh', '-c', command], POST_CREATE_TIMEOUT_MS);
            if (marker) {
                fs.writeFileSync(marker, `${new Date().toISOString()}\n`);
            }
        } catch (error) {
            console.warn(`[qaap-task-sandbox] postCreateCommand failed in ${name}: ${(error as Error).message}`);
        }
        return Date.now() - started;
    }

    /** Once-per-worktree marker in the worktree's private git dir (never in the working tree). */
    protected async postCreateMarker(root: string): Promise<string | undefined> {
        const gitDir = await this.git(root, ['rev-parse', '--path-format=absolute', '--git-dir']).catch(() => undefined);
        return gitDir ? path.join(gitDir, 'qaap-devcontainer-post-create') : undefined;
    }

    protected async waitReady(name: string): Promise<void> {
        const deadline = Date.now() + 30_000;
        for (;;) {
            const ready = await this.docker(['exec', name, '/bin/sh', '-c', `test -x ${EXEC_DIR}/run`]).then(() => true, () => false);
            if (ready) {
                return;
            }
            if (Date.now() > deadline) {
                const logs = await this.docker(['logs', '--tail', '20', name]).catch(() => '');
                throw new Error(`Sandbox ${name} did not become ready within 30 s. ${logs.trim()}`);
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    /** In-container script that ends the process group recorded for `execId` (TERM, then KILL). */
    killScript(execId: string): string {
        const pidFile = `${EXEC_DIR}/${execId}.pid`;
        return `p=$(cat ${pidFile} 2>/dev/null) || exit 0; kill -TERM -"$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null; `
            + 'for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 -"$p" 2>/dev/null || kill -0 "$p" 2>/dev/null || break; sleep 0.2; done; '
            + `kill -KILL -"$p" 2>/dev/null; kill -KILL "$p" 2>/dev/null; rm -f ${pidFile}`;
    }

    async resolveWorktreeRoot(cwd: string): Promise<string> {
        const real = this.realpath(cwd);
        const top = await this.git(real, ['rev-parse', '--show-toplevel']).catch(() => undefined);
        return top ? this.realpath(top) : real;
    }

    protected containerName(root: string): string {
        const hash = crypto.createHash('sha256').update(`task-sandbox\u0000${root}`).digest('hex').slice(0, 12);
        return qaapDockerName(`qaap-task-${hash}`);
    }

    protected containerPath(): string {
        return `${QAAP_TASK_SANDBOX_TOOLCHAIN_MOUNT}/bin:${DEFAULT_PATH}`;
    }

    protected baseImage(): string {
        const image = process.env.QAAP_TASK_SANDBOX_IMAGE?.trim() || process.env.QAAP_TENANT_DOCKER_IMAGE?.trim() || process.env.QAAP_THEIA_IMAGE?.trim();
        if (!image) {
            throw new Error('QAAP_TASK_SANDBOX=1 needs a base image: set QAAP_TASK_SANDBOX_IMAGE (or QAAP_TENANT_DOCKER_IMAGE).');
        }
        return image;
    }

    protected homeDirs(): string[] {
        const raw = process.env.QAAP_TASK_SANDBOX_HOME_DIRS;
        return raw === undefined ? DEFAULT_HOME_DIRS
            : raw.split(',').map(entry => entry.trim()).filter(entry => entry && !entry.split('/').includes('..'));
    }

    lingerMs(): number {
        const raw = Number(process.env.QAAP_TASK_SANDBOX_LINGER_MS);
        return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_LINGER_MS;
    }

    protected archiveTtlMs(): number {
        const raw = Number(process.env.QAAP_TASK_SANDBOX_ARCHIVE_TTL_MS);
        return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_ARCHIVE_TTL_MS;
    }

    endMode(): QaapTaskSandboxEndMode {
        return process.env.QAAP_TASK_SANDBOX_ON_END?.trim().toLowerCase() === 'archive' ? 'archive' : 'destroy';
    }

    protected positiveInt(name: string, fallback: number): number {
        const raw = Number(process.env[name]);
        return Number.isInteger(raw) && raw > 0 ? raw : fallback;
    }

    protected isAncestor(ancestor: string, target: string): boolean {
        return target === ancestor || target.startsWith(ancestor.endsWith(path.sep) ? ancestor : ancestor + path.sep);
    }

    protected realpath(target: string): string {
        try {
            return fs.realpathSync(target);
        } catch {
            return path.resolve(target);
        }
    }

    /**
     * What the docker CLI itself needs from the BACKEND env (binary lookup, daemon endpoint, config
     * and contexts). The task env lacks them or carries the tenant's HOME. None of these reach the
     * container: they are on the exec denylist.
     */
    protected dockerClientEnv(): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = {};
        for (const key of ['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) {
            if (process.env[key] !== undefined) {
                env[key] = process.env[key];
            }
        }
        return env;
    }

    protected dockerCli(): string {
        return process.env.QAAP_DOCKER_CLI_PATH?.trim() || 'docker';
    }

    /** The one Docker CLI seam (overridden in specs). Resolves stdout; rejects with stderr. */
    protected docker(args: string[], timeoutMs = 60_000, env: NodeJS.ProcessEnv = process.env): Promise<string> {
        return new Promise((resolve, reject) => {
            execFile(this.dockerCli(), args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(`docker ${args[0]} failed: ${String(stderr || error.message).trim().slice(0, 500)}`));
                } else {
                    resolve(String(stdout));
                }
            });
        });
    }

    protected git(cwd: string, args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            execFile('git', ['-C', cwd, ...args], { timeout: 15_000 }, (error, stdout) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(String(stdout).trim());
                }
            });
        });
    }
}
