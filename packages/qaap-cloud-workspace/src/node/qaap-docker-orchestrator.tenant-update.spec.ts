// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type * as Dockerode from 'dockerode';
import {
    QaapDockerOrchestrator,
    type QaapTenantBackendEnsureOptions,
    type QaapTenantBackendTarget,
} from './qaap-docker-orchestrator';
import type { QaapTenantBusyStatus } from './qaap-tenant-busy-probe';

const OWNER = 'Alice';
const NEW_IMAGE = 'sha256:new';
const OLD_IMAGE = 'sha256:old';

/**
 * Orchestrator whose Docker and tenant-HTTP touch points are replaced by plain fields. The real
 * `runsCurrentTenantImage`, `tenantUpdateStatus`, `applyTenantUpdateNow` and `ensureTenantBackend`
 * logic runs unchanged. The recreation itself (`createOrValidateTenantBackend`) is stubbed: the
 * stale-but-busy deferral branch inside it needs a real Docker daemon and is not covered here.
 */
class UpdateTestOrchestrator extends QaapDockerOrchestrator {
    /** Image the serving tag points at (what `runsCurrentTenantImage` compares against). */
    currentImage = NEW_IMAGE;
    /** Image the tenant's running container was created from. */
    containerImage = OLD_IMAGE;
    running = true;
    busyTasks = 0;
    inspectCount = 0;
    readonly createCalls: QaapTenantBackendEnsureOptions[] = [];
    /** When set, recreations wait on it so concurrent callers overlap. */
    gate: Promise<void> | undefined;

    protected override async getDocker(): Promise<Dockerode> {
        const self = this;
        return {
            getContainer: (): unknown => ({
                inspect: async (): Promise<unknown> => {
                    self.inspectCount += 1;
                    return { Id: 'container-1', Image: self.containerImage, State: { Running: self.running, Paused: false } };
                },
            }),
            getImage: (): unknown => ({ inspect: async (): Promise<unknown> => ({ Id: self.currentImage }) }),
        } as unknown as Dockerode;
    }

    protected override isManagedTenantBackendFor(): boolean {
        return true;
    }

    override async probeTenantBackendBusy(): Promise<QaapTenantBusyStatus | undefined> {
        return { busy: this.busyTasks > 0, runningTasks: this.busyTasks };
    }

    protected override async createOrValidateTenantBackend(
        _ownerLogin: string,
        _tenantRootHostPath: string,
        options: QaapTenantBackendEnsureOptions = {},
    ): Promise<QaapTenantBackendTarget> {
        this.createCalls.push(options);
        if (this.gate) {
            await this.gate;
        }
        this.containerImage = this.currentImage;
        return { containerId: 'container-1', containerName: 'qaap-backend-alice', host: '127.0.0.1', port: 4000 } as unknown as QaapTenantBackendTarget;
    }
}

