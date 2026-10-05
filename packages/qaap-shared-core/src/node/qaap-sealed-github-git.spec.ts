// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapSealedGithubGit, type QaapSealedGitRunOptions } from './qaap-sealed-github-git';

/** Test seam: the protected scratch and run helpers. */
class SpecSealedGit extends QaapSealedGithubGit {
    createScratchForTest(prefix: string): Promise<string> {
        return this.createScratch(prefix);
    }

    runGitForTest(args: string[], options: QaapSealedGitRunOptions): Promise<string> {
        return this.runGit(args, { ...process.env, GIT_CONFIG_NOSYSTEM: '1' }, options);
    }
}

/** A file handle whose first write waits for {@link release}; records the bytes written. */
function gatedHandle(): { handle: fs.promises.FileHandle; release: () => void; bytes: () => number } {
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => {
        release = resolve;
    });
    let bytes = 0;
    const handle = {
        write: async (chunk: Buffer) => {
            await gate;
            bytes += chunk.length;
            return { bytesWritten: chunk.length, buffer: chunk };
        },
    } as unknown as fs.promises.FileHandle;
    return { handle, release: () => release(), bytes: () => bytes };
}

describe('qaap-sealed-github-git scratch and output limits (R3-5)', function (): void {
    this.timeout(30_000);
    const saved = { QAAP_SEALED_GIT_SCRATCH_ROOT: process.env.QAAP_SEALED_GIT_SCRATCH_ROOT };
    let base: string;

    beforeEach(() => {
        base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-sealed-spec-')));
        process.env.QAAP_SEALED_GIT_SCRATCH_ROOT = path.join(base, 'scratch');
    });

    afterEach(() => {
        fs.rmSync(base, { recursive: true, force: true });
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    it('works in the configured scratch root on the volume, not in the backend tmpdir', async () => {
        const scratch = await new SpecSealedGit().createScratchForTest('qaap-fetch-');
        expect(path.dirname(scratch)).to.equal(path.join(base, 'scratch'));
        if (process.platform !== 'win32') {
            expect(fs.statSync(path.join(base, 'scratch')).mode & 0o777).to.equal(0o700);
        }
    });

    it('refuses a scratch root that is a symlink or open to other uids', async function (): Promise<void> {
        if (process.platform === 'win32') {
            this.skip();
        }
        fs.mkdirSync(path.join(base, 'elsewhere'));
        fs.symlinkSync(path.join(base, 'elsewhere'), path.join(base, 'scratch'));
        let error: unknown;
        try {
            await new SpecSealedGit().createScratchForTest('qaap-fetch-');
        } catch (caught) {
            error = caught;
        }
        expect(String(error)).to.match(/private \(0700\) directory/);

        fs.unlinkSync(path.join(base, 'scratch'));
        fs.mkdirSync(path.join(base, 'scratch'), { mode: 0o777 });
        fs.chmodSync(path.join(base, 'scratch'), 0o777);
        error = undefined;
        try {
            await new SpecSealedGit().createScratchForTest('qaap-fetch-');
        } catch (caught) {
            error = caught;
        }
        expect(String(error)).to.match(/private \(0700\) directory/);
    });

    it('removes scratch directories a crashed backend left, and nothing else', async () => {
        const root = path.join(base, 'scratch');
        fs.mkdirSync(root, { mode: 0o700 });
        const hourAndAHalfAgo = new Date(Date.now() - 90 * 60 * 1000);
        for (const name of ['qaap-fetch-old', 'qaap-push-old', 'unrelated-old']) {
            fs.mkdirSync(path.join(root, name));
            fs.utimesSync(path.join(root, name), hourAndAHalfAgo, hourAndAHalfAgo);
        }
        fs.mkdirSync(path.join(root, 'qaap-fetch-running'));

        await new SpecSealedGit().createScratchForTest('qaap-push-');
        const left = fs.readdirSync(root).filter(name => !/^qaap-push-(?!old)/.test(name)).sort();
        expect(left).to.deep.equal(['qaap-fetch-running', 'unrelated-old']);
    });

    describe('streamed output', () => {
        let repo: string;
        let blob: string;

        beforeEach(() => {
            repo = path.join(base, 'repo.git');
            execFileSync('git', ['init', '--bare', '--quiet', repo]);
            const file = path.join(base, 'big.bin');
            fs.writeFileSync(file, crypto.randomBytes(2 * 1024 * 1024));
            blob = execFileSync('git', ['--git-dir', repo, 'hash-object', '-w', file], { encoding: 'utf8' }).trim();
        });

        it('pauses git stdout until each chunk is written, so a slow volume never buffers the output', async () => {
            // A shell alias writes 2 MiB, then marks that it got to the end. With the first write held,
            // a paused stdout fills the pipe and blocks the writer before the mark.
            const big = path.join(base, 'big.bin').split(path.sep).join('/');
            const done = path.join(base, 'done').split(path.sep).join('/');
            const output = gatedHandle();
            const running = new SpecSealedGit().runGitForTest(['-c', `alias.spill=!cat '${big}' && touch '${done}'`, 'spill'], { stdoutHandle: output.handle });
            await new Promise(resolve => setTimeout(resolve, 1000));
            const ranAhead = fs.existsSync(done);
            output.release();
            await running;
            expect(ranAhead).to.equal(false);
            expect(output.bytes()).to.equal(2 * 1024 * 1024);
            expect(fs.existsSync(done)).to.equal(true);
        });

        it('fails once the streamed output passes maxBytes', async () => {
            const output = gatedHandle();
            output.release();
            let error: unknown;
            try {
                await new SpecSealedGit().runGitForTest(['--git-dir', repo, 'cat-file', 'blob', blob], { stdoutHandle: output.handle, maxBytes: 256 * 1024 });
            } catch (caught) {
                error = caught;
            }
            expect(String(error)).to.match(/262144-byte limit/);
            expect(output.bytes()).to.be.at.most(256 * 1024);
        });
    });
});
