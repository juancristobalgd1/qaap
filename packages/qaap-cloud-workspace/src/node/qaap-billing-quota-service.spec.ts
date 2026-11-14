// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapPlanRepoLimitError, QaapPlanStorageLimitError } from '@theia/qaap-adapters/lib/common/qaap-billing-quota';
import { QaapBillingQuotaService } from './qaap-billing-quota-service';
import { QaapBillingStore } from './qaap-billing-store';

import { QaapSqliteConnectionRegistry } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';

function makeStore(filePath: string): QaapBillingStore {
    const store = Object.create(QaapBillingStore.prototype) as QaapBillingStore;
    Object.assign(store, {
        filePath,
        writeChain: Promise.resolve(),
        entitlementsCache: new Map(),
    });
    return store;
}

const noStorageLimit = { isOverStorageLimit: async (): Promise<boolean> => false };

describe('QaapBillingQuotaService', () => {
    let tmpDir: string;
    let filePath: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-quota-'));
        filePath = path.join(tmpDir, 'billing-accounts.json');
    });

    afterEach(() => {
        QaapSqliteConnectionRegistry.shared.closeUnder(tmpDir);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('throws plan_repo_limit when Starter already has 3 active clones', async () => {
        const quota = Object.create(QaapBillingQuotaService.prototype) as QaapBillingQuotaService;
        Object.assign(quota, { store: makeStore(filePath), storage: noStorageLimit });
        await quota.assertCanAddActiveRepo('alice', 2);
        try {
            await quota.assertCanAddActiveRepo('alice', 3);
            expect.fail('expected QaapPlanRepoLimitError');
        } catch (error) {
            expect(error).to.be.instanceOf(QaapPlanRepoLimitError);
            const limit = error as QaapPlanRepoLimitError;
            expect(limit.code).to.equal('plan_repo_limit');
            expect(limit.planId).to.equal('starter');
            expect(limit.limit).to.equal(3);
        }
    });

    it('caps Pro at 10 active repos', async () => {
        const store = makeStore(filePath);
        await store.setPlan('alice', 'pro');
        const quota = Object.create(QaapBillingQuotaService.prototype) as QaapBillingQuotaService;
        Object.assign(quota, { store, storage: noStorageLimit });
        await quota.assertCanAddActiveRepo('alice', 9);
        try {
            await quota.assertCanAddActiveRepo('alice', 10);
            expect.fail('expected QaapPlanRepoLimitError');
        } catch (error) {
            expect((error as QaapPlanRepoLimitError).limit).to.equal(10);
            expect((error as QaapPlanRepoLimitError).planId).to.equal('pro');
        }
    });

    it('reports the plan allowances the UI shows', async () => {
        const store = makeStore(filePath);
        await store.setPlan('alice', 'pro');
        const quota = Object.create(QaapBillingQuotaService.prototype) as QaapBillingQuotaService;
        Object.assign(quota, { store, storage: noStorageLimit });
        const snapshot = await quota.getEntitlements('alice');
        expect(snapshot).to.deep.include({
            planId: 'pro',
            maxConcurrentAgents: 4,
            maxActiveRepos: 10,
            storageGb: 30,
            defaultMemoryGb: 2,
            cpuLimit: 4,
            idlePauseMinutes: 360,
        });
        expect(snapshot.memoryOptionsGb).to.deep.equal([2, 4]);
    });
    it('throws plan_limit/storage_limit when the workspace is over its plan storage', async () => {
        const quota = Object.create(QaapBillingQuotaService.prototype) as QaapBillingQuotaService;
        Object.assign(quota, { store: makeStore(filePath), storage: { isOverStorageLimit: async (): Promise<boolean> => true } });
        try {
            await quota.assertCanAddActiveRepo('alice', 0);
            expect.fail('expected QaapPlanStorageLimitError');
        } catch (error) {
            expect(error).to.be.instanceOf(QaapPlanStorageLimitError);
            const limit = error as QaapPlanStorageLimitError;
            expect(limit.code).to.equal('plan_limit');
            expect(limit.reason).to.equal('storage_limit');
            expect(limit.limit).to.equal(10);
        }
    });

});
