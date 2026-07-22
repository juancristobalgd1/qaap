// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapJobLoopTriggerLeaseManager } from './qaap-job-loop-trigger-lease';

class TestLeaseManager extends QaapJobLoopTriggerLeaseManager {
    constructor(protected readonly testDirectory: string) { super(); }
    protected override directory(): string { return this.testDirectory; }
}

describe('QaapJobLoopTriggerLeaseManager', () => {
    let directory: string;

    beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-trigger-lease-')); });
    afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

    it('coordinates one trigger slot across manager instances and releases only its own lease', () => {
        const first = new TestLeaseManager(directory);
        const second = new TestLeaseManager(directory);
        const firstLease = first.acquire('trigger-1', 'cron:1');
        expect(firstLease).to.not.equal(undefined);
        expect(second.acquire('trigger-1', 'cron:1')).to.equal(undefined);
        const otherSlot = second.acquire('trigger-1', 'cron:2');
        expect(otherSlot).to.not.equal(undefined);

        firstLease?.release();
        const secondLease = second.acquire('trigger-1', 'cron:1');
        expect(secondLease).to.not.equal(undefined);
        firstLease?.release();
        expect(new TestLeaseManager(directory).acquire('trigger-1', 'cron:1')).to.equal(undefined);
        secondLease?.release();
        otherSlot?.release();
    });

    it('recovers an expired lease', () => {
        const first = new TestLeaseManager(directory);
        const second = new TestLeaseManager(directory);
        Object.assign(first, { ttlMs: -1 });
        const expired = first.acquire('trigger-1', 'interval:1');
        expect(expired).to.not.equal(undefined);
        const replacement = second.acquire('trigger-1', 'interval:1');
        expect(replacement).to.not.equal(undefined);
        expired?.release();
        expect(new TestLeaseManager(directory).acquire('trigger-1', 'interval:1')).to.equal(undefined);
        replacement?.release();
    });

    it('uses the configured lease directory and otherwise stays with trigger state', () => {
        const manager = new QaapJobLoopTriggerLeaseManager();
        const originalLeaseDirectory = process.env.QAAP_JOB_LOOP_TRIGGER_LEASE_DIR;
        const originalStateDirectory = process.env.QAAP_JOB_LOOP_TRIGGER_STATE_DIR;
        try {
            process.env.QAAP_JOB_LOOP_TRIGGER_STATE_DIR = '/tmp/qaap-state';
            delete process.env.QAAP_JOB_LOOP_TRIGGER_LEASE_DIR;
            expect((manager as unknown as { directory(): string }).directory()).to.equal('/tmp/qaap-state/leases');
            process.env.QAAP_JOB_LOOP_TRIGGER_LEASE_DIR = '/tmp/qaap-leases';
            expect((manager as unknown as { directory(): string }).directory()).to.equal('/tmp/qaap-leases');
        } finally {
            if (originalLeaseDirectory === undefined) { delete process.env.QAAP_JOB_LOOP_TRIGGER_LEASE_DIR; } else { process.env.QAAP_JOB_LOOP_TRIGGER_LEASE_DIR = originalLeaseDirectory; }
            if (originalStateDirectory === undefined) { delete process.env.QAAP_JOB_LOOP_TRIGGER_STATE_DIR; } else { process.env.QAAP_JOB_LOOP_TRIGGER_STATE_DIR = originalStateDirectory; }
        }
    });

    it('removes expired claims for old, distinct slots during later acquisitions', () => {
        const manager = new TestLeaseManager(directory);
        Object.assign(manager, { ttlMs: -1, lastCleanupAt: 0 });
        expect(manager.acquire('trigger-1', 'interval:old')).to.not.equal(undefined);
        Object.assign(manager, { lastCleanupAt: 0 });
        expect(manager.acquire('trigger-1', 'interval:new')).to.not.equal(undefined);

        expect(fs.readdirSync(directory).filter(entry => entry.endsWith('.lease'))).to.have.length(1);
    });
});
