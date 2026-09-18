// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { FileUri } from '@theia/core/lib/node';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as Dockerode from 'dockerode';
import {
    resolveQaapParallelRoot,
    resolveQaapReposRoot,
    resolveQaapWorktreesRoot,
    resolveTenantIsolationRoot,
    QAAP_USER_REPOS_SEGMENT,
    safeUserIdSegment,
    resolveQaapTenantUserRoot,
    resolveQaapTenantConfigRoot,
    resolveUserReposRoot,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import {
    assertQaapDockerControlPlane,
    isQaapHostedRuntime,
    resolveQaapDockerNodes,
    type QaapDockerNodeConfig,
} from './qaap-docker-control-plane';
import { QaapTenantRuntimeMetrics } from './qaap-tenant-runtime-metrics';
import { QaapTenantRuntimeStore } from './qaap-tenant-runtime-store';

const QAAP_CONTAINER_PREFIX = 'qaap-ws-';
const QAAP_TENANT_NETWORK_PREFIX = 'qaap-net-';
const DEFAULT_IMAGE = process.env.QAAP_DOCKER_IMAGE?.trim() || 'node:20-bookworm';
const WORKSPACE_MOUNT = '/workspace';
const WORKTREES_MOUNT = `${WORKSPACE_MOUNT}/.qaap-worktrees`;
const PARALLEL_MOUNT = `${WORKSPACE_MOUNT}/.qaap-parallel`;
const TENANT_BACKEND_PORT = 4873;
const TENANT_BACKEND_REPOS_ROOT = '/workspace/repos';
const TENANT_BACKEND_REPOS_MOUNT = `${TENANT_BACKEND_REPOS_ROOT}/users`;
const TENANT_BACKEND_WORKTREES_MOUNT = '/tmp/qaap-worktrees';
const TENANT_BACKEND_PARALLEL_MOUNT = '/tmp/qaap-parallel';
const TENANT_BACKEND_QAAP_HOME_MOUNT = '/home/theia/.qaap';
const TENANT_BACKEND_THEIA_HOME_MOUNT = '/home/theia/.theia';
const TENANT_BACKEND_SQLITE_STORE_PATH = `${TENANT_BACKEND_QAAP_HOME_MOUNT}/tenant.sqlite`;
// Agent CLIs such as Copilot extract native addons under HOME. Keep the worker scratch space
// executable while retaining the other hardening flags; a noexec tmpfs makes those addons look
// missing even when the extracted .node file is present.
const TENANT_TMPFS_OPTIONS = 'rw,exec,nosuid,nodev,size=512m';

/**
 * Environment variables that belong to the shared backend/control plane. They may be needed by
 * the parent `docker` CLI, but must never be copied into an untrusted tenant process. Tenant
 * provider/deploy credentials are intentionally not matched by a broad `SECRET`/`TOKEN` regex:
 * those are explicit tenant inputs and must reach the worker when the caller supplied them.
 */
const TENANT_WORKER_ENV_DENYLIST = new Set([
    'DOCKER_HOST',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
    'DOCKER_CONTEXT',
    'QAAP_DOCKER_SOCKET_SOURCE',
    'QAAP_DOCKER_SOCKET_TARGET',
    'QAAP_DOCKER_NODES',
    'QAAP_DOCKER_PUBLISH_HOST_IP',
    'QAAP_DOCKER_REMOTE_REPOS_ROOT',
    'QAAP_DOCKER_REMOTE_WORKTREES_ROOT',
    'QAAP_DOCKER_REMOTE_PARALLEL_ROOT',
    'QAAP_DOCKER_REMOTE_TENANT_CONFIG_ROOT',
    'QAAP_ALLOW_ROOTFUL_DOCKER_SOCKET_IN_PRODUCTION',
    'QAAP_GITHUB_CLIENT_SECRET',
    'QAAP_VAPID_PRIVATE_KEY',
    'QAAP_VAPID_SUBJECT',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'QAAP_SESSION_SECRET',
    'QAAP_COOKIE_SECRET',
    'QAAP_JWT_SECRET',
    'QAAP_DATABASE_URL',
    'QAAP_REDIS_URL',
    'QAAP_TENANT_UID_REGISTRY_PATH',
    'QAAP_SYSTEM_SKILLS_DIR',
]);

interface QaapTenantMountSet {
    readonly reposRoot: string;
    readonly worktreesRoot: string;
    readonly parallelRoot: string;
}

export interface QaapDockerEnsureResult {
    readonly containerId: string;
    readonly containerName: string;
    readonly workspaceMount: string;
    readonly hostPath: string;
}

export interface QaapTenantBackendTarget {
    readonly containerId: string;
    readonly containerName: string;
    readonly host: string;
    readonly port: number;
    readonly tenantLogin: string;
}

export interface QaapManagedTenantContainer {
    readonly tenantLogin?: string;
    readonly kind: 'worker' | 'backend';
    readonly containerId: string;
    readonly containerName: string;
    readonly running: boolean;
    readonly nodeId?: string;
}

interface QaapDockerNodeClient {
    readonly config: QaapDockerNodeConfig;
    readonly docker: Dockerode;
}

/** One hardened worker container per tenant when `QAAP_CLOUD_MODE=docker`. */
@injectable()
export class QaapDockerOrchestrator {

    @inject(QaapTenantRuntimeMetrics) @optional()
    protected readonly runtimeMetrics: QaapTenantRuntimeMetrics | undefined;

    @inject(QaapTenantRuntimeStore) @optional()
    protected readonly runtimeStore: QaapTenantRuntimeStore | undefined;

    protected docker: Dockerode | undefined;
    /** Per-node verification is needed when a tenant pool uses more than one remote daemon. */
    protected readonly verifiedDockerNodeIds = new Set<string>();
    protected dockerNodeConfigs: readonly QaapDockerNodeConfig[] | undefined;
    protected readonly dockerNodeClients = new Map<string, QaapDockerNodeClient>();
    /** Canonical host-side repository roots for containers validated during this backend lifetime. */
    protected readonly tenantRoots = new Map<string, string>();
    /** All host-side roots mounted into each validated tenant worker. */
    protected readonly tenantMounts = new Map<string, QaapTenantMountSet>();
    /** Prevent two first-use requests from racing into duplicate container creation. */
    protected readonly tenantEnsurePromises = new Map<string, Promise<QaapDockerEnsureResult>>();
    /** Tenant Theia backends are separate from legacy worker containers. */
    protected readonly tenantBackendTargets = new Map<string, QaapTenantBackendTarget>();
    protected readonly tenantBackendEnsurePromises = new Map<string, Promise<QaapTenantBackendTarget>>();
    /** Internal BrowserConnectionToken values captured from each tenant backend's health response. */
    protected readonly tenantBackendConnectionTokens = new Map<string, string>();

    isEnabled(): boolean {
        const cloudMode = (process.env.QAAP_CLOUD_MODE?.trim() || 'local').toLowerCase();
        return cloudMode === 'docker' || /^(1|true)$/i.test(process.env.QAAP_TENANT_CONTAINER_ISOLATION?.trim() ?? '');
    }

    /** True only for the complete backend-per-tenant data plane, not the worker-only mode. */
    isBackendPerTenantEnabled(): boolean {
        return /^(1|true)$/i.test(process.env.QAAP_BACKEND_PER_TENANT?.trim() ?? '');
    }

    /**
     * Ensure a full Theia backend runs inside the tenant's hardened container. The public router
     * uses the returned loopback port and never exposes the Docker socket or a tenant container
     * port directly to the browser.
     */
    async ensureTenantBackend(ownerLogin: string, tenantRootHostPath: string): Promise<QaapTenantBackendTarget> {
        if (!this.isBackendPerTenantEnabled()) {
            throw new Error('Backend-per-tenant mode is not enabled. Set QAAP_BACKEND_PER_TENANT=1 only with the tenant proxy enabled.');
        }
        const tenant = ownerLogin.trim();
        if (!tenant) {
            throw new Error('A tenant backend requires an authenticated owner login.');
        }
        const key = tenant.toLowerCase();
        const existing = this.tenantBackendTargets.get(key);
        if (existing) {
            return existing;
        }
        const inFlight = this.tenantBackendEnsurePromises.get(key);
        if (inFlight) {
            return inFlight;
        }
        const coldStartAt = Date.now();
        const wasReady = this.tenantBackendTargets.has(key);
        this.runtimeStore?.setState(ownerLogin, 'starting', {
            lastActivityAt: new Date().toISOString(),
            idleSince: undefined,
            stoppedAt: undefined,
            destroyAfter: undefined,
        });
        const promise = this.createOrValidateTenantBackend(tenant, tenantRootHostPath);
        this.tenantBackendEnsurePromises.set(key, promise);
        try {
            const target = await promise;
            if (!wasReady) {
                this.runtimeMetrics?.recordColdStart(Date.now() - coldStartAt);
            }
            this.runtimeStore?.setState(ownerLogin, 'active', {
                backendContainerId: target.containerId,
                lastActivityAt: new Date().toISOString(),
                idleSince: undefined,
                stoppedAt: undefined,
                destroyAfter: undefined,
                lastError: undefined,
            });
            this.tenantBackendTargets.set(key, target);
            return target;
        } finally {
            if (this.tenantBackendEnsurePromises.get(key) === promise) {
                this.tenantBackendEnsurePromises.delete(key);
            }
        }
    }

    getTenantBackendTarget(ownerLogin: string | undefined): QaapTenantBackendTarget | undefined {
        const tenant = ownerLogin?.trim().toLowerCase();
        return tenant ? this.tenantBackendTargets.get(tenant) : undefined;
    }

    /**
     * Refresh readiness for a cached backend when a WebSocket is about to be proxied. This keeps
     * the internal Theia connection token available after a backend restart without exposing the
     * tenant backend directly to the browser.
     */
    async ensureTenantBackendReady(ownerLogin: string): Promise<QaapTenantBackendTarget> {
        const target = this.getTenantBackendTarget(ownerLogin);
        if (!target) {
            throw new Error(`No tenant backend is registered for ${ownerLogin}.`);
        }
        if (!this.getTenantBackendConnectionToken(ownerLogin)) {
            await this.waitForTenantBackendReady(target);
        }
        return target;
    }

    async stopTenantBackend(ownerLogin: string | undefined): Promise<void> {
        const tenant = ownerLogin?.trim().toLowerCase();
        if (!tenant) {
            return;
        }
        const name = this.backendContainerNameForTenant(ownerLogin);
        const nodes = await this.verifiedDockerNodesForTenant(ownerLogin);
        try {
            for (const node of nodes) {
                try {
                    await node.docker.getContainer(name).stop({ t: 10 });
                    break;
                } catch (error) {
                    if (this.isDockerAlreadyStopped(error)) {
                        break;
                    }
                    if (!this.isDockerNotFound(error)) {
                        throw error;
                    }
                }
            }
        } finally {
            this.tenantBackendTargets.delete(tenant);
            this.tenantBackendConnectionTokens.delete(tenant);
        }
    }

    getTenantBackendConnectionToken(ownerLogin: string | undefined): string | undefined {
        const tenant = ownerLogin?.trim().toLowerCase();
        return tenant ? this.tenantBackendConnectionTokens.get(tenant) : undefined;
    }

    /** Canonical host root used to recreate a tenant runtime after a cold start. */
    tenantRootForLogin(ownerLogin: string): string {
        return this.normalizeHostPath(resolveUserReposRoot(resolveQaapReposRoot(), ownerLogin));
    }

    /** Discover only Qaap-managed tenant containers; discovery survives backend restarts. */
    async listManagedTenantContainers(): Promise<QaapManagedTenantContainer[]> {
        assertQaapDockerControlPlane(process.env);
        const nodes = this.getDockerNodeClients();
        if (isQaapHostedRuntime(process.env)) {
            await Promise.all(nodes.map(node => this.verifyDockerNode(node)));
        }
        const discovered = await Promise.all(nodes.map(async node => {
            const containers = await node.docker.listContainers({
                all: true,
                filters: { label: ['com.qaap.managed=true'] },
            });
            return containers.flatMap(container => {
                const labels = container.Labels ?? {};
                const tenantLogin = labels['com.qaap.tenant-login']?.trim().toLowerCase();
                const kind = labels['com.qaap.tenant-backend'] === 'true'
                    ? 'backend'
                    : labels['com.qaap.tenant-container'] === 'true' ? 'worker' : undefined;
                if (!kind) {
                    return [];
                }
                return [{
                    ...(tenantLogin ? { tenantLogin } : {}),
                    kind,
                    containerId: container.Id,
                    containerName: (container.Names?.[0] ?? '').replace(/^\//, ''),
                    running: container.State === 'running',
                    nodeId: node.config.id,
                } satisfies QaapManagedTenantContainer];
            });
        }));
        return discovered.flat();
    }

    async stopTenantRuntime(ownerLogin: string): Promise<void> {
        const stops: Array<Promise<void>> = [this.stopTenantContainer(ownerLogin)];
        if (this.isBackendPerTenantEnabled()) {
            stops.push(this.stopTenantBackend(ownerLogin));
        }
        await Promise.all(stops);
    }

    /** Remove only the ephemeral containers and their dedicated network, never tenant bind mounts. */
    async destroyTenantRuntime(ownerLogin: string): Promise<void> {
        const nodes = await this.verifiedDockerNodesForTenant(ownerLogin);
        const names = [this.containerNameForTenant(ownerLogin)];
        if (this.isBackendPerTenantEnabled()) {
            names.push(this.backendContainerNameForTenant(ownerLogin));
        }
        for (const name of names) {
            for (const node of nodes) {
                try {
                    await node.docker.getContainer(name).remove({ force: true, v: false });
                    break;
                } catch (error) {
                    if (!this.isDockerNotFound(error)) {
                        throw error;
                    }
                }
            }
        }
        this.tenantRoots.delete(this.containerNameForTenant(ownerLogin));
        this.tenantMounts.delete(this.containerNameForTenant(ownerLogin));
        const tenant = ownerLogin.trim().toLowerCase();
        this.tenantBackendTargets.delete(tenant);
        this.tenantBackendConnectionTokens.delete(tenant);
        const networkMode = this.getTenantNetworkMode(ownerLogin);
        if (networkMode !== 'none') {
            for (const node of nodes) {
                try {
                    const network = node.docker.getNetwork(networkMode);
                    const inspect = await network.inspect() as { Labels?: Record<string, string> };
                    if (inspect.Labels?.['com.qaap.tenant-network'] === 'true') {
                        await network.remove();
                    }
                    break;
                } catch (error) {
                    if (!this.isDockerNotFound(error)) {
                        console.warn(`[qaap-runtime] could not remove tenant network ${networkMode} on ${node.config.id}: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            }
        }
    }

    /** The proxy and the tenant container must use the same tenant-scoped assertion secret. */
    getTenantBackendAssertionSecret(ownerLogin: string): string {
        return this.tenantBackendSecret(ownerLogin);
    }

    protected async getDocker(ownerLogin?: string): Promise<Dockerode> {
        assertQaapDockerControlPlane(process.env);
        const node = this.dockerNodeForTenant(ownerLogin);
        await this.verifyDockerNode(node);
        return node.docker;
    }

    protected async verifyDockerNode(node: QaapDockerNodeClient): Promise<void> {
        if (isQaapHostedRuntime(process.env) && !this.verifiedDockerNodeIds.has(node.config.id)) {
            const info = await node.docker.info() as { SecurityOptions?: readonly string[] };
            const rootless = (info.SecurityOptions ?? []).some(option => /rootless/i.test(option));
            if (!rootless) {
                throw new Error(`Refusing hosted Docker control-plane access: Docker node ${node.config.id} did not report rootless mode.`);
            }
            this.verifiedDockerNodeIds.add(node.config.id);
        }
    }

    protected async verifiedDockerNodesForTenant(ownerLogin?: string): Promise<readonly QaapDockerNodeClient[]> {
        assertQaapDockerControlPlane(process.env);
        const nodes = this.orderDockerNodesForTenant(ownerLogin);
        if (isQaapHostedRuntime(process.env)) {
            await Promise.all(nodes.map(node => this.verifyDockerNode(node)));
        }
        return nodes;
    }

    protected getDockerNodeClients(): readonly QaapDockerNodeClient[] {
        if (!process.env.QAAP_DOCKER_NODES?.trim() && this.docker) {
            return [{
                config: {
                    id: 'default',
                    dockerHost: process.env.DOCKER_HOST?.trim() || '',
                    ...(process.env.DOCKER_CERT_PATH?.trim() ? { certPath: process.env.DOCKER_CERT_PATH.trim() } : {}),
                    ...(process.env.DOCKER_TLS_VERIFY !== undefined ? { tlsVerify: this.isTruthy(process.env.DOCKER_TLS_VERIFY) } : {}),
                    ...(process.env.QAAP_DOCKER_PUBLISH_HOST_IP?.trim() ? { publishHostIp: process.env.QAAP_DOCKER_PUBLISH_HOST_IP.trim() } : {}),
                },
                docker: this.docker,
            }];
        }
        if (!this.dockerNodeConfigs) {
            this.dockerNodeConfigs = resolveQaapDockerNodes(process.env);
        }
        return this.dockerNodeConfigs.map(config => {
            const existing = this.dockerNodeClients.get(config.id);
            if (existing) {
                return existing;
            }
            const client = { config, docker: this.createDockerClient(config) };
            this.dockerNodeClients.set(config.id, client);
            if (config.id === 'default') {
                this.docker = client.docker;
            }
            return client;
        });
    }

    protected dockerNodeForTenant(ownerLogin?: string): QaapDockerNodeClient {
        const nodes = this.getDockerNodeClients();
        if (nodes.length === 1) {
            return nodes[0];
        }
        return this.orderDockerNodesForTenant(ownerLogin)[0];
    }

    /** Rendezvous hashing keeps an existing tenant on its node when another node is added. */
    protected orderDockerNodesForTenant(ownerLogin?: string): readonly QaapDockerNodeClient[] {
        const tenant = ownerLogin?.trim().toLowerCase() || '__anonymous__';
        return [...this.getDockerNodeClients()].sort((left, right) => {
            const leftScore = crypto.createHash('sha256').update(`${tenant}\u0000${left.config.id}`).digest('hex');
            const rightScore = crypto.createHash('sha256').update(`${tenant}\u0000${right.config.id}`).digest('hex');
            return rightScore.localeCompare(leftScore);
        });
    }

    protected createDockerClient(config: QaapDockerNodeConfig): Dockerode {
        const configured = config.dockerHost;
        if (configured.startsWith('unix://')) {
            return new Dockerode({ socketPath: configured.slice('unix://'.length) });
        }
        if (configured.startsWith('npipe://')) {
            // Docker Desktop exposes its engine through a named pipe. Dockerode expects the Win32
            // pipe path without the `npipe:` URI scheme.
            return new Dockerode({ socketPath: configured.slice('npipe://'.length) });
        }
        const endpoint = new URL(configured);
        const tls = endpoint.protocol === 'https:'
            || config.tlsVerify === true
            || this.isTruthy(process.env.DOCKER_TLS_VERIFY);
        const certPath = config.certPath || process.env.DOCKER_CERT_PATH?.trim();
        const tlsOptions = tls && certPath ? {
            ca: fs.readFileSync(path.join(certPath, 'ca.pem')),
            cert: fs.readFileSync(path.join(certPath, 'cert.pem')),
            key: fs.readFileSync(path.join(certPath, 'key.pem')),
        } : {};
        return new Dockerode({
            protocol: tls ? 'https' : 'http',
            host: endpoint.hostname,
            port: Number.parseInt(endpoint.port || (tls ? '2376' : '2375'), 10),
            ...tlsOptions,
        });
    }

    protected isTruthy(value: string | undefined): boolean {
        const normalized = value?.trim().toLowerCase();
        return normalized === '1' || normalized === 'true' || normalized === 'yes';
    }

    protected dockerAdvertiseHost(config: QaapDockerNodeConfig): string {
        if (config.advertiseHost) {
            return config.advertiseHost;
        }
        try {
            const endpoint = new URL(config.dockerHost);
            return endpoint.hostname || '127.0.0.1';
        } catch {
            return '127.0.0.1';
        }
    }

    protected dockerCliGlobalArgs(ownerLogin?: string): string[] {
        const node = this.dockerNodeForTenant(ownerLogin).config;
        if (!/^(tcp|http|https):\/\//i.test(node.dockerHost)) {
            return [];
        }
        const args = ['--host', node.dockerHost];
        const tls = node.dockerHost.startsWith('https://') || node.tlsVerify === true || this.isTruthy(process.env.DOCKER_TLS_VERIFY);
        if (tls) {
            args.push('--tlsverify');
            const certPath = node.certPath || process.env.DOCKER_CERT_PATH?.trim();
            if (certPath) {
                args.push('--tlscacert', path.join(certPath, 'ca.pem'), '--tlscert', path.join(certPath, 'cert.pem'), '--tlskey', path.join(certPath, 'key.pem'));
            }
        }
        return args;
    }

    /**
     * Resolve Docker to an executable path for terminal PTYs. Theia validates the requested
     * terminal shell with fs.accessSync; a bare `docker` therefore gets rejected as an invalid
     * shell before the PTY starts, while its arguments still contain `docker exec ...`.
     * Keep the bare command as a portable fallback for development environments where Docker is
     * only resolved by the process PATH (and for Windows, where Theia accepts command names).
     */
    protected dockerCliExecutable(): string {
        if (process.platform === 'win32') {
            return 'docker';
        }
        const configured = process.env.QAAP_DOCKER_CLI_PATH?.trim();
        const candidates = [
            ...(configured ? [configured] : []),
            ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(directory => path.join(directory, 'docker')),
        ];
        for (const candidate of candidates) {
            if (!path.isAbsolute(candidate)) {
                continue;
            }
            try {
                fs.accessSync(candidate, fs.constants.X_OK);
                return candidate;
            } catch {
                // Keep searching; the Docker CLI may be installed in a later PATH entry.
            }
        }
        return 'docker';
    }

    protected dockerPublishHostIp(config: QaapDockerNodeConfig): string {
        const configured = config.publishHostIp || process.env.QAAP_DOCKER_PUBLISH_HOST_IP?.trim();
        const remote = /^(tcp|http|https):\/\//i.test(config.dockerHost);
        if (remote && !configured) {
            throw new Error(`Docker node ${config.id} requires publishHostIp or QAAP_DOCKER_PUBLISH_HOST_IP for backend-per-tenant routing.`);
        }
        return configured || '127.0.0.1';
    }

    /** Legacy repo container API retained for compatibility with explicit callers. */
    async ensureContainer(repoKey: string, workspaceUri: string, ownerLogin?: string): Promise<QaapDockerEnsureResult> {
        // Keep the old method name for callers compiled against the original API, but never
        // retain its old repo-scoped, weak container policy. All execution now goes through the
        // same tenant-root mount and inspect-validated worker as the cloud path.
        const target = this.tenantTargetForWorkspace(workspaceUri);
        return this.ensureTenantContainer(ownerLogin || target.segment, target.root);
    }

    async stopContainer(repoKey: string, ownerLogin?: string): Promise<void> {
        // See ensureContainer(): compatibility aliases must not expose an unscoped lifecycle.
        await this.stopTenantContainer(ownerLogin);
    }

    protected containerNameFor(repoKey: string, ownerLogin?: string): string {
        const tenant = ownerLogin && ownerLogin.trim() ? ownerLogin.trim().toLowerCase() : '__anonymous__';
        const hash = crypto.createHash('sha256').update(`${tenant}\u0000${repoKey}`).digest('hex').slice(0, 12);
        return `${QAAP_CONTAINER_PREFIX}${hash}`;
    }

    /** Stable container name: all repositories, previews, jobs and terminals for a tenant share it. */
    containerNameForTenant(ownerLogin?: string): string {
        const tenant = ownerLogin && ownerLogin.trim() ? ownerLogin.trim().toLowerCase() : '__anonymous__';
        const hash = crypto.createHash('sha256').update(`tenant\u0000${tenant}`).digest('hex').slice(0, 12);
        return `qaap-tenant-${hash}`;
    }

    /** One Docker network per tenant prevents workers from joining a shared bridge. */
    tenantNetworkNameFor(ownerLogin?: string): string {
        const tenant = ownerLogin && ownerLogin.trim() ? ownerLogin.trim().toLowerCase() : '__anonymous__';
        const hash = crypto.createHash('sha256').update(`tenant-network\u0000${tenant}`).digest('hex').slice(0, 12);
        return `${QAAP_TENANT_NETWORK_PREFIX}${hash}`;
    }

    /** Resolve the only host directory that may be exposed to a tenant container. */
    tenantRootForWorkspace(workspaceUri: string): string {
        return this.tenantTargetForWorkspace(workspaceUri).root;
    }

    tenantTargetForWorkspace(workspaceUri: string): { root: string; segment: string } {
        const hostPath = this.hostPathFromUri(workspaceUri);
        const target = resolveTenantIsolationRoot(resolveQaapReposRoot(), resolveQaapWorktreesRoot(), hostPath);
        if (!target) {
            throw new Error(`Refusing to mount a workspace outside a canonical tenant tree: ${hostPath}`);
        }
        return target;
    }

    /** Whether a validated tenant container is available for synchronous docker-exec wrappers. */
    isTenantContainerReady(ownerLogin: string | undefined, tenantRootHostPath: string): boolean {
        const name = this.containerNameForTenant(ownerLogin);
        const requested = this.normalizeHostPath(tenantRootHostPath);
        const mounts = this.tenantMounts.get(name);
        if (mounts) {
            return [mounts.reposRoot, mounts.worktreesRoot, mounts.parallelRoot].includes(requested);
        }
        return this.tenantRoots.get(name) === requested;
    }

    /**
     * Create or validate one hardened, non-root worker container per tenant. Existing containers are
     * inspected rather than blindly reused. A weaker or differently mounted container is fatal.
     */
    async ensureTenantContainer(ownerLogin: string | undefined, tenantRootHostPath: string): Promise<QaapDockerEnsureResult> {
        if (!this.isEnabled()) {
            throw new Error('Tenant container isolation requires QAAP_CLOUD_MODE=docker.');
        }
        const name = this.containerNameForTenant(ownerLogin);
        const mounts = this.tenantMountsForRoot(tenantRootHostPath);
        if (ownerLogin?.trim()) {
            const expectedSegment = safeUserIdSegment(ownerLogin.trim()).toLowerCase();
            const actualSegment = path.basename(mounts.reposRoot).toLowerCase();
            if (actualSegment !== expectedSegment) {
                throw new Error(`Tenant identity ${ownerLogin} does not match the requested tenant root ${tenantRootHostPath}.`);
            }
        }
        const existing = this.tenantEnsurePromises.get(name);
        if (existing) {
            return existing;
        }
        const networkMode = this.getTenantNetworkMode(ownerLogin);
        const coldStartAt = Date.now();
        const wasReady = this.isTenantContainerReady(ownerLogin, mounts.reposRoot);
        const promise = this.createOrValidateTenantContainer(
            name,
            mounts,
            networkMode,
            ownerLogin,
        );
        this.tenantEnsurePromises.set(name, promise);
        try {
            const result = await promise;
            if (!wasReady) {
                this.runtimeMetrics?.recordColdStart(Date.now() - coldStartAt);
            }
            this.runtimeStore?.setState(ownerLogin || name, 'active', {
                workerContainerId: result.containerId,
                lastActivityAt: new Date().toISOString(),
                idleSince: undefined,
                stoppedAt: undefined,
                destroyAfter: undefined,
                lastError: undefined,
            });
            return result;
        } finally {
            if (this.tenantEnsurePromises.get(name) === promise) {
                this.tenantEnsurePromises.delete(name);
            }
        }
    }

    protected async createOrValidateTenantContainer(
        name: string,
        mounts: QaapTenantMountSet,
        networkMode: string,
        ownerLogin?: string,
    ): Promise<QaapDockerEnsureResult> {
        const docker = await this.getDocker(ownerLogin);
        const dockerMounts = this.tenantMountsForDocker(mounts);
        for (const root of Object.values(mounts)) {
            fs.mkdirSync(root, { recursive: true });
        }
        if (networkMode !== 'none') {
            await this.ensureTenantNetwork(docker, networkMode);
        }
        let container: Dockerode.Container;
        let inspect: Dockerode.ContainerInspectInfo;
        try {
            container = docker.getContainer(name);
            inspect = await container.inspect();
            if (!this.tenantContainerMatches(inspect, mounts, networkMode)) {
                throw new Error(`Tenant container ${name} has an unexpected mount or security configuration; refusing to reuse it.`);
            }
            if (!inspect.State.Running) {
                await container.start();
            }
        } catch (error) {
            if (!this.isDockerNotFound(error)) {
                throw error;
            }
            const user = this.getTenantContainerUser();
            container = await docker.createContainer({
                name,
                Image: this.getTenantImage(),
                Tty: true,
                OpenStdin: true,
                WorkingDir: WORKSPACE_MOUNT,
                Cmd: ['/bin/bash'],
                User: user,
                Env: [`HOME=${this.getTenantContainerHome()}`, 'USER=qaap-tenant', 'LOGNAME=qaap-tenant'],
                Labels: {
                    'com.qaap.managed': 'true',
                    'com.qaap.tenant-container': 'true',
                    'com.qaap.tenant-name': name,
                    'com.qaap.tenant-login': (ownerLogin?.trim() || '__anonymous__').toLowerCase(),
                },
                HostConfig: {
                    // Mount only this tenant's three storage roots. The worker never receives the
                    // shared parent, another tenant's root, or the backend's host filesystem.
                    Binds: [
                        `${dockerMounts.reposRoot}:${WORKSPACE_MOUNT}:rw`,
                        `${dockerMounts.worktreesRoot}:${WORKTREES_MOUNT}:rw`,
                        `${dockerMounts.parallelRoot}:${PARALLEL_MOUNT}:rw`,
                    ],
                    Memory: this.getTenantMemoryLimit(),
                    NanoCpus: this.getTenantCpuLimit(),
                    PidsLimit: this.getTenantPidsLimit(),
                    SecurityOpt: ['no-new-privileges:true'],
                    CapDrop: ['ALL'],
                    ReadonlyRootfs: true,
                    Tmpfs: { '/tmp': TENANT_TMPFS_OPTIONS },
                    NetworkMode: networkMode,
                    AutoRemove: false,
                },
            });
            await container.start();
        }
        inspect = await container.inspect();
        if (!inspect.State.Running || !this.tenantContainerMatches(inspect, mounts, networkMode)) {
            throw new Error(`Tenant container ${name} did not start with the required isolated configuration.`);
        }
        this.tenantRoots.set(name, mounts.reposRoot);
        this.tenantMounts.set(name, mounts);
        return { containerId: inspect.Id, containerName: name, workspaceMount: WORKSPACE_MOUNT, hostPath: mounts.reposRoot };
    }

    protected backendContainerNameForTenant(ownerLogin?: string): string {
        const tenant = ownerLogin && ownerLogin.trim() ? ownerLogin.trim().toLowerCase() : '__anonymous__';
        const hash = crypto.createHash('sha256').update(`tenant-backend\u0000${tenant}`).digest('hex').slice(0, 12);
        return `qaap-backend-${hash}`;
    }

    protected tenantBackendSecret(ownerLogin: string): string {
        const master = process.env.QAAP_TENANT_BACKEND_MASTER_SECRET?.trim();
        if (!master || master.length < 32) {
            throw new Error('QAAP_TENANT_BACKEND_MASTER_SECRET must contain at least 32 characters in backend-per-tenant mode.');
        }
        return crypto.createHmac('sha256', master).update(`tenant-backend\u0000${ownerLogin.toLowerCase()}`).digest('hex');
    }

    protected async createOrValidateTenantBackend(
        ownerLogin: string,
        tenantRootHostPath: string,
    ): Promise<QaapTenantBackendTarget> {
        const node = this.dockerNodeForTenant(ownerLogin);
        const docker = await this.getDocker(ownerLogin);
        const name = this.backendContainerNameForTenant(ownerLogin);
        const mounts = this.tenantMountsForRoot(tenantRootHostPath);
        const dockerMounts = this.tenantMountsForDocker(mounts);
        const expectedSegment = safeUserIdSegment(ownerLogin).toLowerCase();
        const actualSegment = path.basename(mounts.reposRoot).toLowerCase();
        if (actualSegment !== expectedSegment) {
            throw new Error(`Tenant identity ${ownerLogin} does not match the requested backend root ${tenantRootHostPath}.`);
        }
        const networkMode = this.getTenantNetworkMode(ownerLogin);
        if (networkMode !== 'none') {
            await this.ensureTenantNetwork(docker, networkMode);
        }
        const tenantDataRoot = this.normalizeHostPath(resolveQaapTenantUserRoot(ownerLogin));
        const theiaHome = path.join(tenantDataRoot, 'theia-home');
        const publishHostIp = this.dockerPublishHostIp(node.config);
        const dockerTenantDataRoot = this.dockerMountSource(tenantDataRoot, 'tenant-config');
        const dockerTheiaHome = this.dockerMountSource(theiaHome, 'tenant-config');
        for (const root of [...Object.values(mounts), tenantDataRoot, theiaHome]) {
            fs.mkdirSync(root, { recursive: true });
        }
        const secret = this.tenantBackendSecret(ownerLogin);
        let container: Dockerode.Container;
        let inspect: Dockerode.ContainerInspectInfo;
        try {
            container = docker.getContainer(name);
            inspect = await container.inspect();
            if (!this.tenantBackendContainerMatches(inspect, ownerLogin, mounts, tenantDataRoot, theiaHome, networkMode, publishHostIp)) {
                throw new Error(`Tenant backend ${name} has an unexpected security or mount configuration; refusing to reuse it.`);
            }
            if (!inspect.State.Running) {
                await container.start();
            }
        } catch (error) {
            if (!this.isDockerNotFound(error)) {
                throw error;
            }
            const env = [
                'NODE_ENV=development',
                'QAAP_CLOUD_MODE=local',
                'QAAP_SKIP_AUTH=false',
                'QAAP_AGENT_UID_PER_USER=0',
                `QAAP_REPOS_ROOT=${TENANT_BACKEND_REPOS_ROOT}`,
                `QAAP_TENANT_CONFIG_ROOT=${TENANT_BACKEND_QAAP_HOME_MOUNT}`,
                `QAAP_TENANT_BACKEND_MODE=1`,
                `QAAP_TENANT_BACKEND_SECRET=${secret}`,
                `QAAP_TENANT_LOGIN=${ownerLogin}`,
                `QAAP_SQLITE_STORE_PATH=${TENANT_BACKEND_SQLITE_STORE_PATH}`,
                `HOME=${TENANT_BACKEND_QAAP_HOME_MOUNT.replace('/.qaap', '')}`,
                'USER=theia',
                'LOGNAME=theia',
                'HOST=0.0.0.0',
                `PORT=${TENANT_BACKEND_PORT}`,
                'SHELL=/bin/bash',
                'THEIA_SHELL=/bin/bash',
                'THEIA_PLUGINS_DIR=/app/plugins',
                'QAAP_SYSTEM_SKILLS_DIR=/opt/qaap/system-skills',
            ];
            const repoMount = `${dockerMounts.reposRoot}:${TENANT_BACKEND_REPOS_MOUNT}/${expectedSegment}:rw`;
            const worktreeMount = `${dockerMounts.worktreesRoot}:${TENANT_BACKEND_WORKTREES_MOUNT}/${expectedSegment}:rw`;
            const parallelMount = `${dockerMounts.parallelRoot}:${TENANT_BACKEND_PARALLEL_MOUNT}/${expectedSegment}:rw`;
            container = await docker.createContainer({
                name,
                Image: this.getTenantImage(),
                User: this.getTenantContainerUser(),
                // Keep Node's cwd in the immutable application tree. The tenant repo is exposed
                // through QAAP_REPOS_ROOT and must never replace the image's application cwd.
                WorkingDir: '/app/examples/browser',
                Cmd: [
                    'node',
                    'src-gen/backend/main.js',
                    '--hostname=0.0.0.0',
                    `--port=${TENANT_BACKEND_PORT}`,
                    '--no-cluster',
                    '--plugins=local-dir:/app/plugins',
                    '--ovsx-router-config=/app/examples/ovsx-router-config.json',
                ],
                Env: env,
                ExposedPorts: { [`${TENANT_BACKEND_PORT}/tcp`]: {} },
                Labels: {
                    'com.qaap.managed': 'true',
                    'com.qaap.tenant-backend': 'true',
                    'com.qaap.tenant-name': name,
                    'com.qaap.tenant-login': ownerLogin.toLowerCase(),
                },
                HostConfig: {
                    Binds: [
                        repoMount,
                        worktreeMount,
                        parallelMount,
                        `${dockerTenantDataRoot}:${TENANT_BACKEND_QAAP_HOME_MOUNT}:rw`,
                        `${dockerTheiaHome}:${TENANT_BACKEND_THEIA_HOME_MOUNT}:rw`,
                    ],
                    PortBindings: {
                        // Empty HostPort asks Docker for an ephemeral port. A fixed port would make
                        // two tenants collide; publishing on 0 is not portable across Docker
                        // Desktop/rootless daemon versions.
                        [`${TENANT_BACKEND_PORT}/tcp`]: [{ HostIp: publishHostIp, HostPort: '' }],
                    },
                    Memory: this.getTenantMemoryLimit(),
                    NanoCpus: this.getTenantCpuLimit(),
                    PidsLimit: this.getTenantPidsLimit(),
                    SecurityOpt: ['no-new-privileges:true'],
                    CapDrop: ['ALL'],
                    ReadonlyRootfs: true,
                    Tmpfs: { '/tmp': TENANT_TMPFS_OPTIONS },
                    NetworkMode: networkMode,
                    AutoRemove: false,
                },
            });
            await container.start();
        }
        inspect = await container.inspect();
        if (!inspect.State.Running || !this.tenantBackendContainerMatches(inspect, ownerLogin, mounts, tenantDataRoot, theiaHome, networkMode, publishHostIp)) {
            throw new Error(`Tenant backend ${name} did not start with the required isolated configuration.`);
        }
        const ports = (inspect.NetworkSettings?.Ports as Record<string, Array<{ HostIp?: string; HostPort?: string }> | null> | undefined)?.[`${TENANT_BACKEND_PORT}/tcp`];
        const hostPort = Number.parseInt(ports?.find(entry => entry.HostIp === publishHostIp)?.HostPort ?? '', 10);
        if (!Number.isInteger(hostPort) || hostPort <= 0) {
            throw new Error(`Tenant backend ${name} has no published port on ${publishHostIp}.`);
        }
        const target = { containerId: inspect.Id, containerName: name, host: this.dockerAdvertiseHost(node.config), port: hostPort, tenantLogin: ownerLogin };
        await this.waitForTenantBackendReady(target);
        return target;
    }

    /** Do not route the first browser request into a Theia process that is still deploying plugins. */
    protected async waitForTenantBackendReady(target: QaapTenantBackendTarget): Promise<void> {
        const configuredTimeout = Number.parseInt(process.env.QAAP_TENANT_BACKEND_READY_TIMEOUT_MS?.trim() ?? '', 10);
        const timeoutMs = Number.isInteger(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 30_000;
        const deadline = Date.now() + timeoutMs;
        let lastFailure = 'no response';
        while (Date.now() < deadline) {
            try {
                const response = await this.requestTenantBackendHealth(target);
                const token = this.extractTenantBackendConnectionToken(response.setCookie);
                if (token) {
                    this.tenantBackendConnectionTokens.set(target.tenantLogin.toLowerCase(), token);
                }
                if (response.statusCode === 200) {
                    const payload = JSON.parse(response.body) as { ready?: boolean };
                    if (payload.ready === true) {
                        return;
                    }
                    lastFailure = `health.ready=${String(payload.ready)}`;
                } else {
                    lastFailure = `HTTP ${response.statusCode}`;
                }
            } catch (error) {
                lastFailure = error instanceof Error ? error.message : String(error);
            }
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        throw new Error(`Tenant backend ${target.containerName} did not become ready within ${timeoutMs}ms (${lastFailure}).`);
    }

    protected requestTenantBackendHealth(target: QaapTenantBackendTarget): Promise<{ statusCode?: number; body: string; setCookie?: string[] }> {
        return new Promise((resolve, reject) => {
            const token = this.tenantBackendConnectionTokens.get(target.tenantLogin.toLowerCase());
            const request = http.get({
                host: target.host,
                port: target.port,
                path: '/qaap/api/health',
                timeout: 2_000,
                headers: token ? { cookie: `theia-connection-token=${encodeURIComponent(token)}` } : undefined,
            }, response => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', chunk => body += chunk);
                response.on('end', () => resolve({
                    statusCode: response.statusCode,
                    body,
                    setCookie: response.headers['set-cookie'],
                }));
            });
            request.on('timeout', () => request.destroy(new Error('tenant backend health timeout')));
            request.on('error', reject);
        });
    }

    protected extractTenantBackendConnectionToken(setCookie: string[] | undefined): string | undefined {
        for (const header of setCookie ?? []) {
            const match = /^theia-connection-token=([^;]+)/.exec(header);
            if (match?.[1]) {
                return decodeURIComponent(match[1]);
            }
        }
        return undefined;
    }

    protected tenantBackendContainerMatches(
        inspect: Dockerode.ContainerInspectInfo,
        ownerLogin: string,
        mounts: QaapTenantMountSet,
        tenantDataRoot: string,
        theiaHome: string,
        networkMode: string,
        publishHostIp: string,
    ): boolean {
        const raw = inspect as Dockerode.ContainerInspectInfo & {
            Config?: { User?: string; Image?: string; Cmd?: string[]; Env?: string[]; WorkingDir?: string; Labels?: Record<string, string> };
            HostConfig?: {
                Memory?: number;
                NanoCpus?: number;
                PidsLimit?: number | null;
                SecurityOpt?: string[];
                CapDrop?: string[];
                ReadonlyRootfs?: boolean;
                Tmpfs?: Record<string, string>;
                NetworkMode?: string;
                Privileged?: boolean;
                PidMode?: string;
                IpcMode?: string;
            };
            Mounts?: Array<{ Source?: string; Destination?: string; RW?: boolean }>;
            NetworkSettings?: {
                Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
            };
        };
        const expectedMounts = [
            { source: this.dockerMountSource(mounts.reposRoot, 'repos'), destination: `${TENANT_BACKEND_REPOS_MOUNT}/${safeUserIdSegment(ownerLogin).toLowerCase()}` },
            { source: this.dockerMountSource(mounts.worktreesRoot, 'worktrees'), destination: `${TENANT_BACKEND_WORKTREES_MOUNT}/${safeUserIdSegment(ownerLogin).toLowerCase()}` },
            { source: this.dockerMountSource(mounts.parallelRoot, 'parallel'), destination: `${TENANT_BACKEND_PARALLEL_MOUNT}/${safeUserIdSegment(ownerLogin).toLowerCase()}` },
            { source: this.dockerMountSource(tenantDataRoot, 'tenant-config'), destination: TENANT_BACKEND_QAAP_HOME_MOUNT },
            { source: this.dockerMountSource(theiaHome, 'tenant-config'), destination: TENANT_BACKEND_THEIA_HOME_MOUNT },
        ];
        const hostConfig = raw.HostConfig ?? {};
        const labels = raw.Config?.Labels ?? {};
        const env = new Set(raw.Config?.Env ?? []);
        const expectedEnv = [
            'QAAP_CLOUD_MODE=local',
            'QAAP_SKIP_AUTH=false',
            'QAAP_AGENT_UID_PER_USER=0',
            `QAAP_REPOS_ROOT=${TENANT_BACKEND_REPOS_ROOT}`,
            `QAAP_TENANT_CONFIG_ROOT=${TENANT_BACKEND_QAAP_HOME_MOUNT}`,
            'QAAP_TENANT_BACKEND_MODE=1',
            `QAAP_TENANT_BACKEND_SECRET=${this.tenantBackendSecret(ownerLogin)}`,
            `QAAP_TENANT_LOGIN=${ownerLogin}`,
            `QAAP_SQLITE_STORE_PATH=${TENANT_BACKEND_SQLITE_STORE_PATH}`,
            `HOME=${TENANT_BACKEND_QAAP_HOME_MOUNT.replace('/.qaap', '')}`,
            'USER=theia',
            'LOGNAME=theia',
            'HOST=0.0.0.0',
            `PORT=${TENANT_BACKEND_PORT}`,
            'SHELL=/bin/bash',
            'THEIA_SHELL=/bin/bash',
            'THEIA_PLUGINS_DIR=/app/plugins',
            'QAAP_SYSTEM_SKILLS_DIR=/opt/qaap/system-skills',
        ];
        // Docker keeps the requested empty HostPort in HostConfig, while the allocated ephemeral
        // port is authoritative in NetworkSettings after the container starts.
        const ports = raw.NetworkSettings?.Ports?.[`${TENANT_BACKEND_PORT}/tcp`];
        return labels['com.qaap.managed'] === 'true'
            && labels['com.qaap.tenant-backend'] === 'true'
            && labels['com.qaap.tenant-login'] === ownerLogin.toLowerCase()
            && raw.Config?.User === this.getTenantContainerUser()
            && raw.Config?.Image === this.getTenantImage()
            && raw.Config?.WorkingDir === '/app/examples/browser'
            && raw.Config?.Cmd?.join('\u0000') === [
                'node', 'src-gen/backend/main.js', '--hostname=0.0.0.0', `--port=${TENANT_BACKEND_PORT}`,
                '--no-cluster', '--plugins=local-dir:/app/plugins', '--ovsx-router-config=/app/examples/ovsx-router-config.json',
            ].join('\u0000')
            && expectedEnv.every(entry => env.has(entry))
            && raw.Mounts?.length === expectedMounts.length
            && expectedMounts.every(expected => raw.Mounts?.some(actual =>
                actual.Destination === expected.destination
                && this.normalizeDockerMountPath(actual.Source ?? '') === this.normalizeDockerMountPath(expected.source)
                && actual.RW === true) === true)
            && hostConfig.Memory === this.getTenantMemoryLimit()
            && hostConfig.NanoCpus === this.getTenantCpuLimit()
            && hostConfig.PidsLimit === this.getTenantPidsLimit()
            && hostConfig.SecurityOpt?.includes('no-new-privileges:true') === true
            && hostConfig.CapDrop?.includes('ALL') === true
            && hostConfig.ReadonlyRootfs === true
            && hostConfig.Tmpfs?.['/tmp'] === TENANT_TMPFS_OPTIONS
            && hostConfig.Privileged !== true
            && (!hostConfig.PidMode || hostConfig.PidMode === 'private')
            && (!hostConfig.IpcMode || hostConfig.IpcMode === 'private')
            && hostConfig.NetworkMode === networkMode
            && ports?.length === 1
            && ports[0]?.HostIp === publishHostIp
            && Number.parseInt(ports[0]?.HostPort ?? '', 10) > 0;
    }

    async stopTenantContainer(ownerLogin?: string): Promise<void> {
        const name = this.containerNameForTenant(ownerLogin);
        const nodes = await this.verifiedDockerNodesForTenant(ownerLogin);
        try {
            for (const node of nodes) {
                try {
                    await node.docker.getContainer(name).stop({ t: 10 });
                    break;
                } catch (error) {
                    if (this.isDockerAlreadyStopped(error)) {
                        break;
                    }
                    if (!this.isDockerNotFound(error)) {
                        throw error;
                    }
                }
            }
        } finally {
            this.tenantRoots.delete(name);
            this.tenantMounts.delete(name);
        }
    }

    wrapShellForTenantContainer(
        ownerLogin: string | undefined,
        cwd: string,
        file: string,
        args: readonly string[],
        tenantRootHostPath?: string,
        environment?: NodeJS.ProcessEnv,
    ): { file: string; args: string[] } {
        const containerName = this.containerNameForTenant(ownerLogin);
        const root = tenantRootHostPath ?? this.tenantRoots.get(containerName);
        const containerCwd = this.toContainerPath(cwd, root);
        const containerArgs = file === 'git' && root ? this.translateTenantGitArgs(args, root) : [...args];
        return {
            file: 'docker',
            args: [
                ...this.dockerCliGlobalArgs(ownerLogin),
                'exec',
                '-i',
                ...this.buildTenantEnvironmentArgs(environment),
                '--user',
                this.getTenantContainerUser(),
                '-w',
                containerCwd,
                containerName,
                file,
                ...containerArgs,
            ],
        };
    }

    wrapInteractiveTerminalForTenant(
        ownerLogin: string | undefined,
        cwd: string,
        file: string,
        args: readonly string[],
        tenantRootHostPath?: string,
        environment?: NodeJS.ProcessEnv,
    ): { file: string; args: string[] } {
        const containerName = this.containerNameForTenant(ownerLogin);
        const containerCwd = this.toContainerPath(cwd, tenantRootHostPath ?? this.tenantRoots.get(containerName));
        return {
            file: this.dockerCliExecutable(),
            args: [
                ...this.dockerCliGlobalArgs(ownerLogin),
                'exec',
                '-it',
                ...this.buildTenantEnvironmentArgs(environment),
                '--user',
                this.getTenantContainerUser(),
                '-w',
                containerCwd,
                containerName,
                file,
                ...args,
            ],
        };
    }

    /** Build `docker exec -e` flags without exposing the shared Docker/backend control plane. */
    protected buildTenantEnvironmentArgs(environment?: NodeJS.ProcessEnv): string[] {
        if (!environment) {
            return [];
        }
        const args: string[] = [];
        for (const [key, value] of Object.entries(environment)) {
            if (value === undefined || TENANT_WORKER_ENV_DENYLIST.has(key) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
                continue;
            }
            args.push('-e', `${key}=${value}`);
        }
        return args;
    }

    toContainerPath(hostPath: string, tenantRootHostPath?: string): string {
        const normalized = hostPath.replace(/\\/g, '/').replace(/\/$/, '');
        const root = tenantRootHostPath?.replace(/\\/g, '/').replace(/\/$/, '');
        if (!root) {
            throw new Error('Cannot translate a tenant cwd without the validated tenant mount root.');
        }
        const mounts = [...this.tenantMounts.values()].find(candidate =>
            [candidate.reposRoot, candidate.worktreesRoot, candidate.parallelRoot]
                .map(value => value.replace(/\\/g, '/').replace(/\/$/, ''))
                .includes(root));
        if (mounts) {
            const candidates: Array<{ root: string; mount: string }> = [
                { root: mounts.reposRoot, mount: WORKSPACE_MOUNT },
                { root: mounts.worktreesRoot, mount: WORKTREES_MOUNT },
                { root: mounts.parallelRoot, mount: PARALLEL_MOUNT },
            ];
            for (const candidate of candidates) {
                const candidateRoot = candidate.root.replace(/\\/g, '/').replace(/\/$/, '');
                if (normalized === candidateRoot) {
                    return candidate.mount;
                }
                const candidatePrefix = `${candidateRoot}/`;
                if (normalized.startsWith(candidatePrefix)) {
                    return `${candidate.mount}/${normalized.slice(candidatePrefix.length)}`;
                }
            }
            throw new Error(`Tenant path ${normalized} is outside the validated tenant mounts.`);
        }
        if (normalized === root) {
            return WORKSPACE_MOUNT;
        }
        const prefix = `${root}/`;
        if (!normalized.startsWith(prefix)) {
            throw new Error(`Tenant cwd ${normalized} is outside its mounted tenant root ${root}.`);
        }
        return `${WORKSPACE_MOUNT}/${normalized.slice(prefix.length)}`;
    }

    protected tenantMountsForDocker(mounts: QaapTenantMountSet): QaapTenantMountSet {
        return {
            reposRoot: this.dockerMountSource(mounts.reposRoot, 'repos'),
            worktreesRoot: this.dockerMountSource(mounts.worktreesRoot, 'worktrees'),
            parallelRoot: this.dockerMountSource(mounts.parallelRoot, 'parallel'),
        };
    }

    /**
     * Translate control-plane paths to the path visible on a remote Docker node. The default is an
     * identical path, which is appropriate when every node mounts the same NFS/ Ceph volume at the
     * canonical location. Explicit mappings are useful when the backend and Docker nodes use
     * different mount prefixes.
     */
    protected dockerMountSource(hostPath: string, kind: 'repos' | 'worktrees' | 'parallel' | 'tenant-config'): string {
        const localRoot = kind === 'repos'
            ? resolveQaapReposRoot()
            : kind === 'worktrees'
                ? resolveQaapWorktreesRoot()
                : kind === 'parallel'
                    ? resolveQaapParallelRoot()
                    : resolveQaapTenantConfigRoot();
        const remoteRoot = kind === 'repos'
            ? process.env.QAAP_DOCKER_REMOTE_REPOS_ROOT?.trim()
            : kind === 'worktrees'
                ? process.env.QAAP_DOCKER_REMOTE_WORKTREES_ROOT?.trim()
                : kind === 'parallel'
                    ? process.env.QAAP_DOCKER_REMOTE_PARALLEL_ROOT?.trim()
                    : process.env.QAAP_DOCKER_REMOTE_TENANT_CONFIG_ROOT?.trim();
        const normalizedHost = this.normalizeHostPath(hostPath);
        if (!remoteRoot) {
            return normalizedHost;
        }
        const relative = path.relative(this.normalizeHostPath(localRoot), normalizedHost);
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            throw new Error(`Docker mount ${hostPath} is outside the configured ${kind} root.`);
        }
        const normalizedRemoteRoot = remoteRoot.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
        if (!normalizedRemoteRoot.startsWith('/')) {
            const setting = kind === 'tenant-config' ? 'TENANT_CONFIG' : kind.toUpperCase();
            throw new Error(`QAAP_DOCKER_REMOTE_${setting}_ROOT must be an absolute path on the Docker node.`);
        }
        return normalizedRemoteRoot === '/'
            ? `/${relative.replace(/\\/g, '/')}`
            : `${normalizedRemoteRoot}/${relative.replace(/\\/g, '/')}`;
    }

    protected normalizeDockerMountPath(hostPath: string): string {
        return hostPath.replace(/\\/g, '/').replace(/\/$/, '');
    }

    protected tenantContainerMatches(inspect: Dockerode.ContainerInspectInfo, mounts: QaapTenantMountSet, networkMode: string): boolean {
        const raw = inspect as Dockerode.ContainerInspectInfo & {
            Config?: { User?: string; Image?: string; Labels?: Record<string, string> };
            HostConfig?: {
                Memory?: number;
                NanoCpus?: number;
                PidsLimit?: number | null;
                SecurityOpt?: string[];
                CapDrop?: string[];
                ReadonlyRootfs?: boolean;
                Tmpfs?: Record<string, string>;
                NetworkMode?: string;
                Privileged?: boolean;
                PidMode?: string;
                IpcMode?: string;
            };
            Mounts?: Array<{ Source?: string; Destination?: string; RW?: boolean }>;
        };
        const expectedMounts = [
            { source: this.dockerMountSource(mounts.reposRoot, 'repos'), destination: WORKSPACE_MOUNT },
            { source: this.dockerMountSource(mounts.worktreesRoot, 'worktrees'), destination: WORKTREES_MOUNT },
            { source: this.dockerMountSource(mounts.parallelRoot, 'parallel'), destination: PARALLEL_MOUNT },
        ];
        const hostConfig = raw.HostConfig ?? {};
        const labels = raw.Config?.Labels ?? {};
        return labels['com.qaap.managed'] === 'true'
            && labels['com.qaap.tenant-container'] === 'true'
            && raw.Config?.User === this.getTenantContainerUser()
            && raw.Config?.Image === this.getTenantImage()
            && raw.Mounts?.length === expectedMounts.length
            && expectedMounts.every(expected => raw.Mounts?.some(actual =>
                actual.Destination === expected.destination
                && this.normalizeDockerMountPath(actual.Source ?? '') === this.normalizeDockerMountPath(expected.source)
                && actual.RW === true) === true)
            && hostConfig.Memory === this.getTenantMemoryLimit()
            && hostConfig.NanoCpus === this.getTenantCpuLimit()
            && hostConfig.PidsLimit === this.getTenantPidsLimit()
            && hostConfig.SecurityOpt?.includes('no-new-privileges:true') === true
            && hostConfig.CapDrop?.includes('ALL') === true
            && hostConfig.ReadonlyRootfs === true
            && hostConfig.Tmpfs?.['/tmp'] === TENANT_TMPFS_OPTIONS
            && hostConfig.Privileged !== true
            // Docker Desktop reports the default IPC namespace as `private`; reject only
            // host/container namespace sharing, not the safe private default.
            && (!hostConfig.PidMode || hostConfig.PidMode === 'private')
            && (!hostConfig.IpcMode || hostConfig.IpcMode === 'private')
            && hostConfig.NetworkMode === networkMode;
    }

    /** Derive the complete per-tenant mount set from any one of its canonical roots. */
    protected tenantMountsForRoot(hostPath: string): QaapTenantMountSet {
        const normalized = this.normalizeHostPath(hostPath);
        const segment = path.basename(normalized);
        if (!segment || segment === '.' || segment === path.sep) {
            throw new Error(`Cannot derive a tenant segment from root ${hostPath}.`);
        }
        return {
            reposRoot: this.normalizeHostPath(path.join(resolveQaapReposRoot(), QAAP_USER_REPOS_SEGMENT, segment)),
            worktreesRoot: this.normalizeHostPath(path.join(resolveQaapWorktreesRoot(), segment)),
            parallelRoot: this.normalizeHostPath(path.join(resolveQaapParallelRoot(), segment)),
        };
    }

    /** Translate absolute host paths embedded in Git arguments to the tenant worker namespace. */
    protected translateTenantGitArgs(args: readonly string[], tenantRootHostPath: string): string[] {
        return args.map(arg => {
            if (!path.isAbsolute(arg) && !/^[A-Za-z]:[\\/]/.test(arg)) {
                return arg;
            }
            try {
                return this.toContainerPath(arg, tenantRootHostPath);
            } catch {
                // URLs and paths outside the tenant mounts are not rewritten; the cwd/mount guard
                // remains authoritative and Git will reject an inaccessible path inside the worker.
                return arg;
            }
        });
    }

    protected isDockerNotFound(error: unknown): boolean {
        return (error as { statusCode?: number } | undefined)?.statusCode === 404;
    }

    protected isDockerAlreadyStopped(error: unknown): boolean {
        return (error as { statusCode?: number } | undefined)?.statusCode === 304;
    }

    protected getTenantMemoryLimit(): number {
        const raw = process.env.QAAP_TENANT_MEMORY_LIMIT?.trim();
        const num = raw ? Number.parseInt(raw, 10) : Number.NaN;
        return Number.isInteger(num) && num > 0 ? num : 2 * 1024 * 1024 * 1024;
    }

    protected getTenantCpuLimit(): number {
        const raw = process.env.QAAP_TENANT_CPU_LIMIT?.trim();
        const num = raw ? Number.parseFloat(raw) : Number.NaN;
        return Number.isFinite(num) && num > 0 ? Math.floor(num * 1e9) : 2 * 1e9;
    }

    protected getTenantPidsLimit(): number {
        const raw = process.env.QAAP_TENANT_PIDS_LIMIT?.trim();
        const num = raw ? Number.parseInt(raw, 10) : Number.NaN;
        return Number.isInteger(num) && num > 0 ? num : 256;
    }

    protected getTenantImage(): string {
        const image = process.env.QAAP_TENANT_DOCKER_IMAGE?.trim() || process.env.QAAP_THEIA_IMAGE?.trim();
        if (image) {
            return image;
        }
        const cloudMode = process.env.QAAP_CLOUD_MODE?.trim().toLowerCase();
        if (process.env.NODE_ENV === 'production' || cloudMode === 'docker') {
            throw new Error('QAAP_TENANT_DOCKER_IMAGE or QAAP_THEIA_IMAGE is required for hosted tenant workers.');
        }
        return DEFAULT_IMAGE;
    }

    protected getTenantContainerUser(): string {
        const rootlessDocker = /^(1|true)$/i.test(process.env.QAAP_DOCKER_ROOTLESS?.trim() ?? '');
        const configuredUid = Number.parseInt(process.env.QAAP_TENANT_CONTAINER_UID?.trim() ?? '', 10);
        // Root inside a rootless daemon maps to the unprivileged host account that owns the
        // persistent bind mounts. It is therefore the only container uid that can share the
        // rootful control-plane's 0700 tenant state without weakening those permissions. Never
        // allow the same setting against a rootful daemon; it would be a real root escape.
        const uid = rootlessDocker && configuredUid === 0
            ? 0
            : this.parsePositiveInteger(process.env.QAAP_TENANT_CONTAINER_UID, 1000);
        const configuredGid = Number.parseInt(process.env.QAAP_TENANT_CONTAINER_GID?.trim() ?? '', 10);
        const gid = rootlessDocker && configuredUid === 0 && configuredGid === 0
            ? 0
            : this.parsePositiveInteger(process.env.QAAP_TENANT_CONTAINER_GID, uid);
        return `${uid}:${gid}`;
    }

    protected getTenantContainerHome(): string {
        return process.env.QAAP_TENANT_CONTAINER_HOME?.trim() || '/tmp/qaap-home';
    }

    protected getTenantNetworkMode(ownerLogin?: string): string {
        // `bridge` is deliberately not accepted: it is a shared Docker network and allows one
        // tenant worker to probe another worker. `isolated-bridge` keeps normal outbound egress
        // while giving every tenant a separately inspected network. `none` is the strictest mode
        // for deployments that provide an external egress proxy.
        const mode = process.env.QAAP_TENANT_NETWORK_MODE?.trim().toLowerCase() || 'isolated-bridge';
        if (mode === 'none') {
            return mode;
        }
        if (mode !== 'isolated-bridge') {
            throw new Error(`Unsafe or unsupported tenant network mode is not allowed: ${mode}. Use isolated-bridge or none.`);
        }
        return this.tenantNetworkNameFor(ownerLogin);
    }

    protected async ensureTenantNetwork(docker: Dockerode, networkName: string): Promise<void> {
        let network: Dockerode.Network;
        try {
            network = docker.getNetwork(networkName);
            const inspect = await network.inspect() as {
                Name?: string;
                Driver?: string;
                Internal?: boolean;
                Labels?: Record<string, string>;
                Options?: Record<string, string>;
            };
            if (!this.tenantNetworkMatches(inspect, networkName)) {
                throw new Error(`Tenant network ${networkName} has an unexpected isolation configuration; refusing to reuse it.`);
            }
            return;
        } catch (error) {
            if (!this.isDockerNotFound(error)) {
                throw error;
            }
        }
        network = await docker.createNetwork({
            Name: networkName,
            Driver: 'bridge',
            Internal: false,
            CheckDuplicate: true,
            Labels: {
                'com.qaap.managed': 'true',
                'com.qaap.tenant-network': 'true',
                'com.qaap.tenant-network-name': networkName,
            },
            Options: {
                // There is only one worker attached to this network, and ICC=false adds
                // defense in depth if an operator later attaches another container.
                'com.docker.network.bridge.enable_icc': 'false',
            },
        });
        const inspect = await network.inspect() as {
            Name?: string;
            Driver?: string;
            Internal?: boolean;
            Labels?: Record<string, string>;
            Options?: Record<string, string>;
        };
        if (!this.tenantNetworkMatches(inspect, networkName)) {
            throw new Error(`Tenant network ${networkName} was not created with the required isolation configuration.`);
        }
    }

    protected tenantNetworkMatches(network: {
        Name?: string;
        Driver?: string;
        Internal?: boolean;
        Labels?: Record<string, string>;
        Options?: Record<string, string>;
    }, networkName: string): boolean {
        return network.Name === networkName
            && network.Driver === 'bridge'
            && network.Internal === false
            && network.Labels?.['com.qaap.managed'] === 'true'
            && network.Labels?.['com.qaap.tenant-network'] === 'true'
            && network.Options?.['com.docker.network.bridge.enable_icc'] === 'false';
    }

    protected parsePositiveInteger(raw: string | undefined, fallback: number): number {
        const value = Number.parseInt(raw?.trim() || '', 10);
        return Number.isInteger(value) && value > 0 ? value : fallback;
    }

    protected normalizeHostPath(hostPath: string): string {
        return path.resolve(hostPath.replace(/\\/g, path.sep));
    }

    protected hostPathFromUri(workspaceUri: string): string {
        if (workspaceUri.startsWith('file://')) {
            return FileUri.fsPath(workspaceUri);
        }
        return path.resolve(workspaceUri);
    }
}
