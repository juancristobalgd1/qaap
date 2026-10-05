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
import { QaapHostedGitFetch } from './qaap-hosted-git-fetch';
import type { QaapSealedGitRunOptions } from './qaap-sealed-github-git';

const TOKEN = 'gho_secretFetchTokenForSpec123';

/** Fetches from a local bare repository instead of GitHub and records every git invocation. */
class LocalHostedGitFetch extends QaapHostedGitFetch {
    readonly calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];

    protected override isAllowedUrl(url: string): boolean {
        return url.startsWith('file://');
    }

    protected override allowedProtocol(): string {
        return 'file';
    }

    protected override runGit(args: string[], env: NodeJS.ProcessEnv, options?: QaapSealedGitRunOptions): Promise<string> {
        this.calls.push({ args, env });
        return super.runGit(args, env, options);
    }
}

function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
}

/** `file:///C:/x` on Windows, `file:///tmp/x` on POSIX. */
function fileUrl(directory: string): string {
    const posix = directory.split(path.sep).join('/');
    return `file://${posix.startsWith('/') ? '' : '/'}${posix}`;
}

function commit(repo: string, file: string, content: string): string {
    fs.writeFileSync(path.join(repo, file), content);
    git(repo, 'add', file);
    git(repo, 'commit', '--quiet', '-m', file);
    return git(repo, 'rev-parse', 'HEAD');
}

