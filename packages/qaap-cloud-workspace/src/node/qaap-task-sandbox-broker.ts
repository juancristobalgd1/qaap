// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import type { BackendApplicationContribution } from '@theia/core/lib/node';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import type * as Dockerode from 'dockerode';
import { QAAP_TENANT_RUNTIME_API_PATH } from '../common/qaap-cloud-api-types';
import { qaapDockerName, qaapDockerNamespaceLabels } from './qaap-docker-namespace';
import { QaapDockerOrchestrator, type QaapTaskSandboxPlacement, type QaapTenantBackendTarget } from './qaap-docker-orchestrator';
import {
    QAAP_TASK_SANDBOX_LINK_HEADER,
    QAAP_TASK_SANDBOX_LINK_PATH,
    QAAP_TASK_SANDBOX_REPLY_PATH,
    QaapTaskSandboxBrokerAuth,
    type QaapTaskSandboxBrokerCreateArgs,
    type QaapTaskSandboxBrokerDestroyArgs,
    type QaapTaskSandboxBrokerListed,
    type QaapTaskSandboxBrokerReply,
    type QaapTaskSandboxBrokerRequest,
    type QaapTaskSandboxBrokerSandbox,
} from './qaap-task-sandbox-broker-protocol';
import { QAAP_SANDBOX_EXEC_PORT, QAAP_SANDBOX_EXEC_READY_MARKER } from './qaap-task-sandbox-exec-protocol';

export const QAAP_TASK_SANDBOX_BROKER_LABEL = 'com.qaap.task-sandbox.broker';
const SANDBOX_LABEL = 'com.qaap.task-sandbox';
const WORKTREE_LABEL = 'com.qaap.task-sandbox.worktree';
const TOOLCHAIN_MOUNT = '/opt/qaap-agent';
const SANDBOX_HOME = '/tmp/qaap-home';
const DEFAULT_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const EXEC_SERVER_FILE = 'qaap-task-sandbox-exec-server.js';
/** Directory inside the toolchain volume (the volume itself is mounted at TOOLCHAIN_MOUNT). */
const TOOLCHAIN_VERSION = 'current';
const READY_TIMEOUT_MS = 30_000;
const LINK_SYNC_MS = 2_000;
const ORPHAN_GRACE_MS = 60_000;
const IMAGE_REFERENCE = /^[a-z0-9][a-z0-9._\-/:@]{0,254}$/i;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const HOME_LINK_NAME = /^\.[A-Za-z0-9._-]{1,64}$/;
/** Never settable from a devcontainer: they steer the exec server, the egress route or the toolchain. */
const RESERVED_ENV = /^(HOME|PATH|QAAP_.*|HTTPS?_PROXY|https?_proxy|NO_PROXY|no_proxy|NODE_OPTIONS|LD_.*)$/;

interface BrokerLink {
    readonly target: QaapTenantBackendTarget;
    readonly request: http.ClientRequest;
    readonly seen: Set<string>;
}

/**
 * Control-plane broker for task sandboxes in production (`QAAP_BACKEND_PER_TENANT=1`,
 * doc/qaap-task-sandbox.md). Tenant backends have no Docker socket; they ask this broker over a
 * link it opens to each of them (see `qaap-task-sandbox-broker-protocol.ts`). The broker accepts
 * only three operations, each scoped to the tenant whose link carried it:
 *
 * - `create`: a worktree root that must lie strictly inside that tenant's own trees. The sandbox
 *   runs on the tenant's internal network with the tenant's fixed roots bound at the paths the
 *   tenant backend sees, the tenant uid, hardened like tenant workers, and the exec server from
 *   the read-only toolchain volume as its entrypoint.
 * - `destroy` / `list`: only containers labelled with that tenant.
 *
 * The tenant cannot choose mounts, uid, network, capabilities or the entrypoint.
 */
@injectable()
export class QaapTaskSandboxBroker implements BackendApplicationContribution {

    @inject(QaapDockerOrchestrator) @optional()
    protected readonly orchestrator?: QaapDockerOrchestrator;

    protected readonly links = new Map<string, BrokerLink>();
    protected readonly toolchains = new Map<string, Promise<string>>();
    protected readonly backgroundPulls = new Map<string, Promise<void>>();
    /** Tenants that got sandboxes here, with the time their backend was last seen routed. */
    protected readonly tenantsWithSandboxes = new Map<string, number>();
    protected syncTimer: ReturnType<typeof setInterval> | undefined;

    isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
        return /^(1|true)$/i.test(env.QAAP_TASK_SANDBOX?.trim() ?? '')
            && !/^(1|true)$/i.test(env.QAAP_TENANT_BACKEND_MODE?.trim() ?? '')
            && !!this.orchestrator?.isBackendPerTenantEnabled();
    }

    onStart(): void {
        if (!this.isEnabled()) {
            return;
        }
        this.syncTimer = setInterval(() => this.syncLinks(), LINK_SYNC_MS);
        this.syncTimer.unref?.();
    }

    onStop(): void {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
        }
        for (const link of this.links.values()) {
            link.request.destroy();
        }
        this.links.clear();
    }

    /** Open a link to every routed tenant backend that has none; reap sandboxes of tenants that went away. */
    syncLinks(now = Date.now()): void {
        const targets = this.orchestrator?.listTenantBackendTargets() ?? [];
        const routed = new Set<string>();
        for (const target of targets) {
            const tenant = target.tenantLogin.trim().toLowerCase();
            routed.add(tenant);
            if (this.tenantsWithSandboxes.has(tenant)) {
                this.tenantsWithSandboxes.set(tenant, now);
            }
            const link = this.links.get(tenant);
            if (link && (link.target.containerId !== target.containerId || link.target.port !== target.port)) {
                link.request.destroy();
                this.links.delete(tenant);
            }
            if (!this.links.has(tenant)) {
                this.openLink(target);
            }
        }
        for (const [tenant, lastSeen] of this.tenantsWithSandboxes) {
            if (!routed.has(tenant) && now - lastSeen > ORPHAN_GRACE_MS) {
                // The tenant backend was stopped or destroyed: its linger timers died with it.
                this.tenantsWithSandboxes.delete(tenant);
                this.removeTenantSandboxes(tenant).catch(error =>
                    console.warn(`[qaap-task-sandbox] reaping sandboxes of ${tenant} failed: ${(error as Error).message}`));
            }
        }
    }

    protected openLink(target: QaapTenantBackendTarget): void {
        const tenant = target.tenantLogin.trim().toLowerCase();
        let probe: string;
        try {
            probe = QaapTaskSandboxBrokerAuth.createLinkProbe(tenant, this.orchestrator!.getTenantBackendAssertionSecret(tenant));
        } catch {
            return;
        }
        const request = http.get({
            host: target.host,
            port: target.port,
            path: `${QAAP_TENANT_RUNTIME_API_PATH}${QAAP_TASK_SANDBOX_LINK_PATH}`,
            headers: { [QAAP_TASK_SANDBOX_LINK_HEADER]: probe, ...this.connectionCookie(tenant) },
        }, response => {
            if (response.statusCode !== 200) {
                response.resume();
                request.destroy();
                return;
            }
            response.setEncoding('utf8');
            let buffered = '';
            response.on('data', (chunk: string) => {
                buffered += chunk;
                let newline = buffered.indexOf('\n');
                while (newline >= 0) {
                    const line = buffered.slice(0, newline).trim();
                    buffered = buffered.slice(newline + 1);
                    if (line) {
                        this.onLinkMessage(link, line);
                    }
                    newline = buffered.indexOf('\n');
                }
                if (buffered.length > 1024 * 1024) {
                    request.destroy();
                }
            });
            response.on('end', () => request.destroy());
        });
        const link: BrokerLink = { target, request, seen: new Set() };
        const drop = (): void => {
            if (this.links.get(tenant) === link) {
                this.links.delete(tenant);
            }
        };
        request.on('error', drop);
        request.on('close', drop);
        this.links.set(tenant, link);
    }

    protected onLinkMessage(link: BrokerLink, line: string): void {
        let message: unknown;
        try {
            message = JSON.parse(line);
        } catch {
            return;
        }
        if ((message as { type?: unknown }).type !== 'request') {
            return;
        }
        const tenant = link.target.tenantLogin.trim().toLowerCase();
        const secret = this.orchestrator!.getTenantBackendAssertionSecret(tenant);
        if (!QaapTaskSandboxBrokerAuth.verifyRequest(message, tenant, secret) || link.seen.has(message.id)) {
            console.warn(`[qaap-task-sandbox] rejected an unsigned, stale or replayed sandbox request on ${tenant}'s link`);
            return;
        }
        link.seen.add(message.id);
        if (link.seen.size > 4096) {
            link.seen.clear();
        }
        this.handle(tenant, message)
            .then(result => this.reply(link.target, { id: message.id, ok: true, result }))
            .catch(error => this.reply(link.target, { id: message.id, ok: false, error: (error as Error).message }));
    }

    async handle(tenant: string, request: Pick<QaapTaskSandboxBrokerRequest, 'op' | 'args'>): Promise<unknown> {
        if (request.op === 'create') {
            return this.create(tenant, request.args as QaapTaskSandboxBrokerCreateArgs);
        }
        if (request.op === 'destroy') {
            await this.destroy(tenant, request.args as QaapTaskSandboxBrokerDestroyArgs);
            return { ok: true };
        }
        return this.list(tenant);
    }

    protected reply(target: QaapTenantBackendTarget, reply: QaapTaskSandboxBrokerReply): void {
        const tenant = target.tenantLogin.trim().toLowerCase();
        const body = JSON.stringify(reply);
        const request = http.request({
            host: target.host,
            port: target.port,
            method: 'POST',
            path: `${QAAP_TENANT_RUNTIME_API_PATH}${QAAP_TASK_SANDBOX_REPLY_PATH}`,
            timeout: 10_000,
            headers: {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(body),
                [QAAP_TASK_SANDBOX_LINK_HEADER]: QaapTaskSandboxBrokerAuth.createLinkProbe(tenant, this.orchestrator!.getTenantBackendAssertionSecret(tenant)),
                ...this.connectionCookie(tenant),
            },
        }, response => response.resume());
        request.on('timeout', () => request.destroy());
        request.on('error', error => console.warn(`[qaap-task-sandbox] reply to ${tenant} failed: ${error.message}`));
        request.end(body);
    }

    protected connectionCookie(tenant: string): Record<string, string> {
        const token = this.orchestrator?.getTenantBackendConnectionToken(tenant);
        return token ? { cookie: `theia-connection-token=${encodeURIComponent(token)}` } : {};
    }

    // ─── Operations ──────────────────────────────────────────────────────────────────────────────

    async create(tenant: string, args: QaapTaskSandboxBrokerCreateArgs): Promise<QaapTaskSandboxBrokerSandbox> {
        const started = Date.now();
        const placement = await this.orchestrator!.taskSandboxPlacement(tenant);
        const root = this.validateRoot(placement, args?.root);
        const homeLinks = this.validateHomeLinks(placement, args?.homeLinks);
        const containerEnv = this.validateContainerEnv(args?.devcontainer?.containerEnv);
        const requestedImage = this.validateImage(args?.devcontainer?.image);
        const docker = placement.docker;
        const name = this.containerName(tenant, root);
        const existing = await this.inspect(docker, name);
        if (existing) {
            if (!this.ownedBy(existing, tenant)) {
                throw new Error(`Sandbox ${name} is not owned by this tenant.`);
            }
            const existingToken = this.envValue(existing, 'QAAP_SANDBOX_EXEC_TOKEN');
            if (existing.State?.Running && !existing.State.Paused && existingToken) {
                return this.describe(name, root, existingToken, existing.Config?.Image ?? placement.image, placement, 0, false);
            }
            await docker.getContainer(name).remove({ force: true });
        }
        await this.enforceLimit(docker, tenant);
        const toolchain = await this.ensureToolchain(placement);
        const image = requestedImage && await this.imagePresent(docker, requestedImage) ? requestedImage : placement.image;
        if (requestedImage && image !== requestedImage) {
            this.startBackgroundPull(docker, requestedImage);
            console.warn(`[qaap-task-sandbox] devcontainer image ${requestedImage} not present; pulling in the background, using the base image for now`);
        }
        const token = crypto.randomBytes(32).toString('base64url');
        try {
            await this.runSandbox(placement, name, tenant, root, image, toolchain, token, homeLinks, containerEnv);
        } catch (error) {
            if (image === placement.image) {
                throw error;
            }
            // Typically a musl or glibc-less devcontainer image the toolchain's node cannot run on.
            console.warn(`[qaap-task-sandbox] ${image} cannot run the exec server (${(error as Error).message}); falling back to the base image`);
            await docker.getContainer(name).remove({ force: true }).catch(() => undefined);
            await this.runSandbox(placement, name, tenant, root, placement.image, toolchain, token, homeLinks, containerEnv);
            this.tenantsWithSandboxes.set(tenant, Date.now());
            return this.describe(name, root, token, placement.image, placement, Date.now() - started, true);
        }
        this.tenantsWithSandboxes.set(tenant, Date.now());
        const sandbox = this.describe(name, root, token, image, placement, Date.now() - started, true);
        console.info(`[qaap-task-sandbox] broker started ${name} for ${tenant} ${root} (image ${image}) in ${sandbox.startupMs} ms`);
        return sandbox;
    }

    async destroy(tenant: string, args: QaapTaskSandboxBrokerDestroyArgs): Promise<void> {
        const name = typeof args?.name === 'string' ? args.name : '';
        const placement = await this.orchestrator!.taskSandboxPlacement(tenant);
        const inspect = name ? await this.inspect(placement.docker, name) : undefined;
        if (!inspect) {
            return;
        }
        if (!this.ownedBy(inspect, tenant)) {
            throw new Error(`Sandbox ${name} is not owned by this tenant.`);
        }
        const container = placement.docker.getContainer(name);
        if (args.mode === 'archive') {
            await container.stop({ t: 5 }).catch(() => undefined);
            await container.rename({ name: `${name}-archived-${Date.now()}` }).catch(() => undefined);
        } else {
            await container.remove({ force: true });
        }
    }

    async list(tenant: string): Promise<QaapTaskSandboxBrokerListed[]> {
        const placement = await this.orchestrator!.taskSandboxPlacement(tenant);
        const containers = await placement.docker.listContainers({
            all: true,
            filters: { label: [`${QAAP_TASK_SANDBOX_BROKER_LABEL}=true`, `com.qaap.tenant-login=${tenant}`] },
        });
        return containers.map(container => {
            const name = (container.Names?.[0] ?? '').replace(/^\//, '');
            return {
                name,
                root: container.Labels?.[WORKTREE_LABEL] ?? '',
                running: container.State === 'running',
                archived: name.includes('-archived-'),
            };
        });
    }

    async removeTenantSandboxes(tenant: string): Promise<number> {
        const placement = await this.orchestrator!.taskSandboxPlacement(tenant);
        let removed = 0;
        for (const sandbox of await this.list(tenant)) {
            if (!sandbox.archived) {
                await placement.docker.getContainer(sandbox.name).remove({ force: true }).catch(() => undefined);
                removed++;
            }
        }
        return removed;
    }

    // ─── Validation ──────────────────────────────────────────────────────────────────────────────

    /**
     * The worktree root as the tenant backend sees it, strictly inside one of the tenant's own
     * repos/worktrees/parallel trees, existing as a real directory (not a symlink) for this
     * control plane. Only used as the exec cwd and a label: it is never a bind source.
     */
    validateRoot(placement: QaapTaskSandboxPlacement, raw: unknown): string {
        if (typeof raw !== 'string' || !raw.startsWith('/') || raw.includes('\u0000') || raw.length > 4096) {
            throw new Error('Sandbox root must be an absolute path.');
        }
        const root = path.posix.normalize(raw).replace(/\/+$/, '');
        if (root !== raw.replace(/\/+$/, '') || root.split('/').includes('..')) {
            throw new Error('Sandbox root must be a normalized path.');
        }
        const owner = placement.roots.find(candidate => candidate.kind !== 'tenant-config' && root.startsWith(`${candidate.backendPath}/`));
        if (!owner) {
            throw new Error(`Sandbox root ${root} is not inside this tenant's repositories or worktrees.`);
        }
        const hostPath = path.join(owner.hostPath, ...root.slice(owner.backendPath.length + 1).split('/'));
        let stat: fs.Stats;
        try {
            stat = fs.lstatSync(hostPath);
        } catch {
            throw new Error(`Sandbox root ${root} does not exist.`);
        }
        if (!stat.isDirectory()) {
            throw new Error(`Sandbox root ${root} is not a directory.`);
        }
        return root;
    }

    protected validateHomeLinks(placement: QaapTaskSandboxPlacement, raw: unknown): Array<{ name: string; target: string }> {
        const config = placement.roots.find(candidate => candidate.kind === 'tenant-config')!;
        const links: Array<{ name: string; target: string }> = [];
        for (const entry of Array.isArray(raw) ? raw.slice(0, 64) : []) {
            const name = (entry as { name?: unknown }).name;
            const target = (entry as { target?: unknown }).target;
            if (typeof name !== 'string' || !HOME_LINK_NAME.test(name) || typeof target !== 'string') {
                continue;
            }
            const normalized = path.posix.normalize(target);
            // A symlink is resolved inside the sandbox's own mount namespace, but keep it to the tenant storage.
            if (normalized === target && normalized.startsWith(`${config.backendPath}/`) && !normalized.split('/').includes('..')) {
                links.push({ name, target: normalized });
            }
        }
        return links;
    }

    protected validateContainerEnv(raw: unknown): Record<string, string> {
        const env: Record<string, string> = {};
        if (!raw || typeof raw !== 'object') {
            return env;
        }
        for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 64)) {
            if (ENV_NAME.test(key) && !RESERVED_ENV.test(key) && typeof value === 'string' && value.length <= 4096 && !value.includes('\u0000')) {
                env[key] = value;
            }
        }
        return env;
    }

    protected validateImage(raw: unknown): string | undefined {
        if (raw === undefined) {
            return undefined;
        }
        if (typeof raw !== 'string' || !IMAGE_REFERENCE.test(raw) || raw.includes('..')) {
            throw new Error('Invalid devcontainer image reference.');
        }
        return raw;
    }

    // ─── Docker ──────────────────────────────────────────────────────────────────────────────────

    protected async runSandbox(
        placement: QaapTaskSandboxPlacement, name: string, tenant: string, root: string, image: string,
        toolchain: string, token: string, homeLinks: Array<{ name: string; target: string }>, containerEnv: Record<string, string>,
    ): Promise<void> {
        const docker = placement.docker;
        const [uid, gid] = placement.user.split(':');
        const container = await docker.createContainer({
            name,
            Image: image,
            User: placement.user,
            WorkingDir: root,
            Entrypoint: [`${TOOLCHAIN_MOUNT}/${TOOLCHAIN_VERSION}/bin/node`, `${TOOLCHAIN_MOUNT}/${TOOLCHAIN_VERSION}/lib/${EXEC_SERVER_FILE}`],
            Cmd: [],
            Env: [
                ...Object.entries(containerEnv).map(([key, value]) => `${key}=${value}`),
                ...Object.entries(placement.egressEnv).map(([key, value]) => `${key}=${value}`),
                `HOME=${SANDBOX_HOME}`,
                `PATH=${TOOLCHAIN_MOUNT}/${TOOLCHAIN_VERSION}/bin:${DEFAULT_PATH}`,
                `QAAP_SANDBOX_EXEC_TOKEN=${token}`,
                `QAAP_SANDBOX_EXEC_PORT=${QAAP_SANDBOX_EXEC_PORT}`,
                `QAAP_SANDBOX_HOME_LINKS=${JSON.stringify(homeLinks)}`,
            ],
            Labels: {
                'com.qaap.managed': 'true',
                ...qaapDockerNamespaceLabels(),
                [SANDBOX_LABEL]: 'true',
                [QAAP_TASK_SANDBOX_BROKER_LABEL]: 'true',
                [WORKTREE_LABEL]: root,
                'com.qaap.tenant-login': tenant,
            },
            Healthcheck: { Test: ['NONE'] },
            HostConfig: {
                Init: true,
                CapDrop: ['ALL'],
                SecurityOpt: ['no-new-privileges:true'],
                PidsLimit: this.positiveInt('QAAP_TASK_SANDBOX_PIDS', 1024),
                Memory: this.memoryBytes(process.env.QAAP_TASK_SANDBOX_MEMORY?.trim() || '2g'),
                NanoCpus: Math.round(Number(process.env.QAAP_TASK_SANDBOX_CPUS?.trim() || '2') * 1e9) || 2e9,
                // The base image needs nothing written outside /tmp; a devcontainer image may install packages.
                ReadonlyRootfs: image === placement.image,
                Tmpfs: {
                    '/tmp': 'rw,exec,nosuid,nodev,size=2g,mode=1777',
                    [SANDBOX_HOME]: `rw,exec,nosuid,nodev,size=1g,mode=0700,uid=${uid},gid=${gid ?? uid}`,
                },
                Binds: [
                    ...placement.roots.map(entry => `${entry.source}:${entry.backendPath}:rw`),
                    `${toolchain}:${TOOLCHAIN_MOUNT}:ro`,
                ],
                NetworkMode: placement.network,
                AutoRemove: false,
            },
        });
        if (placement.directEgressNetwork) {
            await docker.getNetwork(placement.directEgressNetwork).connect({ Container: name });
        }
        await container.start();
        await this.waitReady(container);
    }

    protected async waitReady(container: Dockerode.Container): Promise<void> {
        const deadline = Date.now() + READY_TIMEOUT_MS;
        for (;;) {
            const logs = String(await container.logs({ stdout: true, stderr: true, tail: 50 }).catch(() => ''));
            if (logs.includes(QAAP_SANDBOX_EXEC_READY_MARKER)) {
                return;
            }
            const inspect = await container.inspect().catch(() => undefined);
            if (!inspect?.State?.Running) {
                throw new Error(`exec server exited (${inspect?.State?.ExitCode ?? '?'}): ${logs.replace(/[^\x20-\x7e\n]/g, '').trim().slice(-400)}`);
            }
            if (Date.now() > deadline) {
                throw new Error('exec server did not become ready within 30 s');
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    /**
     * The read-only `/opt/qaap-agent` toolchain volume: node and the exec server copied from the
     * tenant image once per (image, server version). A sandbox image without a compatible libc
     * cannot run it and falls back to the base image.
     */
    protected ensureToolchain(placement: QaapTaskSandboxPlacement): Promise<string> {
        const server = this.execServerSource();
        const key = `${placement.image}\u0000${crypto.createHash('sha256').update(server).digest('hex')}`;
        let job = this.toolchains.get(key);
        if (!job) {
            job = this.populateToolchain(placement, server).catch(error => {
                this.toolchains.delete(key);
                throw error;
            });
            this.toolchains.set(key, job);
        }
        return job;
    }

    protected async populateToolchain(placement: QaapTaskSandboxPlacement, server: string): Promise<string> {
        const docker = placement.docker;
        const imageId = (await docker.getImage(placement.image).inspect()).Id;
        const hash = crypto.createHash('sha256').update(`${imageId}\u0000${server}`).digest('hex').slice(0, 12);
        const volume = qaapDockerName(`qaap-agent-toolchain-${hash}`);
        await docker.createVolume({
            Name: volume,
            Labels: { 'com.qaap.managed': 'true', ...qaapDockerNamespaceLabels(), 'com.qaap.agent-toolchain': 'true' },
        });
        // Idempotent and crash-safe: a finished toolchain is renamed into place, never half-written.
        const script = `set -e; [ -x /out/${TOOLCHAIN_VERSION}/bin/node ] && [ -f /out/${TOOLCHAIN_VERSION}/lib/${EXEC_SERVER_FILE} ] && exit 0; `
            + 'rm -rf /out/.staging; mkdir -p /out/.staging/bin /out/.staging/lib; cp "$(command -v node)" /out/.staging/bin/node; '
            + `printf '%s' "$QAAP_EXEC_SERVER_JS" > /out/.staging/lib/${EXEC_SERVER_FILE}; chmod -R a+rX,go-w /out/.staging; `
            + `rm -rf /out/${TOOLCHAIN_VERSION}; mv /out/.staging /out/${TOOLCHAIN_VERSION}`;
        const container = await docker.createContainer({
            Image: placement.image,
            User: '0:0',
            Entrypoint: ['/bin/sh', '-c', script],
            Cmd: [],
            Env: [`QAAP_EXEC_SERVER_JS=${server}`],
            Labels: { 'com.qaap.managed': 'true', ...qaapDockerNamespaceLabels() },
            HostConfig: {
                Binds: [`${volume}:/out`],
                NetworkMode: 'none',
                CapDrop: ['ALL'],
                SecurityOpt: ['no-new-privileges:true'],
                ReadonlyRootfs: true,
                AutoRemove: false,
            },
        });
        try {
            await container.start();
            const result = await container.wait() as { StatusCode?: number };
            if (result.StatusCode !== 0) {
                const logs = String(await container.logs({ stdout: true, stderr: true, tail: 20 }).catch(() => ''));
                throw new Error(`populating the agent toolchain failed (${result.StatusCode}): ${logs.trim().slice(-300)}`);
            }
        } finally {
            await container.remove({ force: true }).catch(() => undefined);
        }
        return volume;
    }

    protected execServerSource(): string {
        return fs.readFileSync(path.join(__dirname, EXEC_SERVER_FILE), 'utf8');
    }

    protected startBackgroundPull(docker: Dockerode, image: string): void {
        if (this.backgroundPulls.has(image)) {
            return;
        }
        const job = new Promise<void>((resolve, reject) => {
            docker.pull(image, (error: Error | null, stream: NodeJS.ReadableStream) => {
                if (error) {
                    reject(error);
                    return;
                }
                docker.modem.followProgress(stream, (followError: Error | null) => followError ? reject(followError) : resolve());
            });
        }).then(
            () => console.info(`[qaap-task-sandbox] pulled devcontainer image ${image}`),
            error => console.warn(`[qaap-task-sandbox] pulling ${image} failed: ${(error as Error).message}`),
        ).finally(() => this.backgroundPulls.delete(image));
        this.backgroundPulls.set(image, job);
    }

    protected async imagePresent(docker: Dockerode, image: string): Promise<boolean> {
        return docker.getImage(image).inspect().then(() => true, () => false);
    }

    protected async enforceLimit(docker: Dockerode, tenant: string): Promise<void> {
        const max = this.positiveInt('QAAP_TASK_SANDBOX_MAX_PER_TENANT', 8);
        const containers = await docker.listContainers({
            filters: { label: [`${QAAP_TASK_SANDBOX_BROKER_LABEL}=true`, `com.qaap.tenant-login=${tenant}`] },
        });
        if (containers.length >= max) {
            throw new Error(`This tenant already runs ${containers.length} task sandboxes (limit ${max}).`);
        }
    }

    protected async inspect(docker: Dockerode, name: string): Promise<Dockerode.ContainerInspectInfo | undefined> {
        try {
            return await docker.getContainer(name).inspect();
        } catch (error) {
            if ((error as { statusCode?: number }).statusCode === 404) {
                return undefined;
            }
            throw error;
        }
    }

    protected ownedBy(inspect: Dockerode.ContainerInspectInfo, tenant: string): boolean {
        const labels = inspect.Config?.Labels ?? {};
        return labels[QAAP_TASK_SANDBOX_BROKER_LABEL] === 'true' && labels['com.qaap.tenant-login'] === tenant;
    }

    protected envValue(inspect: Dockerode.ContainerInspectInfo, key: string): string | undefined {
        const entry = (inspect.Config?.Env ?? []).find(candidate => candidate.startsWith(`${key}=`));
        return entry?.slice(key.length + 1);
    }

    protected describe(
        name: string, root: string, token: string, image: string, placement: QaapTaskSandboxPlacement, startupMs: number, created: boolean,
    ): QaapTaskSandboxBrokerSandbox {
        return { name, root, host: name, port: QAAP_SANDBOX_EXEC_PORT, token, image, imageKind: image === placement.image ? 'base' : 'image', startupMs, created };
    }

    containerName(tenant: string, root: string): string {
        const hash = crypto.createHash('sha256').update(`task-sandbox\u0000${tenant}\u0000${root}`).digest('hex').slice(0, 12);
        return qaapDockerName(`qaap-task-${hash}`);
    }

    protected positiveInt(name: string, fallback: number): number {
        const raw = Number(process.env[name]);
        return Number.isInteger(raw) && raw > 0 ? raw : fallback;
    }

    protected memoryBytes(raw: string): number {
        const match = /^(\d+(?:\.\d+)?)([kmg]?)b?$/i.exec(raw.trim());
        if (!match) {
            return 2 * 1024 ** 3;
        }
        const unit = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[match[2].toLowerCase() as '' | 'k' | 'm' | 'g'];
        return Math.round(Number(match[1]) * unit);
    }
}
