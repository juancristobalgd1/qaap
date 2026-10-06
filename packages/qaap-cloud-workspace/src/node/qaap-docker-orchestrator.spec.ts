// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import type * as Dockerode from 'dockerode';
import { QaapDockerOrchestrator } from './qaap-docker-orchestrator';

/**
 * Mirrors the internal `QaapTenantMountSet` shape (not exported from the production module).
 */
interface QaapTenantMountSet {
    readonly reposRoot: string;
    readonly worktreesRoot: string;
    readonly parallelRoot: string;
}

/**
 * `QaapDockerOrchestrator` intentionally exposes almost nothing publicly: the riskiest logic
 * (path translation, identity checks, hardening comparison) lives in `protected` members so that
 * only the class itself and, per the coding guidelines, subclasses can reach it. Rather than
 * weaken production encapsulation for tests, this file accesses those members through a narrow,
 * explicitly typed surface instead of `any`.
 */
interface QaapDockerOrchestratorTestAccess {
    docker: Dockerode | undefined;
    readonly tenantMounts: Map<string, QaapTenantMountSet>;
    tenantMountsForRoot(hostPath: string): QaapTenantMountSet;
    toContainerPath(hostPath: string, tenantRootHostPath?: string): string;
    dockerMountSource(hostPath: string, kind: 'repos' | 'worktrees' | 'parallel' | 'tenant-config'): string;
    tenantContainerMatches(inspect: Dockerode.ContainerInspectInfo, mounts: QaapTenantMountSet, networkMode: string): boolean;
    buildTenantEnvironmentArgs(environment?: NodeJS.ProcessEnv, inheritByName?: boolean): string[];
    getTenantNetworkMode(ownerLogin?: string): string;
    backendContainerNameForTenant(ownerLogin?: string): string;
    backendIngressNetworkNameForTenant(ownerLogin?: string): string;
    getTenantContainerUser(): string;
    getTenantImage(): string;
    getTenantMemoryLimit(): number;
    getTenantCpuLimit(): number;
    getTenantPidsLimit(): number;
    getTenantTmpfsOptions(): string;
    getTenantBackendAgentStorageRoot(): string;
    tenantEgressProxyEnv(): Record<string, string>;
    tenantNetworkMatches(network: { Name?: string; Driver?: string; Internal?: boolean; Labels?: Record<string, string>; Options?: Record<string, string> }, networkName: string): boolean;
    tenantDirectEgressNetworkNameFor(ownerLogin?: string): string;
    tenantDirectEgressNetworkMatches(network: { Name?: string; Driver?: string; Internal?: boolean; Labels?: Record<string, string>; Options?: Record<string, string> }, networkName: string, ownerLogin: string): boolean;
    tenantEgressProxyNameFor(ownerLogin?: string): string;
    tenantEgressProxyMatches(inspect: Dockerode.ContainerInspectInfo, ownerLogin: string, tenantNetwork: string, image: string): boolean;
    tenantEgressProxyImageIsCurrent(docker: Dockerode, inspect: Dockerode.ContainerInspectInfo, image: string): Promise<boolean>;
    ensureTenantNetwork(docker: Dockerode, networkName: string, ownerLogin?: string): Promise<void>;
    destroyTenantRuntime(ownerLogin: string): Promise<void>;
    verifiedDockerNodesForTenant(ownerLogin?: string): Promise<readonly { config: { id: string }; docker: Dockerode }[]>;
    normalizeHostPath(hostPath: string): string;
    runsCurrentTenantImage(docker: Dockerode, inspect: Dockerode.ContainerInspectInfo): Promise<boolean>;
    getDocker(ownerLogin?: string): Promise<Dockerode>;
    createOrValidateTenantContainer(name: string, mounts: QaapTenantMountSet, networkMode: string, ownerLogin?: string): Promise<unknown>;
    createOrValidateTenantBackend(ownerLogin: string, tenantRootHostPath: string): Promise<unknown>;
    containerNameForTenant(ownerLogin?: string): string;
    waitForTenantBackendReady(target: unknown): Promise<void>;
}

function access(instance: QaapDockerOrchestrator): QaapDockerOrchestratorTestAccess {
    return instance as unknown as QaapDockerOrchestratorTestAccess;
}

/** Mirrors the unexported mount-point constants in qaap-docker-orchestrator.ts. */
const WORKSPACE_MOUNT = '/workspace';
const WORKTREES_MOUNT = `${WORKSPACE_MOUNT}/.qaap-worktrees`;
const PARALLEL_MOUNT = `${WORKSPACE_MOUNT}/.qaap-parallel`;

/** A minimal, spying Dockerode stand-in. No test in this file touches a real Docker daemon. */
class FakeDockerode {
    readonly calls = { getContainer: 0, createContainer: 0, getNetwork: 0, createNetwork: 0 };

    getContainer(_name: string): unknown {
        this.calls.getContainer += 1;
        throw new Error('FakeDockerode.getContainer should not be called by this test.');
    }

    createContainer(_options: unknown): unknown {
        this.calls.createContainer += 1;
        throw new Error('FakeDockerode.createContainer should not be called by this test.');
    }

    getNetwork(_name: string): unknown {
        this.calls.getNetwork += 1;
        throw new Error('FakeDockerode.getNetwork should not be called by this test.');
    }
}

/**
 * Reports every container as missing, records the `createContainer` options, then stops the
 * flow at the post-start inspect so no test depends on a real daemon.
 */
class CreateCapturingDockerode {
    readonly created: Array<{ HostConfig?: Record<string, unknown>; Env?: string[]; User?: string; Healthcheck?: { Test?: string[] } }> = [];

    getContainer(_name: string): unknown {
        return { inspect: async () => { throw Object.assign(new Error('no such container'), { statusCode: 404 }); } };
    }

    async createContainer(options: { HostConfig?: Record<string, unknown>; Env?: string[]; User?: string; Healthcheck?: { Test?: string[] } }): Promise<unknown> {
        this.created.push(options);
        return {
            start: async () => undefined,
            inspect: async () => { throw new Error('CreateCapturingDockerode: stop after create'); },
        };
    }
}

interface FakePortBinding {
    HostIp?: string;
    HostPort?: string;
}

interface FakeBackendContainerInfo {
    Id: string;
    Image: string;
    State: { Running: boolean };
    Config: Record<string, unknown>;
    HostConfig: Record<string, unknown>;
    NetworkSettings: {
        Networks: Record<string, Record<string, unknown>>;
        Ports: Record<string, FakePortBinding[] | null>;
    };
    Mounts: Array<{ Source?: string; Destination?: string; RW?: boolean }>;
}

interface FakeNetworkInfo {
    Name: string;
    Driver: string;
    Internal: boolean;
    Labels: Record<string, string>;
    Options: Record<string, string>;
}

function createFakeTenantBackendDocker(): {
    readonly docker: Dockerode;
    readonly created: Array<{ readonly name: string; readonly options: Record<string, unknown>; readonly info: FakeBackendContainerInfo }>;
    readonly createdNetworks: FakeNetworkInfo[];
    readonly networks: ReadonlyMap<string, FakeNetworkInfo>;
    readonly networkDisconnects: Array<{ readonly networkName: string; readonly containerName: string }>;
    readonly networkConnections: Array<{ readonly networkName: string; readonly containerName: string; readonly container: FakeBackendContainerInfo }>;
    seedManagedBackend(name: string, networkName: string, ports: FakePortBinding[] | null): () => boolean;
    detachContainerFromNetwork(containerName: string, networkName: string): void;
    attachContainerToNetwork(containerName: string, networkName: string): void;
    conflictOnNextNetworkCreate(networkName: string): void;
} {
    const containers = new Map<string, FakeBackendContainerInfo>();
    const networks = new Map<string, FakeNetworkInfo>();
    const created: Array<{ readonly name: string; readonly options: Record<string, unknown>; readonly info: FakeBackendContainerInfo }> = [];
    const createdNetworks: FakeNetworkInfo[] = [];
    const networkDisconnects: Array<{ readonly networkName: string; readonly containerName: string }> = [];
    const networkConnections: Array<{ readonly networkName: string; readonly containerName: string; readonly container: FakeBackendContainerInfo }> = [];
    const networkCreateConflicts = new Set<string>();
    const missing = (): never => { throw Object.assign(new Error('no such object'), { statusCode: 404 }); };

    const containerHandle = (name: string): Record<string, unknown> => {
        const info = containers.get(name);
        if (!info) {
            return missing();
        }
        return {
            inspect: async (): Promise<FakeBackendContainerInfo> => info,
            start: async (): Promise<void> => { info.State.Running = true; },
            remove: async (): Promise<void> => { containers.delete(name); },
        };
    };

    const networkHandle = (name: string): Record<string, unknown> => {
        const info = networks.get(name);
        if (!info) {
            return missing();
        }
        return {
            inspect: async (): Promise<FakeNetworkInfo> => info,
            connect: async (options: { Container: string; EndpointConfig?: { Aliases?: string[] } }): Promise<void> => {
                const container = containers.get(options.Container);
                if (!container) {
                    throw new Error(`unknown container ${options.Container}`);
                }
                networkConnections.push({ networkName: name, containerName: options.Container, container });
                container.NetworkSettings.Networks[name] = options.EndpointConfig?.Aliases
                    ? { Aliases: options.EndpointConfig.Aliases }
                    : {};
            },
            disconnect: async (options: { Container: string }): Promise<void> => {
                const container = containers.get(options.Container);
                if (!container) {
                    throw new Error(`unknown container ${options.Container}`);
                }
                delete container.NetworkSettings.Networks[name];
                networkDisconnects.push({ networkName: name, containerName: options.Container });
            },
            remove: async (): Promise<void> => { networks.delete(name); },
        };
    };

    const docker = {
        getImage: (image: string) => ({ inspect: async () => ({ Id: image === 'qaap-tenant-egress:release' ? 'sha256:egress-image' : 'sha256:tenant-image' }) }),
        getContainer: (name: string) => containerHandle(name),
        getNetwork: (name: string) => networkHandle(name),
        createNetwork: async (options: Record<string, unknown>): Promise<Record<string, unknown>> => {
            const info: FakeNetworkInfo = {
                Name: String(options.Name),
                Driver: typeof options.Driver === 'string' ? options.Driver : 'bridge',
                Internal: options.Internal === true,
                Labels: (options.Labels as Record<string, string> | undefined) ?? {},
                Options: (options.Options as Record<string, string> | undefined) ?? {},
            };
            networks.set(info.Name, info);
            createdNetworks.push(info);
            if (networkCreateConflicts.delete(info.Name)) {
                throw Object.assign(new Error(`Conflict. network ${info.Name} already exists`), { statusCode: 409 });
            }
            return networkHandle(info.Name);
        },
        createContainer: async (options: Record<string, unknown>): Promise<Record<string, unknown>> => {
            const hostConfig = options.HostConfig as Record<string, unknown>;
            const primaryNetwork = String(hostConfig.NetworkMode);
            const network = networks.get(primaryNetwork);
            const exposedPorts = options.ExposedPorts as Record<string, unknown> | undefined;
            const portBindings = hostConfig.PortBindings as Record<string, FakePortBinding[]> | undefined;
            const ports: Record<string, FakePortBinding[] | null> = {};
            for (const port of Object.keys(exposedPorts ?? {})) {
                const bindings = portBindings?.[port];
                // Docker reports a null mapping when an exposed port is on an internal-only network.
                ports[port] = network?.Internal === true
                    ? null
                    : bindings?.map(binding => ({ HostIp: binding.HostIp, HostPort: '43123' })) ?? null;
            }
            const bindMounts = hostConfig.Binds as string[] | undefined;
            const image = String(options.Image);
            const info: FakeBackendContainerInfo = {
                Id: String(options.name ?? options.Name).startsWith('qaap-backend-') ? 'backend-id' : 'relay-id',
                Image: image === 'qaap-tenant-egress:release' ? 'sha256:egress-image' : 'sha256:tenant-image',
                State: { Running: false },
                Config: {
                    Image: options.Image,
                    User: options.User,
                    WorkingDir: options.WorkingDir,
                    Cmd: options.Cmd,
                    Env: options.Env,
                    Labels: options.Labels,
                    ExposedPorts: options.ExposedPorts,
                },
                HostConfig: { ...hostConfig, PidMode: 'private', IpcMode: 'private' },
                NetworkSettings: { Networks: { [primaryNetwork]: {} }, Ports: ports },
                Mounts: (bindMounts ?? []).map(bind => {
                    // Parse from the right: Windows host paths (C:\\...) contain a colon of their own.
                    const parts = bind.split(':');
                    const last = parts[parts.length - 1];
                    const mode = parts.length > 2 && /^(ro|rw)(,|$)/.test(last) ? parts.pop() : undefined;
                    const Destination = parts.pop();
                    const Source = parts.join(':');
                    return { Source, Destination, RW: mode === undefined || !mode.startsWith('ro') };
                }),
            };
            // Dockerode takes the container name as lowercase `name`; accept `Name` for older call sites.
            const name = String(options.name ?? options.Name);
            if (name.startsWith('qaap-tenant-')) {
                info.Id = `worker-${name}`;
            } else if (name.startsWith('qaap-ingress-')) {
                info.Id = `relay-${name}`;
            } else if (name.startsWith('qaap-egress-')) {
                info.Id = `proxy-${name}`;
            }
            if (containers.has(name)) {
                // Docker refuses to create a container whose name is still taken.
                throw Object.assign(new Error(`Conflict. The container name "/${name}" is already in use`), { statusCode: 409 });
            }
            containers.set(name, info);
            created.push({ name, options, info });
            return containerHandle(name);
        },
    } as unknown as Dockerode;

    return {
        docker,
        created,
        createdNetworks,
        networks,
        networkDisconnects,
        networkConnections,
        seedManagedBackend: (name, networkName, ports): (() => boolean) => {
            containers.set(name, {
                Id: 'stale-backend-id',
                Image: 'sha256:old-image',
                State: { Running: true },
                Config: {
                    Labels: {
                        'com.qaap.managed': 'true',
                        'com.qaap.tenant-backend': 'true',
                        'com.qaap.tenant-login': 'alice',
                    },
                },
                HostConfig: { NetworkMode: networkName },
                NetworkSettings: { Networks: { [networkName]: {} }, Ports: { '4873/tcp': ports } },
                Mounts: [],
            });
            // The replacement reuses the same name, so check the stale container itself is gone.
            return () => containers.get(name)?.Id !== 'stale-backend-id';
        },
        detachContainerFromNetwork: (containerName, networkName): void => {
            const container = containers.get(containerName);
            if (container) {
                delete container.NetworkSettings.Networks[networkName];
            }
        },
        attachContainerToNetwork: (containerName, networkName): void => {
            const container = containers.get(containerName);
            if (container) {
                container.NetworkSettings.Networks[networkName] = {};
            }
        },
        conflictOnNextNetworkCreate: (networkName): void => { networkCreateConflicts.add(networkName); },
    };
}

