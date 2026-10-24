// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import { sweepOrphanedTempFiles, sweepOrphanedTempFilesSync, writeJsonAtomic, writeJsonAtomicSync } from './qaap-write-json-atomic';

describe('qaap-write-json-atomic', () => {

    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-atomic-'));
    });

    afterEach(() => {
        sinon.restore();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const leftoverTemps = (): string[] => fs.readdirSync(dir).filter(f => f.includes('.tmp'));

    it('writes valid JSON and leaves no temp file behind', async () => {
        const file = path.join(dir, 'state.json');
        await writeJsonAtomic(file, { a: 1, b: [2, 3] });
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).to.deep.equal({ a: 1, b: [2, 3] });
        expect(leftoverTemps()).to.have.length(0);
    });

    it('keeps the previous file intact when serialization fails — never a partial write', async () => {
        const file = path.join(dir, 'state.json');
        await writeJsonAtomic(file, { ok: true });

        const circular: Record<string, unknown> = {};
        circular.self = circular;
        let threw = false;
        try {
            await writeJsonAtomic(file, circular);
        } catch {
            threw = true;
        }

        expect(threw).to.equal(true);
        // The destination still holds the last good content, and no half-written temp survives.
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).to.deep.equal({ ok: true });
        expect(leftoverTemps()).to.have.length(0);
    });

    it('sync variant applies the requested file mode (secrets stay 0600)', () => {
        const file = path.join(dir, 'tokens.json');
        writeJsonAtomicSync(file, { token: 'secret' }, { mode: 0o600 });
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).to.deep.equal({ token: 'secret' });
        if (process.platform !== 'win32') {
            expect(fs.statSync(file).mode & 0o777).to.equal(0o600);
        }
    });

    it('honors space:0 (compact) and trailingNewline', () => {
        const compact = path.join(dir, 'compact.json');
        writeJsonAtomicSync(compact, { a: 1 }, { space: 0 });
        expect(fs.readFileSync(compact, 'utf8')).to.equal('{"a":1}');

        const withNewline = path.join(dir, 'newline.json');
        writeJsonAtomicSync(withNewline, { a: 1 }, { trailingNewline: true });
        expect(fs.readFileSync(withNewline, 'utf8').endsWith('\n')).to.equal(true);
    });

    it('replaces existing content on a normal overwrite', async () => {
        const file = path.join(dir, 'state.json');
        await writeJsonAtomic(file, { v: 1 });
        await writeJsonAtomic(file, { v: 2 });
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).to.deep.equal({ v: 2 });
        expect(leftoverTemps()).to.have.length(0);
    });

    it('preserves the previous JSON when synchronous disk flush fails', () => {
        const file = path.join(dir, 'state.json');
        writeJsonAtomicSync(file, { version: 1 });
        sinon.stub(fs, 'fsyncSync').throws(new Error('flush failed'));
        expect(() => writeJsonAtomicSync(file, { version: 2 })).to.throw('flush failed');
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).to.deep.equal({ version: 1 });
        expect(leftoverTemps()).to.have.length(0);
    });

    it('preserves the previous JSON when asynchronous disk flush fails', async () => {
        const file = path.join(dir, 'state.json');
        await writeJsonAtomic(file, { version: 1 });
        const open = fsp.open;
        sinon.stub(fsp, 'open').callsFake(async (...args: Parameters<typeof fsp.open>) => {
            const handle = await open(...args);
            sinon.stub(handle, 'sync').rejects(new Error('flush failed'));
            return handle;
        });
        let failure: unknown;
        try {
            await writeJsonAtomic(file, { version: 2 });
        } catch (error) {
            failure = error;
        }
        expect(failure).to.be.instanceOf(Error);
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).to.deep.equal({ version: 1 });
        expect(leftoverTemps()).to.have.length(0);
    });

    it('does not remove a temporary file owned by another writer after repeated name collisions', async () => {
        const file = path.join(dir, 'state.json');
        const open = fsp.open;
        const collisions: string[] = [];
        sinon.stub(fsp, 'open').callsFake(async (...args: Parameters<typeof fsp.open>) => {
            collisions.push(String(args[0]));
            fs.writeFileSync(String(args[0]), 'other writer');
            return open(...args);
        });
        try {
            await writeJsonAtomic(file, {});
            expect.fail('Exclusive creation must reject repeated collisions');
        } catch (error) {
            expect((error as NodeJS.ErrnoException).code).to.equal('EEXIST');
        }
        expect(collisions).to.have.length(3);
        for (const collision of collisions) {
            expect(fs.readFileSync(collision, 'utf8')).to.equal('other writer');
        }
    });

    it('writes successfully when temp files in the pre-suffix {pid}.{counter} format already exist', async () => {
        const file = path.join(dir, 'state.json');
        for (let counter = 1; counter <= 50; counter++) {
            fs.writeFileSync(`${file}.${process.pid}.${counter}.tmp`, 'legacy');
        }
        await writeJsonAtomic(file, { ok: true });
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).to.deep.equal({ ok: true });
    });

    it('retries with another temp name after one EEXIST collision', async () => {
        const file = path.join(dir, 'state.json');
        const open = fsp.open;
        let calls = 0;
        sinon.stub(fsp, 'open').callsFake(async (...args: Parameters<typeof fsp.open>) => {
            // Only the exclusive temp-file create counts; the directory fsync also goes through open.
            if (args[1] === 'wx') {
                calls++;
                if (calls === 1) {
                    throw Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' });
                }
            }
            return open(...args);
        });
        await writeJsonAtomic(file, { retried: true });
        expect(calls).to.equal(2);
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).to.deep.equal({ retried: true });
        expect(leftoverTemps()).to.have.length(0);
    });

    it('sync variant retries with another temp name after one EEXIST collision', () => {
        const file = path.join(dir, 'state.json');
        const openSync = fs.openSync;
        let calls = 0;
        sinon.stub(fs, 'openSync').callsFake((...args: Parameters<typeof fs.openSync>) => {
            // Only the exclusive temp-file create counts; the directory fsync also goes through openSync.
            if (args[1] === 'wx') {
                calls++;
                if (calls === 1) {
                    throw Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' });
                }
            }
            return openSync(...args);
        });
        writeJsonAtomicSync(file, { retried: true });
        expect(calls).to.equal(2);
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).to.deep.equal({ retried: true });
        expect(leftoverTemps()).to.have.length(0);
    });

    for (const sweep of [sweepOrphanedTempFiles, sweepOrphanedTempFilesSync]) {
        it(`${sweep.name} removes a same-pid temp from an earlier boot but keeps one written by this boot`, async () => {
            sinon.stub(process, 'kill').throws(Object.assign(new Error('No process'), { code: 'ESRCH' }));
            const file = path.join(dir, 'state.json');
            const stale = `${file}.${process.pid}.11.tmp`;
            const fresh = `${file}.${process.pid}.12.a1b2c3d4.tmp`;
            fs.writeFileSync(stale, 'stale');
            fs.writeFileSync(fresh, 'fresh');
            const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            fs.utimesSync(stale, anHourAgo, anHourAgo);

            await sweep(file);

            expect(fs.existsSync(stale)).to.equal(false);
            expect(fs.existsSync(fresh)).to.equal(true);
        });

        it(`${sweep.name} removes a dead-pid temp in the hex-suffixed format`, async () => {
            sinon.stub(process, 'kill').throws(Object.assign(new Error('No process'), { code: 'ESRCH' }));
            const file = path.join(dir, 'state.json');
            const orphan = `${file}.99999.1.0a1b2c3d.tmp`;
            fs.writeFileSync(orphan, 'orphan');

            await sweep(file);

            expect(fs.existsSync(orphan)).to.equal(false);
        });

        it(`${sweep.name} keeps temps of another live pid and names outside the pattern`, async () => {
            const kill = sinon.stub(process, 'kill').returns(true);
            const file = path.join(dir, 'state.json');
            const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            const names = [
                `${file}.${process.ppid}.3.a1b2c3d4.tmp`,
                `${file}.${process.ppid}.4.tmp`,
                `${file}.${process.pid}.5.ABCDEF12.tmp`,
                `${file}.${process.pid}.5.extra.tmp`,
            ];
            for (const name of names) {
                fs.writeFileSync(name, 'keep');
                fs.utimesSync(name, anHourAgo, anHourAgo);
            }

            await sweep(file);

            expect(leftoverTemps()).to.have.length(names.length);
            expect(kill.calledWith(process.ppid, 0)).to.equal(true);
        });
    }

    it('sweepOrphanedTempFiles deletes temp files from other PIDs but keeps current PID temps', async () => {
        sinon.stub(process, 'kill').throws(Object.assign(new Error('No process'), { code: 'ESRCH' }));
        const file = path.join(dir, 'state.json');
        // Simulate orphaned temps from dead processes (different PIDs)
        fs.writeFileSync(`${file}.99999.1.tmp`, 'orphan-1');
        fs.writeFileSync(`${file}.88888.2.tmp`, 'orphan-2');
        fs.writeFileSync(`${file}.77777.999.tmp`, 'orphan-3');
        // Simulate an in-flight temp from the current process
        fs.writeFileSync(`${file}.${process.pid}.1.tmp`, 'in-flight');

        await sweepOrphanedTempFiles(file);

        const remaining = leftoverTemps();
        expect(remaining).to.have.length(1);
        expect(remaining[0]).to.equal(`state.json.${process.pid}.1.tmp`);
    });

    it('sweepOrphanedTempFilesSync deletes temp files from other PIDs', () => {
        sinon.stub(process, 'kill').throws(Object.assign(new Error('No process'), { code: 'ESRCH' }));
        const file = path.join(dir, 'state.json');
        fs.writeFileSync(`${file}.99999.1.tmp`, 'orphan-1');
        fs.writeFileSync(`${file}.${process.pid}.1.tmp`, 'in-flight');

        sweepOrphanedTempFilesSync(file);

        const remaining = leftoverTemps();
        expect(remaining).to.have.length(1);
        expect(remaining[0]).to.equal(`state.json.${process.pid}.1.tmp`);
    });

    it('sweepOrphanedTempFiles is a no-op when the directory does not exist', async () => {
        const file = path.join(dir, 'nonexistent', 'state.json');
        await sweepOrphanedTempFiles(file); // should not throw
    });

    for (const sweep of [sweepOrphanedTempFiles, sweepOrphanedTempFilesSync]) {
        it(`${sweep.name} preserves live writers and uncertain process ownership`, async () => {
            const file = path.join(dir, 'state.json');
            const kill = sinon.stub(process, 'kill');
            kill.withArgs(12345, 0).returns(true);
            kill.withArgs(12346, 0).throws(Object.assign(new Error('Permission denied'), { code: 'EPERM' }));
            kill.withArgs(12347, 0).throws(Object.assign(new Error('Unknown failure'), { code: 'EINVAL' }));
            for (const pid of [12345, 12346, 12347]) {
                fs.writeFileSync(`${file}.${pid}.1.tmp`, 'keep');
            }
            await sweep(file);
            expect(leftoverTemps()).to.have.length(3);
            expect(kill.callCount).to.equal(3);
        });

        it(`${sweep.name} ignores unrelated and malformed filenames`, async () => {
            const file = path.join(dir, 'state.json');
            const kill = sinon.stub(process, 'kill');
            const names = ['backup', '123.bad', '0.1', '-2.1', '123.1.extra', '999999999999999999.1'];
            for (const name of names) {
                fs.writeFileSync(`${file}.${name}.tmp`, 'keep');
            }
            await sweep(file);
            expect(leftoverTemps()).to.have.length(names.length);
            expect(kill.called).to.equal(false);
        });
    }
});
