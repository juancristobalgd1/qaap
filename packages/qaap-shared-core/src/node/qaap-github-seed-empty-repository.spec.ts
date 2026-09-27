// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { seedEmptyRepository } from './qaap-github-seed-empty-repository';

describe('seedEmptyRepository', () => {

    it('creates package.json and index.html in an empty repository', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'qaap-seed-'));
        try {
            await fs.mkdir(path.join(tmp, '.git'));
            await fs.writeFile(path.join(tmp, 'README.md'), '# repo\n', 'utf-8');

            const calls: string[][] = [];
            const seeded = await seedEmptyRepository(tmp, 'my-app', async args => { calls.push(args); });

            expect(seeded).to.equal(true);
            const packageJson = JSON.parse(await fs.readFile(path.join(tmp, 'package.json'), 'utf-8'));
            expect(packageJson.name).to.equal('my-app');
            expect(packageJson.scripts.dev).to.be.a('string');
            const indexHtml = await fs.readFile(path.join(tmp, 'index.html'), 'utf-8');
            expect(indexHtml).to.include('my-app');
            expect(calls).to.have.length(3);
            expect(calls[0]).to.deep.equal(['-C', tmp, 'add', 'package.json', 'index.html']);
            expect(calls[1]).to.deep.equal(['-C', tmp, '-c', 'user.email=qaaq@qaap.dev', '-c', 'user.name=Qaaq', 'commit', '-m', 'Initial scaffold']);
            expect(calls[2]).to.deep.equal(['-C', tmp, 'push', 'origin', 'HEAD']);
        } finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });

    it('does nothing when the repository already has meaningful files', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'qaap-seed-'));
        try {
            await fs.mkdir(path.join(tmp, '.git'));
            await fs.writeFile(path.join(tmp, 'src.ts'), '', 'utf-8');

            const calls: string[][] = [];
            const seeded = await seedEmptyRepository(tmp, 'my-app', async args => { calls.push(args); });

            expect(seeded).to.equal(false);
            expect(calls).to.have.length(0);
        } finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });
});
