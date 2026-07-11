// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeJsonAtomic, writeJsonAtomicSync } from './qaap-write-json-atomic';

describe('qaap-write-json-atomic', () => {

    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-atomic-'));
    });

    afterEach(() => {
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
        expect(fs.statSync(file).mode & 0o777).to.equal(0o600);
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
});
