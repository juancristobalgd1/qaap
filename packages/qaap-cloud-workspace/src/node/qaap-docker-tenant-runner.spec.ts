// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { ChildProcess } from 'child_process';
import * as path from 'path';
import {
    resolveQaapParallelRoot,
    resolveQaapReposRoot,
    resolveQaapWorktreesRoot,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapDockerOrchestrator } from './qaap-docker-orchestrator';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';
import {
    isContainerIsolationEnabled,
    evaluateAgentIsolationPolicy,
} from './qaap-agent-spawn-identity';

interface LaunchCall {
    file: string;
    args: string[];
    options: { cwd?: string; env?: NodeJS.ProcessEnv; detached?: boolean };
}

class TestDockerTenantSpawnService extends QaapTenantSpawnService {
    readonly launches: LaunchCall[] = [];

    constructor(dockerOrchestrator: QaapDockerOrchestrator) {
        super();
        (this as any).dockerOrchestrator = dockerOrchestrator;
    }

    protected override launchProcess(file: string, args: string[], options: object): ChildProcess {
        this.launches.push({ file, args, options: options as LaunchCall['options'] });
        return {} as ChildProcess;
    }
}

describe('Container-per-Tenant Runner (Option A)', () => {

    const reposRoot = resolveQaapReposRoot();
    const aliceRoot = path.join(reposRoot, 'users', 'alice');
    const bobRoot = path.join(reposRoot, 'users', 'bob');
    const aliceWorktreesRoot = path.join(resolveQaapWorktreesRoot(), 'alice');
    const aliceParallelRoot = path.join(resolveQaapParallelRoot(), 'alice');
    const aliceCwd = path.join(reposRoot, 'users', 'alice', 'acme', 'webapp');
    const bobCwd = path.join(reposRoot, 'users', 'bob', 'acme', 'webapp');

    describe('QaapDockerOrchestrator tenant containers', () => {
        const orchestrator = new QaapDockerOrchestrator();

        it('generates distinct container names for different tenant logins', () => {
            const aliceContainer = orchestrator.containerNameForTenant('alice');
            const bobContainer = orchestrator.containerNameForTenant('bob');

            expect(aliceContainer).to.match(/^qaap-tenant-[a-f0-9]{12}$/);
            expect(bobContainer).to.match(/^qaap-tenant-[a-f0-9]{12}$/);
            expect(aliceContainer).to.not.equal(bobContainer);
        });

        it('is stable and case-insensitive for the same login', () => {
            const a1 = orchestrator.containerNameForTenant('Alice');
            const a2 = orchestrator.containerNameForTenant('alice');
            expect(a1).to.equal(a2);
        });

        it('isolates anonymous users into a distinct __anonymous__ bucket', () => {
            const anon1 = orchestrator.containerNameForTenant(undefined);
            const anon2 = orchestrator.containerNameForTenant('  ');
            const alice = orchestrator.containerNameForTenant('alice');

            expect(anon1).to.equal(anon2);
            expect(anon1).to.not.equal(alice);
        });

        it('assigns each tenant a distinct managed network and rejects the shared bridge', () => {
            expect(orchestrator.tenantNetworkNameFor('alice')).to.match(/^qaap-net-[a-f0-9]{12}$/);
            expect(orchestrator.tenantNetworkNameFor('alice')).to.not.equal(orchestrator.tenantNetworkNameFor('bob'));
            const previous = process.env.QAAP_TENANT_NETWORK_MODE;
            try {
                process.env.QAAP_TENANT_NETWORK_MODE = 'bridge';
                expect(() => (orchestrator as any).getTenantNetworkMode('alice')).to.throw(/shared|unsupported/i);
                process.env.QAAP_TENANT_NETWORK_MODE = 'none';
                expect((orchestrator as any).getTenantNetworkMode('alice')).to.equal('none');
            } finally {
                if (previous === undefined) {
                    delete process.env.QAAP_TENANT_NETWORK_MODE;
                } else {
                    process.env.QAAP_TENANT_NETWORK_MODE = previous;
                }
            }
        });

        it('assigns tenants deterministically across a remote Docker node pool', () => {
            const previousEnv = process.env;
            process.env = {
                ...previousEnv,
                NODE_ENV: 'development',
                QAAP_CLOUD_MODE: 'docker',
                DOCKER_TLS_VERIFY: '',
                QAAP_DOCKER_NODES: JSON.stringify([
                    { id: 'node-b', dockerHost: 'http://docker-b.internal:2375', advertiseHost: '10.0.0.12' },
                    { id: 'node-a', dockerHost: 'http://docker-a.internal:2375', advertiseHost: '10.0.0.11' },
                ]),
            };
            try {
                const first = new QaapDockerOrchestrator();
                const second = new QaapDockerOrchestrator();
                const assignment = (orchestrator: QaapDockerOrchestrator, login: string): string =>
                    (orchestrator as any).dockerNodeForTenant(login).config.id;
                const logins = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi'];
                const firstAssignments = logins.map(login => assignment(first, login));
                expect(firstAssignments).to.include('node-a');
                expect(firstAssignments).to.include('node-b');
                expect(logins.map(login => assignment(second, login))).to.deep.equal(firstAssignments);

                const wrapped = first.wrapShellForTenantContainer('alice', aliceCwd, '/bin/bash', ['-c', 'echo ok'], aliceRoot);
                const node = (first as any).dockerNodeForTenant('alice').config;
                expect(wrapped.args.slice(0, 2)).to.deep.equal(['--host', node.dockerHost]);
                expect(wrapped.args).to.include('exec');
            } finally {
                process.env = previousEnv;
            }
        });

        it('maps canonical storage roots for remote Docker nodes', () => {
            const previousEnv = process.env;
            process.env = { ...previousEnv, QAAP_DOCKER_REMOTE_REPOS_ROOT: '/srv/qaap/repos' };
            try {
                const orchestrator = new QaapDockerOrchestrator();
                expect((orchestrator as any).dockerMountSource(aliceRoot, 'repos'))
                    .to.equal('/srv/qaap/repos/users/alice');
            } finally {
                process.env = previousEnv;
            }
        });

        it('creates one non-root container with only that tenant storage roots mounted and hardening enabled', async () => {
            const previousEnv = process.env;
            process.env = {
                ...previousEnv,
                NODE_ENV: 'development',
                QAAP_CLOUD_MODE: 'local',
                QAAP_TENANT_CONTAINER_ISOLATION: '1',
                QAAP_TENANT_DOCKER_IMAGE: 'qaap-test-worker:local',
            };
            try {
                let created: any;
                let createOptions: any;
                let createCalls = 0;
                let networkCreated: any;
                let networkOptions: any;
                const fakeDocker = {
                    getContainer: (): any => {
                        if (!created) {
                            const missing: any = new Error('not found');
                            missing.statusCode = 404;
                            throw missing;
                        }
                        return created;
                    },
                    createContainer: async (options: any): Promise<any> => {
                        createCalls += 1;
                        createOptions = options;
                        created = {
                            start: async (): Promise<void> => undefined,
                            inspect: async (): Promise<any> => ({
                                Id: 'tenant-container-id',
                                State: { Running: true },
                                Config: {
                                    User: options.User,
                                    Image: options.Image,
                                    Labels: options.Labels,
                                },
                                HostConfig: { ...options.HostConfig, PidMode: 'private', IpcMode: 'private' },
                                Mounts: [
                                    { Source: aliceRoot, Destination: '/workspace', RW: true },
                                    { Source: aliceWorktreesRoot, Destination: '/workspace/.qaap-worktrees', RW: true },
                                    { Source: aliceParallelRoot, Destination: '/workspace/.qaap-parallel', RW: true },
                                ],
                            }),
                        };
                        return created;
                    },
                    getNetwork: (): any => {
                        if (!networkCreated) {
                            const missing: any = new Error('not found');
                            missing.statusCode = 404;
                            throw missing;
                        }
                        return networkCreated;
                    },
                    createNetwork: async (options: any): Promise<any> => {
                        networkOptions = options;
                        networkCreated = {
                            inspect: async (): Promise<any> => ({
                                Name: options.Name,
                                Driver: options.Driver,
                                Internal: options.Internal,
                                Labels: options.Labels,
                                Options: options.Options,
                            }),
                        };
                        return networkCreated;
                    },
                };
                (orchestrator as any).docker = fakeDocker;
                const [first, second] = await Promise.all([
                    orchestrator.ensureTenantContainer('alice', aliceRoot),
                    orchestrator.ensureTenantContainer('alice', aliceRoot),
                ]);

                expect(createCalls).to.equal(1);
                expect(first.containerId).to.equal(second.containerId);
                expect(orchestrator.isTenantContainerReady('alice', aliceRoot)).to.be.true;
                expect(createOptions.HostConfig.Binds).to.deep.equal([
                    `${aliceRoot}:/workspace:rw`,
                    `${aliceWorktreesRoot}:/workspace/.qaap-worktrees:rw`,
                    `${aliceParallelRoot}:/workspace/.qaap-parallel:rw`,
                ]);
                expect(createOptions.User).to.equal('1000:1000');
                expect(createOptions.HostConfig.CapDrop).to.deep.equal(['ALL']);
                expect(createOptions.HostConfig.SecurityOpt).to.include('no-new-privileges:true');
                expect(createOptions.HostConfig.ReadonlyRootfs).to.equal(true);
                expect(createOptions.HostConfig.Tmpfs).to.deep.equal({ '/tmp': 'rw,exec,nosuid,nodev,size=512m' });
                expect(createOptions.HostConfig.PidsLimit).to.be.greaterThan(0);
                expect(networkOptions.Name).to.equal(orchestrator.tenantNetworkNameFor('alice'));
                expect(networkOptions.Options['com.docker.network.bridge.enable_icc']).to.equal('false');
                expect(createOptions.HostConfig.NetworkMode).to.equal(networkOptions.Name);
            } finally {
                process.env = previousEnv;
            }
        });

        it('rejects a hosted daemon that does not report rootless mode', async () => {
            const previousEnv = process.env;
            process.env = {
                ...previousEnv,
                NODE_ENV: 'production',
                QAAP_CLOUD_MODE: 'docker',
                DOCKER_HOST: 'unix:///run/user/1000/docker.sock',
            };
            try {
                const hosted = new QaapDockerOrchestrator();
                (hosted as any).docker = {
                    info: async (): Promise<{ SecurityOptions: string[] }> => ({ SecurityOptions: ['name=seccomp'] }),
                };
                let error: unknown;
                try {
                    await (hosted as any).getDocker();
                } catch (caught) {
                    error = caught;
                }
                expect(error).to.be.instanceOf(Error);
                expect((error as Error).message).to.match(/did not report rootless/i);
            } finally {
                process.env = previousEnv;
            }
        });

        it('wraps shell commands into docker exec -i targeting the tenant container', () => {
            (orchestrator as any).tenantRoots.set(orchestrator.containerNameForTenant('alice'), aliceRoot);
            const wrapped = orchestrator.wrapShellForTenantContainer('alice', aliceCwd, '/bin/bash', ['-c', 'npm test']);
            const containerName = orchestrator.containerNameForTenant('alice');
            const expectedCwd = orchestrator.toContainerPath(aliceCwd, aliceRoot);

            expect(wrapped.file).to.equal('docker');
            expect(wrapped.args).to.deep.equal([
                'exec',
                '-i',
                '--user',
                '1000:1000',
                '-w',
                expectedCwd,
                containerName,
                '/bin/bash',
                '-c',
                'npm test',
            ]);
        });

        it('forwards tenant environment with docker exec while removing control-plane secrets', () => {
            (orchestrator as any).tenantRoots.set(orchestrator.containerNameForTenant('alice'), aliceRoot);
            const wrapped = orchestrator.wrapShellForTenantContainer(
                'alice',
                aliceCwd,
                '/bin/bash',
                ['-c', 'env'],
                aliceRoot,
                {
                    PATH: '/usr/local/bin:/usr/bin',
                    HOME: '/tmp/qaap-home',
                    OPENAI_API_KEY: 'tenant-key',
                    DOCKER_HOST: 'unix:///run/user/1000/docker.sock',
                    QAAP_GITHUB_CLIENT_SECRET: 'backend-secret',
                    'INVALID-NAME': 'must-not-cross',
                },
            );

            expect(wrapped.args).to.include.members([
                '-e',
                'PATH=/usr/local/bin:/usr/bin',
                '-e',
                'HOME=/tmp/qaap-home',
                '-e',
                'OPENAI_API_KEY=tenant-key',
            ]);
            expect(wrapped.args).to.not.include('DOCKER_HOST=unix:///run/user/1000/docker.sock');
            expect(wrapped.args).to.not.include('QAAP_GITHUB_CLIENT_SECRET=backend-secret');
            expect(wrapped.args).to.not.include('INVALID-NAME=must-not-cross');
        });

        it('wraps interactive terminal into docker exec -it targeting the tenant container', () => {
            (orchestrator as any).tenantRoots.set(orchestrator.containerNameForTenant('bob'), bobRoot);
            const wrapped = orchestrator.wrapInteractiveTerminalForTenant('bob', bobCwd, '/bin/bash', ['-l']);
            const containerName = orchestrator.containerNameForTenant('bob');
            const expectedCwd = orchestrator.toContainerPath(bobCwd, bobRoot);

            expect(wrapped.file).to.match(/(?:^|[\\/])docker(?:\.exe)?$/);
            expect(wrapped.args).to.deep.equal([
                'exec',
                '-it',
                '--user',
                '1000:1000',
                '-w',
                expectedCwd,
                containerName,
                '/bin/bash',
                '-l',
            ]);
        });
    });

    describe('Container isolation policy checks', () => {
        it('detects container isolation when QAAP_CLOUD_MODE=docker', () => {
            expect(isContainerIsolationEnabled({ QAAP_CLOUD_MODE: 'docker' })).to.be.true;
            expect(isContainerIsolationEnabled({ QAAP_CLOUD_MODE: 'Docker' })).to.be.true;
            expect(isContainerIsolationEnabled({ QAAP_CLOUD_MODE: 'local' })).to.be.false;
            expect(isContainerIsolationEnabled({})).to.be.false;
        });

        it('detects container isolation via explicit QAAP_TENANT_CONTAINER_ISOLATION flag', () => {
            expect(isContainerIsolationEnabled({ QAAP_TENANT_CONTAINER_ISOLATION: '1' })).to.be.true;
            expect(isContainerIsolationEnabled({ QAAP_TENANT_CONTAINER_ISOLATION: 'true' })).to.be.true;
            expect(isContainerIsolationEnabled({ QAAP_TENANT_CONTAINER_ISOLATION: '0' })).to.be.false;
        });

        it('evaluateAgentIsolationPolicy approves non-root execution when container isolation is active', () => {
            const decision = evaluateAgentIsolationPolicy(
                { NODE_ENV: 'production', QAAP_CLOUD_MODE: 'docker' },
                false, // not root
            );
            expect(decision.refuse).to.be.false;
        });
    });

    describe('QaapTenantSpawnService execution routing in Docker mode', () => {
        const originalEnv = process.env;

        beforeEach(() => {
            process.env = { ...originalEnv, QAAP_CLOUD_MODE: 'docker' };
        });

        afterEach(() => {
            process.env = originalEnv;
        });

        it('routes spawn() through docker exec targeting tenant container', () => {
            const orchestrator = new QaapDockerOrchestrator();
            const service = new TestDockerTenantSpawnService(orchestrator);
            (orchestrator as any).tenantRoots.set(orchestrator.containerNameForTenant('alice'), aliceRoot);

            service.spawn('qaiq "build project"', {
                cwd: aliceCwd,
                env: process.env,
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            expect(service.launches).to.have.lengthOf(1);
            const launch = service.launches[0];
            expect(launch.file).to.equal('docker');
            expect(launch.args).to.include('exec');
            expect(launch.args).to.include('-i');
            expect(launch.args).to.include(orchestrator.containerNameForTenant('alice'));
            expect(launch.args).to.include('qaiq "build project"');
        });

        it('fails closed instead of spawning on the host when the tenant container was not prepared', () => {
            const orchestrator = new QaapDockerOrchestrator();
            const service = new TestDockerTenantSpawnService(orchestrator);

            expect(() => service.spawn('qaiq', {
                cwd: aliceCwd,
                env: process.env,
                stdio: ['ignore', 'pipe', 'pipe'],
            })).to.throw(/validated tenant container/);
            expect(service.launches).to.have.lengthOf(0);
        });

        it('routes spawnArgvPrepared() through docker exec targeting tenant container', () => {
            const orchestrator = new QaapDockerOrchestrator();
            const service = new TestDockerTenantSpawnService(orchestrator);
            (orchestrator as any).tenantRoots.set(orchestrator.containerNameForTenant('bob'), bobRoot);

            service.spawnArgvPrepared('npm', ['run', 'dev'], {
                cwd: bobCwd,
                env: process.env,
            });

            expect(service.launches).to.have.lengthOf(1);
            const launch = service.launches[0];
            expect(launch.file).to.equal('docker');
            expect(launch.args).to.include('exec');
            expect(launch.args).to.include('-i');
            expect(launch.args).to.include(orchestrator.containerNameForTenant('bob'));
            expect(launch.args).to.include('npm');
            expect(launch.args).to.include('dev');
        });

        it('translates the explicit git -C path into the tenant mount', () => {
            const orchestrator = new QaapDockerOrchestrator();
            const service = new TestDockerTenantSpawnService(orchestrator);
            (orchestrator as any).tenantRoots.set(orchestrator.containerNameForTenant('alice'), aliceRoot);

            const wrapped = service.wrapGitForTenant(aliceCwd, ['worktree', 'prune']);
            const containerCwd = '/workspace/acme/webapp';

            expect(wrapped.file).to.equal('docker');
            expect(wrapped.args).to.include(orchestrator.containerNameForTenant('alice'));
            expect(wrapped.args).to.include(containerCwd);
            expect(wrapped.args).to.not.include(aliceCwd);
        });

        it('translates a worktree path embedded in Git argv to the same tenant container', () => {
            const orchestrator = new QaapDockerOrchestrator();
            const service = new TestDockerTenantSpawnService(orchestrator);
            (orchestrator as any).tenantRoots.set(orchestrator.containerNameForTenant('alice'), aliceRoot);
            (orchestrator as any).tenantMounts.set(orchestrator.containerNameForTenant('alice'), {
                reposRoot: aliceRoot,
                worktreesRoot: aliceWorktreesRoot,
                parallelRoot: aliceParallelRoot,
            });

            const worktreePath = path.join(aliceWorktreesRoot, 'fork-123');
            const wrapped = service.wrapGitForTenant(aliceCwd, ['worktree', 'remove', '--force', worktreePath]);

            expect(wrapped.args).to.include('/workspace/.qaap-worktrees/fork-123');
            expect(wrapped.args).to.not.include(worktreePath);
        });

        it('routes wrapShellForTenant() to docker exec -it for interactive terminals (C-3 mitigation)', () => {
            const orchestrator = new QaapDockerOrchestrator();
            const service = new TestDockerTenantSpawnService(orchestrator);
            (orchestrator as any).tenantRoots.set(orchestrator.containerNameForTenant('alice'), aliceRoot);
            (orchestrator as any).tenantRoots.set(orchestrator.containerNameForTenant('bob'), bobRoot);

            const wrappedAlice = service.wrapShellForTenant(aliceCwd, '/bin/bash', []);
            const wrappedBob = service.wrapShellForTenant(bobCwd, '/bin/bash', []);

            expect(wrappedAlice.file).to.equal('docker');
            expect(wrappedAlice.args).to.include('-it');
            expect(wrappedAlice.args).to.include(orchestrator.containerNameForTenant('alice'));

            expect(wrappedBob.file).to.equal('docker');
            expect(wrappedBob.args).to.include('-it');
            expect(wrappedBob.args).to.include(orchestrator.containerNameForTenant('bob'));

            expect(wrappedAlice.args).to.not.deep.equal(wrappedBob.args);
        });
    });
});
