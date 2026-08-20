// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapPlanRepoLimitError } from '@theia/qaap-adapters/lib/common/qaap-billing-quota';
import { QaapBillingQuotaService } from './qaap-billing-quota-service';
import { QaapBillingStore } from './qaap-billing-store';

function makeStore(filePath: string): QaapBillingStore {
    const store = Object.create(QaapBillingStore.prototype) as QaapBillingStore;
    Object.assign(store, {
        filePath,
        writeChain: Promise.resolve(),
        entitlementsCache: new Map(),
    });
    return store;
}

describe('QaapBillingQuotaService', () => {
    let tmpDir: string;
    let filePath: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-quota-'));
        filePath = path.join(tmpDir, 'billing-accounts.json');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('throws plan_repo_limit when Starter already has 3 active clones', async () => {
        const quota = Object.create(QaapBillingQuotaService.prototype) as QaapBillingQuotaService;
        Object.assign(quota, { store: makeStore(filePath) });
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

    it('does not cap Team (unlimited active repos)', async () => {
        const store = makeStore(filePath);
        await store.setPlan('alice', 'team');
        const quota = Object.create(QaapBillingQuotaService.prototype) as QaapBillingQuotaService;
        Object.assign(quota, { store });
        await quota.assertCanAddActiveRepo('alice', 99);
    });
});
