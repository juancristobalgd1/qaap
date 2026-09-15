// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { ChildProcess } from 'child_process';
import * as path from 'path';
import { resolveQaapReposRoot } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
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

        it('creates one non-root container with only the tenant root mounted and hardening enabled', async () => {
            const previousEnv = process.env;
            process.env = { ...previousEnv, QAAP_CLOUD_MODE: 'docker', QAAP_TENANT_DOCKER_IMAGE: 'qaap-test-worker:local' };
            try {
                let created: any;
                let createOptions: any;
                let createCalls = 0;
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
                                Mounts: [{ Source: aliceRoot, Destination: '/workspace', RW: true }],
                            }),
                        };
                        return created;
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
                expect(createOptions.HostConfig.Binds).to.deep.equal([`${aliceRoot}:/workspace:rw`]);
                expect(createOptions.User).to.equal('1000:1000');
                expect(createOptions.HostConfig.CapDrop).to.deep.equal(['ALL']);
                expect(createOptions.HostConfig.SecurityOpt).to.include('no-new-privileges:true');
                expect(createOptions.HostConfig.ReadonlyRootfs).to.equal(true);
                expect(createOptions.HostConfig.PidsLimit).to.be.greaterThan(0);
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

        it('wraps interactive terminal into docker exec -it targeting the tenant container', () => {
            (orchestrator as any).tenantRoots.set(orchestrator.containerNameForTenant('bob'), bobRoot);
            const wrapped = orchestrator.wrapInteractiveTerminalForTenant('bob', bobCwd, '/bin/bash', ['-l']);
            const containerName = orchestrator.containerNameForTenant('bob');
            const expectedCwd = orchestrator.toContainerPath(bobCwd, bobRoot);

            expect(wrapped.file).to.equal('docker');
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
