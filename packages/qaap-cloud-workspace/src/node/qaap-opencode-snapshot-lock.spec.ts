// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OPENCODE_SNAPSHOT_LOCK_STALE_MS, removeStaleOpencodeSnapshotLocks } from './qaap-opencode-snapshot-lock';

describe('removeStaleOpencodeSnapshotLocks', () => {
    let dataHome: string;
    let snapshotRepo: string;

    beforeEach(() => {
        dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-opencode-lock-'));
        snapshotRepo = path.join(dataHome, 'opencode', 'snapshot', 'project-hash');
        fs.mkdirSync(snapshotRepo, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(dataHome, { recursive: true, force: true });
    });

    function writeLock(file: string, ageMs: number): void {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '');
        const when = (Date.now() - ageMs) / 1000;
        fs.utimesSync(file, when, when);
    }

    it('removes an index.lock older than the stale threshold', async () => {
        const lock = path.join(snapshotRepo, 'index.lock');
        writeLock(lock, OPENCODE_SNAPSHOT_LOCK_STALE_MS + 60_000);

        const removed = await removeStaleOpencodeSnapshotLocks(dataHome);

        expect(removed).to.deep.equal([lock]);
        expect(fs.existsSync(lock)).to.be.false;
    });

    it('keeps a fresh index.lock that a concurrent run may still hold', async () => {
        const lock = path.join(snapshotRepo, 'index.lock');
        writeLock(lock, 5_000);

        const removed = await removeStaleOpencodeSnapshotLocks(dataHome);

        expect(removed).to.deep.equal([]);
        expect(fs.existsSync(lock)).to.be.true;
    });

    it('finds a nested .git/index.lock and ignores locks outside the snapshot store', async () => {
        const nested = path.join(snapshotRepo, '.git', 'index.lock');
        const outside = path.join(dataHome, 'opencode', 'index.lock');
        writeLock(nested, OPENCODE_SNAPSHOT_LOCK_STALE_MS + 1_000);
        writeLock(outside, OPENCODE_SNAPSHOT_LOCK_STALE_MS + 1_000);

        const removed = await removeStaleOpencodeSnapshotLocks(dataHome);

        expect(removed).to.deep.equal([nested]);
        expect(fs.existsSync(outside)).to.be.true;
    });

    it('does not follow a symbolic link named index.lock', async () => {
        const target = path.join(dataHome, 'precious-index');
        fs.writeFileSync(target, 'keep');
        const link = path.join(snapshotRepo, 'index.lock');
        fs.symlinkSync(target, link);
        const old = (Date.now() - OPENCODE_SNAPSHOT_LOCK_STALE_MS - 60_000) / 1000;
        fs.utimesSync(target, old, old);

        const removed = await removeStaleOpencodeSnapshotLocks(dataHome);

        expect(removed).to.deep.equal([]);
        expect(fs.readFileSync(target, 'utf8')).to.equal('keep');
    });

    it('does nothing when no data home is configured or the store is missing', async () => {
        expect(await removeStaleOpencodeSnapshotLocks(undefined)).to.deep.equal([]);
        expect(await removeStaleOpencodeSnapshotLocks('')).to.deep.equal([]);
        expect(await removeStaleOpencodeSnapshotLocks(path.join(dataHome, 'missing'))).to.deep.equal([]);
    });
});