const ENV_KEYS = [
    'NODE_ENV',
    'QAAP_CLOUD_MODE',
    'QAAP_TENANT_CONTAINER_ISOLATION',
    'QAAP_REPOS_ROOT',
    'QAAP_TENANT_DOCKER_IMAGE',
    'QAAP_THEIA_IMAGE',
    'QAAP_DOCKER_REMOTE_REPOS_ROOT',
    'QAAP_DOCKER_REMOTE_WORKTREES_ROOT',
    'QAAP_DOCKER_REMOTE_PARALLEL_ROOT',
    'QAAP_DOCKER_NODES',
    'QAAP_DOCKER_PUBLISH_HOST_IP',
    'QAAP_TENANT_NETWORK_MODE',
    'QAAP_TENANT_MEMORY_LIMIT',
    'QAAP_TENANT_CPU_LIMIT',
    'QAAP_TENANT_PIDS_LIMIT',
    'QAAP_TENANT_MEMORY_LIMIT_OVERRIDES',
    'QAAP_TENANT_CPU_LIMIT_OVERRIDES',
    'QAAP_TENANT_MEMORY_LIMIT_MAX',
    'QAAP_TENANT_CPU_LIMIT_MAX',
    'QAAP_TENANT_PIDS_LIMIT_OVERRIDES',
    'QAAP_TENANT_PIDS_LIMIT_MAX',
    'QAAP_TENANT_TMPFS_SIZE',
    'QAAP_TENANT_AGENT_STORAGE_ROOT',
    'QAAP_TENANT_CONFIG_ROOT',
    'QAAP_TENANT_BACKEND_MASTER_SECRET',
    'QAAP_BACKEND_PER_TENANT',
    'QAAP_TENANT_EGRESS_PROXY_IMAGE',
    'QAAP_TENANT_CONTAINER_UID',
    'QAAP_TENANT_CONTAINER_GID',
    'QAAP_DOCKER_ROOTLESS',
    'DOCKER_HOST',
] as const;

type EnvKey = typeof ENV_KEYS[number];

