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
import { QAAP_TENANT_RUNTIME_API_PATH } from '../common/qaap-cloud-api-types';
import { QAAP_TENANT_BUSY_PROBE_HEADER, QaapTenantBusyProbe, type QaapTenantBusyStatus } from './qaap-tenant-busy-probe';
import { QaapTenantRuntimeMetrics } from './qaap-tenant-runtime-metrics';
import { QaapTenantRuntimeStore } from './qaap-tenant-runtime-store';
import { QaapTenantResourceOverrides } from './qaap-tenant-resource-overrides';
import { QaapAgentRunLedger } from './qaap-agent-run-ledger';
import {
    QAAP_TENANT_AGENT_STORAGE_DIRNAME,
    QAAP_TENANT_AGENT_STORAGE_ROOT_ENV,
    QaapTenantAgentStorageEnv,
} from './qaap-tenant-agent-storage-env';

const QAAP_CONTAINER_PREFIX = 'qaap-ws-';
// v3 gives same-tenant worker/backend/proxy containers ICC while keeping the bridge Internal:true.
// It also forces containers stranded on the v2 incident network to be recreated on a valid bridge.
const QAAP_TENANT_NETWORK_PREFIX = 'qaap-net-v3-';
const QAAP_TENANT_INGRESS_NETWORK_PREFIX = 'qaap-ingress-v1-';
const QAAP_TENANT_DIRECT_EGRESS_NETWORK_PREFIX = 'qaap-egress-v1-';
const QAAP_TENANT_EGRESS_PROXY_ALIAS = 'qaap-tenant-egress-proxy';
const QAAP_TENANT_EGRESS_UPLINK = 'qaap-tenant-egress-uplink';
const DEFAULT_IMAGE = process.env.QAAP_DOCKER_IMAGE?.trim() || 'node:20-bookworm';
const WORKSPACE_MOUNT = '/workspace';
const WORKTREES_MOUNT = `${WORKSPACE_MOUNT}/.qaap-worktrees`;
const PARALLEL_MOUNT = `${WORKSPACE_MOUNT}/.qaap-parallel`;
const TENANT_BACKEND_PORT = 4873;
const TENANT_BACKEND_INGRESS_RELAY_MEMORY_CAP = 256 * 1024 ** 2;
const TENANT_BACKEND_INGRESS_RELAY_CPU_CAP = 500_000_000;
const TENANT_BACKEND_INGRESS_RELAY_PIDS_CAP = 64;
const TENANT_BUILD_PREDICTION_TIMEOUT_MS = 1_500;
const TENANT_IMAGE_BUILD_CACHE_MS = 60_000;
const TENANT_BACKEND_REPOS_ROOT = '/workspace/repos';
const TENANT_BACKEND_REPOS_MOUNT = `${TENANT_BACKEND_REPOS_ROOT}/users`;
const TENANT_BACKEND_WORKTREES_MOUNT = '/tmp/qaap-worktrees';
const TENANT_BACKEND_PARALLEL_MOUNT = '/tmp/qaap-parallel';
const TENANT_BACKEND_QAAP_HOME_MOUNT = '/home/theia/.qaap';
const TENANT_BACKEND_THEIA_HOME_MOUNT = '/home/theia/.theia';
const TENANT_BACKEND_LOGS_MOUNT = `${TENANT_BACKEND_THEIA_HOME_MOUNT}/logs`;
const TENANT_BACKEND_SQLITE_STORE_PATH = `${TENANT_BACKEND_QAAP_HOME_MOUNT}/tenant.sqlite`;
// Agent CLIs such as Copilot extract native addons under HOME. Keep the worker scratch space
// executable while retaining the other hardening flags; a noexec tmpfs makes those addons look
// missing even when the extracted .node file is present. The size is configurable through
// QAAP_TENANT_TMPFS_SIZE (see getTenantTmpfsOptions); tmpfs pages are charged to the container's
// memory cgroup, so it must stay well below QAAP_TENANT_MEMORY_LIMIT.
const TENANT_TMPFS_BASE_OPTIONS = 'rw,exec,nosuid,nodev';
const TENANT_TMPFS_DEFAULT_SIZE = '512m';
// Plugin session logs are disposable runtime state. Keeping them on a tmpfs prevents a
// rootless-runtime UID migration from making Theia's asynchronous old-log cleanup fail with
// EACCES on a directory that was created by an older worker namespace.
const TENANT_BACKEND_LOGS_TMPFS_OPTIONS = 'rw,exec,nosuid,nodev,size=64m';

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
    'QAAP_TENANT_EGRESS_PROXY_IMAGE',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'http_proxy',
    'https_proxy',
    'NO_PROXY',
    'no_proxy',
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
    /** Underlying Docker create/validate runs, shared past a caller's timeout (see {@link shareTenantEnsureOperation}). */
    protected readonly tenantEnsureOperations = new Map<string, { readonly promise: Promise<unknown>; readonly startedAt: number }>();
    /** Internal BrowserConnectionToken values captured from each tenant backend's health response. */
    protected readonly tenantBackendConnectionTokens = new Map<string, string>();
    /** Tenants whose stale backend was kept because agent turns were running at recreation time. */
    protected readonly deferredTenantBackendRecreations = new Set<string>();
    /** `QAAP_BUILD_SHA` each ready tenant backend reported in its health payload (see {@link predictTenantBackendBuild}). */
    protected readonly tenantBackendBuilds = new Map<string, string>();
    /** Short-lived cache of the build baked into the tenant serving image, keyed by image reference. */
    protected tenantImageBuildCache: { readonly image: string; readonly build: string | undefined; readonly at: number } | undefined;

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
        const promise = this.boundTenantEnsure(
            this.shareTenantEnsureOperation(`backend:${key}`, () => this.createOrValidateTenantBackend(tenant, tenantRootHostPath)),
            `backend for ${tenant}`,
        );
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

    /**
     * Forget a cached tenant backend target (e.g. after the proxy could not connect to it), so the
     * next request re-runs {@link ensureTenantBackend} instead of reusing a dead loopback port.
     */
    invalidateTenantBackendTarget(ownerLogin: string | undefined, target?: QaapTenantBackendTarget): void {
        const tenant = ownerLogin?.trim().toLowerCase();
        if (!tenant) {
            return;
        }
        const cached = this.tenantBackendTargets.get(tenant);
        if (!cached || (target && cached !== target)) {
            return;
        }
        this.tenantBackendTargets.delete(tenant);
        this.tenantBackendConnectionTokens.delete(tenant);
        this.tenantBackendBuilds.delete(tenant);
    }

    /**
     * Stop waiting for a Docker ensure that never settles (hung daemon, stuck pull). The deduped
     * in-flight promise is the bounded one, so the caller's `finally` evicts it; the next request
     * rejoins the still-running Docker operation ({@link shareTenantEnsureOperation}), which is not cancelled.
     */
    protected boundTenantEnsure<T>(operation: Promise<T>, label: string): Promise<T> {
        const timeoutMs = this.resolveTenantEnsureTimeoutMs();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(
                () => reject(new Error(`Timed out after ${timeoutMs}ms while ensuring tenant ${label}.`)),
                timeoutMs,
            );
            timer.unref?.();
        });
        return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
    }

    protected resolveTenantEnsureTimeoutMs(): number {
        const configured = Number.parseInt(process.env.QAAP_TENANT_ENSURE_TIMEOUT_MS?.trim() ?? '', 10);
        return Number.isInteger(configured) && configured > 0 ? configured : 180_000;
    }

    /**
     * A caller that timed out only stops waiting: the Docker create/validate keeps running. A retry joins that
     * run instead of racing a second create on the same container name. A run older than twice the ensure
     * timeout counts as hung (dead daemon) and no longer blocks a fresh attempt.
     */
    protected shareTenantEnsureOperation<T>(key: string, start: () => Promise<T>): Promise<T> {
        const running = this.tenantEnsureOperations.get(key);
        if (running && Date.now() - running.startedAt < 2 * this.resolveTenantEnsureTimeoutMs()) {
            return running.promise as Promise<T>;
        }
        const entry = { promise: start(), startedAt: Date.now() };
        this.tenantEnsureOperations.set(key, entry);
        const forget = (): void => {
            if (this.tenantEnsureOperations.get(key) === entry) {
                this.tenantEnsureOperations.delete(key);
            }
        };
        entry.promise.then(forget, forget);
        return entry.promise;
    }

    getTenantBackendTarget(ownerLogin: string | undefined): QaapTenantBackendTarget | undefined {
        const tenant = ownerLogin?.trim().toLowerCase();
        return tenant ? this.tenantBackendTargets.get(tenant) : undefined;
    }

    /**
     * Start (or join) the tenant backend ensure without waiting for it. The proxy calls this for
     * every static frontend request it serves from the control plane, so the backend warms while the
     * browser downloads the bundle; the cached target / in-flight dedup keeps repeats cheap.
     */
    warmTenantBackend(ownerLogin: string, tenantRootHostPath: string): void {
        void this.ensureTenantBackend(ownerLogin, tenantRootHostPath).catch(error => {
            console.warn(`[qaap-docker] Background warm-up of the tenant backend for ${ownerLogin} failed:`,
                error instanceof Error ? error.message : String(error));
        });
    }

    /**
     * Best-effort guess of the `QAAP_BUILD_SHA` the tenant's backend will serve once ensured, bounded
     * by {@link getTenantBuildPredictionTimeoutMs}. `undefined` means "unknown": the caller must then
     * treat the tenant as running a different frontend build than the control plane.
     */
    async predictTenantBackendBuild(ownerLogin: string): Promise<string | undefined> {
        const tenant = ownerLogin.trim().toLowerCase();
        // A deferred recreation keeps a stale backend serving until its agent turns finish.
        if (!tenant || this.deferredTenantBackendRecreations.has(tenant)) {
            return undefined;
        }
        if (this.tenantBackendTargets.has(tenant)) {
            return this.tenantBackendBuilds.get(tenant);
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<undefined>(resolve => {
            timer = setTimeout(() => resolve(undefined), this.getTenantBuildPredictionTimeoutMs());
            timer.unref?.();
        });
        try {
            return await Promise.race([this.inspectTenantBackendBuild(ownerLogin).catch(() => undefined), timeout]);
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * A running backend keeps the build it was created with (a stale one may even be kept by a
     * deferred recreation); a stopped or missing one is (re)started from the current serving image.
     */
    protected async inspectTenantBackendBuild(ownerLogin: string): Promise<string | undefined> {
        const docker = await this.getDocker(ownerLogin);
        try {
            const inspect = await docker.getContainer(this.backendContainerNameForTenant(ownerLogin)).inspect();
            if (!this.isManagedTenantBackendFor(inspect, ownerLogin)) {
                return undefined;
            }
            if (inspect.State.Running) {
                return this.buildFromEnv(inspect.Config?.Env);
            }
        } catch (error) {
            if (!this.isDockerNotFound(error)) {
                return undefined;
            }
        }
        return this.tenantImageBuild(docker);
    }

    protected getTenantBuildPredictionTimeoutMs(): number {
        return TENANT_BUILD_PREDICTION_TIMEOUT_MS;
    }

    protected async tenantImageBuild(docker: Dockerode): Promise<string | undefined> {
        const image = this.getTenantImage();
        const cached = this.tenantImageBuildCache;
        if (cached && cached.image === image && Date.now() - cached.at < TENANT_IMAGE_BUILD_CACHE_MS) {
            return cached.build;
        }
        const inspect = await docker.getImage(image).inspect();
        const build = this.buildFromEnv(inspect.Config?.Env);
        this.tenantImageBuildCache = { image, build, at: Date.now() };
        return build;
    }

    protected buildFromEnv(env: readonly string[] | undefined): string | undefined {
        const entry = env?.find(item => item.startsWith('QAAP_BUILD_SHA='));
        const build = entry?.slice('QAAP_BUILD_SHA='.length).trim();
        return build ? build : undefined;
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
        const names = [this.backendIngressRelayNameForTenant(ownerLogin), this.backendContainerNameForTenant(ownerLogin)];
        const nodes = await this.verifiedDockerNodesForTenant(ownerLogin);
        try {
            for (const name of names) {
                for (const node of nodes) {
                    try {
                        await node.docker.getContainer(name).stop({ t: 10 });
                        break;
                    } catch (error) {
                        if (this.isDockerAlreadyStopped(error)) {
                            break;
                        }
                        if (this.isDockerNotFound(error)) {
                            continue;
                        }
                        throw error;
                    }
                }
            }
        } finally {
            this.tenantBackendTargets.delete(tenant);
            this.tenantBackendConnectionTokens.delete(tenant);
            this.tenantBackendBuilds.delete(tenant);
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
            names.push(this.backendIngressRelayNameForTenant(ownerLogin), this.backendContainerNameForTenant(ownerLogin));
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
        this.tenantBackendBuilds.delete(tenant);
        const networkMode = this.getTenantNetworkMode(ownerLogin);
        const networks = networkMode === 'none'
            ? []
            : [
                networkMode,
                this.tenantDirectEgressNetworkNameFor(ownerLogin),
                ...(this.isBackendPerTenantEnabled() ? [this.backendIngressNetworkNameForTenant(ownerLogin)] : []),
            ];
        for (const networkName of networks) {
            for (const node of nodes) {
                try {
                    const network = node.docker.getNetwork(networkName);
                    const inspect = await network.inspect() as { Labels?: Record<string, string> };
                    if (inspect.Labels?.['com.qaap.tenant-network'] === 'true'
                        || inspect.Labels?.['com.qaap.tenant-ingress-network'] === 'true'
                        || inspect.Labels?.['com.qaap.tenant-egress-network'] === 'true') {
                        await network.remove();
                    }
                    break;
                } catch (error) {
                    if (!this.isDockerNotFound(error)) {
                        console.warn(`[qaap-runtime] could not remove tenant network ${networkName} on ${node.config.id}: ${error instanceof Error ? error.message : String(error)}`);
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

    protected tenantDirectEgressNetworkNameFor(ownerLogin?: string): string {
        const tenant = ownerLogin && ownerLogin.trim() ? ownerLogin.trim().toLowerCase() : '__anonymous__';
        const hash = crypto.createHash('sha256').update(`tenant-direct-egress\u0000${tenant}`).digest('hex').slice(0, 12);
        return `${QAAP_TENANT_DIRECT_EGRESS_NETWORK_PREFIX}${hash}`;
    }

    protected tenantDirectEgressNetworkFor(networkMode: string, ownerLogin?: string): string | undefined {
        return networkMode !== 'none' && Object.keys(this.tenantEgressProxyEnv()).length === 0
            ? this.tenantDirectEgressNetworkNameFor(ownerLogin)
            : undefined;
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
    /**
     * Public-URL settings a tenant backend needs to mint preview URLs that the control plane routes
     * back to it (isolated preview hosts, share links). Part of the backend contract: a change
     * recreates stale backends.
     */
    protected tenantBackendPublicUrlEnv(env: NodeJS.ProcessEnv = process.env): string[] {
        return ['QAAP_OAUTH_PUBLIC_URL', 'QAAP_PREVIEW_BASE_DOMAIN', 'QAAP_PREVIEW_ALLOW_SAME_SITE', 'QAAP_PREVIEW_SHARE_TTL_HOURS']
            .map(key => [key, env[key]?.trim()] as const)
            .filter((entry): entry is readonly [string, string] => !!entry[1] && !/[\r\n\0]/.test(entry[1]))
            .map(([key, value]) => `${key}=${value}`);
    }

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
        const promise = this.boundTenantEnsure(this.shareTenantEnsureOperation(`container:${name}`, () => this.createOrValidateTenantContainer(
            name,
            mounts,
            networkMode,
            ownerLogin,
        )), `container ${name}`);
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
            await this.ensureTenantNetwork(docker, networkMode, ownerLogin);
        }
        const directEgressNetwork = this.tenantDirectEgressNetworkFor(networkMode, ownerLogin);
        const tenantEgressNetwork = networkMode === 'none' ? undefined : this.tenantDirectEgressNetworkNameFor(ownerLogin);
        if (directEgressNetwork) {
            await this.ensureTenantDirectEgressNetwork(docker, directEgressNetwork, ownerLogin);
        }
        let container: Dockerode.Container;
        let inspect: Dockerode.ContainerInspectInfo;
        try {
            container = docker.getContainer(name);
            inspect = await container.inspect();
            if (tenantEgressNetwork) {
                if (directEgressNetwork
                    && !this.tenantContainerMatches(inspect, mounts, networkMode, directEgressNetwork)
                    && this.tenantContainerMatches(inspect, mounts, networkMode)) {
                    // Upgrade a valid pre-egress worker in place. The internal bridge has no default
                    // route; Docker selects the newly attached non-internal bridge for outbound traffic.
                    await docker.getNetwork(directEgressNetwork).connect({ Container: name });
                    inspect = await container.inspect();
                } else if (!directEgressNetwork
                    && this.tenantContainerHasExpectedNetworks(inspect, networkMode, tenantEgressNetwork)
                    && this.isManagedTenantContainerFor(inspect, ownerLogin)) {
                    // Remove the direct route immediately when an allowlist proxy is enabled, even
                    // if a busy worker must continue running with its prior environment for now.
                    await docker.getNetwork(tenantEgressNetwork).disconnect({ Container: name, Force: true });
                    inspect = await container.inspect();
                }
            }
            if (!this.tenantContainerMatches(inspect, mounts, networkMode, directEgressNetwork) || !(await this.runsCurrentTenantImage(docker, inspect))) {
                if (!this.isManagedTenantContainerFor(inspect, ownerLogin)) {
                    throw new Error(`Tenant container ${name} has an unexpected mount or security configuration; refusing to reuse it.`);
                }
                // Tenant workers are disposable data-plane containers: all user data lives in the
                // three bind-mounted roots above. Recreate a managed worker when the serving image
                // or hardening contract changed after a control-plane deploy. Unlabelled or
                // differently-owned containers still fail closed below.
                console.warn(`[qaap-docker] Recreating stale tenant container ${name}.`);
                await container.remove({ force: true });
                const recreated = Object.assign(new Error(`Tenant container ${name} was removed for recreation.`), { statusCode: 404 });
                throw recreated;
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
                // The image HEALTHCHECK probes the Theia backend on :4873, which never runs in a
                // worker (it only hosts exec'd shells and dev servers), so the inherited check
                // reported every working tenant as unhealthy. Tenant backends keep the image check.
                Healthcheck: { Test: ['NONE'] },
                User: user,
                Env: [
                    `HOME=${this.getTenantContainerHome()}`,
                    'USER=qaap-tenant',
                    'LOGNAME=qaap-tenant',
                    ...Object.entries(this.tenantEgressProxyEnv()).map(([key, value]) => `${key}=${value}`),
                ],
                Labels: {
                    'com.qaap.managed': 'true',
                    'com.qaap.tenant-container': 'true',
                    'com.qaap.tenant-name': name,
                    'com.qaap.tenant-login': (ownerLogin?.trim() || '__anonymous__').toLowerCase(),
                },
                HostConfig: {
                    // Docker's tini as PID 1 reaps orphaned grandchildren (killed dev servers,
                    // detached shells); zombies otherwise count against PidsLimit.
                    Init: true,
                    // Mount only this tenant's three storage roots. The worker never receives the
                    // shared parent, another tenant's root, or the backend's host filesystem.
                    Binds: [
                        `${dockerMounts.reposRoot}:${WORKSPACE_MOUNT}:rw`,
                        `${dockerMounts.worktreesRoot}:${WORKTREES_MOUNT}:rw`,
                        `${dockerMounts.parallelRoot}:${PARALLEL_MOUNT}:rw`,
                    ],
                    Memory: this.getTenantMemoryLimitFor(ownerLogin),
                    NanoCpus: this.getTenantCpuLimitFor(ownerLogin),
                    PidsLimit: this.getTenantPidsLimitFor(ownerLogin),
                    SecurityOpt: ['no-new-privileges:true'],
                    CapDrop: ['ALL'],
                    ReadonlyRootfs: true,
                    Tmpfs: { '/tmp': this.getTenantTmpfsOptions() },
                    NetworkMode: networkMode,
                    AutoRemove: false,
                },
            });
            if (directEgressNetwork) {
                // Internal bridges have no default route. Attach the only non-internal network
                // before start so Docker selects its gateway for outbound tenant traffic.
                await docker.getNetwork(directEgressNetwork).connect({ Container: name });
            }
            await container.start();
        }
        inspect = await container.inspect();
        if (!inspect.State.Running || !this.tenantContainerMatches(inspect, mounts, networkMode, directEgressNetwork)) {
            throw new Error(`Tenant container ${name} did not start with the required isolated configuration.`);
        }
        this.tenantRoots.set(name, mounts.reposRoot);
        this.tenantMounts.set(name, mounts);
        return { containerId: inspect.Id, containerName: name, workspaceMount: WORKSPACE_MOUNT, hostPath: mounts.reposRoot };
    }

    protected isManagedTenantContainerFor(
        inspect: Dockerode.ContainerInspectInfo,
        ownerLogin?: string,
    ): boolean {
        const raw = inspect as Dockerode.ContainerInspectInfo & {
            Config?: { Labels?: Record<string, string> };
        };
        const labels = raw.Config?.Labels ?? {};
        const tenantLogin = (ownerLogin?.trim() || '__anonymous__').toLowerCase();
        return labels['com.qaap.managed'] === 'true'
            && labels['com.qaap.tenant-container'] === 'true'
            && labels['com.qaap.tenant-login'] === tenantLogin;
    }

    protected backendContainerNameForTenant(ownerLogin?: string): string {
        const tenant = ownerLogin && ownerLogin.trim() ? ownerLogin.trim().toLowerCase() : '__anonymous__';
        const hash = crypto.createHash('sha256').update(`tenant-backend\u0000${tenant}`).digest('hex').slice(0, 12);
        return `qaap-backend-${hash}`;
    }

    protected backendIngressRelayNameForTenant(ownerLogin?: string): string {
        const tenant = ownerLogin?.trim().toLowerCase() || '__anonymous__';
        const hash = crypto.createHash('sha256').update(`tenant-backend-ingress\u0000${tenant}`).digest('hex').slice(0, 12);
        return `qaap-ingress-${hash}`;
    }

    protected backendIngressNetworkNameForTenant(ownerLogin?: string): string {
        const tenant = ownerLogin?.trim().toLowerCase() || '__anonymous__';
        const hash = crypto.createHash('sha256').update(`tenant-ingress-network\u0000${tenant}`).digest('hex').slice(0, 12);
        return `${QAAP_TENANT_INGRESS_NETWORK_PREFIX}${hash}`;
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
        if (networkMode === 'none') {
            throw new Error('Backend-per-tenant routing requires the isolated tenant bridge so its ingress relay can reach the backend.');
        }
        await this.ensureTenantNetwork(docker, networkMode, ownerLogin);
        const directEgressNetwork = this.tenantDirectEgressNetworkFor(networkMode, ownerLogin);
        const tenantEgressNetwork = networkMode === 'none' ? undefined : this.tenantDirectEgressNetworkNameFor(ownerLogin);
        if (directEgressNetwork) {
            await this.ensureTenantDirectEgressNetwork(docker, directEgressNetwork, ownerLogin);
        }
        const ingressNetwork = this.backendIngressNetworkNameForTenant(ownerLogin);
        await this.ensureTenantIngressNetwork(docker, ingressNetwork, ownerLogin);
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
            if (tenantEgressNetwork) {
                if (directEgressNetwork
                    && !this.tenantBackendContainerMatches(inspect, ownerLogin, mounts, tenantDataRoot, theiaHome, networkMode, directEgressNetwork)
                    && this.tenantBackendContainerMatches(inspect, ownerLogin, mounts, tenantDataRoot, theiaHome, networkMode)) {
                    // Upgrade a valid pre-egress backend in place so deploy-time routing changes do
                    // not interrupt an active agent turn.
                    await docker.getNetwork(directEgressNetwork).connect({ Container: name });
                    inspect = await container.inspect();
                } else if (!directEgressNetwork
                    && this.tenantContainerHasExpectedNetworks(inspect, networkMode, tenantEgressNetwork)
                    && this.isManagedTenantBackendFor(inspect, ownerLogin)) {
                    // Remove the direct route immediately when an allowlist proxy is enabled, even
                    // if a busy backend must continue running with its prior environment for now.
                    await docker.getNetwork(tenantEgressNetwork).disconnect({ Container: name, Force: true });
                    inspect = await container.inspect();
                }
            }
            if (!this.tenantBackendContainerMatches(inspect, ownerLogin, mounts, tenantDataRoot, theiaHome, networkMode, directEgressNetwork)
                || !(await this.runsCurrentTenantImage(docker, inspect))) {
                if (!this.isManagedTenantBackendFor(inspect, ownerLogin)) {
                    throw new Error(`Tenant backend ${name} has an unexpected security or mount configuration; refusing to reuse it.`);
                }
                // Tenant backends are disposable data-plane containers: all user data lives in
                // the bind-mounted tenant roots above. Recreate a managed backend when the
                // serving image or hardening contract changed after a control-plane deploy.
                // Unlabelled or differently-owned containers still fail closed below.
                // Never recreate under a running agent turn: a deploy would otherwise kill it. Keep
                // serving the old backend and let the reaper retry once the turns have finished.
                const runningTarget = inspect.State.Running
                    ? await this.inspectTenantBackendIngressRelayTarget(
                        docker, inspect.Id, name, node.config, ownerLogin, networkMode, ingressNetwork, publishHostIp,
                    )
                    : undefined;
                const busy = runningTarget ? await this.fetchTenantBusyStatus(runningTarget) : undefined;
                if (runningTarget && busy?.busy) {
                    console.warn(`[qaap-docker] Deferring recreation of stale tenant backend ${name} for ${ownerLogin}: `
                        + `${busy.runningTasks} agent turn(s) running.`);
                    this.deferredTenantBackendRecreations.add(ownerLogin.trim().toLowerCase());
                    await this.waitForTenantBackendReady(runningTarget);
                    return runningTarget;
                }
                console.warn(`[qaap-docker] Recreating stale tenant backend ${name} for ${ownerLogin}.`);
                await this.removeTenantBackendIngressRelay(docker, ownerLogin);
                await container.remove({ force: true });
                const recreated = Object.assign(new Error(`Tenant backend ${name} was removed for recreation.`), { statusCode: 404 });
                throw recreated;
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
                'QAAP_AGENT_UID=1001',
                'QAAP_AGENT_GID=1001',
                `QAAP_REPOS_ROOT=${TENANT_BACKEND_REPOS_ROOT}`,
                `QAAP_TENANT_CONFIG_ROOT=${TENANT_BACKEND_QAAP_HOME_MOUNT}`,
                'QAAP_TENANT_BACKEND_MODE=1',
                `QAAP_TENANT_BACKEND_SECRET=${secret}`,
                `QAAP_TENANT_LOGIN=${ownerLogin}`,
                `QAAP_SQLITE_STORE_PATH=${TENANT_BACKEND_SQLITE_STORE_PATH}`,
                // The agent-run ledger lives in this tenant's SQLite; with the flag off the env is unchanged.
                ...(QaapAgentRunLedger.isEnabled() ? [`${QaapAgentRunLedger.FLAG_ENV}=on`] : []),
                // Agent processes use the image's private non-root HOME and put package caches and
                // harness databases on this tenant's disk-backed config mount.
                `${QAAP_TENANT_AGENT_STORAGE_ROOT_ENV}=${this.getTenantBackendAgentStorageRoot()}`,
                `HOME=${TENANT_BACKEND_QAAP_HOME_MOUNT.replace('/.qaap', '')}`,
                'USER=theia',
                'LOGNAME=theia',
                ...Object.entries(this.tenantEgressProxyEnv()).map(([key, value]) => `${key}=${value}`),
                'HOST=0.0.0.0',
                `PORT=${TENANT_BACKEND_PORT}`,
                'SHELL=/bin/bash',
                'THEIA_SHELL=/bin/bash',
                'THEIA_PLUGINS_DIR=/app/plugins',
                'QAAP_SYSTEM_SKILLS_DIR=/opt/qaap/system-skills',
                ...this.tenantBackendPublicUrlEnv(),
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
                    // The backend (node) would otherwise be PID 1 and never reap orphaned
                    // grandchildren such as OOM-killed `next-server` processes; each zombie
                    // counts against PidsLimit. Same contract as `init: true` in docker-compose.yml.
                    Init: true,
                    Binds: [
                        repoMount,
                        worktreeMount,
                        parallelMount,
                        `${dockerTenantDataRoot}:${TENANT_BACKEND_QAAP_HOME_MOUNT}:rw`,
                        `${dockerTheiaHome}:${TENANT_BACKEND_THEIA_HOME_MOUNT}:rw`,
                    ],
                    Memory: this.getTenantMemoryLimitFor(ownerLogin),
                    NanoCpus: this.getTenantCpuLimitFor(ownerLogin),
                    PidsLimit: this.getTenantPidsLimitFor(ownerLogin),
                    SecurityOpt: ['no-new-privileges:true'],
                    CapDrop: ['ALL'],
                    // The backend needs only credential switching so setpriv can drop each agent
                    // child to uid 1001. The rootless user namespace and no-new-privileges keep
                    // those children unprivileged after the drop.
                    CapAdd: ['SETUID', 'SETGID'],
                    ReadonlyRootfs: true,
                    Tmpfs: {
                        '/tmp': this.getTenantTmpfsOptions(),
                        [TENANT_BACKEND_LOGS_MOUNT]: TENANT_BACKEND_LOGS_TMPFS_OPTIONS,
                    },
                    NetworkMode: networkMode,
                    AutoRemove: false,
                },
            });
            if (directEgressNetwork) {
                // Keep the internal tenant bridge for backend/worker/relay traffic and add the
                // tenant-only non-internal bridge for the container's default outbound route.
                await docker.getNetwork(directEgressNetwork).connect({ Container: name });
            }
            await container.start();
        }
        inspect = await container.inspect();
        if (!inspect.State.Running || !this.tenantBackendContainerMatches(inspect, ownerLogin, mounts, tenantDataRoot, theiaHome, networkMode, directEgressNetwork)) {
            throw new Error(`Tenant backend ${name} did not start with the required isolated configuration.`);
        }
        const relayInspect = await this.ensureTenantBackendIngressRelay(
            docker, ownerLogin, name, networkMode, ingressNetwork, publishHostIp,
        );
        const target = this.tenantBackendTargetFromIngressRelayInspect(relayInspect, inspect.Id, name, node.config, ownerLogin);
        if (!target) {
            throw new Error(`Tenant ingress relay for ${name} has no published port on ${publishHostIp}.`);
        }
        await this.waitForTenantBackendReady(target);
        return target;
    }

    protected tenantBackendTargetFromIngressRelayInspect(
        inspect: Dockerode.ContainerInspectInfo,
        backendContainerId: string,
        backendName: string,
        config: QaapDockerNodeConfig,
        ownerLogin: string,
    ): QaapTenantBackendTarget | undefined {
        const publishHostIp = this.dockerPublishHostIp(config);
        const ports = (inspect.NetworkSettings?.Ports as Record<string, Array<{ HostIp?: string; HostPort?: string }> | null> | undefined)?.[`${TENANT_BACKEND_PORT}/tcp`];
        const hostPort = Number.parseInt(ports?.find(entry => entry.HostIp === publishHostIp)?.HostPort ?? '', 10);
        if (!Number.isInteger(hostPort) || hostPort <= 0) {
            return undefined;
        }
        return { containerId: backendContainerId, containerName: backendName, host: this.dockerAdvertiseHost(config), port: hostPort, tenantLogin: ownerLogin };
    }

    protected tenantBackendIngressRelayCommand(backendName: string): string[] {
        // Reuse the already-pinned tenant serving image and its Node runtime. The relay has no
        // mounts or tenant credentials and forwards a single TCP port to this tenant's backend.
        const script = `const net = require('node:net'); const server = net.createServer(client => { const upstream = net.connect(${TENANT_BACKEND_PORT}, ${JSON.stringify(backendName)}); client.on('error', () => upstream.destroy()); upstream.on('error', () => client.destroy()); client.pipe(upstream); upstream.pipe(client); }); server.listen(${TENANT_BACKEND_PORT}, '0.0.0.0');`;
        return ['node', '-e', script];
    }

    protected async inspectTenantBackendIngressRelayTarget(
        docker: Dockerode,
        backendContainerId: string,
        backendName: string,
        config: QaapDockerNodeConfig,
        ownerLogin: string,
        tenantNetwork: string,
        ingressNetwork: string,
        publishHostIp: string,
    ): Promise<QaapTenantBackendTarget | undefined> {
        try {
            const relayName = this.backendIngressRelayNameForTenant(ownerLogin);
            const inspect = await docker.getContainer(relayName).inspect();
            if (!inspect.State.Running
                // A stale but correctly-scoped relay is still needed to probe whether the old
                // backend is serving an active turn before replacing it during a deploy.
                || !this.tenantBackendIngressRelayMatches(inspect, ownerLogin, backendName, tenantNetwork, ingressNetwork, publishHostIp, false)) {
                return undefined;
            }
            return this.tenantBackendTargetFromIngressRelayInspect(inspect, backendContainerId, backendName, config, ownerLogin);
        } catch (error) {
            if (!this.isDockerNotFound(error)) {
                throw error;
            }
            return undefined;
        }
    }

    protected async ensureTenantBackendIngressRelay(
        docker: Dockerode,
        ownerLogin: string,
        backendName: string,
        tenantNetwork: string,
        ingressNetwork: string,
        publishHostIp: string,
    ): Promise<Dockerode.ContainerInspectInfo> {
        const relayName = this.backendIngressRelayNameForTenant(ownerLogin);
        let container: Dockerode.Container | undefined;
        let inspect: Dockerode.ContainerInspectInfo | undefined;
        try {
            container = docker.getContainer(relayName);
            inspect = await container.inspect();
        } catch (error) {
            if (!this.isDockerNotFound(error)) {
                throw error;
            }
        }

        if (inspect && container) {
            const owned = this.isManagedTenantBackendIngressRelayFor(inspect, ownerLogin);
            const matches = owned
                && this.tenantBackendIngressRelayMatches(inspect, ownerLogin, backendName, tenantNetwork, ingressNetwork, publishHostIp)
                && await this.runsCurrentTenantImage(docker, inspect);
            if (!matches) {
                if (!owned) {
                    throw new Error(`Tenant ingress relay ${relayName} has an unexpected image, network, or security configuration.`);
                }
                console.warn(`[qaap-docker] Recreating stale tenant ingress relay ${relayName}.`);
                await container.remove({ force: true });
                container = undefined;
                inspect = undefined;
            }
        }

        if (inspect && container) {
            if (!inspect.State.Running) {
                await container.start();
            }
        } else {
            container = await docker.createContainer({
                name: relayName,
                Image: this.getTenantImage(),
                User: this.getTenantContainerUser(),
                WorkingDir: '/app',
                Cmd: this.tenantBackendIngressRelayCommand(backendName),
                ExposedPorts: { [`${TENANT_BACKEND_PORT}/tcp`]: {} },
                Labels: {
                    'com.qaap.managed': 'true',
                    'com.qaap.tenant-backend-ingress-relay': 'true',
                    'com.qaap.tenant-name': relayName,
                    'com.qaap.tenant-login': ownerLogin.toLowerCase(),
                    'com.qaap.tenant-backend-name': backendName,
                },
                HostConfig: {
                    Init: true,
                    PortBindings: {
                        [`${TENANT_BACKEND_PORT}/tcp`]: [{ HostIp: publishHostIp, HostPort: '' }],
                    },
                    Memory: this.getTenantBackendIngressRelayMemoryLimit(),
                    NanoCpus: this.getTenantBackendIngressRelayCpuLimit(),
                    PidsLimit: this.getTenantBackendIngressRelayPidsLimit(),
                    SecurityOpt: ['no-new-privileges:true'],
                    CapDrop: ['ALL'],
                    ReadonlyRootfs: true,
                    Tmpfs: { '/tmp': 'rw,noexec,nosuid,nodev,size=16m' },
                    // Docker must publish on the non-internal ingress network when the relay starts.
                    // Connect the internal tenant network before start so this is its only other
                    // interface and its fixed forward destination resolves by Docker DNS.
                    NetworkMode: ingressNetwork,
                    AutoRemove: false,
                },
            });
            await docker.getNetwork(tenantNetwork).connect({ Container: relayName });
            await container.start();
        }

        inspect = await container.inspect();
        if (!inspect.State.Running
            || !this.tenantBackendIngressRelayMatches(inspect, ownerLogin, backendName, tenantNetwork, ingressNetwork, publishHostIp)) {
            throw new Error(`Tenant ingress relay ${relayName} did not start with the required isolated configuration.`);
        }
        return inspect;
    }

    protected isManagedTenantBackendIngressRelayFor(inspect: Dockerode.ContainerInspectInfo, ownerLogin: string): boolean {
        const labels = (inspect as Dockerode.ContainerInspectInfo & {
            Config?: { Labels?: Record<string, string> };
        }).Config?.Labels ?? {};
        return labels['com.qaap.managed'] === 'true'
            && labels['com.qaap.tenant-backend-ingress-relay'] === 'true'
            && labels['com.qaap.tenant-login'] === ownerLogin.toLowerCase();
    }

    protected async removeTenantBackendIngressRelay(docker: Dockerode, ownerLogin: string): Promise<void> {
        const relayName = this.backendIngressRelayNameForTenant(ownerLogin);
        try {
            const container = docker.getContainer(relayName);
            const inspect = await container.inspect();
            if (!this.isManagedTenantBackendIngressRelayFor(inspect, ownerLogin)) {
                throw new Error(`Tenant ingress relay ${relayName} is not managed for ${ownerLogin}; refusing to remove it.`);
            }
            await container.remove({ force: true });
        } catch (error) {
            if (!this.isDockerNotFound(error)) {
                throw error;
            }
        }
    }

    protected tenantBackendIngressRelayMatches(
        inspect: Dockerode.ContainerInspectInfo,
        ownerLogin: string,
        backendName: string,
        tenantNetwork: string,
        ingressNetwork: string,
        publishHostIp: string,
        requireCurrentImage: boolean = true,
    ): boolean {
        const raw = inspect as Dockerode.ContainerInspectInfo & {
            Config?: { User?: string; Image?: string; Cmd?: string[]; WorkingDir?: string; Labels?: Record<string, string>; ExposedPorts?: Record<string, unknown> };
            HostConfig?: {
                Init?: boolean;
                Memory?: number;
                NanoCpus?: number;
                PidsLimit?: number | null;
                SecurityOpt?: string[];
                CapDrop?: string[];
                CapAdd?: string[];
                ReadonlyRootfs?: boolean;
                Tmpfs?: Record<string, string>;
                NetworkMode?: string;
                Binds?: string[] | null;
                PortBindings?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
                PublishAllPorts?: boolean;
                AutoRemove?: boolean;
                Privileged?: boolean;
                PidMode?: string;
                IpcMode?: string;
            };
            NetworkSettings?: {
                Networks?: Record<string, unknown>;
                Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
            };
            Mounts?: Array<unknown>;
        };
        const labels = raw.Config?.Labels ?? {};
        const host = raw.HostConfig ?? {};
        const boundPorts = raw.NetworkSettings?.Ports?.[`${TENANT_BACKEND_PORT}/tcp`];
        const bindings = host.PortBindings?.[`${TENANT_BACKEND_PORT}/tcp`];
        const networks = raw.NetworkSettings?.Networks ?? {};
        return labels['com.qaap.managed'] === 'true'
            && labels['com.qaap.tenant-backend-ingress-relay'] === 'true'
            && labels['com.qaap.tenant-name'] === this.backendIngressRelayNameForTenant(ownerLogin)
            && labels['com.qaap.tenant-login'] === ownerLogin.toLowerCase()
            && labels['com.qaap.tenant-backend-name'] === backendName
            && raw.Config?.User === this.getTenantContainerUser()
            && (!requireCurrentImage || raw.Config?.Image === this.getTenantImage())
            && raw.Config?.WorkingDir === '/app'
            && raw.Config?.Cmd?.join('\u0000') === this.tenantBackendIngressRelayCommand(backendName).join('\u0000')
            && Object.keys(raw.Config?.ExposedPorts ?? {}).length === 1
            && raw.Config?.ExposedPorts?.[`${TENANT_BACKEND_PORT}/tcp`] !== undefined
            && raw.Mounts?.length === 0
            && (host.Binds?.length ?? 0) === 0
            && host.Init === true
            && host.Memory === this.getTenantBackendIngressRelayMemoryLimit()
            && host.NanoCpus === this.getTenantBackendIngressRelayCpuLimit()
            && host.PidsLimit === this.getTenantBackendIngressRelayPidsLimit()
            && host.SecurityOpt?.includes('no-new-privileges:true') === true
            && host.CapDrop?.includes('ALL') === true
            && (host.CapAdd?.length ?? 0) === 0
            && host.ReadonlyRootfs === true
            && host.Tmpfs?.['/tmp'] === 'rw,noexec,nosuid,nodev,size=16m'
            && host.Privileged !== true
            && (!host.PidMode || host.PidMode === 'private')
            && (!host.IpcMode || host.IpcMode === 'private')
            && host.NetworkMode === ingressNetwork
            && host.PublishAllPorts !== true
            && host.AutoRemove !== true
            && Object.keys(host.PortBindings ?? {}).length === 1
            && bindings?.length === 1
            && bindings[0]?.HostIp === publishHostIp
            && bindings[0]?.HostPort === ''
            && boundPorts?.length === 1
            && boundPorts[0]?.HostIp === publishHostIp
            && Number.parseInt(boundPorts[0]?.HostPort ?? '', 10) > 0
            && Object.keys(raw.NetworkSettings?.Ports ?? {}).length === 1
            && Object.keys(networks).length === 2
            && networks[tenantNetwork] !== undefined
            && networks[ingressNetwork] !== undefined;
    }

    /**
     * Ask a tenant backend whether agent turns are in flight there. Those turns hold their activity
     * lease inside the tenant container, so the control-plane reaper cannot see them otherwise.
     * `undefined` means the backend could not be asked (not running, unreachable, older image).
     */
    async probeTenantBackendBusy(ownerLogin: string): Promise<QaapTenantBusyStatus | undefined> {
        if (!this.isBackendPerTenantEnabled() || !ownerLogin.trim()) {
            return undefined;
        }
        const target = this.getTenantBackendTarget(ownerLogin) ?? await this.inspectRunningTenantBackendTarget(ownerLogin);
        return target ? this.fetchTenantBusyStatus(target) : undefined;
    }

    /**
     * Stale backends kept alive because a turn was running (see `createOrValidateTenantBackend`).
     * Once idle, forget the cached target so the next request recreates them on the current image.
     */
    async retryDeferredTenantBackendRecreations(): Promise<void> {
        for (const tenant of [...this.deferredTenantBackendRecreations]) {
            const status = await this.probeTenantBackendBusy(tenant);
            if (status?.busy) {
                continue;
            }
            this.deferredTenantBackendRecreations.delete(tenant);
            this.invalidateTenantBackendTarget(tenant);
            console.info(`[qaap-docker] tenant backend for ${tenant} is idle; it will be recreated on its next request.`);
        }
    }

    protected async inspectRunningTenantBackendTarget(ownerLogin: string): Promise<QaapTenantBackendTarget | undefined> {
        try {
            const node = this.dockerNodeForTenant(ownerLogin);
            const docker = await this.getDocker(ownerLogin);
            const name = this.backendContainerNameForTenant(ownerLogin);
            const inspect = await docker.getContainer(name).inspect();
            if (!inspect.State.Running || !this.isManagedTenantBackendFor(inspect, ownerLogin)) {
                return undefined;
            }
            const networkMode = this.getTenantNetworkMode(ownerLogin);
            if (networkMode === 'none') {
                return undefined;
            }
            return this.inspectTenantBackendIngressRelayTarget(
                docker,
                inspect.Id,
                name,
                node.config,
                ownerLogin,
                networkMode,
                this.backendIngressNetworkNameForTenant(ownerLogin),
                this.dockerPublishHostIp(node.config),
            );
        } catch {
            return undefined;
        }
    }

    protected fetchTenantBusyStatus(target: QaapTenantBackendTarget): Promise<QaapTenantBusyStatus | undefined> {
        let probe: string;
        try {
            probe = QaapTenantBusyProbe.create(target.tenantLogin, this.tenantBackendSecret(target.tenantLogin));
        } catch {
            return Promise.resolve(undefined);
        }
        const token = this.tenantBackendConnectionTokens.get(target.tenantLogin.toLowerCase());
        return new Promise(resolve => {
            const request = http.get({
                host: target.host,
                port: target.port,
                path: `${QAAP_TENANT_RUNTIME_API_PATH}/busy`,
                timeout: 5_000,
                headers: {
                    [QAAP_TENANT_BUSY_PROBE_HEADER]: probe,
                    ...(token ? { cookie: `theia-connection-token=${encodeURIComponent(token)}` } : {}),
                },
            }, response => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', chunk => body += chunk);
                response.on('end', () => {
                    if (response.statusCode !== 200) {
                        resolve(undefined);
                        return;
                    }
                    try {
                        resolve(QaapTenantBusyProbe.parseStatus(JSON.parse(body)));
                    } catch {
                        resolve(undefined);
                    }
                });
            });
            request.on('timeout', () => request.destroy(new Error('tenant busy probe timeout')));
            request.on('error', () => resolve(undefined));
        });
    }

    protected isManagedTenantBackendFor(
        inspect: Dockerode.ContainerInspectInfo,
        ownerLogin: string,
    ): boolean {
        const raw = inspect as Dockerode.ContainerInspectInfo & {
            Config?: { Labels?: Record<string, string> };
        };
        const labels = raw.Config?.Labels ?? {};
        return labels['com.qaap.managed'] === 'true'
            && labels['com.qaap.tenant-backend'] === 'true'
            && labels['com.qaap.tenant-login'] === ownerLogin.toLowerCase();
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
                    const payload = JSON.parse(response.body) as { ready?: boolean; build?: unknown };
                    if (payload.ready === true) {
                        // Lets the proxy serve the static frontend from the control plane only
                        // when both run the same build (see predictTenantBackendBuild).
                        const build = typeof payload.build === 'string' ? payload.build.trim() : '';
                        if (build) {
                            this.tenantBackendBuilds.set(target.tenantLogin.toLowerCase(), build);
                        } else {
                            this.tenantBackendBuilds.delete(target.tenantLogin.toLowerCase());
                        }
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
        directEgressNetwork?: string,
    ): boolean {
        const raw = inspect as Dockerode.ContainerInspectInfo & {
            Config?: { User?: string; Image?: string; Cmd?: string[]; Env?: string[]; WorkingDir?: string; Labels?: Record<string, string> };
            HostConfig?: {
                Memory?: number;
                NanoCpus?: number;
                PidsLimit?: number | null;
                SecurityOpt?: string[];
                CapDrop?: string[];
                CapAdd?: string[];
                ReadonlyRootfs?: boolean;
                Tmpfs?: Record<string, string>;
                NetworkMode?: string;
                Privileged?: boolean;
                PidMode?: string;
                IpcMode?: string;
                PortBindings?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
                PublishAllPorts?: boolean;
            };
            Mounts?: Array<{ Source?: string; Destination?: string; RW?: boolean }>;
            NetworkSettings?: {
                Networks?: Record<string, unknown>;
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
            'QAAP_AGENT_UID=1001',
            'QAAP_AGENT_GID=1001',
            `QAAP_REPOS_ROOT=${TENANT_BACKEND_REPOS_ROOT}`,
            `QAAP_TENANT_CONFIG_ROOT=${TENANT_BACKEND_QAAP_HOME_MOUNT}`,
            'QAAP_TENANT_BACKEND_MODE=1',
            `QAAP_TENANT_BACKEND_SECRET=${this.tenantBackendSecret(ownerLogin)}`,
            `QAAP_TENANT_LOGIN=${ownerLogin}`,
            `QAAP_SQLITE_STORE_PATH=${TENANT_BACKEND_SQLITE_STORE_PATH}`,
            `${QAAP_TENANT_AGENT_STORAGE_ROOT_ENV}=${this.getTenantBackendAgentStorageRoot()}`,
            `HOME=${TENANT_BACKEND_QAAP_HOME_MOUNT.replace('/.qaap', '')}`,
            'USER=theia',
            'LOGNAME=theia',
            ...Object.entries(this.tenantEgressProxyEnv()).map(([key, value]) => `${key}=${value}`),
            'HOST=0.0.0.0',
            `PORT=${TENANT_BACKEND_PORT}`,
            'SHELL=/bin/bash',
            'THEIA_SHELL=/bin/bash',
            'THEIA_PLUGINS_DIR=/app/plugins',
            'QAAP_SYSTEM_SKILLS_DIR=/opt/qaap/system-skills',
            ...this.tenantBackendPublicUrlEnv(),
        ];
        // The backend must not publish its own port: a Docker internal network deliberately reports
        // a null mapping. Only the dedicated ingress relay publishes a host port.
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
            && this.tenantContainerHasExpectedNetworks(inspect, networkMode, directEgressNetwork)
            && raw.Mounts?.length === expectedMounts.length
            && expectedMounts.every(expected => raw.Mounts?.some(actual =>
                actual.Destination === expected.destination
                && this.normalizeDockerMountPath(actual.Source ?? '') === this.normalizeDockerMountPath(expected.source)
                && actual.RW === true) === true)
            && hostConfig.Memory === this.getTenantMemoryLimitFor(ownerLogin)
            && hostConfig.NanoCpus === this.getTenantCpuLimitFor(ownerLogin)
            && hostConfig.PidsLimit === this.getTenantPidsLimitFor(ownerLogin)
            && hostConfig.SecurityOpt?.includes('no-new-privileges:true') === true
            && hostConfig.CapDrop?.includes('ALL') === true
            && hostConfig.CapAdd?.includes('SETUID') === true
            && hostConfig.CapAdd?.includes('SETGID') === true
            && hostConfig.ReadonlyRootfs === true
            && hostConfig.Tmpfs?.['/tmp'] === this.getTenantTmpfsOptions()
            && hostConfig.Tmpfs?.[TENANT_BACKEND_LOGS_MOUNT] === TENANT_BACKEND_LOGS_TMPFS_OPTIONS
            && hostConfig.Privileged !== true
            && (!hostConfig.PidMode || hostConfig.PidMode === 'private')
            && (!hostConfig.IpcMode || hostConfig.IpcMode === 'private')
            && hostConfig.NetworkMode === networkMode
            && ports === null
            && Object.values((hostConfig.PortBindings ?? {}) as Record<string, unknown[] | null | undefined>).every(bindings => !bindings || bindings.length === 0)
            && hostConfig.PublishAllPorts !== true;
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
        const containerArgs = !root
            ? [...args]
            : file === 'git' ? this.translateTenantGitArgs(args, root) : this.translateTenantShellArgs(args, root);
        return {
            file: 'docker',
            args: [
                ...this.dockerCliGlobalArgs(ownerLogin),
                'exec',
                '-i',
                // Callers (QaapTenantSpawnService.spawn / spawnArgvPrepared) launch this docker CLI
                // with exactly `environment` as its process env, so values are inherited by name and
                // never appear on the docker argv (`docker events` exec_create, `ps`).
                ...this.buildTenantEnvironmentArgs(environment, true),
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
        const root = tenantRootHostPath ?? this.tenantRoots.get(containerName);
        const containerCwd = this.toContainerPath(cwd, root);
        return {
            file: this.dockerCliExecutable(),
            args: [
                ...this.dockerCliGlobalArgs(ownerLogin),
                'exec',
                '-it',
                // The node-pty launch env is merged/mutated after this wrapper runs (process.env merge,
                // extension env collections, HOME overlay), so it cannot be proven equal to
                // `environment`: keep passing explicit values here.
                ...this.buildTenantEnvironmentArgs(environment),
                '--user',
                this.getTenantContainerUser(),
                '-w',
                containerCwd,
                containerName,
                file,
                // Managed shells (project bootstrap / preview) embed the host cwd, e.g.
                // `bash -l -c "cd -- '<reposRoot>/users/<login>/<repo>' && npm install"`.
                ...(root ? this.translateTenantShellArgs(args, root) : args),
            ],
        };
    }

    /**
     * Build `docker exec -e` flags without exposing the shared Docker/backend control plane.
     *
     * With `inheritByName`, only the variable NAME is emitted (`-e KEY`): the docker CLI copies the
     * value from its own process env, so secrets (git credential headers, provider keys, task
     * tokens) never appear in the docker argv. Only use it when the docker CLI child is launched
     * with exactly `environment` as its env — otherwise the variable is silently not set.
     */
    protected buildTenantEnvironmentArgs(environment?: NodeJS.ProcessEnv, inheritByName = false): string[] {
        if (!environment) {
            return [];
        }
        const args: string[] = [];
        for (const [key, value] of Object.entries(environment)) {
            if (value === undefined || TENANT_WORKER_ENV_DENYLIST.has(key) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
                continue;
            }
            args.push('-e', inheritByName ? key : `${key}=${value}`);
        }
        return args;
    }

    toContainerPath(hostPath: string, tenantRootHostPath?: string): string {
        // Collapse `.`/`..` segments before the prefix checks: `<root>/../other` string-starts-with
        // `<root>/` but must not be translated to `/workspace/../other`.
        const normalized = path.posix.normalize(hostPath.replace(/\\/g, '/')).replace(/\/$/, '');
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

    protected tenantContainerHasExpectedNetworks(
        inspect: Dockerode.ContainerInspectInfo,
        networkMode: string,
        directEgressNetwork?: string,
    ): boolean {
        const networks = (inspect as Dockerode.ContainerInspectInfo & {
            NetworkSettings?: { Networks?: Record<string, unknown> };
        }).NetworkSettings?.Networks ?? {};
        const attached = Object.keys(networks);
        return networkMode === 'none'
            ? attached.every(name => name === 'none')
            : attached.length === (directEgressNetwork ? 2 : 1)
                && attached.includes(networkMode)
                && (!directEgressNetwork || attached.includes(directEgressNetwork));
    }

    protected tenantContainerMatches(
        inspect: Dockerode.ContainerInspectInfo,
        mounts: QaapTenantMountSet,
        networkMode: string,
        directEgressNetwork?: string,
    ): boolean {
        const raw = inspect as Dockerode.ContainerInspectInfo & {
            Config?: { User?: string; Image?: string; Labels?: Record<string, string>; Env?: string[] };
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
            NetworkSettings?: { Networks?: Record<string, unknown> };
            Mounts?: Array<{ Source?: string; Destination?: string; RW?: boolean }>;
        };
        const expectedMounts = [
            { source: this.dockerMountSource(mounts.reposRoot, 'repos'), destination: WORKSPACE_MOUNT },
            { source: this.dockerMountSource(mounts.worktreesRoot, 'worktrees'), destination: WORKTREES_MOUNT },
            { source: this.dockerMountSource(mounts.parallelRoot, 'parallel'), destination: PARALLEL_MOUNT },
        ];
        const hostConfig = raw.HostConfig ?? {};
        const labels = raw.Config?.Labels ?? {};
        const env = new Set(raw.Config?.Env ?? []);
        const expectedEnv = Object.entries(this.tenantEgressProxyEnv()).map(([key, value]) => `${key}=${value}`);
        return labels['com.qaap.managed'] === 'true'
            && labels['com.qaap.tenant-container'] === 'true'
            && raw.Config?.User === this.getTenantContainerUser()
            && raw.Config?.Image === this.getTenantImage()
            && expectedEnv.every(entry => env.has(entry))
            && this.tenantContainerHasExpectedNetworks(inspect, networkMode, directEgressNetwork)
            && raw.Mounts?.length === expectedMounts.length
            && expectedMounts.every(expected => raw.Mounts?.some(actual =>
                actual.Destination === expected.destination
                && this.normalizeDockerMountPath(actual.Source ?? '') === this.normalizeDockerMountPath(expected.source)
                && actual.RW === true) === true)
            && hostConfig.Memory === this.getTenantMemoryLimitFor(labels['com.qaap.tenant-login'])
            && hostConfig.NanoCpus === this.getTenantCpuLimitFor(labels['com.qaap.tenant-login'])
            && hostConfig.PidsLimit === this.getTenantPidsLimitFor(labels['com.qaap.tenant-login'])
            && hostConfig.SecurityOpt?.includes('no-new-privileges:true') === true
            && hostConfig.CapDrop?.includes('ALL') === true
            && hostConfig.ReadonlyRootfs === true
            && hostConfig.Tmpfs?.['/tmp'] === this.getTenantTmpfsOptions()
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

    /**
     * Rewrite host tenant roots embedded anywhere inside shell/argv strings (for example
     * `cd -- '<reposRoot>/users/<login>/<repo>' && npm install`) to their worker mount paths. The
     * worker only sees its own mounts, so a host path is never meaningful inside it. Matches require
     * a path boundary on both sides so `/other/<root>` or `<root>-suffix` are left untouched.
     */
    protected translateTenantShellArgs(args: readonly string[], tenantRootHostPath: string): string[] {
        const pairs = this.tenantHostMountPairs(tenantRootHostPath)
            .sort((left, right) => right.root.length - left.root.length);
        if (pairs.length === 0) {
            return [...args];
        }
        const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(^|[^A-Za-z0-9_.\\-/])(${pairs.map(pair => escape(pair.root)).join('|')})(?=$|[/'"\\s;&|)<>\`])`, 'g');
        return args.map(arg => arg.replace(pattern, (_match, prefix: string, hostRoot: string) =>
            `${prefix}${pairs.find(pair => pair.root === hostRoot)!.mount}`));
    }

    /** Host root → worker mount pairs for the tenant owning `tenantRootHostPath` (POSIX separators). */
    protected tenantHostMountPairs(tenantRootHostPath: string): Array<{ root: string; mount: string }> {
        const clean = (value: string): string => value.replace(/\\/g, '/').replace(/\/$/, '');
        const root = clean(tenantRootHostPath);
        if (!root || root === '/') {
            return [];
        }
        const mounts = [...this.tenantMounts.values()].find(candidate =>
            [candidate.reposRoot, candidate.worktreesRoot, candidate.parallelRoot].map(clean).includes(root));
        if (!mounts) {
            return [{ root, mount: WORKSPACE_MOUNT }];
        }
        return [
            { root: clean(mounts.reposRoot), mount: WORKSPACE_MOUNT },
            { root: clean(mounts.worktreesRoot), mount: WORKTREES_MOUNT },
            { root: clean(mounts.parallelRoot), mount: PARALLEL_MOUNT },
        ].filter(pair => pair.root && pair.root !== '/');
    }

    protected isDockerNotFound(error: unknown): boolean {
        return (error as { statusCode?: number } | undefined)?.statusCode === 404;
    }

    protected isDockerConflict(error: unknown): boolean {
        const statusCode = (error as { statusCode?: number } | undefined)?.statusCode;
        const message = error instanceof Error ? error.message : String(error);
        return statusCode === 409 || /\bconflict\b/i.test(message);
    }

    protected warnIfTenantNetworkAddressPoolIsExhausted(networkName: string, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        if (/non-overlapping/i.test(message)) {
            console.warn(`[qaap-docker] Could not create tenant network ${networkName}: Docker could not allocate a non-overlapping address pool. `
                + 'Configure the Docker daemon default-address-pools (for example base 10.200.0.0/16, size 24). '
                + `Docker reported: ${message}`);
        }
    }

    protected isDockerAlreadyStopped(error: unknown): boolean {
        return (error as { statusCode?: number } | undefined)?.statusCode === 304;
    }

    protected getTenantMemoryLimit(): number {
        const raw = process.env.QAAP_TENANT_MEMORY_LIMIT?.trim();
        const num = raw ? Number.parseInt(raw, 10) : Number.NaN;
        return Number.isInteger(num) && num > 0 ? num : 2 * 1024 * 1024 * 1024;
    }

    /** The default, raised for `ownerLogin` by `QAAP_TENANT_MEMORY_LIMIT_OVERRIDES` (see QaapTenantResourceOverrides). */
    protected getTenantMemoryLimitFor(ownerLogin: string | undefined): number {
        return QaapTenantResourceOverrides.memoryBytes(ownerLogin, this.getTenantMemoryLimit());
    }

    /**
     * Mount options of the tenant `/tmp` tmpfs (which also holds the tenant HOME). The size comes
     * from `QAAP_TENANT_TMPFS_SIZE` (`<n>[k|m|g]`, default 512m). Values that are malformed or not
     * below half of the container memory limit fall back to the default: tmpfs pages are charged to
     * the container memory cgroup, so a larger tmpfs would let a full `/tmp` OOM-kill the tenant.
     */
    protected getTenantTmpfsOptions(): string {
        return `${TENANT_TMPFS_BASE_OPTIONS},size=${this.getTenantTmpfsSize()}`;
    }

    protected getTenantTmpfsSize(): string {
        const raw = process.env.QAAP_TENANT_TMPFS_SIZE?.trim().toLowerCase();
        if (!raw) {
            return TENANT_TMPFS_DEFAULT_SIZE;
        }
        const match = /^(\d+)([kmg]?)$/.exec(raw);
        const multiplier = match ? { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[match[2] as '' | 'k' | 'm' | 'g'] : 0;
        const bytes = match ? Number.parseInt(match[1], 10) * multiplier : 0;
        if (!match || bytes <= 0 || bytes > this.getTenantMemoryLimit() / 2) {
            if (!this.warnedInvalidTmpfsSize) {
                this.warnedInvalidTmpfsSize = true;
                console.warn(`[qaap-docker] Ignoring QAAP_TENANT_TMPFS_SIZE=${raw}: expected <n>[k|m|g] no larger than half of `
                    + `QAAP_TENANT_MEMORY_LIMIT; using ${TENANT_TMPFS_DEFAULT_SIZE}.`);
            }
            return TENANT_TMPFS_DEFAULT_SIZE;
        }
        return `${match[1]}${match[2]}`;
    }

    protected warnedInvalidTmpfsSize = false;

    protected getTenantCpuLimit(): number {
        const raw = process.env.QAAP_TENANT_CPU_LIMIT?.trim();
        const num = raw ? Number.parseFloat(raw) : Number.NaN;
        return Number.isFinite(num) && num > 0 ? Math.floor(num * 1e9) : 2 * 1e9;
    }

    protected getTenantCpuLimitFor(ownerLogin: string | undefined): number {
        return QaapTenantResourceOverrides.nanoCpus(ownerLogin, this.getTenantCpuLimit());
    }

    protected getTenantPidsLimit(): number {
        const raw = process.env.QAAP_TENANT_PIDS_LIMIT?.trim();
        const num = raw ? Number.parseInt(raw, 10) : Number.NaN;
        return Number.isInteger(num) && num > 0 ? num : 256;
    }

    protected getTenantPidsLimitFor(ownerLogin: string | undefined): number {
        return QaapTenantResourceOverrides.pidsLimit(ownerLogin, this.getTenantPidsLimit());
    }

    protected getTenantBackendIngressRelayMemoryLimit(): number {
        return Math.min(this.getTenantMemoryLimit(), TENANT_BACKEND_INGRESS_RELAY_MEMORY_CAP);
    }

    protected getTenantBackendIngressRelayCpuLimit(): number {
        return Math.min(this.getTenantCpuLimit(), TENANT_BACKEND_INGRESS_RELAY_CPU_CAP);
    }

    protected getTenantBackendIngressRelayPidsLimit(): number {
        return Math.min(this.getTenantPidsLimit(), TENANT_BACKEND_INGRESS_RELAY_PIDS_CAP);
    }

    /**
     * The `Config.Image` comparison in the match checks only sees the tag. A locally built serving image
     * (`qaap-theia:local`) keeps its tag across deploys, so also require the container to run the image the
     * tag currently points at; otherwise a deploy never reaches existing tenant containers.
     */
    protected async runsCurrentTenantImage(docker: Dockerode, inspect: Dockerode.ContainerInspectInfo): Promise<boolean> {
        try {
            const current = await docker.getImage(this.getTenantImage()).inspect();
            return !current.Id || inspect.Image === current.Id;
        } catch {
            // Unknown or missing image: keep the existing container rather than fail the request.
            return true;
        }
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

    /**
     * In-container agent storage root for tenant backends: a directory on the tenant's private,
     * disk-backed config mount, or `off` when the operator disabled the relocation on the control plane.
     */
    protected getTenantBackendAgentStorageRoot(): string {
        return QaapTenantAgentStorageEnv.isDisabled(process.env[QAAP_TENANT_AGENT_STORAGE_ROOT_ENV])
            ? 'off'
            : path.posix.join(TENANT_BACKEND_QAAP_HOME_MOUNT, QAAP_TENANT_AGENT_STORAGE_DIRNAME);
    }

    protected getTenantContainerHome(): string {
        return process.env.QAAP_TENANT_CONTAINER_HOME?.trim() || '/tmp/qaap-home';
    }

    protected getTenantNetworkMode(ownerLogin?: string): string {
        // `bridge` is deliberately not accepted: it is a shared Docker network and allows one
        // tenant worker to probe another worker. The isolated bridge stays internal; direct egress
        // uses a separate per-tenant bridge only when no allowlisting proxy is configured. `none`
        // disables all network access for deployments that do not need model/package downloads.
        const mode = process.env.QAAP_TENANT_NETWORK_MODE?.trim().toLowerCase() || 'isolated-bridge';
        if (mode === 'none') {
            return mode;
        }
        if (mode !== 'isolated-bridge') {
            throw new Error(`Unsafe or unsupported tenant network mode is not allowed: ${mode}. Use isolated-bridge or none.`);
        }
        return this.tenantNetworkNameFor(ownerLogin);
    }

    protected async ensureTenantNetwork(docker: Dockerode, networkName: string, ownerLogin?: string): Promise<void> {
        let existingNetwork: Dockerode.Network | undefined;
        let existingInspect: {
            Name?: string;
            Driver?: string;
            Internal?: boolean;
            Labels?: Record<string, string>;
            Options?: Record<string, string>;
        } | undefined;
        try {
            existingNetwork = docker.getNetwork(networkName);
            existingInspect = await existingNetwork.inspect();
        } catch (error) {
            if (!this.isDockerNotFound(error)) {
                throw error;
            }
        }
        if (existingNetwork && existingInspect) {
            if (!this.tenantNetworkMatches(existingInspect, networkName)) {
                throw new Error(`Tenant network ${networkName} has an unexpected isolation configuration; refusing to reuse it.`);
            }
            await this.ensureTenantEgressProxyAttached(docker, networkName, ownerLogin);
            return;
        }
        let network: Dockerode.Network;
        try {
            network = await docker.createNetwork({
                Name: networkName,
                Driver: 'bridge',
                Internal: true,
                CheckDuplicate: true,
                Labels: {
                    'com.qaap.managed': 'true',
                    'com.qaap.tenant-network': 'true',
                    'com.qaap.tenant-network-name': networkName,
                },
                // This bridge is internal and unique to one tenant. Its worker, backend, relay and
                // optional allowlist proxy need intra-tenant connectivity; Internal:true still blocks
                // their direct Internet egress, and no other tenant is attached to this bridge.
                Options: { 'com.docker.network.bridge.enable_icc': 'true' },
            });
        } catch (error) {
            this.warnIfTenantNetworkAddressPoolIsExhausted(networkName, error);
            if (!this.isDockerConflict(error)) {
                throw error;
            }
            // Another tenant operation won the create race. Inspect its network below and
            // accept it only if it has this tenant's complete isolation configuration.
            network = docker.getNetwork(networkName);
        }
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
        await this.ensureTenantEgressProxyAttached(docker, networkName, ownerLogin);
    }

    protected async ensureTenantDirectEgressNetwork(
        docker: Dockerode,
        networkName: string,
        ownerLogin?: string,
    ): Promise<void> {
        const tenantLogin = ownerLogin?.trim().toLowerCase() || '__anonymous__';
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
            if (!this.tenantDirectEgressNetworkMatches(inspect, networkName, tenantLogin)) {
                throw new Error(`Tenant direct egress network ${networkName} has an unexpected configuration.`);
            }
            return;
        } catch (error) {
            if (!this.isDockerNotFound(error)) {
                throw error;
            }
        }
        try {
            network = await docker.createNetwork({
                Name: networkName,
                Driver: 'bridge',
                Internal: false,
                CheckDuplicate: true,
                Labels: {
                    'com.qaap.managed': 'true',
                    'com.qaap.tenant-egress-network': 'true',
                    'com.qaap.tenant-login': tenantLogin,
                },
                Options: { 'com.docker.network.bridge.enable_icc': 'false' },
            });
        } catch (error) {
            this.warnIfTenantNetworkAddressPoolIsExhausted(networkName, error);
            if (!this.isDockerConflict(error)) {
                throw error;
            }
            // A concurrent backend or worker may already have created it. The common inspect
            // and match below validates Docker's network rather than trusting the conflict.
            network = docker.getNetwork(networkName);
        }
        const inspect = await network.inspect() as {
            Name?: string;
            Driver?: string;
            Internal?: boolean;
            Labels?: Record<string, string>;
            Options?: Record<string, string>;
        };
        if (!this.tenantDirectEgressNetworkMatches(inspect, networkName, tenantLogin)) {
            throw new Error(`Tenant direct egress network ${networkName} was not created with the required configuration.`);
        }
    }

    protected tenantDirectEgressNetworkMatches(
        network: {
            Name?: string;
            Driver?: string;
            Internal?: boolean;
            Labels?: Record<string, string>;
            Options?: Record<string, string>;
        },
        networkName: string,
        ownerLogin: string,
    ): boolean {
        return network.Name === networkName
            && network.Driver === 'bridge'
            && network.Internal === false
            && network.Labels?.['com.qaap.managed'] === 'true'
            && network.Labels?.['com.qaap.tenant-egress-network'] === 'true'
            && network.Labels?.['com.qaap.tenant-login'] === ownerLogin.toLowerCase()
            && network.Options?.['com.docker.network.bridge.enable_icc'] === 'false';
    }

    protected async ensureTenantIngressNetwork(docker: Dockerode, networkName: string, ownerLogin: string): Promise<void> {
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
            if (!this.tenantIngressNetworkMatches(inspect, networkName, ownerLogin)) {
                throw new Error(`Tenant ingress network ${networkName} has an unexpected configuration.`);
            }
            return;
        } catch (error) {
            if (!this.isDockerNotFound(error)) {
                throw error;
            }
        }
        try {
            network = await docker.createNetwork({
                Name: networkName,
                Driver: 'bridge',
                Internal: false,
                CheckDuplicate: true,
                Labels: {
                    'com.qaap.managed': 'true',
                    'com.qaap.tenant-ingress-network': 'true',
                    'com.qaap.tenant-login': ownerLogin.toLowerCase(),
                },
                Options: { 'com.docker.network.bridge.enable_icc': 'false' },
            });
        } catch (error) {
            this.warnIfTenantNetworkAddressPoolIsExhausted(networkName, error);
            throw error;
        }
        const inspect = await network.inspect() as {
            Name?: string;
            Driver?: string;
            Internal?: boolean;
            Labels?: Record<string, string>;
            Options?: Record<string, string>;
        };
        if (!this.tenantIngressNetworkMatches(inspect, networkName, ownerLogin)) {
            throw new Error(`Tenant ingress network ${networkName} was not created with the required configuration.`);
        }
    }

    protected tenantIngressNetworkMatches(
        network: {
            Name?: string;
            Driver?: string;
            Internal?: boolean;
            Labels?: Record<string, string>;
            Options?: Record<string, string>;
        },
        networkName: string,
        ownerLogin: string,
    ): boolean {
        return network.Name === networkName
            && network.Driver === 'bridge'
            && network.Internal === false
            && network.Labels?.['com.qaap.managed'] === 'true'
            && network.Labels?.['com.qaap.tenant-ingress-network'] === 'true'
            && network.Labels?.['com.qaap.tenant-login'] === ownerLogin.toLowerCase()
            && network.Options?.['com.docker.network.bridge.enable_icc'] === 'false';
    }

    protected tenantEgressProxyEnv(): Record<string, string> {
        if (!process.env.QAAP_TENANT_EGRESS_PROXY_IMAGE?.trim()) {
            return {};
        }
        const proxy = `http://${QAAP_TENANT_EGRESS_PROXY_ALIAS}:3128`;
        return {
            HTTP_PROXY: proxy,
            HTTPS_PROXY: proxy,
            http_proxy: proxy,
            https_proxy: proxy,
            NO_PROXY: 'localhost,127.0.0.1,::1',
            no_proxy: 'localhost,127.0.0.1,::1',
        };
    }

    protected tenantEgressProxyNameFor(ownerLogin?: string): string {
        const tenant = ownerLogin?.trim().toLowerCase() || '__anonymous__';
        const hash = crypto.createHash('sha256').update(`tenant-egress-proxy\u0000${tenant}`).digest('hex').slice(0, 12);
        return `qaap-egress-${hash}`;
    }

    protected async ensureTenantEgressProxyAttached(docker: Dockerode, networkName: string, ownerLogin?: string): Promise<void> {
        const image = process.env.QAAP_TENANT_EGRESS_PROXY_IMAGE?.trim();
        if (!image) {
            return;
        }
        const tenant = ownerLogin?.trim() || '__anonymous__';
        const proxyName = this.tenantEgressProxyNameFor(tenant);
        await this.ensureTenantEgressUplink(docker);
        let container: Dockerode.Container | undefined;
        let inspect: Dockerode.ContainerInspectInfo | undefined;
        try {
            container = docker.getContainer(proxyName);
            inspect = await container.inspect();
        } catch (error) {
            if (!this.isDockerNotFound(error)) {
                throw error;
            }
        }

        if (inspect && container) {
            const owned = this.isManagedTenantEgressProxyFor(inspect, tenant);
            const matches = owned
                && this.tenantEgressProxyMatches(inspect, tenant, networkName, image)
                && await this.tenantEgressProxyImageIsCurrent(docker, inspect, image);
            if (!matches) {
                if (!owned) {
                    throw new Error(`Tenant egress proxy ${proxyName} has an unexpected image, network, or security configuration.`);
                }
                console.warn(`[qaap-docker] Recreating stale tenant egress proxy ${proxyName}.`);
                await container.remove({ force: true });
                container = undefined;
                inspect = undefined;
            }
        }

        if (inspect && container) {
            if (!inspect.State?.Running) {
                await container.start();
            }
            const networks = (inspect as Dockerode.ContainerInspectInfo & {
                NetworkSettings?: { Networks?: Record<string, unknown> };
            }).NetworkSettings?.Networks ?? {};
            if (!networks[networkName]) {
                await docker.getNetwork(networkName).connect({
                    Container: proxyName,
                    EndpointConfig: { Aliases: [QAAP_TENANT_EGRESS_PROXY_ALIAS] },
                });
            }
            return;
        }

        container = await docker.createContainer({
            name: proxyName,
            Image: image,
            User: 'proxy',
            Cmd: ['squid', '-N', '-f', '/etc/squid/squid.conf'],
            Labels: {
                'com.qaap.managed': 'true',
                'com.qaap.tenant-egress-proxy': 'true',
                'com.qaap.tenant-login': tenant.toLowerCase(),
            },
            HostConfig: {
                // Attach the outbound network first so Squid keeps its default route there when
                // the isolated tenant interface is added next.
                NetworkMode: QAAP_TENANT_EGRESS_UPLINK,
                CapDrop: ['ALL'],
                SecurityOpt: ['no-new-privileges:true'],
                ReadonlyRootfs: true,
                Tmpfs: { '/tmp': 'rw,noexec,nosuid,nodev,size=16m' },
                AutoRemove: false,
            },
        });
        await docker.getNetwork(networkName).connect({
            Container: proxyName,
            EndpointConfig: { Aliases: [QAAP_TENANT_EGRESS_PROXY_ALIAS] },
        });
        await container.start();
    }

    protected isManagedTenantEgressProxyFor(inspect: Dockerode.ContainerInspectInfo, ownerLogin: string): boolean {
        const labels = (inspect as Dockerode.ContainerInspectInfo & {
            Config?: { Labels?: Record<string, string> };
        }).Config?.Labels ?? {};
        return labels['com.qaap.managed'] === 'true'
            && labels['com.qaap.tenant-egress-proxy'] === 'true'
            && labels['com.qaap.tenant-login'] === ownerLogin.toLowerCase();
    }

    protected async tenantEgressProxyImageIsCurrent(
        docker: Dockerode,
        inspect: Dockerode.ContainerInspectInfo,
        image: string,
    ): Promise<boolean> {
        const currentImage = await docker.getImage(image).inspect();
        return inspect.Image === currentImage.Id;
    }

    protected async ensureTenantEgressUplink(docker: Dockerode): Promise<Dockerode.Network> {
        let network: Dockerode.Network;
        try {
            network = docker.getNetwork(QAAP_TENANT_EGRESS_UPLINK);
            const inspect = await network.inspect() as {
                Name?: string;
                Driver?: string;
                Internal?: boolean;
                Labels?: Record<string, string>;
                Options?: Record<string, string>;
            };
            if (!this.tenantEgressUplinkMatches(inspect)) {
                throw new Error(`Tenant egress uplink ${QAAP_TENANT_EGRESS_UPLINK} has an unexpected configuration.`);
            }
            return network;
        } catch (error) {
            if (!this.isDockerNotFound(error)) {
                throw error;
            }
        }
        try {
            network = await docker.createNetwork({
                Name: QAAP_TENANT_EGRESS_UPLINK,
                Driver: 'bridge',
                Internal: false,
                CheckDuplicate: true,
                Labels: { 'com.qaap.managed': 'true', 'com.qaap.tenant-egress-uplink': 'true' },
                Options: { 'com.docker.network.bridge.enable_icc': 'false' },
            });
        } catch (error) {
            this.warnIfTenantNetworkAddressPoolIsExhausted(QAAP_TENANT_EGRESS_UPLINK, error);
            throw error;
        }
        const inspect = await network.inspect() as {
            Name?: string;
            Driver?: string;
            Internal?: boolean;
            Labels?: Record<string, string>;
            Options?: Record<string, string>;
        };
        if (!this.tenantEgressUplinkMatches(inspect)) {
            throw new Error(`Tenant egress uplink ${QAAP_TENANT_EGRESS_UPLINK} was not created with the required configuration.`);
        }
        return network;
    }

    protected tenantEgressUplinkMatches(network: {
        Name?: string;
        Driver?: string;
        Internal?: boolean;
        Labels?: Record<string, string>;
        Options?: Record<string, string>;
    }): boolean {
        return network.Name === QAAP_TENANT_EGRESS_UPLINK
            && network.Driver === 'bridge'
            && network.Internal === false
            && network.Labels?.['com.qaap.managed'] === 'true'
            && network.Labels?.['com.qaap.tenant-egress-uplink'] === 'true'
            && network.Options?.['com.docker.network.bridge.enable_icc'] === 'false';
    }

    protected tenantEgressProxyMatches(
        inspect: Dockerode.ContainerInspectInfo,
        ownerLogin: string,
        tenantNetwork: string,
        image: string,
    ): boolean {
        const raw = inspect as Dockerode.ContainerInspectInfo & {
            Config?: { User?: string; Image?: string; Cmd?: string[]; Labels?: Record<string, string> };
            HostConfig?: {
                NetworkMode?: string;
                CapDrop?: string[];
                SecurityOpt?: string[];
                ReadonlyRootfs?: boolean;
                Tmpfs?: Record<string, string>;
                Privileged?: boolean;
                PidMode?: string;
                IpcMode?: string;
            };
            NetworkSettings?: { Networks?: Record<string, { Aliases?: string[] } | undefined> };
        };
        const labels = raw.Config?.Labels ?? {};
        const host = raw.HostConfig ?? {};
        return labels['com.qaap.managed'] === 'true'
            && labels['com.qaap.tenant-egress-proxy'] === 'true'
            && labels['com.qaap.tenant-login'] === ownerLogin.toLowerCase()
            && raw.Config?.Image === image
            && raw.Config?.User === 'proxy'
            && raw.Config?.Cmd?.join('\u0000') === ['squid', '-N', '-f', '/etc/squid/squid.conf'].join('\u0000')
            && host.NetworkMode === QAAP_TENANT_EGRESS_UPLINK
            && host.CapDrop?.includes('ALL') === true
            && host.SecurityOpt?.includes('no-new-privileges:true') === true
            && host.ReadonlyRootfs === true
            && host.Tmpfs?.['/tmp'] === 'rw,noexec,nosuid,nodev,size=16m'
            && host.Privileged !== true
            && (!host.PidMode || host.PidMode === 'private')
            && (!host.IpcMode || host.IpcMode === 'private')
            && Object.keys(raw.NetworkSettings?.Networks ?? {}).length === 2
            && raw.NetworkSettings?.Networks?.[QAAP_TENANT_EGRESS_UPLINK] !== undefined
            && raw.NetworkSettings?.Networks?.[tenantNetwork]?.Aliases?.includes(QAAP_TENANT_EGRESS_PROXY_ALIAS) === true;
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
            && network.Internal === true
            && network.Labels?.['com.qaap.managed'] === 'true'
            && network.Labels?.['com.qaap.tenant-network'] === 'true'
            && network.Options?.['com.docker.network.bridge.enable_icc'] === 'true';
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
