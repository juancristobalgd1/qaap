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
    getTenantContainerUser(): string;
    getTenantImage(): string;
    getTenantMemoryLimit(): number;
    getTenantCpuLimit(): number;
    getTenantPidsLimit(): number;
    getTenantTmpfsOptions(): string;
    getTenantBackendAgentStorageRoot(): string;
    normalizeHostPath(hostPath: string): string;
    runsCurrentTenantImage(docker: Dockerode, inspect: Dockerode.ContainerInspectInfo): Promise<boolean>;
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
    'QAAP_TENANT_NETWORK_MODE',
    'QAAP_TENANT_MEMORY_LIMIT',
    'QAAP_TENANT_CPU_LIMIT',
    'QAAP_TENANT_PIDS_LIMIT',
    'QAAP_TENANT_TMPFS_SIZE',
    'QAAP_TENANT_AGENT_STORAGE_ROOT',
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
                DOCKER_HOST: 'unix:///var/run/docker.sock',
                QAAP_DOCKER_SOCKET_SOURCE: '/var/run/docker.sock',
                MY_SAFE_VAR: 'ok',
            });

            const joined = args.join(' ');
            for (const secretKey of [
                'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'QAAP_JWT_SECRET', 'QAAP_SESSION_SECRET',
                'QAAP_COOKIE_SECRET', 'QAAP_DATABASE_URL', 'QAAP_REDIS_URL', 'DOCKER_HOST', 'QAAP_DOCKER_SOCKET_SOURCE',
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

            expect(mode).to.match(/^qaap-net-[0-9a-f]{12}$/);
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
