// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
// The confirm dialog module touches the DOM while loading.
const disableImportJSDOM = enableJSDOM();
import { expect } from 'chai';
import { QaapTenantUpdateClient, type QaapTenantUpdateStatus } from '@theia/qaap-shared-core/lib/browser/qaap-tenant-update-client';
import { QaapTenantUpdateConfirmDialog } from './qaap-tenant-update-confirm-dialog';
import {
    QAAP_TENANT_UPDATE_POLL_MS,
    QAAP_TENANT_UPDATE_RECOVERY_TIMEOUT_MS,
    QaapTenantUpdateService,
    type QaapTenantUpdateState,
    type QaapTenantUpdateTimers,
} from './qaap-tenant-update-service';
disableImportJSDOM();

/** Scripted control-plane answers; each read consumes the next status, the last one repeats. */
class ScriptedClient extends QaapTenantUpdateClient {
    readonly statuses: QaapTenantUpdateStatus[] = [];
    failStatus = false;
    applyResult: boolean | Error = true;
    applyCalls = 0;

    override async fetchStatus(): Promise<QaapTenantUpdateStatus> {
        if (this.failStatus) {
            throw new Error('offline');
        }
        const next = this.statuses.length > 1 ? this.statuses.shift()! : this.statuses[0];
        return next;
    }

    override async applyUpdate(): Promise<boolean> {
        this.applyCalls += 1;
        if (this.applyResult instanceof Error) {
            throw this.applyResult;
        }
        return this.applyResult;
    }
}

class ScriptedConfirm extends QaapTenantUpdateConfirmDialog {
    answers: boolean[] = [];
    asked: number[] = [];

    override async confirm(runningTasks: number): Promise<boolean> {
        this.asked.push(runningTasks);
        return this.answers.shift() ?? false;
    }
}

class FakeTimers implements QaapTenantUpdateTimers {
    current = 0;
    readonly intervals: Array<{ readonly ms: number; readonly handle: number }> = [];
    readonly cleared: number[] = [];
    private nextHandle = 1;

    now(): number {
        return this.current;
    }

    setInterval(_callback: () => void, ms: number): unknown {
        const handle = this.nextHandle++;
        this.intervals.push({ ms, handle });
        return handle;
    }

    clearInterval(handle: unknown): void {
        this.cleared.push(handle as number);
    }

    async delay(ms: number): Promise<void> {
        this.current += ms;
    }
}

class TestService extends QaapTenantUpdateService {
    reloads = 0;

    protected override reloadPage(): void {
        this.reloads += 1;
    }
}

function setup(): { service: TestService; client: ScriptedClient; confirm: ScriptedConfirm; timers: FakeTimers; states: QaapTenantUpdateState[] } {
    const service = new TestService();
    const client = new ScriptedClient();
    const confirm = new ScriptedConfirm();
    const timers = new FakeTimers();
    const internals = service as unknown as { client: unknown; confirmDialog: unknown; timers: unknown };
    internals.client = client;
    internals.confirmDialog = confirm;
    internals.timers = timers;
    const states: QaapTenantUpdateState[] = [];
    service.onDidChangeState(state => states.push(state));
    return { service, client, confirm, timers, states };
}

const idle: QaapTenantUpdateStatus = { updateAvailable: false, runningTasks: 0 };
const pending = (runningTasks = 0): QaapTenantUpdateStatus => ({ updateAvailable: true, runningTasks });

describe('QaapTenantUpdateService', () => {

    it('reads the status on start and polls every five minutes; stop clears the poll', async () => {
        const { service, client, timers } = setup();
        client.statuses.push(pending());
        service.start();
        await flush();
        expect(service.getState().status).to.deep.equal(pending());
        expect(timers.intervals).to.have.length(1);
        expect(timers.intervals[0].ms).to.equal(QAAP_TENANT_UPDATE_POLL_MS);
        service.start();
        expect(timers.intervals).to.have.length(1);
        service.stop();
        expect(timers.cleared).to.deep.equal([timers.intervals[0].handle]);
    });

    it('keeps the last known state silently when a read fails', async () => {
        const { service, client, states } = setup();
        client.statuses.push(pending(1));
        await service.refresh();
        client.failStatus = true;
        await service.refresh();
        expect(service.getState().status).to.deep.equal(pending(1));
        expect(states).to.have.length(1);
    });

    it('applies without asking when no agent turn is running, then reloads once the backend is current', async () => {
        const { service, client, confirm, timers } = setup();
        client.statuses.push(pending(0), idle);
        await service.refresh();
        await service.updateNow();
        expect(confirm.asked).to.deep.equal([]);
        expect(client.applyCalls).to.equal(1);
        expect(timers.current).to.be.greaterThan(0);
        expect(service.reloads).to.equal(1);
    });

    it('asks before interrupting running agent turns, naming how many, and does nothing when declined', async () => {
        const { service, client, confirm } = setup();
        client.statuses.push(pending(2));
        await service.refresh();
        confirm.answers.push(false);
        await service.updateNow();
        expect(confirm.asked).to.deep.equal([2]);
        expect(client.applyCalls).to.equal(0);
        expect(service.reloads).to.equal(0);
        expect(service.getState().phase).to.equal('idle');
    });

    it('applies after the user accepts the interruption', async () => {
        const { service, client, confirm } = setup();
        client.statuses.push(pending(3), idle);
        await service.refresh();
        confirm.answers.push(true);
        await service.updateNow();
        expect(client.applyCalls).to.equal(1);
        expect(service.reloads).to.equal(1);
    });

    it('shows failure and lets the user retry; no reload after a failed apply', async () => {
        const { service, client, states } = setup();
        client.statuses.push(pending(0), idle);
        client.applyResult = new Error('HTTP 500');
        await service.refresh();
        await service.updateNow();
        expect(service.getState().phase).to.equal('failed');
        expect(service.reloads).to.equal(0);
        client.applyResult = true;
        await service.updateNow();
        expect(client.applyCalls).to.equal(2);
        expect(service.reloads).to.equal(1);
        expect(states.map(state => state.phase)).to.include('failed');
    });

    it('does not reload when the control plane had nothing to apply', async () => {
        const { service, client } = setup();
        client.statuses.push(pending(0), idle);
        client.applyResult = false;
        await service.refresh();
        await service.updateNow();
        expect(service.reloads).to.equal(0);
        expect(service.getState().phase).to.equal('idle');
    });

    it('reloads anyway after the recovery window if the status never clears', async () => {
        const { service, client, timers } = setup();
        client.statuses.push(pending(0));
        await service.refresh();
        await service.updateNow();
        expect(service.reloads).to.equal(1);
        expect(timers.current).to.be.at.least(QAAP_TENANT_UPDATE_RECOVERY_TIMEOUT_MS);
    });

    it('ignores a second "Update now" while the first is in progress', async () => {
        const { service, client } = setup();
        client.statuses.push(pending(0), idle);
        await service.refresh();
        const first = service.updateNow();
        const second = service.updateNow();
        await Promise.all([first, second]);
        expect(client.applyCalls).to.equal(1);
        expect(service.reloads).to.equal(1);
    });
});

/** Lets pending promise callbacks (the non-awaited first read) run. */
async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await Promise.resolve();
    }
}
