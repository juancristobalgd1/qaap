// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapJobLoopTriggerStore } from './qaap-job-loop-trigger-store';

class TestTriggerStore extends QaapJobLoopTriggerStore {
    constructor(protected readonly testDirectory: string) { super(); }
    initialize(): void { this.init(); }
    protected override directory(): string { return this.testDirectory; }
}

describe('QaapJobLoopTriggerStore', () => {
    it('never exposes the webhook secret and de-duplicates a delivery', () => {
        const store = Object.create(QaapJobLoopTriggerStore.prototype) as QaapJobLoopTriggerStore;
        Object.assign(store, { triggers: new Map(), load: () => undefined, persist: () => undefined });
        const created = store.create('alice', { templateId: 'template', title: 'Inbound', type: 'webhook' });
        expect(created.webhookSecret).to.be.a('string');
        expect(JSON.stringify(created.trigger)).not.to.contain(created.webhookSecret!);
        expect(store.verifyWebhookSecret(created.trigger.id, created.webhookSecret!)).to.equal(true);
        expect(store.verifyWebhookSecret(created.trigger.id, 'wrong')).to.equal(false);
        expect(store.claimDelivery(created.trigger.id, 'delivery-1')).to.equal(true);
        expect(store.claimDelivery(created.trigger.id, 'delivery-1')).to.equal(false);
        expect(store.get('bob', created.trigger.id)).to.equal(undefined);
    });

    it('rejects invalid cron schedules and keeps the trigger kind immutable', () => {
        const store = Object.create(QaapJobLoopTriggerStore.prototype) as QaapJobLoopTriggerStore;
        Object.assign(store, { triggers: new Map(), load: () => undefined, persist: () => undefined });

        expect(() => store.create('alice', {
            templateId: 'template', title: 'Broken schedule', type: 'cron', cronExpression: 'not cron',
        })).to.throw();

        const created = store.create('alice', {
            templateId: 'template', title: 'Every hour', type: 'cron', cronExpression: '0 * * * *',
        });
        expect(() => store.update('alice', created.trigger.id, { type: 'webhook' })).to.throw();
        expect(store.get('alice', created.trigger.id)?.type).to.equal('cron');
    });

    it('refreshes a warm replica from a shared trigger state directory', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-job-loop-triggers-'));
        try {
            const first = new TestTriggerStore(directory);
            const second = new TestTriggerStore(directory);
            first.initialize();
            second.initialize();

            const created = first.create('alice', { templateId: 'template', title: 'Shared interval', type: 'interval' });
            expect(second.get('alice', created.trigger.id)?.title).to.equal('Shared interval');
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});
