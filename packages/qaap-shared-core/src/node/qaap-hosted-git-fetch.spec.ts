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
/** darwin's `O_NOFOLLOW_ANY`. */
const O_NOFOLLOW_ANY = 0x20000000;

/**
 * How a {@link LocalHostedGitFetch} simulates darwin on this host (no `/proc/self/fd` walk):
 * `einval` is a kernel that rejects `O_NOFOLLOW_ANY` like the macos-15 CI runners, `nofollow-any`
 * one that honours it (`ELOOP` for a symlink anywhere in the path).
 */
type SimulatedDarwin = 'einval' | 'nofollow-any';

/** Fetches from a local bare repository instead of GitHub and records every git invocation and open. */
class LocalHostedGitFetch extends QaapHostedGitFetch {
    readonly calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
    readonly opens: Array<{ file: string; flags: number }> = [];

    constructor(readonly darwin?: SimulatedDarwin) {
        super();
    }

    protected override canOpenRelativeToDescriptor(): boolean {
        return this.darwin === undefined && super.canOpenRelativeToDescriptor();
    }

    protected override isNoFollowAnyKernel(): boolean {
        return this.darwin !== undefined || super.isNoFollowAnyKernel();
    }

    protected override async openFile(file: string, flags: number, mode: number): Promise<fs.promises.FileHandle> {
        this.opens.push({ file, flags });
        if (this.darwin === undefined || (flags & O_NOFOLLOW_ANY) === 0) {
            return super.openFile(file, flags, mode);
        }
        if (this.darwin === 'einval') {
            throw Object.assign(new Error(`EINVAL: invalid argument, open '${file}'`), { code: 'EINVAL' });
        }
        for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
            if ((await fs.promises.lstat(directory)).isSymbolicLink()) {
                throw Object.assign(new Error(`ELOOP: too many symbolic links encountered, open '${file}'`), { code: 'ELOOP' });
            }
            if (path.dirname(directory) === directory) {
                return super.openFile(file, flags & ~O_NOFOLLOW_ANY, mode);
            }
        }
    }

    /** The flags of the `open` that created `bundleFile`. */
    bundleFlags(bundleFile: string): number | undefined {
        return this.opens.filter(open => open.file === bundleFile).pop()?.flags;
    }

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
        fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    it('refuses a non-GitHub URL, a relative bundle path and an objects path list', async () => {
        const fetcher = new QaapHostedGitFetch();
        const valid = { url: 'https://github.com/acme/widget.git', bundleFile: path.join(base, 'x.bundle'), bundleRoot: base };
        for (const bad of [
            { url: 'https://evil.test/acme/widget.git' },
            { url: url },
            { bundleFile: 'x.bundle' },
            { bundleFile: path.join(path.dirname(base), 'x.bundle') },
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

    /** Without `/proc/self/fd`, the bundle is opened with `O_NOFOLLOW_ANY` only where the kernel takes it. */
    function expectBundleFlags(fetcher: LocalHostedGitFetch, bundleFile: string): void {
        if (fetcher.darwin !== undefined) {
            expect(fetcher.bundleFlags(bundleFile)! & O_NOFOLLOW_ANY).to.equal(fetcher.darwin === 'nofollow-any' ? O_NOFOLLOW_ANY : 0);
        }
    }

    for (const darwin of [undefined, 'einval', 'nofollow-any'] as const) {
        const variant = darwin === undefined ? '' : ` (simulated darwin, ${darwin === 'einval' ? 'O_NOFOLLOW_ANY rejected with EINVAL' : 'O_NOFOLLOW_ANY honoured'})`;

        it(`first clone: a tokenless bundle the tenant clones, with every branch and the default branch${variant}`, async () => {
            const fetcher = new LocalHostedGitFetch(darwin);
            const bundleFile = path.join(base, '.qaap-clone.bundle');
            const result = await fetcher.fetchBundle({ url, token: TOKEN, bundleFile, bundleRoot: base });
            expect(result.refs).to.have.members(['refs/heads/main', 'refs/heads/feature', 'refs/tags/v1']);
            expect(result.defaultBranch).to.equal('main');
            expectBundleFlags(fetcher, bundleFile);
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

        it(`fetch: downloads only what the project lacks, keeps unchanged refs for --prune, never reads the project config${variant}`, async () => {
            const project = path.join(base, 'project');
            git(base, 'clone', '--quiet', remote, project);
            const marker = path.join(base, 'helper-ran');
            git(project, 'config', 'credential.helper', `!f() { touch '${marker.split(path.sep).join('/')}'; }; f`);
            git(project, 'config', 'http.sslVerify', 'false');
            const oldMain = git(project, 'rev-parse', 'origin/main');
            const newMain = commit(upstream, 'b.txt', 'two\n');
            git(upstream, 'push', '--quiet', remote, 'main');

            const fetcher = new LocalHostedGitFetch(darwin);
            const bundleFile = path.join(base, '.qaap-fetch.bundle');
            const haves = git(project, 'for-each-ref', '--format=%(objectname)', 'refs/remotes/origin', 'refs/heads').split('\n');
            const result = await fetcher.fetchBundle({
                url,
                token: TOKEN,
                bundleFile,
                bundleRoot: base,
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

        it(`writes nothing for an empty remote, and never writes through an existing bundle path${variant}`, async () => {
            const empty = path.join(base, 'empty.git');
            git(base, 'init', '--bare', '--quiet', empty);
            const fetcher = new LocalHostedGitFetch(darwin);
            const bundleFile = path.join(base, 'empty.bundle');
            const result = await fetcher.fetchBundle({ url: fileUrl(empty), bundleFile, bundleRoot: base });
            expect(result.refs).to.deep.equal([]);
            expect(fs.existsSync(bundleFile)).to.equal(false);

            const existing = path.join(base, 'existing.bundle');
            fs.writeFileSync(existing, 'keep');
            let error: unknown;
            try {
                await fetcher.fetchBundle({ url, bundleFile: existing, bundleRoot: base });
            } catch (caught) {
                error = caught;
            }
            expect(error).to.be.instanceOf(Error);
            expect(fs.readFileSync(existing, 'utf8')).to.equal('keep');
        });
    }

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
            await fetcher.fetchBundle({ url, token: TOKEN, bundleFile, bundleRoot: base });
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
    /** Sets the given variables for one spec and restores them afterwards. */
    async function withEnv<T>(values: Record<string, string>, run: () => Promise<T>): Promise<T> {
        const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
        Object.assign(process.env, values);
        try {
            return await run();
        } finally {
            for (const [key, value] of Object.entries(saved)) {
                if (value === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }
        }
    }

    async function errorOf(run: () => Promise<unknown>): Promise<unknown> {
        try {
            await run();
        } catch (caught) {
            return caught;
        }
        return undefined;
    }

    describe('backend-wide limits (R4-1)', () => {
        /** Holds every fetch at its first git call until `release`. */
        class GatedHostedGitFetch extends LocalHostedGitFetch {
            release: () => void;
            protected gate = new Promise<void>(resolve => this.release = resolve);
            started = 0;

            protected override async runGit(args: string[], env: NodeJS.ProcessEnv, options?: QaapSealedGitRunOptions): Promise<string> {
                if (args[0] === 'init') {
                    this.started++;
                    await this.gate;
                }
                return super.runGit(args, env, options);
            }
        }

        it('runs at most QAAP_SEALED_GIT_MAX_CONCURRENT_FETCHES sealed fetches at once and refuses the next one', async () => {
            await withEnv({ QAAP_SEALED_GIT_MAX_CONCURRENT_FETCHES: '2', QAAP_SEALED_GIT_SCRATCH_ROOT: path.join(base, 'scratch') }, async () => {
                const fetcher = new GatedHostedGitFetch();
                const bundle = (name: string): string => path.join(base, `${name}.bundle`);
                const running = [fetcher.fetchBundle({ url, bundleFile: bundle('one'), bundleRoot: base }), fetcher.fetchBundle({ url, bundleFile: bundle('two'), bundleRoot: base })];
                while (fetcher.started < 2) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
                // An accepted third fetch would wait at the gate: give it 5 s to be refused instead.
                const refused = await Promise.race([
                    errorOf(() => fetcher.fetchBundle({ url, bundleFile: bundle('three'), bundleRoot: base })),
                    new Promise(resolve => setTimeout(() => resolve('accepted'), 5_000)),
                ]);
                expect(String(refused)).to.match(/2 hosted fetches are already running.*QAAP_SEALED_GIT_MAX_CONCURRENT_FETCHES/);
                expect(fetcher.started).to.equal(2);
                expect(fs.existsSync(bundle('three'))).to.equal(false);
                fetcher.release();
                await Promise.all(running);
                // Finished (and failed) fetches free their slot.
                await errorOf(() => fetcher.fetchBundle({ url: fileUrl(path.join(base, 'missing.git')), bundleFile: bundle('four'), bundleRoot: base }));
                await fetcher.fetchBundle({ url, bundleFile: bundle('five'), bundleRoot: base });
                expect(fs.existsSync(bundle('five'))).to.equal(true);
            });
        });

        it('refuses to start a fetch while the sealed scratch already uses QAAP_SEALED_GIT_SCRATCH_BUDGET_BYTES', async () => {
            const scratchRoot = path.join(base, 'scratch');
            fs.mkdirSync(path.join(scratchRoot, 'qaap-fetch-other'), { recursive: true, mode: 0o700 });
            fs.chmodSync(scratchRoot, 0o700);
            fs.writeFileSync(path.join(scratchRoot, 'qaap-fetch-other', 'pack'), Buffer.alloc(64 * 1024));
            await withEnv({ QAAP_SEALED_GIT_SCRATCH_BUDGET_BYTES: String(32 * 1024), QAAP_SEALED_GIT_SCRATCH_ROOT: scratchRoot }, async () => {
                const fetcher = new LocalHostedGitFetch();
                const bundleFile = path.join(base, 'budget.bundle');
                const error = await errorOf(() => fetcher.fetchBundle({ url, token: TOKEN, bundleFile, bundleRoot: base }));
                expect(String(error)).to.match(/32768-byte budget.*QAAP_SEALED_GIT_SCRATCH_BUDGET_BYTES/);
                expect(fetcher.calls).to.deep.equal([]);
                expect(fs.existsSync(bundleFile)).to.equal(false);
            });
        });

        it('stops a fetch that pushes the whole sealed scratch over its budget, even below the per-fetch cap', async () => {
            fs.writeFileSync(path.join(upstream, 'big.bin'), crypto.randomBytes(512 * 1024));
            git(upstream, 'add', 'big.bin');
            git(upstream, 'commit', '--quiet', '-m', 'big');
            git(upstream, 'push', '--quiet', remote, 'main');
            await withEnv({ QAAP_SEALED_GIT_SCRATCH_BUDGET_BYTES: String(256 * 1024), QAAP_SEALED_GIT_SCRATCH_ROOT: path.join(base, 'scratch') }, async () => {
                const fetcher = new LocalHostedGitFetch();
                const bundleFile = path.join(base, 'budget.bundle');
                const error = await errorOf(() => fetcher.fetchBundle({ url, token: TOKEN, bundleFile, bundleRoot: base }));
                expect(String(error)).to.match(/262144-byte budget/);
                expect(fs.existsSync(bundleFile)).to.equal(false);
                expect(fs.readdirSync(path.join(base, 'scratch'))).to.deep.equal([]);
            });
        });
    });

    /** Swaps the bundle's directory for a symlink to `elsewhere` just before the open, as an agent racing the backend would (R3-2). */
    class RacedHostedGitFetch extends LocalHostedGitFetch {
        /** Whether the check-after-open cleanup had to run. */
        cleanedUp = false;

        constructor(protected readonly parent: string, protected readonly elsewhere: string, darwin?: SimulatedDarwin) {
            super(darwin);
        }

        protected override async removeSwappedBundle(file: string, opened: fs.BigIntStats): Promise<void> {
            this.cleanedUp = true;
            return super.removeSwappedBundle(file, opened);
        }

        protected override openBundle(file: string): Promise<fs.promises.FileHandle> {
            if (!fs.lstatSync(this.parent).isSymbolicLink()) {
                fs.renameSync(this.parent, `${this.parent}.real`);
                fs.symlinkSync(this.elsewhere, this.parent, 'dir');
            }
            return super.openBundle(file);
        }
    }

    describe('bundle directory owned by the agent (R3-2)', () => {
        let parent: string;
        let elsewhere: string;
        let bundleFile: string;

        beforeEach(function (): void {
            if (process.platform === 'win32') {
                this.skip();
            }
            parent = path.join(base, 'users', 'octo', 'acme');
            elsewhere = path.join(base, 'backend-only');
            fs.mkdirSync(parent, { recursive: true });
            fs.mkdirSync(elsewhere);
            bundleFile = path.join(parent, '.qaap-clone-widget-0000.bundle');
        });

        it('refuses a bundle directory that is a symlink by the time the bundle is created', async () => {
            fs.renameSync(path.join(base, 'users', 'octo'), path.join(base, 'octo.real'));
            fs.mkdirSync(path.join(elsewhere, 'acme'));
            fs.symlinkSync(elsewhere, path.join(base, 'users', 'octo'), 'dir');
            let error: unknown;
            try {
                await new LocalHostedGitFetch().fetchBundle({ url, bundleFile, bundleRoot: base });
            } catch (caught) {
                error = caught;
            }
            expect(String(error)).to.match(/changed while the hosted fetch was creating its bundle/);
            expect(fs.readdirSync(path.join(elsewhere, 'acme'))).to.deep.equal([]);
        });

        it('never writes into the directory an agent swaps in while the bundle is opened', async () => {
            try {
                await new RacedHostedGitFetch(parent, elsewhere).fetchBundle({ url, bundleFile, bundleRoot: base });
            } catch {
                // Refusing is fine (non-Linux); writing into `elsewhere` is not.
            }
            expect(fs.readdirSync(elsewhere)).to.deep.equal([]);
        });

        it('refuses the swap and leaves no file behind without a descriptor walk (R4-2)', async () => {
            /** The check-after-open path of platforms with neither `/proc/self/fd` nor `O_NOFOLLOW_ANY`. */
            class CheckedHostedGitFetch extends RacedHostedGitFetch {
                protected override canOpenRelativeToDescriptor(): boolean {
                    return false;
                }

                protected override isNoFollowAnyKernel(): boolean {
                    return false;
                }
            }
            let error: unknown;
            try {
                await new CheckedHostedGitFetch(parent, elsewhere).fetchBundle({ url, bundleFile, bundleRoot: base });
            } catch (caught) {
                error = caught;
            }
            expect(String(error)).to.match(/changed while the hosted fetch was creating its bundle/);
            expect(fs.readdirSync(elsewhere)).to.deep.equal([]);
            expect(fs.readdirSync(`${parent}.real`)).to.deep.equal([]);
        });

        for (const darwin of ['kernel', 'einval', 'nofollow-any'] as const) {
            const how = darwin === 'kernel' ? 'darwin kernel' : `simulated darwin, ${darwin === 'einval' ? 'O_NOFOLLOW_ANY rejected with EINVAL' : 'O_NOFOLLOW_ANY honoured'}`;
            it(`refuses a symlink swapped into the darwin bundle path and leaves no file behind (${how})`, async function (): Promise<void> {
                if (darwin === 'kernel' && process.platform !== 'darwin') {
                    this.skip();
                }
                const fetcher = new RacedHostedGitFetch(parent, elsewhere, darwin === 'kernel' ? undefined : darwin);
                let error: unknown;
                try {
                    await fetcher.fetchBundle({ url, bundleFile, bundleRoot: base });
                } catch (caught) {
                    error = caught;
                }
                // The security property, whether the kernel took `O_NOFOLLOW_ANY` or the checked open ran.
                expect(String(error)).to.match(/changed while the hosted fetch was creating its bundle/);
                expect(fs.readdirSync(elsewhere)).to.deep.equal([]);
                expect(fs.readdirSync(`${parent}.real`)).to.deep.equal([]);
                if (darwin !== 'kernel') {
                    // `O_NOFOLLOW_ANY` refuses the open itself; the checked open creates the file and removes it.
                    expect(fetcher.cleanedUp).to.equal(darwin === 'einval');
                }
            });
        }

        it('removes the bundle only through the real directory', async () => {
            const decoy = path.join(elsewhere, path.basename(bundleFile));
            fs.writeFileSync(decoy, 'backend data');
            fs.renameSync(parent, `${parent}.real`);
            fs.symlinkSync(elsewhere, parent, 'dir');
            await new LocalHostedGitFetch().removeBundle(base, bundleFile);
            expect(fs.readFileSync(decoy, 'utf8')).to.equal('backend data');
        });
    });
});
