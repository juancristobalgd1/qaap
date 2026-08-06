// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import AdmZip = require('adm-zip');
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { gzip as gzipCallback } from 'zlib';
import * as tarStream from 'tar-stream';
import { extractArchive } from './safe-archive-extractor';

const gzip = promisify(gzipCallback);

async function createTar(entries: Array<{ name: string; type?: 'file' | 'symlink'; data?: Buffer; linkname?: string }>): Promise<Buffer> {
    const pack = tarStream.pack();
    const chunks: Buffer[] = [];
    const done = new Promise<void>((resolve, reject) => {
        pack.on('data', chunk => chunks.push(Buffer.from(chunk)));
        pack.on('end', resolve);
        pack.on('error', reject);
    });
    for (const entry of entries) {
        pack.entry({
            name: entry.name,
            type: entry.type ?? 'file',
            linkname: entry.linkname,
            mode: 0o644,
        }, entry.data ?? Buffer.alloc(0));
    }
    pack.finalize();
    await done;
    return Buffer.concat(chunks);
}

async function expectRefusal(action: () => Promise<unknown>, pattern: RegExp): Promise<void> {
    let error: unknown;
    try {
        await action();
    } catch (caught) {
        error = caught;
    }
    expect(error).to.be.instanceOf(Error);
    expect((error as Error).message).to.match(pattern);
}

describe('safe archive extractor', () => {

    let sandbox: string;

    beforeEach(async () => {
        sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'qaap-safe-archive-'));
    });

    afterEach(async () => {
        await fs.rm(sandbox, { recursive: true, force: true });
    });

    it('extracts ZIP and rejects traversal entries before writing', async () => {
        const zip = new AdmZip();
        zip.addFile('extension/package.json', Buffer.from('{"name":"safe"}'));
        const escape = zip.addFile('safe.txt', Buffer.from('escape'));
        escape.entryName = '../outside.txt';
        await expectRefusal(() => extractArchive(zip.toBuffer(), path.join(sandbox, 'zip')), /outside the output path/);
        await expectRefusal(() => fs.access(path.join(sandbox, 'outside.txt')), /ENOENT/);
    });

    it('extracts TGZ contents and preserves the filtered entry contract', async () => {
        const tar = await createTar([{ name: 'extension/package.json', data: Buffer.from('{"name":"safe"}') }]);
        const entries = await extractArchive(await gzip(tar), undefined, { filter: entry => entry.path.endsWith('package.json') });
        expect(entries).to.have.length(1);
        expect(entries[0].data.toString('utf8')).to.equal('{"name":"safe"}');
    });

    it('rejects symlinks that point outside the extraction root', async () => {
        const tar = await createTar([{ name: 'escape', type: 'symlink', linkname: '../outside.txt' }]);
        await expectRefusal(() => extractArchive(tar, path.join(sandbox, 'tar')), /outside the output path/);
    });

    it('enforces entry and aggregate byte limits before retaining archive data', async () => {
        const zip = new AdmZip();
        zip.addFile('large.txt', Buffer.from('12345'));
        await expectRefusal(
            () => extractArchive(zip.toBuffer(), undefined, { limits: { maxEntryBytes: 4 } }),
            /larger than 4 bytes/,
        );

        const tar = await createTar([
            { name: 'one.txt', data: Buffer.from('123') },
            { name: 'two.txt', data: Buffer.from('456') },
        ]);
        await expectRefusal(
            () => extractArchive(tar, undefined, { limits: { maxTotalBytes: 5 } }),
            /larger than 5 uncompressed bytes/,
        );
    });

    it('rejects excessive compression ratios while streaming TGZ input', async () => {
        const tar = await createTar([{ name: 'repetitive.txt', data: Buffer.alloc(4096, 0) }]);
        await expectRefusal(
            async () => extractArchive(await gzip(tar), undefined, { limits: { maxCompressionRatio: 2 } }),
            /compression ratio/,
        );
    });

    it('limits archive entry count independently of the filter', async () => {
        const zip = new AdmZip();
        zip.addFile('first.txt', Buffer.from('first'));
        zip.addFile('second.txt', Buffer.from('second'));
        await expectRefusal(
            () => extractArchive(zip.toBuffer(), undefined, {
                filter: entry => entry.path === 'first.txt',
                limits: { maxEntries: 1 },
            }),
            /more than 1 entries/,
        );
    });
});
