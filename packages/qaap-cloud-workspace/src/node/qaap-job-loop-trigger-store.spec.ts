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
    protected override managementLockPath(): string { return path.join(this.testDirectory, 'management.lock'); }
}

describe('QaapJobLoopTriggerStore', () => {
    let directory: string;
    let store: TestTriggerStore;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-job-loop-triggers-'));
        store = new TestTriggerStore(directory);
        store.initialize();
    });

    afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

    it('never exposes the webhook secret and de-duplicates a delivery', async () => {
        const created = await store.create('alice', { templateId: 'template', title: 'Inbound', type: 'webhook' });
        expect(created.webhookSecret).to.be.a('string');
        expect(JSON.stringify(created.trigger)).not.to.contain(created.webhookSecret!);
        expect(store.verifyWebhookSecret(created.trigger.id, created.webhookSecret!)).to.equal(true);
        expect(store.verifyWebhookSecret(created.trigger.id, 'wrong')).to.equal(false);
        expect(await store.claimDelivery(created.trigger.id, 'delivery-1')).to.equal(true);
        expect(await store.claimDelivery(created.trigger.id, 'delivery-1')).to.equal(false);
        expect(store.get('bob', created.trigger.id)).to.equal(undefined);
    });

    it('rejects invalid cron schedules and keeps the trigger kind immutable', async () => {
        let invalidSchedule: unknown;
        try {
            await store.create('alice', {
                templateId: 'template', title: 'Broken schedule', type: 'cron', cronExpression: 'not cron',
            });
        } catch (error) {
            invalidSchedule = error;
        }
        expect(invalidSchedule).to.be.instanceOf(Error);

        const created = await store.create('alice', {
            templateId: 'template', title: 'Every hour', type: 'cron', cronExpression: '0 * * * *',
        });
        let immutableKind: unknown;
        try {
            await store.update('alice', created.trigger.id, { type: 'webhook' });
        } catch (error) {
            immutableKind = error;
        }
        expect(immutableKind).to.be.instanceOf(Error);
        expect(store.get('alice', created.trigger.id)?.type).to.equal('cron');
    });

    it('refreshes a warm replica from a shared trigger state directory', async () => {
        const warmReplica = new TestTriggerStore(directory);
        warmReplica.initialize();

        const created = await store.create('alice', { templateId: 'template', title: 'Shared interval', type: 'interval' });
        expect(warmReplica.get('alice', created.trigger.id)?.title).to.equal('Shared interval');
    });

    it('preserves concurrent replica writes and claims a webhook delivery once', async () => {
        const second = new TestTriggerStore(directory);
        second.initialize();

        const [interval, webhook] = await Promise.all([
            store.create('alice', { templateId: 'template', title: 'Concurrent interval', type: 'interval' }),
            second.create('alice', { templateId: 'template', title: 'Concurrent webhook', type: 'webhook' }),
        ]);
        const restored = new TestTriggerStore(directory);
        restored.initialize();
        expect(restored.list('alice').map(trigger => trigger.title).sort()).to.deep.equal([
            'Concurrent interval', 'Concurrent webhook',
        ]);

        const claims = await Promise.all([
            store.claimDelivery(webhook.trigger.id, 'shared-delivery'),
            second.claimDelivery(webhook.trigger.id, 'shared-delivery'),
        ]);
        expect(claims.sort()).to.deep.equal([false, true]);
        expect(restored.get('alice', interval.trigger.id)?.type).to.equal('interval');
    });
});