describe('QaapDockerOrchestrator tenant update (Update now)', () => {

    const saved = {
        perTenant: process.env.QAAP_BACKEND_PER_TENANT,
        image: process.env.QAAP_TENANT_DOCKER_IMAGE,
    };

    beforeEach(() => {
        process.env.QAAP_BACKEND_PER_TENANT = '1';
        process.env.QAAP_TENANT_DOCKER_IMAGE = 'qaap-theia:test';
    });

    afterEach(() => {
        restoreEnv('QAAP_BACKEND_PER_TENANT', saved.perTenant);
        restoreEnv('QAAP_TENANT_DOCKER_IMAGE', saved.image);
    });

    describe('tenantUpdateStatus', () => {

        it('reports no update when the running backend already uses the serving image', async () => {
            const orchestrator = new UpdateTestOrchestrator();
            orchestrator.containerImage = NEW_IMAGE;
            expect(await orchestrator.tenantUpdateStatus(OWNER)).to.deep.equal({ updateAvailable: false, runningTasks: 0 });
        });

        it('reports an update for a stale backend that is idle', async () => {
            const orchestrator = new UpdateTestOrchestrator();
            expect(await orchestrator.tenantUpdateStatus(OWNER)).to.deep.equal({ updateAvailable: true, runningTasks: 0 });
        });

        it('reports an update and the running turns for a stale backend that is busy', async () => {
            const orchestrator = new UpdateTestOrchestrator();
            orchestrator.busyTasks = 2;
            expect(await orchestrator.tenantUpdateStatus(OWNER)).to.deep.equal({ updateAvailable: true, runningTasks: 2 });
        });

        it('reports no update when there is no backend container yet', async () => {
            const orchestrator = new UpdateTestOrchestrator();
            const missing = {
                getContainer: (): unknown => ({ inspect: async (): Promise<never> => { throw Object.assign(new Error('no such container'), { statusCode: 404 }); } }),
            } as unknown as Dockerode;
            (orchestrator as unknown as { getDocker: () => Promise<Dockerode> }).getDocker = async (): Promise<Dockerode> => missing;
            expect(await orchestrator.tenantUpdateStatus(OWNER)).to.deep.equal({ updateAvailable: false, runningTasks: 0 });
        });

        it('trusts a deferred recreation without inspecting Docker', async () => {
            const orchestrator = new UpdateTestOrchestrator();
            orchestrator.containerImage = NEW_IMAGE;
            (orchestrator as unknown as { deferredTenantBackendRecreations: Set<string> }).deferredTenantBackendRecreations.add('alice');
            expect(await orchestrator.tenantUpdateStatus(OWNER)).to.deep.equal({ updateAvailable: true, runningTasks: 0 });
            expect(orchestrator.inspectCount).to.equal(0);
        });

        it('answers from a short cache instead of inspecting Docker on every poll', async () => {
            const orchestrator = new UpdateTestOrchestrator();
            await orchestrator.tenantUpdateStatus(OWNER);
            orchestrator.containerImage = NEW_IMAGE;
            expect(await orchestrator.tenantUpdateStatus(OWNER)).to.deep.equal({ updateAvailable: true, runningTasks: 0 });
            expect(orchestrator.inspectCount).to.equal(1);
        });

        it('is neutral outside backend-per-tenant mode and never touches Docker', async () => {
            delete process.env.QAAP_BACKEND_PER_TENANT;
            const orchestrator = new UpdateTestOrchestrator();
            expect(await orchestrator.tenantUpdateStatus(OWNER)).to.deep.equal({ updateAvailable: false, runningTasks: 0 });
            expect(orchestrator.inspectCount).to.equal(0);
            expect(await orchestrator.applyTenantUpdateNow(OWNER)).to.equal(false);
            expect(orchestrator.createCalls).to.have.length(0);
        });
    });

    describe('applyTenantUpdateNow', () => {

        it('is a no-op when the backend already runs the serving image', async () => {
            const orchestrator = new UpdateTestOrchestrator();
            orchestrator.containerImage = NEW_IMAGE;
            expect(await orchestrator.applyTenantUpdateNow(OWNER)).to.equal(false);
            expect(orchestrator.createCalls).to.have.length(0);
        });

        it('recreates a stale backend even while agent turns run, and says so with interruptRunningTurns', async () => {
            const orchestrator = new UpdateTestOrchestrator();
            orchestrator.busyTasks = 3;
            expect(await orchestrator.applyTenantUpdateNow(OWNER)).to.equal(true);
            expect(orchestrator.createCalls).to.deep.equal([{ interruptRunningTurns: true }]);
        });

        it('recreates once for concurrent calls and then reports nothing left to do', async () => {
            const orchestrator = new UpdateTestOrchestrator();
            let release: () => void = () => undefined;
            orchestrator.gate = new Promise<void>(resolve => { release = resolve; });
            const first = orchestrator.applyTenantUpdateNow(OWNER);
            const second = orchestrator.applyTenantUpdateNow(OWNER);
            release();
            expect(await Promise.all([first, second])).to.deep.equal([true, true]);
            expect(orchestrator.createCalls).to.have.length(1);
            expect(await orchestrator.applyTenantUpdateNow(OWNER)).to.equal(false);
            expect(orchestrator.createCalls).to.have.length(1);
        });

        it('leaves the normal wake path non-interrupting, so a deploy still never ends a turn', async () => {
            const orchestrator = new UpdateTestOrchestrator();
            orchestrator.busyTasks = 1;
            await orchestrator.ensureTenantBackend(OWNER, '/qaap-test/tenant-root');
            expect(orchestrator.createCalls).to.deep.equal([{ interruptRunningTurns: false }]);
        });
    });
});

function restoreEnv(name: string, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}