describe('QaapDockerOrchestrator', () => {

    let snapshot: Partial<Record<EnvKey, string | undefined>>;

    beforeEach(() => {
        snapshot = {};
        for (const key of ENV_KEYS) {
            snapshot[key] = process.env[key];
        }
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            const value = snapshot[key];
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    describe('tenantMountsForRoot', () => {

        it('derives all three roots from the tenant segment', () => {
            const reposRootTmp = path.join(os.tmpdir(), 'qaap-orchestrator-spec-repos');
            process.env.QAAP_REPOS_ROOT = reposRootTmp;
            const orchestrator = access(new QaapDockerOrchestrator());

            const mounts = orchestrator.tenantMountsForRoot(path.join(reposRootTmp, 'users', 'alice'));

            expect(mounts.reposRoot).to.equal(orchestrator.normalizeHostPath(path.join(reposRootTmp, 'users', 'alice')));
            expect(mounts.worktreesRoot).to.equal(orchestrator.normalizeHostPath(path.join(os.tmpdir(), 'qaap-worktrees', 'alice')));
            expect(mounts.parallelRoot).to.equal(orchestrator.normalizeHostPath(path.join(os.tmpdir(), 'qaap-parallel', 'alice')));
        });

        it('produces nothing outside the tenant segment for a sibling-looking login', () => {
            const reposRootTmp = path.join(os.tmpdir(), 'qaap-orchestrator-spec-repos');
            process.env.QAAP_REPOS_ROOT = reposRootTmp;
            const orchestrator = access(new QaapDockerOrchestrator());

            const alice = orchestrator.tenantMountsForRoot(path.join(reposRootTmp, 'users', 'alice'));
            const aliceEvil = orchestrator.tenantMountsForRoot(path.join(reposRootTmp, 'users', 'alice-evil'));

            // Naive string prefix checks would wrongly treat "alice-evil" as being inside "alice"
            // (it shares the raw string prefix); the two must be distinct sibling directories with
            // neither being a path-separator-bounded ancestor of the other.
            expect(aliceEvil.reposRoot).not.to.equal(alice.reposRoot);
            expect(path.relative(alice.reposRoot, aliceEvil.reposRoot).startsWith('..')).to.equal(true);
            expect(path.relative(aliceEvil.reposRoot, alice.reposRoot).startsWith('..')).to.equal(true);
        });

        it('is insensitive to a trailing separator or backslashes in the input', () => {
            const reposRootTmp = path.join(os.tmpdir(), 'qaap-orchestrator-spec-repos');
            process.env.QAAP_REPOS_ROOT = reposRootTmp;
            const orchestrator = access(new QaapDockerOrchestrator());

            const plain = orchestrator.tenantMountsForRoot(path.join(reposRootTmp, 'users', 'alice'));
            const withSlash = orchestrator.tenantMountsForRoot(`${path.join(reposRootTmp, 'users', 'alice')}${path.sep}`);
            const withBackslashes = orchestrator.tenantMountsForRoot(`${reposRootTmp}\\users\\alice`);

            expect(withSlash.reposRoot).to.equal(plain.reposRoot);
            expect(withBackslashes.reposRoot).to.equal(plain.reposRoot);
        });

        it('refuses a root with no derivable tenant segment', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            expect(() => orchestrator.tenantMountsForRoot('/')).to.throw(/Cannot derive a tenant segment/);
        });
    });

    describe('toContainerPath', () => {

        function registerMounts(orchestrator: QaapDockerOrchestratorTestAccess, containerName: string, mounts: QaapTenantMountSet): void {
            orchestrator.tenantMounts.set(containerName, mounts);
        }

        const mounts: QaapTenantMountSet = {
            reposRoot: '/data/tenants/alice/repos',
            worktreesRoot: '/data/tenants/alice/worktrees',
            parallelRoot: '/data/tenants/alice/parallel',
        };

        it('maps the repos root itself to the workspace mount', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            registerMounts(orchestrator, 'containerA', mounts);

            expect(orchestrator.toContainerPath(mounts.reposRoot, mounts.reposRoot)).to.equal(WORKSPACE_MOUNT);
        });

        it('maps a nested repos path under the workspace mount', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            registerMounts(orchestrator, 'containerA', mounts);

            expect(orchestrator.toContainerPath(`${mounts.reposRoot}/src/index.ts`, mounts.reposRoot)).to.equal(`${WORKSPACE_MOUNT}/src/index.ts`);
        });

        it('maps a nested worktrees path under the worktrees mount, keyed off any validated root', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            registerMounts(orchestrator, 'containerA', mounts);

            // The root argument only needs to belong to *a* validated mount set; the mount picked
            // for translation is whichever of the tenant's three roots the host path falls under.
            expect(orchestrator.toContainerPath(`${mounts.worktreesRoot}/wt1`, mounts.reposRoot)).to.equal(`${WORKTREES_MOUNT}/wt1`);
        });

        it('maps a nested parallel-run path under the parallel mount', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            registerMounts(orchestrator, 'containerA', mounts);

            expect(orchestrator.toContainerPath(`${mounts.parallelRoot}/run1/variant-a`, mounts.reposRoot)).to.equal(`${PARALLEL_MOUNT}/run1/variant-a`);
        });

        it('translates a Windows-style host path under a Windows-style tenant root', () => {
            const winMounts: QaapTenantMountSet = {
                reposRoot: 'C:\\data\\tenants\\alice\\repos',
                worktreesRoot: 'C:\\data\\tenants\\alice\\worktrees',
                parallelRoot: 'C:\\data\\tenants\\alice\\parallel',
            };
            const orchestrator = access(new QaapDockerOrchestrator());
            registerMounts(orchestrator, 'containerB', winMounts);

            expect(orchestrator.toContainerPath('C:\\data\\tenants\\alice\\repos\\src\\index.ts', winMounts.reposRoot))
                .to.equal(`${WORKSPACE_MOUNT}/src/index.ts`);
        });

        it('refuses a sibling directory whose name merely starts with the tenant segment', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            registerMounts(orchestrator, 'containerA', mounts);

            // "alice-evil" is not a path *inside* "alice"; the prefix comparison must require the
            // separator, not just a shared string prefix.
            expect(() => orchestrator.toContainerPath('/data/tenants/alice-evil/secret', mounts.reposRoot))
                .to.throw(/outside the validated tenant mounts/);
        });

        it('refuses a relative path', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            registerMounts(orchestrator, 'containerA', mounts);

            expect(() => orchestrator.toContainerPath('relative/path/secret.txt', mounts.reposRoot))
                .to.throw(/outside the validated tenant mounts/);
        });

        it('refuses translation without a validated tenant root at all', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            expect(() => orchestrator.toContainerPath('/data/tenants/alice/repos/src'))
                .to.throw(/without the validated tenant mount root/);
        });

        // Regression: `<reposRoot>/../x` string-starts-with `<reposRoot>/` and used to be emitted as
        // `/workspace/../x`, escaping the mount once `docker exec -w` resolved it.
        it('refuses a `..` traversal that escapes the tenant repos root', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            registerMounts(orchestrator, 'containerA', mounts);

            expect(() => orchestrator.toContainerPath(`${mounts.reposRoot}/../alice-evil/secret`, mounts.reposRoot))
                .to.throw(/outside the validated tenant mounts/);
            expect(() => orchestrator.toContainerPath(`${mounts.reposRoot}\\..\\..\\bob\\repos`, mounts.reposRoot))
                .to.throw(/outside the validated tenant mounts/);
        });

        it('refuses a `..` traversal in the direct-root fallback branch', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            expect(() => orchestrator.toContainerPath('/data/tenants/alice/repos/../../bob/repos', '/data/tenants/alice/repos'))
                .to.throw(/outside its mounted tenant root/);
        });

        it('still translates an in-tenant path that contains a harmless `..`', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            registerMounts(orchestrator, 'containerA', mounts);

            expect(orchestrator.toContainerPath(`${mounts.reposRoot}/src/../lib/a.js`, mounts.reposRoot))
                .to.equal(`${WORKSPACE_MOUNT}/lib/a.js`);
        });
    });

    describe('dockerMountSource', () => {

        it('returns the host path unchanged when no remote Docker root is configured', () => {
            const reposRootTmp = path.join(os.tmpdir(), 'qaap-orchestrator-spec-repos');
            process.env.QAAP_REPOS_ROOT = reposRootTmp;
            const orchestrator = access(new QaapDockerOrchestrator());
            const hostPath = path.join(reposRootTmp, 'users', 'alice');

            expect(orchestrator.dockerMountSource(hostPath, 'repos')).to.equal(orchestrator.normalizeHostPath(hostPath));
        });

        it('rewrites a host path under the local root to the remote Docker node root', () => {
            const reposRootTmp = path.join(os.tmpdir(), 'qaap-orchestrator-spec-repos');
            process.env.QAAP_REPOS_ROOT = reposRootTmp;
            process.env.QAAP_DOCKER_REMOTE_REPOS_ROOT = '/mnt/remote/repos';
            const orchestrator = access(new QaapDockerOrchestrator());
            const hostPath = path.join(reposRootTmp, 'users', 'alice');

            expect(orchestrator.dockerMountSource(hostPath, 'repos')).to.equal('/mnt/remote/repos/users/alice');
        });

        it('rejects the local root itself once a remote root is configured (empty relative path)', () => {
            const reposRootTmp = path.join(os.tmpdir(), 'qaap-orchestrator-spec-repos');
            process.env.QAAP_REPOS_ROOT = reposRootTmp;
            process.env.QAAP_DOCKER_REMOTE_REPOS_ROOT = '/mnt/remote/repos';
            const orchestrator = access(new QaapDockerOrchestrator());

            expect(() => orchestrator.dockerMountSource(reposRootTmp, 'repos')).to.throw(/outside the configured repos root/);
        });

        it('rejects a host path outside the local root (relative starts with ..)', () => {
            const reposRootTmp = path.join(os.tmpdir(), 'qaap-orchestrator-spec-repos');
            process.env.QAAP_REPOS_ROOT = reposRootTmp;
            process.env.QAAP_DOCKER_REMOTE_REPOS_ROOT = '/mnt/remote/repos';
            const orchestrator = access(new QaapDockerOrchestrator());

            expect(() => orchestrator.dockerMountSource(path.join(os.tmpdir(), 'somewhere-else'), 'repos'))
                .to.throw(/outside the configured repos root/);
        });

        it('rejects an absolute-looking relative escape via a sibling directory', () => {
            const reposRootTmp = path.join(os.tmpdir(), 'qaap-orchestrator-spec-repos');
            process.env.QAAP_REPOS_ROOT = reposRootTmp;
            process.env.QAAP_DOCKER_REMOTE_REPOS_ROOT = '/mnt/remote/repos';
            const orchestrator = access(new QaapDockerOrchestrator());

            expect(() => orchestrator.dockerMountSource(`${reposRootTmp}-evil`, 'repos'))
                .to.throw(/outside the configured repos root/);
        });

        it('translates the fixed tmpdir-based worktrees root the same way', () => {
            process.env.QAAP_DOCKER_REMOTE_WORKTREES_ROOT = '/mnt/remote/worktrees';
            const orchestrator = access(new QaapDockerOrchestrator());
            const hostPath = path.join(os.tmpdir(), 'qaap-worktrees', 'alice', 'wt1');

            expect(orchestrator.dockerMountSource(hostPath, 'worktrees')).to.equal('/mnt/remote/worktrees/alice/wt1');
        });

        it('requires an absolute remote root', () => {
            const reposRootTmp = path.join(os.tmpdir(), 'qaap-orchestrator-spec-repos');
            process.env.QAAP_REPOS_ROOT = reposRootTmp;
            process.env.QAAP_DOCKER_REMOTE_REPOS_ROOT = 'relative/remote/repos';
            const orchestrator = access(new QaapDockerOrchestrator());
            const hostPath = path.join(reposRootTmp, 'users', 'alice');

            expect(() => orchestrator.dockerMountSource(hostPath, 'repos')).to.throw(/must be an absolute path/);
        });
    });

    describe('tenantContainerMatches', () => {

        const mounts: QaapTenantMountSet = {
            reposRoot: '/data/tenants/alice/repos',
            worktreesRoot: '/data/tenants/alice/worktrees',
            parallelRoot: '/data/tenants/alice/parallel',
        };
        const networkMode = 'qaap-net-alice';

        function buildMatchingInspect(orchestrator: QaapDockerOrchestratorTestAccess): Dockerode.ContainerInspectInfo {
            return {
                Config: {
                    User: orchestrator.getTenantContainerUser(),
                    Image: orchestrator.getTenantImage(),
                    Env: Object.entries(orchestrator.tenantEgressProxyEnv()).map(([key, value]) => `${key}=${value}`),
                    Labels: {
                        'com.qaap.managed': 'true',
                        'com.qaap.tenant-container': 'true',
                    },
                },
                HostConfig: {
                    Memory: orchestrator.getTenantMemoryLimit(),
                    NanoCpus: orchestrator.getTenantCpuLimit(),
                    PidsLimit: orchestrator.getTenantPidsLimit(),
                    SecurityOpt: ['no-new-privileges:true'],
                    CapDrop: ['ALL'],
                    ReadonlyRootfs: true,
                    Tmpfs: { '/tmp': 'rw,exec,nosuid,nodev,size=512m' },
                    NetworkMode: networkMode,
                    Privileged: false,
                },
                Mounts: [
                    { Source: orchestrator.dockerMountSource(mounts.reposRoot, 'repos'), Destination: WORKSPACE_MOUNT, RW: true },
                    { Source: orchestrator.dockerMountSource(mounts.worktreesRoot, 'worktrees'), Destination: WORKTREES_MOUNT, RW: true },
                    { Source: orchestrator.dockerMountSource(mounts.parallelRoot, 'parallel'), Destination: PARALLEL_MOUNT, RW: true },
                ],
                NetworkSettings: { Networks: { [networkMode]: {} } },
            } as unknown as Dockerode.ContainerInspectInfo;
        }

        function withPatchedHostConfig(
            inspect: Dockerode.ContainerInspectInfo,
            patch: Record<string, unknown>,
        ): Dockerode.ContainerInspectInfo {
            const raw = inspect as unknown as { HostConfig: Record<string, unknown> };
            return { ...inspect, HostConfig: { ...raw.HostConfig, ...patch } } as unknown as Dockerode.ContainerInspectInfo;
        }

        beforeEach(() => {
            process.env.QAAP_TENANT_DOCKER_IMAGE = 'qaap-tenant-test-image:latest';
        });

        it('matches an exactly-configured container', () => {
            process.env.QAAP_TENANT_NETWORK_MODE = 'none';
            const orchestrator = access(new QaapDockerOrchestrator());
            const inspect = buildMatchingInspect(orchestrator);

            expect(orchestrator.tenantContainerMatches(inspect, mounts, networkMode)).to.equal(true);
        });

        it('rejects a container missing the CapDrop:ALL hardening flag', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const inspect = withPatchedHostConfig(buildMatchingInspect(orchestrator), { CapDrop: [] });

            expect(orchestrator.tenantContainerMatches(inspect, mounts, networkMode)).to.equal(false);
        });

        it('rejects a container missing no-new-privileges in SecurityOpt', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const inspect = withPatchedHostConfig(buildMatchingInspect(orchestrator), { SecurityOpt: [] });

            expect(orchestrator.tenantContainerMatches(inspect, mounts, networkMode)).to.equal(false);
        });

        it('rejects a container with a writable root filesystem', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const inspect = withPatchedHostConfig(buildMatchingInspect(orchestrator), { ReadonlyRootfs: false });

            expect(orchestrator.tenantContainerMatches(inspect, mounts, networkMode)).to.equal(false);
        });

        it('rejects a container with a higher memory limit than configured', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const inspect = withPatchedHostConfig(buildMatchingInspect(orchestrator), { Memory: orchestrator.getTenantMemoryLimit() + 1 });

            expect(orchestrator.tenantContainerMatches(inspect, mounts, networkMode)).to.equal(false);
        });

        it('expects the per-login raised limits only for that login', () => {
            process.env.QAAP_TENANT_NETWORK_MODE = 'none';
            process.env.QAAP_TENANT_MEMORY_LIMIT = String(4 * 1024 ** 3);
            process.env.QAAP_TENANT_MEMORY_LIMIT_OVERRIDES = 'Alice=12g';
            process.env.QAAP_TENANT_CPU_LIMIT_OVERRIDES = 'alice=4';
            const orchestrator = access(new QaapDockerOrchestrator());
            const withLogin = (login: string, memory: number, cpus: number): Dockerode.ContainerInspectInfo => {
                const inspect = withPatchedHostConfig(buildMatchingInspect(orchestrator), { Memory: memory, NanoCpus: cpus });
                const raw = inspect as unknown as { Config: { Labels: Record<string, string> } };
                raw.Config.Labels = { ...raw.Config.Labels, 'com.qaap.tenant-login': login };
                return inspect;
            };

            expect(orchestrator.tenantContainerMatches(withLogin('alice', 12 * 1024 ** 3, 4e9), mounts, networkMode)).to.equal(true);
            expect(orchestrator.tenantContainerMatches(withLogin('alice', 4 * 1024 ** 3, 2e9), mounts, networkMode)).to.equal(false);
            expect(orchestrator.tenantContainerMatches(withLogin('bob', 4 * 1024 ** 3, 2e9), mounts, networkMode)).to.equal(true);
            expect(orchestrator.tenantContainerMatches(withLogin('bob', 12 * 1024 ** 3, 4e9), mounts, networkMode)).to.equal(false);
        });

        it('rejects a container with a different CPU limit', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const inspect = withPatchedHostConfig(buildMatchingInspect(orchestrator), { NanoCpus: orchestrator.getTenantCpuLimit() + 1 });

            expect(orchestrator.tenantContainerMatches(inspect, mounts, networkMode)).to.equal(false);
        });

        it('rejects a container with a different pids limit', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const inspect = withPatchedHostConfig(buildMatchingInspect(orchestrator), { PidsLimit: orchestrator.getTenantPidsLimit() + 1 });

            expect(orchestrator.tenantContainerMatches(inspect, mounts, networkMode)).to.equal(false);
        });

        it('rejects a container attached to a different network mode', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const inspect = withPatchedHostConfig(buildMatchingInspect(orchestrator), { NetworkMode: 'bridge' });

            expect(orchestrator.tenantContainerMatches(inspect, mounts, networkMode)).to.equal(false);
        });

        it('rejects a tenant container that has another network attached for direct egress', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const matching = buildMatchingInspect(orchestrator);
            const inspect = {
                ...matching,
                NetworkSettings: { Networks: { [networkMode]: {}, bridge: {} } },
            } as unknown as Dockerode.ContainerInspectInfo;

            expect(orchestrator.tenantContainerMatches(inspect, mounts, networkMode)).to.equal(false);
        });

        it('rejects a privileged container', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const inspect = withPatchedHostConfig(buildMatchingInspect(orchestrator), { Privileged: true });

            expect(orchestrator.tenantContainerMatches(inspect, mounts, networkMode)).to.equal(false);
        });

        it('rejects a container sharing the host PID namespace', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const inspect = withPatchedHostConfig(buildMatchingInspect(orchestrator), { PidMode: 'host' });

            expect(orchestrator.tenantContainerMatches(inspect, mounts, networkMode)).to.equal(false);
        });

        it('rejects a container sharing the host IPC namespace', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const inspect = withPatchedHostConfig(buildMatchingInspect(orchestrator), { IpcMode: 'host' });

            expect(orchestrator.tenantContainerMatches(inspect, mounts, networkMode)).to.equal(false);
        });

        it('rejects a container missing the qaap-managed labels', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const matching = buildMatchingInspect(orchestrator);
            const raw = matching as unknown as { Config: { Labels: Record<string, string> } };
            const inspect = { ...matching, Config: { ...raw.Config, Labels: {} } } as unknown as Dockerode.ContainerInspectInfo;

            expect(orchestrator.tenantContainerMatches(inspect, mounts, networkMode)).to.equal(false);
        });

        it('rejects a container missing one of the three tenant mounts', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const matching = buildMatchingInspect(orchestrator);
            const raw = matching as unknown as { Mounts: unknown[] };
            const inspect = { ...matching, Mounts: raw.Mounts.slice(0, 2) } as unknown as Dockerode.ContainerInspectInfo;

            expect(orchestrator.tenantContainerMatches(inspect, mounts, networkMode)).to.equal(false);
        });

        it('rejects a container whose repos mount points at another tenant root', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const matching = buildMatchingInspect(orchestrator);
            const raw = matching as unknown as { Mounts: Array<{ Source?: string; Destination?: string; RW?: boolean }> };
            const tampered = raw.Mounts.map(mount => mount.Destination === WORKSPACE_MOUNT
                ? { ...mount, Source: orchestrator.dockerMountSource('/data/tenants/alice-evil/repos', 'repos') }
                : mount);
            const inspect = { ...matching, Mounts: tampered } as unknown as Dockerode.ContainerInspectInfo;

            expect(orchestrator.tenantContainerMatches(inspect, mounts, networkMode)).to.equal(false);
        });
    });

    describe('ensureTenantContainer', () => {

        it('rejects an owner login whose segment does not match the requested tenant root before touching Docker', async () => {
            process.env.QAAP_CLOUD_MODE = 'docker';
            process.env.QAAP_TENANT_CONTAINER_ISOLATION = '1';
            const orchestrator = new QaapDockerOrchestrator();
            const fakeDocker = new FakeDockerode();
            access(orchestrator).docker = fakeDocker as unknown as Dockerode;

            let thrown: unknown;
            try {
                await orchestrator.ensureTenantContainer('alice', '/data/tenants/bob');
            } catch (error) {
                thrown = error;
            }

            expect(thrown).to.be.instanceOf(Error);
            expect((thrown as Error).message).to.match(/does not match the requested tenant root/);
            expect(fakeDocker.calls.getContainer).to.equal(0);
            expect(fakeDocker.calls.createContainer).to.equal(0);
            expect(fakeDocker.calls.getNetwork).to.equal(0);
        });

        it('refuses to operate outside docker/container-isolation mode at all', async () => {
            delete process.env.QAAP_CLOUD_MODE;
            delete process.env.QAAP_TENANT_CONTAINER_ISOLATION;
            const orchestrator = new QaapDockerOrchestrator();
            const fakeDocker = new FakeDockerode();
            access(orchestrator).docker = fakeDocker as unknown as Dockerode;

            let thrown: unknown;
            try {
                await orchestrator.ensureTenantContainer('alice', '/data/tenants/alice');
            } catch (error) {
                thrown = error;
            }

            expect(thrown).to.be.instanceOf(Error);
            expect((thrown as Error).message).to.match(/requires QAAP_CLOUD_MODE=docker/);
            expect(fakeDocker.calls.getContainer).to.equal(0);
        });
    });

    describe('tenant container create options', () => {

        async function captureCreate(run: (orchestrator: QaapDockerOrchestratorTestAccess) => Promise<unknown>): Promise<CreateCapturingDockerode> {
            const orchestrator = access(new QaapDockerOrchestrator());
            const fakeDocker = new CreateCapturingDockerode();
            orchestrator.getDocker = async () => fakeDocker as unknown as Dockerode;
            let thrown: unknown;
            try {
                await run(orchestrator);
            } catch (error) {
                thrown = error;
            }
            expect((thrown as Error | undefined)?.message).to.equal('CreateCapturingDockerode: stop after create');
            return fakeDocker;
        }

        it('runs the tenant worker under Docker init so orphaned processes are reaped', async () => {
            const root = path.join(os.tmpdir(), 'qaap-orchestrator-spec-init', 'repos', 'users', 'alice');
            const fakeDocker = await captureCreate(orchestrator =>
                orchestrator.createOrValidateTenantContainer('qaap-tenant-spec', orchestrator.tenantMountsForRoot(root), 'none', 'alice'));

            expect(fakeDocker.created).to.have.length(1);
            expect(fakeDocker.created[0].HostConfig?.Init).to.equal(true);
        });

        it('disables the image backend healthcheck on the tenant worker, which runs no backend', async () => {
            const root = path.join(os.tmpdir(), 'qaap-orchestrator-spec-health', 'repos', 'users', 'alice');
            const fakeDocker = await captureCreate(orchestrator =>
                orchestrator.createOrValidateTenantContainer('qaap-tenant-spec', orchestrator.tenantMountsForRoot(root), 'none', 'alice'));

            expect(fakeDocker.created).to.have.length(1);
            expect(fakeDocker.created[0].Healthcheck).to.deep.equal({ Test: ['NONE'] });
        });

        it('rejects backend-per-tenant routing without the isolated tenant bridge', async () => {
            const specRoot = path.join(os.tmpdir(), 'qaap-orchestrator-spec-init-none');
            process.env.QAAP_TENANT_NETWORK_MODE = 'none';
            process.env.QAAP_TENANT_CONFIG_ROOT = path.join(specRoot, 'config');
            process.env.QAAP_TENANT_BACKEND_MASTER_SECRET = 'x'.repeat(32);
            const orchestrator = access(new QaapDockerOrchestrator());
            const fakeDocker = new CreateCapturingDockerode();
            orchestrator.getDocker = async () => fakeDocker as unknown as Dockerode;
            let thrown: unknown;
            try {
                await orchestrator.createOrValidateTenantBackend('alice', path.join(specRoot, 'repos', 'users', 'alice'));
            } catch (error) {
                thrown = error;
            }
            expect((thrown as Error | undefined)?.message).to.match(/requires the isolated tenant bridge/);
            expect(fakeDocker.created).to.have.length(0);
        });

        it('runs the tenant backend under Docker init so orphaned dev servers are reaped', async () => {
            const specRoot = path.join(os.tmpdir(), 'qaap-orchestrator-spec-init');
            process.env.QAAP_REPOS_ROOT = path.join(specRoot, 'repos');
            process.env.QAAP_TENANT_NETWORK_MODE = 'isolated-bridge';
            process.env.QAAP_TENANT_CONFIG_ROOT = path.join(specRoot, 'config');
            process.env.QAAP_TENANT_BACKEND_MASTER_SECRET = 'x'.repeat(32);
            process.env.QAAP_DOCKER_PUBLISH_HOST_IP = '127.0.0.1';
            process.env.QAAP_DOCKER_ROOTLESS = '1';
            process.env.QAAP_TENANT_CONTAINER_UID = '0';
            process.env.QAAP_TENANT_CONTAINER_GID = '0';
            delete process.env.QAAP_BACKEND_PER_TENANT;
            delete process.env.QAAP_TENANT_EGRESS_PROXY_IMAGE;
            delete process.env.QAAP_DOCKER_NODES;
            const fakeDocker = createFakeTenantBackendDocker();
            const orchestrator = access(new QaapDockerOrchestrator());
            orchestrator.docker = fakeDocker.docker;
            orchestrator.getDocker = async () => fakeDocker.docker;
            orchestrator.waitForTenantBackendReady = async () => undefined;
            await orchestrator.createOrValidateTenantBackend('alice', path.join(specRoot, 'repos', 'users', 'alice'));

            const backends = fakeDocker.created.filter(container => container.name.startsWith('qaap-backend-'));
            expect(backends).to.have.length(1);
            const options = backends[0].options as { User?: string; Env?: string[]; HostConfig?: Record<string, unknown> };
            expect(options.User).to.equal('0:0');
            expect(options.HostConfig?.Init).to.equal(true);
            expect(options.HostConfig?.CapDrop).to.deep.equal(['ALL']);
            expect(options.HostConfig?.CapAdd).to.deep.equal(['SETUID', 'SETGID']);
            expect(options.Env).to.include.members(['QAAP_AGENT_UID=1001', 'QAAP_AGENT_GID=1001']);
        });
    });

    describe('tenant direct egress', () => {

        function configureDirectEgressEnvironment(): string {
            const specRoot = path.join(os.tmpdir(), 'qaap-orchestrator-spec-direct-egress');
            process.env.QAAP_REPOS_ROOT = path.join(specRoot, 'repos');
            process.env.QAAP_TENANT_CONFIG_ROOT = path.join(specRoot, 'config');
            process.env.QAAP_TENANT_DOCKER_IMAGE = 'qaap-direct-egress-spec:release';
            process.env.QAAP_TENANT_NETWORK_MODE = 'isolated-bridge';
            process.env.QAAP_TENANT_BACKEND_MASTER_SECRET = 'x'.repeat(32);
            process.env.QAAP_DOCKER_PUBLISH_HOST_IP = '127.0.0.1';
            process.env.QAAP_DOCKER_ROOTLESS = '1';
            process.env.QAAP_TENANT_CONTAINER_UID = '0';
            process.env.QAAP_TENANT_CONTAINER_GID = '0';
            delete process.env.QAAP_TENANT_EGRESS_PROXY_IMAGE;
            delete process.env.QAAP_DOCKER_NODES;
            return path.join(specRoot, 'repos', 'users');
        }

        function createOrchestratorWithFakeDocker(docker: Dockerode): QaapDockerOrchestratorTestAccess {
            const orchestrator = access(new QaapDockerOrchestrator());
            orchestrator.docker = docker;
            orchestrator.getDocker = async () => docker;
            orchestrator.waitForTenantBackendReady = async () => undefined;
            return orchestrator;
        }

        async function ensureTenant(orchestrator: QaapDockerOrchestratorTestAccess, tenantRoot: string, login: string): Promise<void> {
            await orchestrator.createOrValidateTenantBackend(login, tenantRoot);
            const mounts = orchestrator.tenantMountsForRoot(tenantRoot);
            await orchestrator.createOrValidateTenantContainer(
                orchestrator.containerNameForTenant(login), mounts, orchestrator.getTenantNetworkMode(login), login,
            );
        }

        it('attaches backend and worker to a private direct-egress network and reuses it per tenant', async () => {
            const usersRoot = configureDirectEgressEnvironment();
            const fakeDocker = createFakeTenantBackendDocker();
            const orchestrator = createOrchestratorWithFakeDocker(fakeDocker.docker);
            const aliceRoot = path.join(usersRoot, 'alice');
            const bobRoot = path.join(usersRoot, 'bob');

            await ensureTenant(orchestrator, aliceRoot, 'alice');
            const createdBeforeReuse = fakeDocker.created.length;
            const networksBeforeReuse = fakeDocker.createdNetworks.length;
            const aliceEgressNetwork = orchestrator.tenantDirectEgressNetworkNameFor('alice');
            fakeDocker.detachContainerFromNetwork(orchestrator.backendContainerNameForTenant('alice'), aliceEgressNetwork);
            fakeDocker.detachContainerFromNetwork(orchestrator.containerNameForTenant('alice'), aliceEgressNetwork);
            await ensureTenant(orchestrator, aliceRoot, 'alice');
            expect(fakeDocker.created).to.have.length(createdBeforeReuse);
            expect(fakeDocker.createdNetworks).to.have.length(networksBeforeReuse);

            await ensureTenant(orchestrator, bobRoot, 'bob');

            const bobEgressNetwork = orchestrator.tenantDirectEgressNetworkNameFor('bob');
            expect(aliceEgressNetwork).not.to.equal(bobEgressNetwork);
            expect(fakeDocker.createdNetworks.filter(network => network.Name.startsWith('qaap-egress-v1-'))).to.have.length(2);
            for (const [login, egressNetwork] of [['alice', aliceEgressNetwork], ['bob', bobEgressNetwork]]) {
                const network = fakeDocker.networks.get(egressNetwork);
                expect(network).to.deep.include({ Name: egressNetwork, Driver: 'bridge', Internal: false });
                expect(network?.Labels).to.deep.include({
                    'com.qaap.managed': 'true',
                    'com.qaap.tenant-egress-network': 'true',
                    'com.qaap.tenant-login': login,
                });
                expect(network?.Options).to.deep.equal({ 'com.docker.network.bridge.enable_icc': 'false' });

                const primaryNetwork = orchestrator.getTenantNetworkMode(login);
                const backend = fakeDocker.created.find(container => container.name === orchestrator.backendContainerNameForTenant(login));
                const worker = fakeDocker.created.find(container => container.name === orchestrator.containerNameForTenant(login));
                expect(Object.keys(backend?.info.NetworkSettings.Networks ?? {})).to.have.members([primaryNetwork, egressNetwork]);
                expect(Object.keys(worker?.info.NetworkSettings.Networks ?? {})).to.have.members([primaryNetwork, egressNetwork]);
                expect(backend?.info.NetworkSettings.Ports['4873/tcp']).to.equal(null);
                expect((backend?.options.HostConfig as Record<string, unknown>).PortBindings).to.equal(undefined);
                expect((worker?.options.HostConfig as Record<string, unknown>).PortBindings).to.equal(undefined);
            }

            const aliceNetworks = fakeDocker.created.find(container => container.name === orchestrator.containerNameForTenant('alice'))?.info.NetworkSettings.Networks ?? {};
            const bobNetworks = fakeDocker.created.find(container => container.name === orchestrator.containerNameForTenant('bob'))?.info.NetworkSettings.Networks ?? {};
            expect(aliceNetworks).not.to.have.property(bobEgressNetwork);
            expect(bobNetworks).not.to.have.property(aliceEgressNetwork);
        });

        it('keeps backend and worker off the direct-egress network when the allowlist proxy is configured', async () => {
            const usersRoot = configureDirectEgressEnvironment();
            process.env.QAAP_TENANT_EGRESS_PROXY_IMAGE = 'qaap-tenant-egress:release';
            const fakeDocker = createFakeTenantBackendDocker();
            const orchestrator = createOrchestratorWithFakeDocker(fakeDocker.docker);
            const aliceRoot = path.join(usersRoot, 'alice');

            await ensureTenant(orchestrator, aliceRoot, 'alice');

            const primaryNetwork = orchestrator.getTenantNetworkMode('alice');
            const directEgressNetwork = orchestrator.tenantDirectEgressNetworkNameFor('alice');
            const backend = fakeDocker.created.find(container => container.name === orchestrator.backendContainerNameForTenant('alice'));
            const worker = fakeDocker.created.find(container => container.name === orchestrator.containerNameForTenant('alice'));
            const proxy = fakeDocker.created.find(container => container.name === orchestrator.tenantEgressProxyNameFor('alice'));
            expect(fakeDocker.networks.has(directEgressNetwork)).to.equal(false);
            expect(Object.keys(backend?.info.NetworkSettings.Networks ?? {})).to.deep.equal([primaryNetwork]);
            expect(Object.keys(worker?.info.NetworkSettings.Networks ?? {})).to.deep.equal([primaryNetwork]);
            expect(Object.keys(proxy?.info.NetworkSettings.Networks ?? {})).to.have.members([
                primaryNetwork,
                'qaap-tenant-egress-uplink',
            ]);
            expect(backend?.options.Env).to.include('HTTPS_PROXY=http://qaap-tenant-egress-proxy:3128');
            expect(worker?.options.Env).to.include('HTTPS_PROXY=http://qaap-tenant-egress-proxy:3128');
            expect(fakeDocker.createdNetworks.some(network => network.Name.startsWith('qaap-egress-v1-'))).to.equal(false);
        });

        it('passes QAAP_AGENT_LEDGER to the tenant backend only when the flag is on', async () => {
            const previous = process.env.QAAP_AGENT_LEDGER;
            try {
                for (const flag of [undefined, 'on']) {
                    if (flag === undefined) {
                        delete process.env.QAAP_AGENT_LEDGER;
                    } else {
                        process.env.QAAP_AGENT_LEDGER = flag;
                    }
                    const usersRoot = configureDirectEgressEnvironment();
                    const fakeDocker = createFakeTenantBackendDocker();
                    const orchestrator = createOrchestratorWithFakeDocker(fakeDocker.docker);
                    await ensureTenant(orchestrator, path.join(usersRoot, 'alice'), 'alice');
                    const backend = fakeDocker.created.find(container => container.name === orchestrator.backendContainerNameForTenant('alice'));
                    const ledgerEnv = (backend?.options.Env as string[] | undefined ?? []).filter(entry => entry.startsWith('QAAP_AGENT_LEDGER='));
                    expect(ledgerEnv).to.deep.equal(flag ? ['QAAP_AGENT_LEDGER=on'] : []);
                }
            } finally {
                if (previous === undefined) {
                    delete process.env.QAAP_AGENT_LEDGER;
                } else {
                    process.env.QAAP_AGENT_LEDGER = previous;
                }
            }
        });

        it('disconnects an existing worker and backend from direct egress when the allowlist proxy is enabled', async () => {
            const usersRoot = configureDirectEgressEnvironment();
            const fakeDocker = createFakeTenantBackendDocker();
            const orchestrator = createOrchestratorWithFakeDocker(fakeDocker.docker);
            const aliceRoot = path.join(usersRoot, 'alice');
            await ensureTenant(orchestrator, aliceRoot, 'alice');

            const egressNetwork = orchestrator.tenantDirectEgressNetworkNameFor('alice');
            const backendName = orchestrator.backendContainerNameForTenant('alice');
            const workerName = orchestrator.containerNameForTenant('alice');
            const oldBackend = fakeDocker.created.find(container => container.name === backendName);
            const oldWorker = fakeDocker.created.find(container => container.name === workerName);
            expect(Object.keys(oldBackend?.info.NetworkSettings.Networks ?? {})).to.have.members([
                orchestrator.getTenantNetworkMode('alice'), egressNetwork,
            ]);
            expect(Object.keys(oldWorker?.info.NetworkSettings.Networks ?? {})).to.have.members([
                orchestrator.getTenantNetworkMode('alice'), egressNetwork,
            ]);

            process.env.QAAP_TENANT_EGRESS_PROXY_IMAGE = 'qaap-tenant-egress:release';
            await ensureTenant(orchestrator, aliceRoot, 'alice');

            expect(fakeDocker.networkDisconnects).to.deep.include.members([
                { networkName: egressNetwork, containerName: backendName },
                { networkName: egressNetwork, containerName: workerName },
            ]);
            expect(oldBackend?.info.NetworkSettings.Networks).not.to.have.property(egressNetwork);
            expect(oldWorker?.info.NetworkSettings.Networks).not.to.have.property(egressNetwork);
        });

        it('recreates a worker with the direct-egress network plus a foreign extra network', async () => {
            const usersRoot = configureDirectEgressEnvironment();
            const fakeDocker = createFakeTenantBackendDocker();
            const orchestrator = createOrchestratorWithFakeDocker(fakeDocker.docker);
            const aliceRoot = path.join(usersRoot, 'alice');
            await ensureTenant(orchestrator, aliceRoot, 'alice');

            const workerName = orchestrator.containerNameForTenant('alice');
            const oldWorker = fakeDocker.created.find(container => container.name === workerName);
            const mounts = orchestrator.tenantMountsForRoot(aliceRoot);
            fakeDocker.attachContainerToNetwork(workerName, 'qaap-foreign-extra');
            const connectionCount = fakeDocker.networkConnections.length;

            await orchestrator.createOrValidateTenantContainer(
                workerName, mounts, orchestrator.getTenantNetworkMode('alice'), 'alice',
            );

            expect(fakeDocker.created.filter(container => container.name === workerName)).to.have.length(2);
            expect(fakeDocker.networkConnections.slice(connectionCount).some(connection => connection.container === oldWorker?.info)).to.equal(false);
        });

        it('re-inspects and validates tenant and egress networks after create conflicts', async () => {
            const usersRoot = configureDirectEgressEnvironment();
            const fakeDocker = createFakeTenantBackendDocker();
            const orchestrator = createOrchestratorWithFakeDocker(fakeDocker.docker);
            const tenantNetwork = orchestrator.getTenantNetworkMode('alice');
            const egressNetwork = orchestrator.tenantDirectEgressNetworkNameFor('alice');
            fakeDocker.conflictOnNextNetworkCreate(tenantNetwork);
            fakeDocker.conflictOnNextNetworkCreate(egressNetwork);

            await ensureTenant(orchestrator, path.join(usersRoot, 'alice'), 'alice');

            expect(orchestrator.tenantNetworkMatches(fakeDocker.networks.get(tenantNetwork)!, tenantNetwork)).to.equal(true);
            expect(orchestrator.tenantDirectEgressNetworkMatches(fakeDocker.networks.get(egressNetwork)!, egressNetwork, 'alice')).to.equal(true);
        });

        it('does not create a tenant or egress network when tenant network mode is none', async () => {
            const usersRoot = configureDirectEgressEnvironment();
            process.env.QAAP_TENANT_NETWORK_MODE = 'none';
            const fakeDocker = createFakeTenantBackendDocker();
            const orchestrator = createOrchestratorWithFakeDocker(fakeDocker.docker);
            const aliceRoot = path.join(usersRoot, 'alice');
            const workerName = orchestrator.containerNameForTenant('alice');

            await orchestrator.createOrValidateTenantContainer(
                workerName, orchestrator.tenantMountsForRoot(aliceRoot), 'none', 'alice',
            );

            expect(fakeDocker.createdNetworks).to.have.length(0);
            expect(fakeDocker.created.find(container => container.name === workerName)?.options.HostConfig)
                .to.have.property('NetworkMode', 'none');
        });

        it('removes the owned direct-egress network when destroying a tenant runtime', async () => {
            const usersRoot = configureDirectEgressEnvironment();
            process.env.QAAP_BACKEND_PER_TENANT = '1';
            const fakeDocker = createFakeTenantBackendDocker();
            const orchestrator = createOrchestratorWithFakeDocker(fakeDocker.docker);
            const egressNetwork = orchestrator.tenantDirectEgressNetworkNameFor('alice');
            await ensureTenant(orchestrator, path.join(usersRoot, 'alice'), 'alice');
            orchestrator.verifiedDockerNodesForTenant = async () => [{ config: { id: 'fake' }, docker: fakeDocker.docker }];

            await orchestrator.destroyTenantRuntime('alice');

            expect(fakeDocker.networks.has(egressNetwork)).to.equal(false);
        });
    });

    describe('tenant backend ingress relay', () => {

        function configureBackendIngressEnvironment(): string {
            const specRoot = path.join(os.tmpdir(), 'qaap-orchestrator-spec-tenant-ingress');
            process.env.QAAP_REPOS_ROOT = path.join(specRoot, 'repos');
            process.env.QAAP_TENANT_CONFIG_ROOT = path.join(specRoot, 'config');
            process.env.QAAP_TENANT_DOCKER_IMAGE = 'qaap-tenant-ingress-spec:release';
            process.env.QAAP_TENANT_NETWORK_MODE = 'isolated-bridge';
            process.env.QAAP_TENANT_BACKEND_MASTER_SECRET = 'x'.repeat(32);
            process.env.QAAP_DOCKER_PUBLISH_HOST_IP = '127.0.0.1';
            delete process.env.QAAP_TENANT_EGRESS_PROXY_IMAGE;
            delete process.env.QAAP_DOCKER_NODES;
            return path.join(specRoot, 'repos', 'users', 'alice');
        }

        function createOrchestratorWithFakeDocker(docker: Dockerode): QaapDockerOrchestrator {
            const orchestrator = access(new QaapDockerOrchestrator());
            orchestrator.docker = docker;
            orchestrator.getDocker = async () => docker;
            orchestrator.waitForTenantBackendReady = async () => undefined;
            return orchestrator as unknown as QaapDockerOrchestrator;
        }

        it('keeps the backend unbound and resolves the router target through the ingress relay port', async () => {
            const root = configureBackendIngressEnvironment();
            const fakeDocker = createFakeTenantBackendDocker();
            const orchestrator = createOrchestratorWithFakeDocker(fakeDocker.docker);
            const target = await access(orchestrator).createOrValidateTenantBackend('alice', root) as {
                containerId: string;
                containerName: string;
                host: string;
                port: number;
                tenantLogin: string;
            };
            const backend = fakeDocker.created.find(container => container.name === target.containerName);
            const relay = fakeDocker.created.find(container => container.name.startsWith('qaap-ingress-'));
            expect(backend).to.not.equal(undefined);
            expect(relay).to.not.equal(undefined);
            expect(backend?.info.NetworkSettings.Ports['4873/tcp']).to.equal(null);
            expect(backend?.options.HostConfig && (backend.options.HostConfig as Record<string, unknown>).PortBindings).to.equal(undefined);
            expect(Object.keys(backend?.info.NetworkSettings.Networks ?? {})).to.have.members([
                access(orchestrator).getTenantNetworkMode('alice'),
                access(orchestrator).tenantDirectEgressNetworkNameFor('alice'),
            ]);
            expect(Object.keys(relay?.info.NetworkSettings.Networks ?? {})).to.have.members([
                access(orchestrator).getTenantNetworkMode('alice'),
                access(orchestrator).backendIngressNetworkNameForTenant('alice'),
            ]);
            expect(target).to.deep.include({ containerId: 'backend-id', port: 43123, host: '127.0.0.1', tenantLogin: 'alice' });
            const relayHostConfig = relay?.options.HostConfig as Record<string, unknown> | undefined;
            expect(relayHostConfig?.CapDrop).to.deep.equal(['ALL']);
            expect(relayHostConfig?.SecurityOpt).to.deep.equal(['no-new-privileges:true']);
            expect(relayHostConfig?.ReadonlyRootfs).to.equal(true);
            expect(relayHostConfig?.PidsLimit).to.be.greaterThan(0);
            expect(relayHostConfig?.Memory).to.be.greaterThan(0);
            expect(relayHostConfig?.PortBindings).to.deep.equal({ '4873/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }] });
        });

        for (const layout of [
            { description: 'the broken internal v2 layout', networkName: 'qaap-net-v2-legacy', ports: null },
            { description: 'the legacy v1 network layout', networkName: 'qaap-net-v1-legacy', ports: [{ HostIp: '127.0.0.1', HostPort: '41321' }] },
        ]) {
            it(`replaces a managed backend from ${layout.description} without requiring its old port`, async () => {
                const root = configureBackendIngressEnvironment();
                const fakeDocker = createFakeTenantBackendDocker();
                const orchestrator = createOrchestratorWithFakeDocker(fakeDocker.docker);
                const staleName = access(orchestrator).backendContainerNameForTenant('alice');
                const staleRemoved = fakeDocker.seedManagedBackend(staleName, layout.networkName, layout.ports);

                const target = await access(orchestrator).createOrValidateTenantBackend('alice', root) as { containerId: string; port: number };

                expect(staleRemoved()).to.equal(true);
                expect(target).to.deep.equal({
                    containerId: 'backend-id',
                    containerName: staleName,
                    host: '127.0.0.1',
                    port: 43123,
                    tenantLogin: 'alice',
                });
            });
        }
    });

    describe('buildTenantEnvironmentArgs', () => {

        it('returns no flags when no environment is supplied', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            expect(orchestrator.buildTenantEnvironmentArgs(undefined)).to.deep.equal([]);
        });

        it('never forwards control-plane and platform secrets from the denylist', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const args = orchestrator.buildTenantEnvironmentArgs({
                STRIPE_SECRET_KEY: 'sk_live_x',
                STRIPE_WEBHOOK_SECRET: 'whsec_x',
                QAAP_JWT_SECRET: 'jwt-secret',
                QAAP_SESSION_SECRET: 'session-secret',
                QAAP_COOKIE_SECRET: 'cookie-secret',
                QAAP_DATABASE_URL: 'postgres://x',
                QAAP_REDIS_URL: 'redis://x',
                QAAP_TENANT_EGRESS_PROXY_IMAGE: 'qaap-tenant-egress:release',
                HTTP_PROXY: 'http://host-proxy:8080',
                HTTPS_PROXY: 'http://host-proxy:8080',
                http_proxy: 'http://host-proxy:8080',
                https_proxy: 'http://host-proxy:8080',
                NO_PROXY: '*',
                no_proxy: '*',
                DOCKER_HOST: 'unix:///var/run/docker.sock',
                QAAP_DOCKER_SOCKET_SOURCE: '/var/run/docker.sock',
                MY_SAFE_VAR: 'ok',
            });

            const joined = args.join(' ');
            for (const secretKey of [
                'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'QAAP_JWT_SECRET', 'QAAP_SESSION_SECRET',
                'QAAP_COOKIE_SECRET', 'QAAP_DATABASE_URL', 'QAAP_REDIS_URL', 'DOCKER_HOST', 'QAAP_DOCKER_SOCKET_SOURCE',
                'QAAP_TENANT_EGRESS_PROXY_IMAGE', 'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy',
            ]) {
                expect(joined).not.to.include(secretKey);
            }
            expect(args).to.include.members(['-e', 'MY_SAFE_VAR=ok']);
        });

        it('forwards a tenant-supplied provider credential that only loosely resembles a secret name', () => {
            // Tenant deploy/provider credentials are deliberately NOT matched by a broad
            // SECRET/TOKEN regex (see the denylist comment in the source): only the explicit
            // control-plane names above are blocked.
            const orchestrator = access(new QaapDockerOrchestrator());
            const args = orchestrator.buildTenantEnvironmentArgs({ MY_APP_API_TOKEN: 'tenant-owned-value' });

            expect(args).to.deep.equal(['-e', 'MY_APP_API_TOKEN=tenant-owned-value']);
        });

        it('rejects env var names that are not valid shell identifiers', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const args = orchestrator.buildTenantEnvironmentArgs({
                'bad-name': 'x',
                '1LEADING_DIGIT': 'x',
                'has space': 'x',
                GOOD_NAME: 'ok',
            });

            expect(args).to.deep.equal(['-e', 'GOOD_NAME=ok']);
        });

        it('emits names only (no values) when the docker CLI inherits the same env', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const args = orchestrator.buildTenantEnvironmentArgs({
                GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic c2VjcmV0',
                DOCKER_HOST: 'unix:///var/run/docker.sock',
                'bad-name': 'x',
                UNSET_VAR: undefined,
            }, true);

            expect(args).to.deep.equal(['-e', 'GIT_CONFIG_VALUE_0']);
        });

        it('skips entries whose value is undefined', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const args = orchestrator.buildTenantEnvironmentArgs({ SET_VAR: 'x', UNSET_VAR: undefined });

            expect(args).to.deep.equal(['-e', 'SET_VAR=x']);
        });
    });

    describe('getTenantTmpfsOptions', () => {

        it('defaults to a 512m executable, nosuid, nodev tmpfs', () => {
            delete process.env.QAAP_TENANT_TMPFS_SIZE;
            expect(access(new QaapDockerOrchestrator()).getTenantTmpfsOptions()).to.equal('rw,exec,nosuid,nodev,size=512m');
        });

        it('accepts a configured size within the memory budget', () => {
            process.env.QAAP_TENANT_MEMORY_LIMIT = String(4 * 1024 ** 3);
            process.env.QAAP_TENANT_TMPFS_SIZE = '1G';
            expect(access(new QaapDockerOrchestrator()).getTenantTmpfsOptions()).to.equal('rw,exec,nosuid,nodev,size=1g');
        });

        it('falls back to the default for malformed sizes or sizes above half the memory limit', () => {
            process.env.QAAP_TENANT_MEMORY_LIMIT = String(2 * 1024 ** 3);
            for (const invalid of ['2g', '1.5g', '-1m', '0', '512mb', 'size=1g,exec']) {
                process.env.QAAP_TENANT_TMPFS_SIZE = invalid;
                expect(access(new QaapDockerOrchestrator()).getTenantTmpfsOptions(), invalid).to.equal('rw,exec,nosuid,nodev,size=512m');
            }
            process.env.QAAP_TENANT_TMPFS_SIZE = '1024m';
            expect(access(new QaapDockerOrchestrator()).getTenantTmpfsOptions()).to.equal('rw,exec,nosuid,nodev,size=1024m');
        });

        it('treats a container with a different tmpfs size as stale', () => {
            process.env.QAAP_TENANT_DOCKER_IMAGE = 'qaap-tenant-test-image:latest';
            process.env.QAAP_TENANT_NETWORK_MODE = 'none';
            process.env.QAAP_TENANT_MEMORY_LIMIT = String(4 * 1024 ** 3);
            process.env.QAAP_TENANT_TMPFS_SIZE = '1g';
            const orchestrator = access(new QaapDockerOrchestrator());
            const mounts: QaapTenantMountSet = {
                reposRoot: '/data/tenants/alice/repos',
                worktreesRoot: '/data/tenants/alice/worktrees',
                parallelRoot: '/data/tenants/alice/parallel',
            };
            const inspect = {
                Config: { User: orchestrator.getTenantContainerUser(), Image: orchestrator.getTenantImage(), Labels: {} },
                HostConfig: {
                    Memory: orchestrator.getTenantMemoryLimit(),
                    NanoCpus: orchestrator.getTenantCpuLimit(),
                    PidsLimit: orchestrator.getTenantPidsLimit(),
                    SecurityOpt: ['no-new-privileges:true'],
                    CapDrop: ['ALL'],
                    ReadonlyRootfs: true,
                    Tmpfs: { '/tmp': 'rw,exec,nosuid,nodev,size=512m' },
                    NetworkMode: 'none',
                    Privileged: false,
                },
                Mounts: [
                    { Source: orchestrator.dockerMountSource(mounts.reposRoot, 'repos'), Destination: WORKSPACE_MOUNT, RW: true },
                    { Source: orchestrator.dockerMountSource(mounts.worktreesRoot, 'worktrees'), Destination: WORKTREES_MOUNT, RW: true },
                    { Source: orchestrator.dockerMountSource(mounts.parallelRoot, 'parallel'), Destination: PARALLEL_MOUNT, RW: true },
                ],
            } as unknown as Dockerode.ContainerInspectInfo;
            expect(orchestrator.tenantContainerMatches(inspect, mounts, 'none')).to.equal(false);
        });
    });

    describe('getTenantBackendAgentStorageRoot', () => {

        it('points tenant backends at their disk-backed config mount', () => {
            delete process.env.QAAP_TENANT_AGENT_STORAGE_ROOT;
            expect(access(new QaapDockerOrchestrator()).getTenantBackendAgentStorageRoot()).to.equal('/home/theia/.qaap/.qaap-agent-storage');
        });

        it('propagates an operator opt-out but never a control-plane path', () => {
            process.env.QAAP_TENANT_AGENT_STORAGE_ROOT = 'off';
            expect(access(new QaapDockerOrchestrator()).getTenantBackendAgentStorageRoot()).to.equal('off');
            process.env.QAAP_TENANT_AGENT_STORAGE_ROOT = '/srv/control-plane/cache';
            expect(access(new QaapDockerOrchestrator()).getTenantBackendAgentStorageRoot()).to.equal('/home/theia/.qaap/.qaap-agent-storage');
        });
    });

    describe('getTenantNetworkMode', () => {

        it('defaults to a per-tenant isolated-bridge network', () => {
            delete process.env.QAAP_TENANT_NETWORK_MODE;
            const orchestrator = access(new QaapDockerOrchestrator());

            const mode = orchestrator.getTenantNetworkMode('alice');

            expect(mode).to.match(/^qaap-net-v3-[0-9a-f]{12}$/);
            // Deterministic per tenant login, and distinct between tenants.
            expect(orchestrator.getTenantNetworkMode('alice')).to.equal(mode);
            expect(orchestrator.getTenantNetworkMode('bob')).not.to.equal(mode);
        });

        it('accepts the strict "none" network mode', () => {
            process.env.QAAP_TENANT_NETWORK_MODE = 'none';
            const orchestrator = access(new QaapDockerOrchestrator());

            expect(orchestrator.getTenantNetworkMode('alice')).to.equal('none');
        });

        it('refuses the shared bridge network mode', () => {
            process.env.QAAP_TENANT_NETWORK_MODE = 'bridge';
            const orchestrator = access(new QaapDockerOrchestrator());

            expect(() => orchestrator.getTenantNetworkMode('alice')).to.throw(/Unsafe or unsupported tenant network mode/);
        });

        it('refuses an arbitrary unrecognized network mode', () => {
            process.env.QAAP_TENANT_NETWORK_MODE = 'host';
            const orchestrator = access(new QaapDockerOrchestrator());

            expect(() => orchestrator.getTenantNetworkMode('alice')).to.throw(/Unsafe or unsupported tenant network mode/);
        });

        it('creates only internal tenant networks and accepts no legacy egress-capable bridge', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const networkName = orchestrator.getTenantNetworkMode('alice');
            const labels = { 'com.qaap.managed': 'true', 'com.qaap.tenant-network': 'true' };
            const options = { 'com.docker.network.bridge.enable_icc': 'true' };
            expect(orchestrator.tenantNetworkMatches({
                Name: networkName, Driver: 'bridge', Internal: true, Labels: labels, Options: options,
            }, networkName)).to.equal(true);
            expect(orchestrator.tenantNetworkMatches({
                Name: networkName, Driver: 'bridge', Internal: false, Labels: labels, Options: options,
            }, networkName)).to.equal(false);
            expect(orchestrator.tenantNetworkMatches({
                Name: networkName, Driver: 'bridge', Internal: true, Labels: labels,
                Options: { 'com.docker.network.bridge.enable_icc': 'false' },
            }, networkName)).to.equal(false);
        });

        it('matches only the owned non-internal direct-egress bridge with ICC disabled', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const networkName = orchestrator.tenantDirectEgressNetworkNameFor('alice');
            const labels = {
                'com.qaap.managed': 'true',
                'com.qaap.tenant-egress-network': 'true',
                'com.qaap.tenant-login': 'alice',
            };
            const options = { 'com.docker.network.bridge.enable_icc': 'false' };

            expect(networkName).to.match(/^qaap-egress-v1-[0-9a-f]{12}$/);
            expect(orchestrator.tenantDirectEgressNetworkMatches({
                Name: networkName, Driver: 'bridge', Internal: false, Labels: labels, Options: options,
            }, networkName, 'alice')).to.equal(true);
            expect(orchestrator.tenantDirectEgressNetworkMatches({
                Name: networkName, Driver: 'bridge', Internal: true, Labels: labels, Options: options,
            }, networkName, 'alice')).to.equal(false);
            expect(orchestrator.tenantDirectEgressNetworkMatches({
                Name: networkName, Driver: 'bridge', Internal: false,
                Labels: { ...labels, 'com.qaap.tenant-login': 'bob' }, Options: options,
            }, networkName, 'alice')).to.equal(false);
            expect(orchestrator.tenantDirectEgressNetworkMatches({
                Name: networkName, Driver: 'bridge', Internal: false, Labels: labels,
                Options: { 'com.docker.network.bridge.enable_icc': 'true' },
            }, networkName, 'alice')).to.equal(false);
        });

        it('passes the allowlist proxy only when the deployment configures its container', () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            expect(orchestrator.tenantEgressProxyEnv()).to.deep.equal({});
            process.env.QAAP_TENANT_EGRESS_PROXY_IMAGE = 'qaap-tenant-egress:release';
            expect(orchestrator.tenantEgressProxyEnv()).to.deep.equal({
                HTTP_PROXY: 'http://qaap-tenant-egress-proxy:3128',
                HTTPS_PROXY: 'http://qaap-tenant-egress-proxy:3128',
                http_proxy: 'http://qaap-tenant-egress-proxy:3128',
                https_proxy: 'http://qaap-tenant-egress-proxy:3128',
                NO_PROXY: 'localhost,127.0.0.1,::1',
                no_proxy: 'localhost,127.0.0.1,::1',
            });
        });

        it('gives each tenant a separate proxy container and rejects shared proxy containers', async () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            const alice = orchestrator.tenantEgressProxyNameFor('alice');
            expect(alice).to.match(/^qaap-egress-[0-9a-f]{12}$/);
            expect(orchestrator.tenantEgressProxyNameFor('alice')).to.equal(alice);
            expect(orchestrator.tenantEgressProxyNameFor('bob')).not.to.equal(alice);
            const inspect = {
                Config: {
                    User: 'proxy',
                    Image: 'qaap-tenant-egress:release',
                    Cmd: ['squid', '-N', '-f', '/etc/squid/squid.conf'],
                    Labels: {
                        'com.qaap.managed': 'true',
                        'com.qaap.tenant-egress-proxy': 'true',
                        'com.qaap.tenant-login': 'alice',
                    },
                },
                HostConfig: {
                    NetworkMode: 'qaap-tenant-egress-uplink',
                    CapDrop: ['ALL'],
                    SecurityOpt: ['no-new-privileges:true'],
                    ReadonlyRootfs: true,
                    Tmpfs: { '/tmp': 'rw,noexec,nosuid,nodev,size=16m' },
                    Privileged: false,
                },
                NetworkSettings: {
                    Networks: {
                        'qaap-tenant-egress-uplink': {},
                        'qaap-net-v3-alice': { Aliases: ['qaap-tenant-egress-proxy'] },
                    },
                },
            } as unknown as Dockerode.ContainerInspectInfo;
            expect(orchestrator.tenantEgressProxyMatches(inspect, 'alice', 'qaap-net-v3-alice', 'qaap-tenant-egress:release')).to.equal(true);
            expect(orchestrator.tenantEgressProxyMatches(inspect, 'alice', 'qaap-net-v3-bob', 'qaap-tenant-egress:release')).to.equal(false);
            const proxyWithUntrustedNetwork = {
                ...inspect,
                NetworkSettings: {
                    Networks: {
                        ...inspect.NetworkSettings?.Networks,
                        bridge: {},
                    },
                },
            } as unknown as Dockerode.ContainerInspectInfo;
            expect(orchestrator.tenantEgressProxyMatches(proxyWithUntrustedNetwork, 'alice', 'qaap-net-v3-alice', 'qaap-tenant-egress:release')).to.equal(false);
            const currentImageDocker = (id: string): Dockerode => ({
                getImage: () => ({ inspect: async () => ({ Id: id }) }),
            }) as unknown as Dockerode;
            expect(await orchestrator.tenantEgressProxyImageIsCurrent(currentImageDocker('sha256:old'), { Image: 'sha256:old' } as Dockerode.ContainerInspectInfo, 'qaap-tenant-egress:release')).to.equal(true);
            expect(await orchestrator.tenantEgressProxyImageIsCurrent(currentImageDocker('sha256:new'), { Image: 'sha256:old' } as Dockerode.ContainerInspectInfo, 'qaap-tenant-egress:release')).to.equal(false);
        });

        it('creates an isolated tenant proxy and connects it to the outbound uplink', async () => {
            process.env.QAAP_TENANT_EGRESS_PROXY_IMAGE = 'qaap-tenant-egress:release';
            const orchestrator = access(new QaapDockerOrchestrator());
            const createdNetworks: Array<{ Name?: string; Driver?: string; Internal?: boolean; Labels?: Record<string, string>; Options?: Record<string, string> }> = [];
            const createdContainers: Array<{ name?: string; Image?: string; User?: string; Cmd?: string[]; HostConfig?: Record<string, unknown> }> = [];
            const connections: Array<{ Container: string; EndpointConfig?: { Aliases?: string[] } }> = [];
            const networks = new Map<string, {
                inspect: () => Promise<typeof createdNetworks[number]>;
                connect: (options: typeof connections[number]) => Promise<void>;
            }>();
            const notFound = (): never => { throw Object.assign(new Error('not found'), { statusCode: 404 }); };
            const fakeDocker = {
                getNetwork: (name: string) => networks.get(name) ?? notFound(),
                createNetwork: async (options: typeof createdNetworks[number]) => {
                    createdNetworks.push(options);
                    const network = {
                        inspect: async () => options,
                        connect: async (options: typeof connections[number]) => { connections.push(options); },
                    };
                    networks.set(options.Name ?? '', network);
                    return network;
                },
                getContainer: () => notFound(),
                createContainer: async (options: typeof createdContainers[number]) => {
                    createdContainers.push(options);
                    return { start: async () => undefined };
                },
            } as unknown as Dockerode;

            const tenantNetwork = orchestrator.getTenantNetworkMode('alice');
            await orchestrator.ensureTenantNetwork(fakeDocker, tenantNetwork, 'alice');

            expect(createdNetworks.map(network => [network.Name, network.Internal])).to.deep.equal([
                [tenantNetwork, true], ['qaap-tenant-egress-uplink', false],
            ]);
            expect(createdContainers).to.have.length(1);
            expect(createdContainers[0]?.HostConfig?.NetworkMode).to.equal('qaap-tenant-egress-uplink');
            expect(createdContainers[0]?.HostConfig?.CapDrop).to.deep.equal(['ALL']);
            expect(connections).to.deep.equal([{
                Container: createdContainers[0]?.name,
                EndpointConfig: { Aliases: ['qaap-tenant-egress-proxy'] },
            }]);
        });
    });
    describe('runsCurrentTenantImage', () => {
        const dockerWithImage = (id: string | Error): Dockerode => ({
            getImage: () => ({ inspect: async () => { if (id instanceof Error) { throw id; } return { Id: id }; } }),
        }) as unknown as Dockerode;
        const container = (image: string): Dockerode.ContainerInspectInfo => ({ Image: image }) as Dockerode.ContainerInspectInfo;

        it('flags a container whose image id differs from the one the tag points at (same local tag after a rebuild)', async () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            expect(await orchestrator.runsCurrentTenantImage(dockerWithImage('sha256:new'), container('sha256:old'))).to.equal(false);
            expect(await orchestrator.runsCurrentTenantImage(dockerWithImage('sha256:new'), container('sha256:new'))).to.equal(true);
        });

        it('keeps the container when the image cannot be inspected', async () => {
            const orchestrator = access(new QaapDockerOrchestrator());
            expect(await orchestrator.runsCurrentTenantImage(dockerWithImage(new Error('no such image')), container('sha256:old'))).to.equal(true);
        });
    });
});

