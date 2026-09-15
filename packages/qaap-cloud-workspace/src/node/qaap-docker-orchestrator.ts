// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { FileUri } from '@theia/core/lib/node';
import * as crypto from 'crypto';
import * as path from 'path';
import * as Dockerode from 'dockerode';
import {
    resolveQaapReposRoot,
    resolveQaapWorktreesRoot,
    resolveTenantIsolationRoot,
    safeUserIdSegment,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';

const QAAP_CONTAINER_PREFIX = 'qaap-ws-';
const DEFAULT_IMAGE = process.env.QAAP_DOCKER_IMAGE?.trim() || 'node:20-bookworm';
const WORKSPACE_MOUNT = '/workspace';

export interface QaapDockerEnsureResult {
    readonly containerId: string;
    readonly containerName: string;
    readonly workspaceMount: string;
    readonly hostPath: string;
}

/** One hardened worker container per tenant when `QAAP_CLOUD_MODE=docker`. */
@injectable()
export class QaapDockerOrchestrator {

    protected docker: Dockerode | undefined;
    /** Host-side tenant roots for containers validated during this backend lifetime. */
    protected readonly tenantRoots = new Map<string, string>();
    /** Prevent two first-use requests from racing into duplicate container creation. */
    protected readonly tenantEnsurePromises = new Map<string, Promise<QaapDockerEnsureResult>>();

    isEnabled(): boolean {
        const cloudMode = (process.env.QAAP_CLOUD_MODE?.trim() || 'local').toLowerCase();
        return cloudMode === 'docker' || /^(1|true)$/i.test(process.env.QAAP_TENANT_CONTAINER_ISOLATION?.trim() ?? '');
    }

    protected async getDocker(): Promise<Dockerode> {
        if (!this.docker) {
            const configured = process.env.DOCKER_HOST?.trim();
            if (configured?.startsWith('unix://')) {
                this.docker = new Dockerode({ socketPath: configured.slice('unix://'.length) });
            } else if (configured?.startsWith('npipe://')) {
                // Docker Desktop on Windows exposes its engine through a named pipe. Dockerode
                // expects the Win32 pipe path without the `npipe:` URI scheme.
                this.docker = new Dockerode({ socketPath: configured.slice('npipe://'.length) });
            } else if (configured?.startsWith('tcp://')) {
                const endpoint = new URL(configured);
                this.docker = new Dockerode({
                    host: endpoint.hostname,
                    port: Number.parseInt(endpoint.port || '2375', 10),
                });
            } else {
                this.docker = new Dockerode({
                    socketPath: configured || (process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock'),
                });
            }
        }
        return this.docker;
    }

    /** Legacy repo container API retained for compatibility with explicit callers. */
    async ensureContainer(repoKey: string, workspaceUri: string, ownerLogin?: string): Promise<QaapDockerEnsureResult> {
        const hostPath = this.hostPathFromUri(workspaceUri);
        const name = this.containerNameFor(repoKey, ownerLogin);
        const docker = await this.getDocker();
        let container: Dockerode.Container;
        try {
            container = docker.getContainer(name);
            const info = await container.inspect();
            if (!info.State.Running) {
                await container.start();
            }
        } catch (error) {
            if (!this.isDockerNotFound(error)) {
                throw error;
            }
            container = await docker.createContainer({
                name,
                Image: DEFAULT_IMAGE,
                Tty: true,
                WorkingDir: WORKSPACE_MOUNT,
                Cmd: ['/bin/bash'],
                HostConfig: {
                    Binds: [`${hostPath}:${WORKSPACE_MOUNT}:rw`],
                    AutoRemove: false,
                },
            });
            await container.start();
        }
        const inspect = await container.inspect();
        return { containerId: inspect.Id, containerName: name, workspaceMount: WORKSPACE_MOUNT, hostPath };
    }

    async stopContainer(repoKey: string, ownerLogin?: string): Promise<void> {
        const docker = await this.getDocker();
        try {
            const container = docker.getContainer(this.containerNameFor(repoKey, ownerLogin));
            await container.stop({ t: 10 });
        } catch {
            /* already stopped */
        }
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
        return this.tenantRoots.get(this.containerNameForTenant(ownerLogin)) === this.normalizeHostPath(tenantRootHostPath);
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
        if (ownerLogin?.trim()) {
            const expectedSegment = safeUserIdSegment(ownerLogin.trim()).toLowerCase();
            const actualSegment = path.basename(this.normalizeHostPath(tenantRootHostPath)).toLowerCase();
            if (actualSegment !== expectedSegment) {
                throw new Error(`Tenant identity ${ownerLogin} does not match the requested tenant root ${tenantRootHostPath}.`);
            }
        }
        const existing = this.tenantEnsurePromises.get(name);
        if (existing) {
            return existing;
        }
        const promise = this.createOrValidateTenantContainer(name, this.normalizeHostPath(tenantRootHostPath));
        this.tenantEnsurePromises.set(name, promise);
        try {
            return await promise;
        } finally {
            if (this.tenantEnsurePromises.get(name) === promise) {
                this.tenantEnsurePromises.delete(name);
            }
        }
    }

    protected async createOrValidateTenantContainer(name: string, hostPath: string): Promise<QaapDockerEnsureResult> {
        const docker = await this.getDocker();
        let container: Dockerode.Container;
        let inspect: Dockerode.ContainerInspectInfo;
        try {
            container = docker.getContainer(name);
            inspect = await container.inspect();
            if (!this.tenantContainerMatches(inspect, hostPath)) {
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
                },
                HostConfig: {
                    Binds: [`${hostPath}:${WORKSPACE_MOUNT}:rw`],
                    Memory: this.getTenantMemoryLimit(),
                    NanoCpus: this.getTenantCpuLimit(),
                    PidsLimit: this.getTenantPidsLimit(),
                    SecurityOpt: ['no-new-privileges:true'],
                    CapDrop: ['ALL'],
                    ReadonlyRootfs: true,
                    Tmpfs: { '/tmp': 'rw,nosuid,nodev,size=512m' },
                    NetworkMode: this.getTenantNetworkMode(),
                    AutoRemove: false,
                },
            });
            await container.start();
        }
        inspect = await container.inspect();
        if (!inspect.State.Running || !this.tenantContainerMatches(inspect, hostPath)) {
            throw new Error(`Tenant container ${name} did not start with the required isolated configuration.`);
        }
        this.tenantRoots.set(name, hostPath);
        return { containerId: inspect.Id, containerName: name, workspaceMount: WORKSPACE_MOUNT, hostPath };
    }

    async stopTenantContainer(ownerLogin?: string): Promise<void> {
        const docker = await this.getDocker();
        const name = this.containerNameForTenant(ownerLogin);
        try {
            const container = docker.getContainer(name);
            await container.stop({ t: 10 });
        } catch {
            /* already stopped */
        } finally {
            this.tenantRoots.delete(name);
        }
    }

    wrapShellForTenantContainer(ownerLogin: string | undefined, cwd: string, file: string, args: readonly string[], tenantRootHostPath?: string): { file: string; args: string[] } {
        const containerName = this.containerNameForTenant(ownerLogin);
        const containerCwd = this.toContainerPath(cwd, tenantRootHostPath ?? this.tenantRoots.get(containerName));
        return { file: 'docker', args: ['exec', '-i', '--user', this.getTenantContainerUser(), '-w', containerCwd, containerName, file, ...args] };
    }

    wrapInteractiveTerminalForTenant(ownerLogin: string | undefined, cwd: string, file: string, args: readonly string[], tenantRootHostPath?: string): { file: string; args: string[] } {
        const containerName = this.containerNameForTenant(ownerLogin);
        const containerCwd = this.toContainerPath(cwd, tenantRootHostPath ?? this.tenantRoots.get(containerName));
        return { file: 'docker', args: ['exec', '-it', '--user', this.getTenantContainerUser(), '-w', containerCwd, containerName, file, ...args] };
    }

    toContainerPath(hostPath: string, tenantRootHostPath?: string): string {
        const normalized = hostPath.replace(/\\/g, '/').replace(/\/$/, '');
        const root = tenantRootHostPath?.replace(/\\/g, '/').replace(/\/$/, '');
        if (!root) {
            throw new Error('Cannot translate a tenant cwd without the validated tenant mount root.');
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

    protected tenantContainerMatches(inspect: Dockerode.ContainerInspectInfo, hostPath: string): boolean {
        const raw = inspect as Dockerode.ContainerInspectInfo & {
            Config?: { User?: string; Image?: string; Labels?: Record<string, string> };
            HostConfig?: {
                Memory?: number;
                NanoCpus?: number;
                PidsLimit?: number | null;
                SecurityOpt?: string[];
                CapDrop?: string[];
                ReadonlyRootfs?: boolean;
                NetworkMode?: string;
                Privileged?: boolean;
                PidMode?: string;
                IpcMode?: string;
            };
            Mounts?: Array<{ Source?: string; Destination?: string; RW?: boolean }>;
        };
        const mount = raw.Mounts?.find(candidate => candidate.Destination === WORKSPACE_MOUNT);
        const hostConfig = raw.HostConfig ?? {};
        const labels = raw.Config?.Labels ?? {};
        return labels['com.qaap.managed'] === 'true'
            && labels['com.qaap.tenant-container'] === 'true'
            && raw.Config?.User === this.getTenantContainerUser()
            && raw.Config?.Image === this.getTenantImage()
            && this.normalizeHostPath(mount?.Source ?? '') === hostPath
            && raw.Mounts?.length === 1
            && mount?.RW === true
            && hostConfig.Memory === this.getTenantMemoryLimit()
            && hostConfig.NanoCpus === this.getTenantCpuLimit()
            && hostConfig.PidsLimit === this.getTenantPidsLimit()
            && hostConfig.SecurityOpt?.includes('no-new-privileges:true') === true
            && hostConfig.CapDrop?.includes('ALL') === true
            && hostConfig.ReadonlyRootfs === true
            && hostConfig.Privileged !== true
            // Docker Desktop reports the default IPC namespace as `private`; reject only
            // host/container namespace sharing, not the safe private default.
            && (!hostConfig.PidMode || hostConfig.PidMode === 'private')
            && (!hostConfig.IpcMode || hostConfig.IpcMode === 'private')
            && hostConfig.NetworkMode === this.getTenantNetworkMode();
    }

    protected isDockerNotFound(error: unknown): boolean {
        return (error as { statusCode?: number } | undefined)?.statusCode === 404;
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
        const uid = this.parsePositiveInteger(process.env.QAAP_TENANT_CONTAINER_UID, 1000);
        const gid = this.parsePositiveInteger(process.env.QAAP_TENANT_CONTAINER_GID, uid);
        return `${uid}:${gid}`;
    }

    protected getTenantContainerHome(): string {
        return process.env.QAAP_TENANT_CONTAINER_HOME?.trim() || '/tmp/qaap-home';
    }

    protected getTenantNetworkMode(): string {
        // Provider/model calls need egress by default. Deployments with an egress proxy or no network
        // may set a dedicated network or `none`; it remains part of the inspected contract.
        const mode = process.env.QAAP_TENANT_NETWORK_MODE?.trim() || 'bridge';
        if (mode === 'host' || mode.startsWith('container:')) {
            throw new Error(`Unsafe tenant network mode is not allowed: ${mode}`);
        }
        return mode;
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
