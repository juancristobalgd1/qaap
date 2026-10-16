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
import * as path from 'path';
import { QaapDevcontainerResolver, type QaapTaskSandboxImagePlan } from './qaap-devcontainer-config';
import { qaapDockerName, qaapDockerNamespaceLabels } from './qaap-docker-namespace';

/**
 * Per-task ephemeral sandbox (roadmap H2.2, design in doc/qaap-task-sandbox.md).
 *
 * Every agent task whose cwd is a git worktree runs in its own container: its own PID and network
 * namespaces (so two tasks can bind the same hardcoded port and cannot see or kill each other's
 * processes) and a filesystem that holds only that worktree, its git metadata and the agent's
 * credential directories. The container uses the repo's devcontainer image when there is one,
 * otherwise the base image, and is destroyed (or archived) once the last task using it ends.
 *
 * v1 is "direct mode": the backend drives the Docker daemon it can reach (local dev with Docker,
 * or a control plane in QAAP_CLOUD_MODE=docker). Per-tenant backends have no Docker socket; the
 * control-plane broker they need is the documented next step. Everything is behind
 * `QAAP_TASK_SANDBOX=1` (default off).
 */

export const QAAP_TASK_SANDBOX_ENV = 'QAAP_TASK_SANDBOX';
export const QAAP_TASK_SANDBOX_LABEL = 'com.qaap.task-sandbox';
export const QAAP_TASK_SANDBOX_WORKTREE_LABEL = 'com.qaap.task-sandbox.worktree';
export const QAAP_TASK_SANDBOX_ARCHIVED_LABEL = 'com.qaap.task-sandbox.archived';

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
}

interface SandboxEntry {
    sandbox: QaapTaskSandbox;
    readonly tasks: Set<string>;
    teardownTimer?: ReturnType<typeof setTimeout>;
    readonly forwards: Map<number, net.Server>;
}

export type QaapTaskSandboxEndMode = 'destroy' | 'archive';

@injectable()
export class QaapTaskSandboxService implements BackendApplicationContribution {

    @inject(QaapDevcontainerResolver) @optional()
    protected readonly devcontainers: QaapDevcontainerResolver = new QaapDevcontainerResolver();

    protected readonly entries = new Map<string, SandboxEntry>();
    protected readonly pending = new Map<string, Promise<SandboxEntry>>();
    protected readonly taskRoots = new Map<string, string>();
    protected readonly backgroundBuilds = new Map<string, Promise<void>>();
    protected execCounter = 0;

    /** Reap sandboxes a previous backend left behind (crash, restart, deploy). Off with the flag. */
    onStart(): void {
        if (!this.isEnabled()) {
            return;
        }
        this.reapOrphans().then(removed => {
            if (removed) {
                console.info(`[qaap-task-sandbox] removed ${removed} orphaned sandbox container(s)`);
            }
        });
    }

    /** End every live sandbox on a clean shutdown; its worktree stays on disk. */
    onStop(): void {
        for (const root of [...this.entries.keys()]) {
            this.end(root).catch(() => undefined);
        }
    }

    isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
        return /^(1|true)$/i.test(env[QAAP_TASK_SANDBOX_ENV]?.trim() ?? '');
    }

    /**
     * Ensure the sandbox for the worktree containing `cwd` and register `taskId` on it. Concurrent
     * acquires for one worktree share a single container; different worktrees get different ones.
     */
    async acquire(options: QaapTaskSandboxAcquireOptions): Promise<QaapTaskSandbox> {
        const root = await this.resolveWorktreeRoot(options.cwd);
        let entry = this.entries.get(root);
        if (!entry) {
            let pending = this.pending.get(root);
            if (!pending) {
                pending = this.createEntry(root, options).finally(() => this.pending.delete(root));
                this.pending.set(root, pending);
            }
            entry = await pending;
        }
        if (entry.teardownTimer) {
            clearTimeout(entry.teardownTimer);
            entry.teardownTimer = undefined;
        }
        entry.tasks.add(options.taskId);
        this.taskRoots.set(options.taskId, root);
        return entry.sandbox;
    }

    /** Unregister a task; when it was the last one the sandbox ends after the linger period. */
    release(taskId: string): void {
        const root = this.taskRoots.get(taskId);
        this.taskRoots.delete(taskId);
        const entry = root ? this.entries.get(root) : undefined;
        if (!entry || !entry.tasks.delete(taskId) || entry.tasks.size > 0) {
            return;
        }
        const linger = this.lingerMs();
        const end = (): void => {
            this.end(entry.sandbox.root).catch(error =>
                console.warn(`[qaap-task-sandbox] ending ${entry.sandbox.name} failed: ${(error as Error).message}`));
        };
        if (linger <= 0) {
            end();
            return;
        }
        entry.teardownTimer = setTimeout(end, linger);
        entry.teardownTimer.unref?.();
    }

    /** End the sandbox of `root` now: destroy it, or stop and label it for later inspection. */
    async end(root: string, mode: QaapTaskSandboxEndMode = this.endMode()): Promise<void> {
        const entry = this.entries.get(root);
        if (!entry) {
            return;
        }
        this.entries.delete(root);
        if (entry.teardownTimer) {
            clearTimeout(entry.teardownTimer);
        }
        for (const server of entry.forwards.values()) {
            server.close();
        }
        if (mode === 'archive') {
            // Docker labels are immutable: the archive marker is the stopped state plus a rename.
            await this.docker(['stop', '-t', '5', entry.sandbox.name]).catch(() => undefined);
            await this.docker(['rename', entry.sandbox.name, `${entry.sandbox.name}-archived-${Date.now()}`]).catch(() => undefined);
        } else {
            await this.docker(['rm', '-f', entry.sandbox.name]);
        }
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
     * `docker exec` argv that runs `file args` inside the sandbox at `cwd`. Variables are passed by
     * NAME only (the docker CLI copies the values from its own env), so secrets never appear on an
     * argv or in the container's persisted config. Launch the docker CLI with `env` as its env.
     */
    wrapExec(sandbox: QaapTaskSandbox, cwd: string, file: string, args: readonly string[], env: NodeJS.ProcessEnv | undefined, execId: string): { file: string; args: string[] } {
        const envArgs: string[] = [];
        for (const [key, value] of Object.entries(env ?? {})) {
            if (value === undefined || EXEC_ENV_DENYLIST.has(key) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
                continue;
            }
            envArgs.push('-e', key);
        }
        for (const key of Object.keys(sandbox.remoteEnv)) {
            envArgs.push('-e', `${key}=${sandbox.remoteEnv[key]}`);
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
     * Spawn `file args` inside the sandbox. The docker CLI swallows SIGTERM (it exits 0 and leaves
     * the exec'd process running), so it runs under a host `sh` whose trap kills the in-container
     * process group when the task is cancelled or a dev server restarts (group kill of the client).
     */
    spawnInSandbox(
        sandbox: QaapTaskSandbox,
        file: string,
        args: readonly string[],
        options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ('pipe' | 'ignore')[]; detached?: boolean },
        launch: (file: string, args: string[], options: object) => ChildProcess = (f, a, o) => spawn(f, a, o as Parameters<typeof spawn>[2]),
    ): ChildProcess {
        const execId = `x${process.pid}-${Date.now().toString(36)}-${(this.execCounter++).toString(36)}`;
        const wrapped = this.wrapExec(sandbox, options.cwd, file, args, options.env, execId);
        const child = launch('/bin/sh', ['-c', SIGNAL_FORWARDER, 'qaap-sandbox-exec', wrapped.file, sandbox.name, this.killScript(execId), ...wrapped.args], {
            // The docker CLI runs on the host: its cwd only needs to exist.
            cwd: fs.existsSync(options.cwd) ? options.cwd : undefined,
            env: { ...options.env, ...this.dockerClientEnv() },
            stdio: options.stdio,
            detached: options.detached ?? process.platform !== 'win32',
        });
        const port = Number(options.env.QAAP_PREVIEW_PORT ?? options.env.PORT);
        if (Number.isInteger(port) && port > 0 && port < 65536) {
            this.forwardPort(sandbox, port, port).catch(error =>
                console.warn(`[qaap-task-sandbox] preview forward ${port} → ${sandbox.name} failed: ${(error as Error).message}`));
        }
        return child;
    }

    /**
     * Expose the sandbox's loopback `containerPort` on the backend's `127.0.0.1:hostPort` (0 picks a
     * free port). Each connection runs a small bridge with `docker exec`, so nothing is published
     * and it works whatever address the dev server bound inside its own network namespace.
     * Resolves to the host port.
     */
    async forwardPort(sandbox: QaapTaskSandbox, containerPort: number, hostPort = 0): Promise<number> {
        const entry = this.entries.get(sandbox.root);
        if (!entry) {
            throw new Error(`Sandbox ${sandbox.name} is not running.`);
        }
        const existing = entry.forwards.get(containerPort);
        if (existing) {
            return (existing.address() as net.AddressInfo).port;
        }
        const server = net.createServer(socket => {
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
        });
        entry.forwards.set(containerPort, server);
        try {
            await new Promise<void>((resolve, reject) => {
                server.once('error', reject);
                server.listen(hostPort, '127.0.0.1', () => resolve());
            });
        } catch (error) {
            entry.forwards.delete(containerPort);
            throw error;
        }
        return (server.address() as net.AddressInfo).port;
    }

    /** Remove sandboxes this namespace left behind (backend crash/restart) and expired archives. */
    async reapOrphans(now: number = Date.now()): Promise<number> {
        const listed = await this.docker([
            'ps', '-a', '--filter', `label=${QAAP_TASK_SANDBOX_LABEL}=true`,
            '--format', '{{.Names}}\t{{.State}}\t{{.CreatedAt}}',
        ]).catch(() => '');
        const live = new Set([...this.entries.values()].map(entry => entry.sandbox.name));
        const prefix = qaapDockerName('qaap-task-');
        let removed = 0;
        for (const line of listed.split('\n').filter(Boolean)) {
            const [name, state, createdAt] = line.split('\t');
            if (!name.startsWith(prefix) || live.has(name)) {
                continue;
            }
            const archived = name.includes('-archived-');
            const age = now - Date.parse(createdAt?.replace(/ [A-Z]+$/, '') ?? '');
            if (archived && state !== 'running' && !(age > this.archiveTtlMs())) {
                continue;
            }
            await this.docker(['rm', '-f', name]).catch(() => undefined);
            removed++;
        }
        return removed;
    }

    protected async createEntry(root: string, options: QaapTaskSandboxAcquireOptions): Promise<SandboxEntry> {
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
            await this.docker(await this.buildRunArgs(name, root, plan, options));
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
        const entry: SandboxEntry = { sandbox, tasks: new Set(), forwards: new Map() };
        this.entries.set(root, entry);
        return entry;
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
            ...Object.entries(devcontainer?.containerEnv ?? {}).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
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
    protected docker(args: string[], timeoutMs = 60_000): Promise<string> {
        return new Promise((resolve, reject) => {
            execFile(this.dockerCli(), args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
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