describe('QaapDockerOrchestrator tenant ensure timeout', () => {
    type EnsureInternals = {
        boundTenantEnsure<T>(operation: Promise<T>, label: string): Promise<T>;
        shareTenantEnsureOperation<T>(key: string, start: () => Promise<T>): Promise<T>;
    };
    let savedTimeout: string | undefined;

    beforeEach(() => {
        savedTimeout = process.env.QAAP_TENANT_ENSURE_TIMEOUT_MS;
        process.env.QAAP_TENANT_ENSURE_TIMEOUT_MS = '20';
    });

    afterEach(() => {
        if (savedTimeout === undefined) {
            delete process.env.QAAP_TENANT_ENSURE_TIMEOUT_MS;
        } else {
            process.env.QAAP_TENANT_ENSURE_TIMEOUT_MS = savedTimeout;
        }
    });

    it('a retry after a timed-out wait joins the still-running create instead of starting a second one', async () => {
        const orchestrator = new QaapDockerOrchestrator() as unknown as EnsureInternals;
        let starts = 0;
        let finish!: (value: string) => void;
        const start = (): Promise<string> => {
            starts += 1;
            return new Promise(resolve => { finish = resolve; });
        };
        const first = orchestrator.boundTenantEnsure(orchestrator.shareTenantEnsureOperation('container:t', start), 'container t');
        const firstError = await first.then(() => undefined, (err: Error) => err);
        expect(firstError?.message).to.contain('Timed out after 20ms');
        const retry = orchestrator.boundTenantEnsure(orchestrator.shareTenantEnsureOperation('container:t', start), 'container t');
        finish('ready');
        expect(await retry).to.equal('ready');
        expect(starts).to.equal(1);
        // Settled: the next ensure starts a fresh run.
        void orchestrator.shareTenantEnsureOperation('container:t', start);
        expect(starts).to.equal(2);
        finish('again');
    });

    it('a run older than twice the timeout no longer blocks a fresh attempt', async () => {
        const orchestrator = new QaapDockerOrchestrator() as unknown as EnsureInternals;
        let starts = 0;
        const hung = (): Promise<string> => {
            starts += 1;
            return new Promise<string>(() => undefined);
        };
        void orchestrator.shareTenantEnsureOperation('backend:t', hung);
        await new Promise(resolve => setTimeout(resolve, 50));
        void orchestrator.shareTenantEnsureOperation('backend:t', hung);
        expect(starts).to.equal(2);
    });
});

