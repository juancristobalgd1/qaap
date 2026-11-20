// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
// The confirm dialog module touches the DOM while it loads (its own import is lazy, the test double is not).
const disableImportJSDOM = enableJSDOM();
import { expect } from 'chai';
import {
    QaapTenantUpdateClient,
    type QaapTenantBackendUpdate,
} from '@theia/qaap-shared-core/lib/browser/qaap-tenant-update-client';
import { QaapTenantUpdateConfirmDialog } from './qaap-tenant-update-confirm-dialog';
import {
    QAAP_TENANT_UPDATE_RECOVERY_TIMEOUT_MS,
    QaapTenantUpdateService,
    type QaapTenantUpdateTimers,
} from './qaap-tenant-update-service';
disableImportJSDOM();

const pending = (runningTasks = 0): QaapTenantBackendUpdate => ({ updatePending: true, runningTasks });
const idle: QaapTenantBackendUpdate = { updatePending: false, runningTasks: 0 };

/** Scripted control plane: each status read consumes the next answer, the last one repeats. */
class ScriptedClient extends QaapTenantUpdateClient {
    readonly updates: Array<QaapTenantBackendUpdate | undefined> = [];
    applyResult: boolean | Error = true;
    applyCalls = 0;
    readCalls = 0;

    override async fetchBackendUpdate(): Promise<QaapTenantBackendUpdate | undefined> {
        this.readCalls += 1;
        return this.updates.length > 1 ? this.updates.shift() : this.updates[0];
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

    now(): number {
        return this.current;
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

function setup(): { service: TestService; client: ScriptedClient; confirm: ScriptedConfirm; timers: FakeTimers; counter: { applying: number } } {
    const client = new ScriptedClient();
    const confirm = new ScriptedConfirm();
    const timers = new FakeTimers();
    const service = new TestService(client, confirm, timers);
    const counter = { applying: 0 };
    service.onDidStartApplying(() => { counter.applying += 1; });
    return { service, client, confirm, timers, counter };
}

describe('QaapTenantUpdateService', () => {

    it('reads the pending state from the runtime status, through the client', async () => {
        const { service, client } = setup();
        client.updates.push(pending(3));
        expect(await service.readBackendUpdate()).to.deep.equal(pending(3));
        expect(client.readCalls).to.equal(1);
    });

    it('applies without asking when no agent turn is running, waits for the backend, then reloads once', async () => {
        const { service, client, confirm, timers } = setup();
        client.updates.push(pending(0), idle);
        const outcome = await service.updateNow(0);
        expect(outcome).to.equal('applied');
        expect(confirm.asked).to.deep.equal([]);
        expect(client.applyCalls).to.equal(1);
        expect(timers.current).to.be.greaterThan(0);
        expect(service.reloads).to.equal(1);
    });

    it('asks before interrupting running agent turns, naming how many, and changes nothing when declined', async () => {
        const { service, client, confirm } = setup();
        confirm.answers.push(false);
        const outcome = await service.updateNow(2);
        expect(outcome).to.equal('cancelled');
        expect(confirm.asked).to.deep.equal([2]);
        expect(client.applyCalls).to.equal(0);
        expect(service.reloads).to.equal(0);
    });

    it('applies after the user accepts the interruption of running turns', async () => {
        const { service, client, confirm } = setup();
        client.updates.push(idle);
        confirm.answers.push(true);
        expect(await service.updateNow(3)).to.equal('applied');
        expect(confirm.asked).to.deep.equal([3]);
        expect(client.applyCalls).to.equal(1);
        expect(service.reloads).to.equal(1);
    });

    it('reports a failed request without reloading, so the caller can restore its control', async () => {
        const { service, client } = setup();
        client.applyResult = new Error('HTTP 500');
        expect(await service.updateNow(0)).to.equal('failed');
        expect(service.reloads).to.equal(0);
        client.applyResult = true;
        client.updates.push(idle);
        expect(await service.updateNow(0)).to.equal('applied');
        expect(client.applyCalls).to.equal(2);
    });

    it('reports nothing to apply without reloading', async () => {
        const { service, client } = setup();
        client.applyResult = false;
        expect(await service.updateNow(0)).to.equal('nothing');
        expect(service.reloads).to.equal(0);
    });

    it('tells the caller when the request is sent (after confirmation), so it can show "Updating…"', async () => {
        const { service, client, confirm, counter } = setup();
        confirm.answers.push(false);
        await service.updateNow(1);
        expect(counter.applying).to.equal(0);
        client.updates.push(idle);
        confirm.answers.push(true);
        await service.updateNow(1);
        expect(counter.applying).to.equal(1);
    });

    it('reloads anyway after the recovery window if the update never stops being pending', async () => {
        const { service, client, timers } = setup();
        client.updates.push(pending(0));
        expect(await service.updateNow(0)).to.equal('applied');
        expect(service.reloads).to.equal(1);
        expect(timers.current).to.be.at.least(QAAP_TENANT_UPDATE_RECOVERY_TIMEOUT_MS);
    });

    it('shares one run between concurrent calls, so the backend is recreated once', async () => {
        const { service, client } = setup();
        client.updates.push(idle);
        const [first, second] = await Promise.all([service.updateNow(0), service.updateNow(0)]);
        expect([first, second]).to.deep.equal(['applied', 'applied']);
        expect(client.applyCalls).to.equal(1);
        expect(service.reloads).to.equal(1);
    });
});
