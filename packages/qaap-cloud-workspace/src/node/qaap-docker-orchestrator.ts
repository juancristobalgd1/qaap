// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { FileUri } from '@theia/core/lib/node';
import * as crypto from 'crypto';
import * as path from 'path';
import * as Dockerode from 'dockerode';

const QAAP_CONTAINER_PREFIX = 'qaap-ws-';
const DEFAULT_IMAGE = process.env.QAAP_DOCKER_IMAGE?.trim() || 'node:20-bookworm';
const WORKSPACE_MOUNT = '/workspace';

export interface QaapDockerEnsureResult {
    readonly containerId: string;
    readonly containerName: string;
    readonly workspaceMount: string;
    readonly hostPath: string;
}

/** One Docker container per user+repo/workspace when `QAAP_CLOUD_MODE=docker`. */
@injectable()
export class QaapDockerOrchestrator {

    protected docker: Dockerode | undefined;

    isEnabled(): boolean {
        return (process.env.QAAP_CLOUD_MODE?.trim() || 'local') === 'docker';
    }

    protected async getDocker(): Promise<Dockerode> {
        if (!this.docker) {
            this.docker = new Dockerode({ socketPath: process.env.DOCKER_HOST || '/var/run/docker.sock' });
        }
        return this.docker;
    }

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
        } catch {
            container = await docker.createContainer({
                name,
                Image: DEFAULT_IMAGE,
                Tty: true,
                WorkingDir: WORKSPACE_MOUNT,
                Cmd: ['/bin/bash'],
                HostConfig: {
                    Binds: [`${hostPath}:${WORKSPACE_MOUNT}`],
                    AutoRemove: false,
                },
            });
            await container.start();
        }
        const inspect = await container.inspect();
        return {
            containerId: inspect.Id,
            containerName: name,
            workspaceMount: WORKSPACE_MOUNT,
            hostPath,
        };
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
        // Namespace containers by owner so two users opening the same repo never
        // share a container, filesystem mount or processes. Anonymous sessions get
        // their own bucket as well.
        const tenant = ownerLogin && ownerLogin.trim() ? ownerLogin.trim().toLowerCase() : '__anonymous__';
        const hash = crypto.createHash('sha256').update(`${tenant}\u0000${repoKey}`).digest('hex').slice(0, 12);
        return `${QAAP_CONTAINER_PREFIX}${hash}`;
    }

    /**
     * Stable, isolated container name for a tenant. All workspaces and tasks
     * for this user run inside this dedicated container.
     */
    containerNameForTenant(ownerLogin?: string): string {
        const tenant = ownerLogin && ownerLogin.trim() ? ownerLogin.trim().toLowerCase() : '__anonymous__';
        const hash = crypto.createHash('sha256').update(`tenant\u0000${tenant}`).digest('hex').slice(0, 12);
        return `qaap-tenant-${hash}`;
    }

    /** Ensure the dedicated tenant container exists and is running with resource limits. */
    async ensureTenantContainer(ownerLogin?: string, workspaceUri?: string): Promise<QaapDockerEnsureResult> {
        const name = this.containerNameForTenant(ownerLogin);
        const docker = await this.getDocker();
        const hostPath = workspaceUri ? this.hostPathFromUri(workspaceUri) : (process.env.NODE_ENV === 'production' ? '/workspace' : process.cwd());
        let container: Dockerode.Container;
        try {
            container = docker.getContainer(name);
            const info = await container.inspect();
            if (!info.State.Running) {
                await container.start();
            }
        } catch {
            const memoryLimit = this.getTenantMemoryLimit();
            const cpuLimit = this.getTenantCpuLimit();
            const pidsLimit = this.getTenantPidsLimit();
            const binds = [`${hostPath}:${WORKSPACE_MOUNT}`];

            container = await docker.createContainer({
                name,
                Image: this.getTenantImage(),
                Tty: true,
                OpenStdin: true,
                WorkingDir: WORKSPACE_MOUNT,
                Cmd: ['/bin/bash'],
                HostConfig: {
                    Binds: binds,
                    Memory: memoryLimit,
                    NanoCpus: cpuLimit,
                    PidsLimit: pidsLimit,
                    SecurityOpt: ['no-new-privileges:true'],
                    AutoRemove: false,
                },
            });
            await container.start();
        }
        const inspect = await container.inspect();
        return {
            containerId: inspect.Id,
            containerName: name,
            workspaceMount: WORKSPACE_MOUNT,
            hostPath,
        };
    }

    /** Stop a tenant's dedicated container. */
    async stopTenantContainer(ownerLogin?: string): Promise<void> {
        const docker = await this.getDocker();
        try {
            const container = docker.getContainer(this.containerNameForTenant(ownerLogin));
            await container.stop({ t: 10 });
        } catch {
            /* already stopped */
        }
    }

    /**
     * Wrap a command to execute inside the tenant's container via `docker exec`.
     */
    wrapShellForTenantContainer(ownerLogin: string | undefined, cwd: string, file: string, args: readonly string[]): { file: string; args: string[] } {
        const containerName = this.containerNameForTenant(ownerLogin);
        const containerCwd = this.toContainerPath(cwd);
        return {
            file: 'docker',
            args: ['exec', '-i', '-w', containerCwd, containerName, file, ...args],
        };
    }

    /**
     * Wrap an interactive shell (PTY) to attach to the tenant's container via `docker exec -it`.
     */
    wrapInteractiveTerminalForTenant(ownerLogin: string | undefined, cwd: string, file: string, args: readonly string[]): { file: string; args: string[] } {
        const containerName = this.containerNameForTenant(ownerLogin);
        const containerCwd = this.toContainerPath(cwd);
        return {
            file: 'docker',
            args: ['exec', '-it', '-w', containerCwd, containerName, file, ...args],
        };
    }

    protected toContainerPath(hostPath: string): string {
        if (hostPath.startsWith('/workspace')) {
            return hostPath;
        }
        return WORKSPACE_MOUNT;
    }

    protected getTenantMemoryLimit(): number {
        const raw = process.env.QAAP_TENANT_MEMORY_LIMIT?.trim();
        if (raw) {
            const num = Number.parseInt(raw, 10);
            if (!Number.isNaN(num) && num > 0) {
                return num;
            }
        }
        return 2 * 1024 * 1024 * 1024; // 2 GiB default
    }

    protected getTenantCpuLimit(): number {
        const raw = process.env.QAAP_TENANT_CPU_LIMIT?.trim();
        if (raw) {
            const num = Number.parseFloat(raw);
            if (!Number.isNaN(num) && num > 0) {
                return Math.floor(num * 1e9);
            }
        }
        return 2 * 1e9; // 2 cores default
    }

    protected getTenantPidsLimit(): number {
        const raw = process.env.QAAP_TENANT_PIDS_LIMIT?.trim();
        if (raw) {
            const num = Number.parseInt(raw, 10);
            if (!Number.isNaN(num) && num > 0) {
                return num;
            }
        }
        return 256; // 256 PIDs default
    }

    protected getTenantImage(): string {
        return process.env.QAAP_TENANT_DOCKER_IMAGE?.trim()
            || process.env.QAAP_THEIA_IMAGE?.trim()
            || DEFAULT_IMAGE;
    }

    protected hostPathFromUri(workspaceUri: string): string {
        if (workspaceUri.startsWith('file://')) {
            return FileUri.fsPath(workspaceUri);
        }
        return path.resolve(workspaceUri);
    }
}