describe('QaapDockerOrchestrator tenant backend build prediction', () => {
    const BUILD_ENV_KEYS = ['QAAP_TENANT_DOCKER_IMAGE', 'QAAP_THEIA_IMAGE', 'QAAP_BACKEND_PER_TENANT', 'QAAP_BUILD_SHA', 'NODE_ENV', 'QAAP_CLOUD_MODE'] as const;
    const TARGET = { containerId: 'c1', containerName: 'qaap-backend-x', host: '127.0.0.1', port: 4873, tenantLogin: 'Alice' };
    const MANAGED_LABELS = { 'com.qaap.managed': 'true', 'com.qaap.tenant-backend': 'true', 'com.qaap.tenant-login': 'alice' };

    interface BuildInternals {
        readonly tenantBackendTargets: Map<string, unknown>;
        readonly tenantBackendBuilds: Map<string, string>;
        readonly deferredTenantBackendRecreations: Set<string>;
        requestTenantBackendHealth(target: unknown): Promise<{ statusCode?: number; body: string; setCookie?: string[] }>;
        waitForTenantBackendReady(target: unknown): Promise<void>;
        getDocker(ownerLogin?: string): Promise<unknown>;
        verifiedDockerNodesForTenant(ownerLogin?: string): Promise<unknown[]>;
        getTenantBuildPredictionTimeoutMs(): number;
        predictTenantBackendBuild(ownerLogin: string): Promise<string | undefined>;
        invalidateTenantBackendTarget(ownerLogin: string | undefined): void;
        stopTenantBackend(ownerLogin: string | undefined): Promise<void>;
    }

    let envSnapshot: Record<string, string | undefined>;

    beforeEach(() => {
        envSnapshot = {};
        for (const key of BUILD_ENV_KEYS) {
            envSnapshot[key] = process.env[key];
        }
        process.env.QAAP_TENANT_DOCKER_IMAGE = 'qaap-theia:spec';
        process.env.QAAP_BACKEND_PER_TENANT = '1';
        process.env.QAAP_BUILD_SHA = 'abc1234';
    });

    afterEach(() => {
        for (const key of BUILD_ENV_KEYS) {
            if (envSnapshot[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = envSnapshot[key];
            }
        }
    });

    function create(): BuildInternals {
        return new QaapDockerOrchestrator() as unknown as BuildInternals;
    }

    /** Dockerode stand-in: `container` answers the backend container inspect, `image` the image inspect. */
    function fakeDocker(container: () => Promise<unknown>, image: () => Promise<unknown>): { imageInspects: number } & Record<string, unknown> {
        const docker = {
            imageInspects: 0,
            getContainer: () => ({ inspect: container }),
            getImage: () => ({
                inspect: () => {
                    docker.imageInspects += 1;
                    return image();
                },
            }),
        };
        return docker;
    }

    const notFound = (): Promise<never> => Promise.reject(Object.assign(new Error('no such container'), { statusCode: 404 }));
    const imageWithBuild = (build: string) => async () => ({ Id: 'sha256:img', Config: { Env: ['PATH=/usr/bin', `QAAP_BUILD_SHA=${build}`] } });

    it('records the build a ready tenant backend reports and serves it for the cached target', async () => {
        const orchestrator = create();
        orchestrator.requestTenantBackendHealth = async () => ({ statusCode: 200, body: JSON.stringify({ ok: true, ready: true, build: 'abc1234' }) });
        await orchestrator.waitForTenantBackendReady(TARGET);
        expect(orchestrator.tenantBackendBuilds.get('alice')).to.equal('abc1234');
        orchestrator.tenantBackendTargets.set('alice', TARGET);
        expect(await orchestrator.predictTenantBackendBuild('alice')).to.equal('abc1234');
    });

    it('forgets the recorded build when the target is invalidated or the backend stopped', async () => {
        const orchestrator = create();
        orchestrator.requestTenantBackendHealth = async () => ({ statusCode: 200, body: JSON.stringify({ ready: true, build: 'abc1234' }) });
        await orchestrator.waitForTenantBackendReady(TARGET);
        orchestrator.tenantBackendTargets.set('alice', TARGET);
        orchestrator.invalidateTenantBackendTarget('alice');
        expect(orchestrator.tenantBackendBuilds.has('alice')).to.equal(false);

        await orchestrator.waitForTenantBackendReady(TARGET);
        orchestrator.tenantBackendTargets.set('alice', TARGET);
        orchestrator.verifiedDockerNodesForTenant = async () => [];
        await orchestrator.stopTenantBackend('alice');
        expect(orchestrator.tenantBackendBuilds.has('alice')).to.equal(false);
    });

    it('drops a stale recorded build when a ready backend reports none', async () => {
        const orchestrator = create();
        orchestrator.tenantBackendBuilds.set('alice', 'old5678');
        orchestrator.requestTenantBackendHealth = async () => ({ statusCode: 200, body: JSON.stringify({ ready: true }) });
        await orchestrator.waitForTenantBackendReady(TARGET);
        expect(orchestrator.tenantBackendBuilds.has('alice')).to.equal(false);
    });

    it('is unknown for a tenant whose stale backend recreation is deferred', async () => {
        const orchestrator = create();
        orchestrator.tenantBackendTargets.set('alice', TARGET);
        orchestrator.tenantBackendBuilds.set('alice', 'abc1234');
        orchestrator.deferredTenantBackendRecreations.add('alice');
        expect(await orchestrator.predictTenantBackendBuild('Alice')).to.equal(undefined);
    });

    it('reads the build of a running backend container from its environment', async () => {
        const orchestrator = create();
        const docker = fakeDocker(async () => ({
            State: { Running: true },
            Config: { Labels: MANAGED_LABELS, Env: ['QAAP_BUILD_SHA=old5678'] },
        }), imageWithBuild('abc1234'));
        orchestrator.getDocker = async () => docker;
        expect(await orchestrator.predictTenantBackendBuild('alice')).to.equal('old5678');
        expect(docker.imageInspects).to.equal(0);
    });

    it('uses the serving image build for a stopped or missing backend and caches the image inspect', async () => {
        const orchestrator = create();
        const stopped = fakeDocker(async () => ({ State: { Running: false }, Config: { Labels: MANAGED_LABELS, Env: ['QAAP_BUILD_SHA=old5678'] } }),
            imageWithBuild('abc1234'));
        orchestrator.getDocker = async () => stopped;
        expect(await orchestrator.predictTenantBackendBuild('alice')).to.equal('abc1234');
        const missing = fakeDocker(notFound, imageWithBuild('zzz9999'));
        orchestrator.getDocker = async () => missing;
        // Same image reference within the cache window: no second image inspect.
        expect(await orchestrator.predictTenantBackendBuild('alice')).to.equal('abc1234');
        expect(stopped.imageInspects + missing.imageInspects).to.equal(1);
    });

    it('is unknown when Docker fails, the container is foreign, or the answer is too slow', async () => {
        const orchestrator = create();
        orchestrator.getDocker = async () => fakeDocker(() => Promise.reject(new Error('daemon down')), imageWithBuild('abc1234'));
        expect(await orchestrator.predictTenantBackendBuild('alice')).to.equal(undefined);

        orchestrator.getDocker = async () => fakeDocker(async () => ({ State: { Running: true }, Config: { Labels: {}, Env: ['QAAP_BUILD_SHA=abc1234'] } }),
            imageWithBuild('abc1234'));
        expect(await orchestrator.predictTenantBackendBuild('alice')).to.equal(undefined);

        orchestrator.getTenantBuildPredictionTimeoutMs = () => 20;
        orchestrator.getDocker = async () => fakeDocker(() => new Promise(() => undefined), imageWithBuild('abc1234'));
        expect(await orchestrator.predictTenantBackendBuild('alice')).to.equal(undefined);
    });
});
