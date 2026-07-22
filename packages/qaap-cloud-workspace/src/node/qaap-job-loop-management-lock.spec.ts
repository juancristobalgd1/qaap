// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    QaapJobLoopManagementLockTimeoutError,
    withQaapJobLoopManagementLock,
} from './qaap-job-loop-management-lock';

describe('withQaapJobLoopManagementLock', () => {
    let directory: string;
    let lockPath: string;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-job-loop-management-lock-'));
        lockPath = path.join(directory, 'index.json.lock');
    });

    afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

    it('serializes transactions that target the same shared index', async () => {
        const order: string[] = [];
        let releaseFirst: (() => void) | undefined;
        const firstGate = new Promise<void>(resolve => releaseFirst = resolve);
        const first = withQaapJobLoopManagementLock(lockPath, async () => {
            order.push('first-enter');
            await firstGate;
            order.push('first-leave');
        }, { ttlMs: 5_000, timeoutMs: 1_000, retryMs: 5 });
        while (!order.length) {
            await new Promise(resolve => setTimeout(resolve, 1));
        }
        const second = withQaapJobLoopManagementLock(lockPath, async () => {
            order.push('second-enter');
        }, { ttlMs: 5_000, timeoutMs: 1_000, retryMs: 5 });

        await new Promise(resolve => setTimeout(resolve, 20));
        expect(order).to.deep.equal(['first-enter']);
        releaseFirst?.();
        await Promise.all([first, second]);
        expect(order).to.deep.equal(['first-enter', 'first-leave', 'second-enter']);
    });

    it('reclaims an expired lock and times out on an active lock', async () => {
        fs.writeFileSync(lockPath, JSON.stringify({ version: 1, ownerId: 'dead', lockId: 'old', expiresAt: Date.now() - 1 }));
        await withQaapJobLoopManagementLock(lockPath, async () => undefined, { ttlMs: 5_000, timeoutMs: 100, retryMs: 5 });
        expect(fs.existsSync(lockPath)).to.equal(false);

        fs.writeFileSync(lockPath, JSON.stringify({ version: 1, ownerId: 'live', lockId: 'current', expiresAt: Date.now() + 5_000 }));
        let caught: unknown;
        try {
            await withQaapJobLoopManagementLock(lockPath, async () => undefined, { ttlMs: 5_000, timeoutMs: 25, retryMs: 5 });
        } catch (error) {
            caught = error;
        }
        expect(caught).to.be.instanceOf(QaapJobLoopManagementLockTimeoutError);
    });

    it('elects one stale-lock reclaimer without overlapping transactions', async () => {
        fs.writeFileSync(lockPath, JSON.stringify({ version: 1, ownerId: 'dead', lockId: 'old', expiresAt: Date.now() - 1 }));
        let active = 0;
        let maximumActive = 0;
        await Promise.all(Array.from({ length: 12 }, () => withQaapJobLoopManagementLock(lockPath, async () => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await new Promise(resolve => setTimeout(resolve, 2));
            active -= 1;
        }, { ttlMs: 5_000, timeoutMs: 1_000, retryMs: 1 })));

        expect(maximumActive).to.equal(1);
        expect(fs.existsSync(lockPath)).to.equal(false);
    });

    it('allows a nested transaction to reuse the lock held by its async context', async () => {
        const value = await withQaapJobLoopManagementLock(
            lockPath,
            async () => withQaapJobLoopManagementLock(lockPath, async () => 42, { timeoutMs: 25 }),
            { ttlMs: 5_000, timeoutMs: 100 },
        );

        expect(value).to.equal(42);
        expect(fs.existsSync(lockPath)).to.equal(false);
    });
});