describe('qaap-hosted-git-fetch', function (): void {
    this.timeout(30_000);
    let base: string;
    let remote: string;
    let upstream: string;
    let url: string;

    beforeEach(() => {
        base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-fetch-spec-')));
        remote = path.join(base, 'remote.git');
        upstream = path.join(base, 'upstream');
        git(base, 'init', '--bare', '--quiet', '-b', 'main', remote);
        git(base, 'init', '--quiet', '-b', 'main', upstream);
        git(upstream, 'config', 'user.email', 'spec@qaap.test');
        git(upstream, 'config', 'user.name', 'Spec');
        commit(upstream, 'a.txt', 'one\n');
        git(upstream, 'branch', 'feature');
        git(upstream, 'tag', 'v1');
        git(upstream, 'push', '--quiet', remote, 'main', 'feature', 'v1');
        url = fileUrl(remote);
    });

    afterEach(() => {
        fs.rmSync(base, { recursive: true, force: true });
    });

    it('refuses a non-GitHub URL, a relative bundle path and an objects path list', async () => {
        const fetcher = new QaapHostedGitFetch();
        const valid = { url: 'https://github.com/acme/widget.git', bundleFile: path.join(base, 'x.bundle') };
        for (const bad of [
            { url: 'https://evil.test/acme/widget.git' },
            { url: url },
            { bundleFile: 'x.bundle' },
            { objectsDirectory: 'relative/objects' },
            { objectsDirectory: `${base}${path.delimiter}${base}` },
            { token: 'with space' },
        ]) {
            let error: unknown;
            try {
                await fetcher.fetchBundle({ ...valid, ...bad });
            } catch (caught) {
                error = caught;
            }
            expect(error, JSON.stringify(bad)).to.be.instanceOf(Error);
        }
        expect(fs.existsSync(valid.bundleFile)).to.equal(false);
    });

    it('first clone: a tokenless bundle the tenant clones, with every branch and the default branch', async () => {
        const fetcher = new LocalHostedGitFetch();
        const bundleFile = path.join(base, '.qaap-clone.bundle');
        const result = await fetcher.fetchBundle({ url, token: TOKEN, bundleFile });
        expect(result.refs).to.have.members(['refs/heads/main', 'refs/heads/feature', 'refs/tags/v1']);
        expect(result.defaultBranch).to.equal('main');
        const project = path.join(base, 'project');
        git(base, 'clone', '--quiet', '--branch', 'main', bundleFile, project);
        expect(git(project, 'rev-parse', 'origin/feature')).to.equal(git(upstream, 'rev-parse', 'feature'));
        expect(fs.readFileSync(path.join(project, 'a.txt'), 'utf8')).to.equal('one\n');
        expect(fs.readFileSync(bundleFile, 'utf8')).to.not.include(TOKEN);
        for (const call of fetcher.calls) {
            expect(call.args.join(' ')).to.not.include(TOKEN);
            if (!call.args.includes('ls-remote') && !call.args.includes('fetch')) {
                expect(call.env.QAAP_GIT_PUSH_TOKEN, call.args.join(' ')).to.equal(undefined);
            }
        }
        const scratch = fetcher.calls[0].args[fetcher.calls[0].args.length - 1];
        expect(fs.existsSync(scratch)).to.equal(false);
    });

    it('fetch: downloads only what the project lacks, keeps unchanged refs for --prune, never reads the project config', async () => {
        const project = path.join(base, 'project');
        git(base, 'clone', '--quiet', remote, project);
        const marker = path.join(base, 'helper-ran');
        git(project, 'config', 'credential.helper', `!f() { touch '${marker.split(path.sep).join('/')}'; }; f`);
        git(project, 'config', 'http.sslVerify', 'false');
        const oldMain = git(project, 'rev-parse', 'origin/main');
        const newMain = commit(upstream, 'b.txt', 'two\n');
        git(upstream, 'push', '--quiet', remote, 'main');

        const fetcher = new LocalHostedGitFetch();
        const bundleFile = path.join(base, '.qaap-fetch.bundle');
        const haves = git(project, 'for-each-ref', '--format=%(objectname)', 'refs/remotes/origin', 'refs/heads').split('\n');
        const result = await fetcher.fetchBundle({
            url,
            token: TOKEN,
            bundleFile,
            objectsDirectory: path.join(project, '.git', 'objects'),
            haves: [...haves, 'f'.repeat(40), 'not-a-sha'],
        });
        expect(result.refs).to.have.members(['refs/heads/main', 'refs/heads/feature', 'refs/tags/v1']);
        const header = fs.readFileSync(bundleFile, 'latin1').split('\n\n')[0];
        expect(header).to.include(`-${oldMain}`);
        expect(header).to.not.include(`-${'f'.repeat(40)}`);

        git(project, 'fetch', '--quiet', '--prune', bundleFile, '+refs/heads/*:refs/remotes/origin/*');
        expect(git(project, 'rev-parse', 'origin/main')).to.equal(newMain);
        expect(git(project, 'rev-parse', 'origin/feature')).to.equal(oldMain);
        expect(fs.existsSync(marker)).to.equal(false);
        const fetchCall = fetcher.calls.find(call => call.args.includes('fetch'))!;
        expect(fetchCall.args).to.include('core.alternateRefsCommand=true');
        expect(fetchCall.args).to.include('http.sslVerify=true');
        expect(fetchCall.env.GIT_CONFIG_NOSYSTEM).to.equal('1');
        expect(fetchCall.env.GIT_CONFIG_GLOBAL).to.equal('/dev/null');
    });

    it('writes nothing for an empty remote, and never writes through an existing bundle path', async () => {
        const empty = path.join(base, 'empty.git');
        git(base, 'init', '--bare', '--quiet', empty);
        const fetcher = new LocalHostedGitFetch();
        const bundleFile = path.join(base, 'empty.bundle');
        const result = await fetcher.fetchBundle({ url: fileUrl(empty), bundleFile });
        expect(result.refs).to.deep.equal([]);
        expect(fs.existsSync(bundleFile)).to.equal(false);

        const existing = path.join(base, 'existing.bundle');
        fs.writeFileSync(existing, 'keep');
        let error: unknown;
        try {
            await fetcher.fetchBundle({ url, bundleFile: existing });
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(Error);
        expect(fs.readFileSync(existing, 'utf8')).to.equal('keep');
    });
    it('refuses a repository larger than QAAP_SEALED_GIT_MAX_BYTES before writing any bundle (R3-5)', async () => {
        fs.writeFileSync(path.join(upstream, 'big.bin'), crypto.randomBytes(512 * 1024));
        git(upstream, 'add', 'big.bin');
        git(upstream, 'commit', '--quiet', '-m', 'big');
        git(upstream, 'push', '--quiet', remote, 'main');
        const saved = process.env.QAAP_SEALED_GIT_MAX_BYTES;
        process.env.QAAP_SEALED_GIT_MAX_BYTES = String(128 * 1024);
        const fetcher = new LocalHostedGitFetch();
        const bundleFile = path.join(base, 'big.bundle');
        let error: unknown;
        try {
            await fetcher.fetchBundle({ url, token: TOKEN, bundleFile });
        } catch (caught) {
            error = caught;
        } finally {
            if (saved === undefined) {
                delete process.env.QAAP_SEALED_GIT_MAX_BYTES;
            } else {
                process.env.QAAP_SEALED_GIT_MAX_BYTES = saved;
            }
        }
        expect(String(error)).to.match(/131072-byte limit/);
        expect(fs.existsSync(bundleFile)).to.equal(false);
        expect(fetcher.calls.some(call => call.args.includes('pack-objects'))).to.equal(false);
        const scratch = fetcher.calls[0].args[fetcher.calls[0].args.length - 1];
        expect(fs.existsSync(scratch)).to.equal(false);
    });
});
