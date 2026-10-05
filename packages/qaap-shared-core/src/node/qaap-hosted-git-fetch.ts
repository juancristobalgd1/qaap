// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import { QaapSealedGithubGit, type QaapSealedGitRunOptions } from './qaap-sealed-github-git';

/** One GitHub fetch for a hosted project, delivered as a tokenless bundle file. */
export interface QaapHostedGitFetchRequest {
    /** Canonical `https://github.com/<owner>/<repo>.git`, built by the backend. */
    readonly url: string;
    /** The signed-in user's GitHub token, if any. Lives only in this backend and the fetch child's env. */
    readonly token?: string;
    /** Absolute path of the bundle to create, below `bundleRoot`. It must not exist yet. */
    readonly bundleFile: string;
    /**
     * Trusted directory the agent cannot replace (the repositories root). The directories between it
     * and the bundle are walked without following symlinks.
     */
    readonly bundleRoot: string;
    /** Absolute `objects` directory of an existing project repository, read as an alternate object store. */
    readonly objectsDirectory?: string;
    /** Commit ids the project already has (its ref tips). Unknown or non-commit ids are ignored. */
    readonly haves?: readonly string[];
}

export interface QaapHostedGitFetchResult {
    /** `refs/heads/*` and `refs/tags/*` of the remote, all listed in the bundle. Empty: no bundle was written. */
    readonly refs: string[];
    /** The remote's default branch name, when it advertises one. */
    readonly defaultBranch?: string;
}

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const MAX_HAVES = 512;
const DEFAULT_MAX_CONCURRENT_FETCHES = 2;
/** `O_NOFOLLOW_ANY` in darwin's `sys/fcntl.h`; not exposed by `fs.constants`. */
const O_NOFOLLOW_ANY_DARWIN = 0x20000000;

/**
 * Clone/fetch counterpart of the hosted push (doc/qaap-github-token-boundary.md): the token never
 * reaches a git process of the agent uid. As this backend's uid, a sealed git fetches the project's
 * own GitHub repository into a private scratch repository, then writes the result as a git bundle
 * (refs plus a pack of the objects the project does not have yet). The tenant then clones or
 * fetches that bundle file with no credentials at all.
 *
 * `git bundle create` is not used because it leaves out every ref whose tip the project already has,
 * which would make the tenant's `fetch --prune` delete unchanged remote-tracking branches.
 */
@injectable()
export class QaapHostedGitFetch extends QaapSealedGithubGit {

    /** Sealed fetches of this backend (a singleton) running now. */
    protected runningFetches = 0;

    /**
     * Fails at once, without queueing, when {@link maxConcurrentFetches} are already running, or when
     * the sealed scratch already holds its whole budget (R4-1). Each fetch is also capped on its own
     * (`QAAP_SEALED_GIT_MAX_BYTES`).
     */
    async fetchBundle(request: QaapHostedGitFetchRequest, options: QaapSealedGitRunOptions = {}): Promise<QaapHostedGitFetchResult> {
        this.assertValidRequest(request);
        const limit = this.maxConcurrentFetches();
        if (this.runningFetches >= limit) {
            throw new Error(`${limit} hosted fetches are already running on this backend (QAAP_SEALED_GIT_MAX_CONCURRENT_FETCHES). `
                + 'Try again when one has finished.');
        }
        this.runningFetches++;
        try {
            await this.assertScratchBudget();
            return await this.fetchBundleInScratch(request, options);
        } finally {
            this.runningFetches--;
        }
    }

    /** `QAAP_SEALED_GIT_MAX_CONCURRENT_FETCHES`, default 2. */
    protected maxConcurrentFetches(): number {
        const configured = Number(process.env.QAAP_SEALED_GIT_MAX_CONCURRENT_FETCHES);
        return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_CONCURRENT_FETCHES;
    }

    protected async fetchBundleInScratch(request: QaapHostedGitFetchRequest, options: QaapSealedGitRunOptions): Promise<QaapHostedGitFetchResult> {
        const scratch = await this.createScratch('qaap-fetch-');
        try {
            const gitDir = path.join(scratch, 'repo.git');
            const env: NodeJS.ProcessEnv = {
                ...this.baseEnv(scratch),
                ...(request.objectsDirectory ? { GIT_ALTERNATE_OBJECT_DIRECTORIES: request.objectsDirectory } : {}),
            };
            const git = (args: string[], extra: QaapSealedGitRunOptions = {}): Promise<string> =>
                this.runGit(['--git-dir', gitDir, ...this.sealedConfig(), ...args], env, { ...options, ...extra });
            await this.runGit(['init', '--bare', '--quiet', '--template=', gitDir], this.baseEnv(scratch), options);
            const haves = request.objectsDirectory ? await this.knownCommits(git, request.haves ?? []) : [];
            if (haves.length > 0) {
                // The project's tips as refs of the scratch repository: git offers them as `have`s, so
                // only missing objects are downloaded.
                await git(['update-ref', '--stdin'], { input: haves.map((sha, index) => `create refs/qaap-have/${index} ${sha}\n`).join('') });
            }
            const withToken = (args: string[], extra: QaapSealedGitRunOptions = {}): Promise<string> => this.runGit(
                ['--git-dir', gitDir, ...this.sealedConfig(), ...this.credentialConfig(request.token), ...args],
                { ...env, ...this.credentialEnv(request.token) },
                { ...options, ...extra },
            );
            const defaultBranch = this.parseDefaultBranch(await withToken(['ls-remote', '--symref', request.url, 'HEAD'], { onStderr: undefined }));
            // A hostile or huge repository must not fill this backend's disk: the scratch is watched while
            // git downloads, measured once more when it is done, and the bundle is capped the same way.
            const maxBytes = this.maxTransferBytes();
            const scratchRoot = path.dirname(scratch);
            await withToken(['fetch', '--progress', '--no-tags', '--no-write-fetch-head', request.url, '+refs/heads/*:refs/heads/*', '+refs/tags/*:refs/tags/*'],
                { watchDirectory: scratch, maxBytes, budgetDirectory: scratchRoot });
            if (await this.directorySize(scratch) > maxBytes) {
                throw this.transferLimitError(maxBytes);
            }
            if (await this.directorySize(scratchRoot) > this.scratchBudgetBytes()) {
                throw this.scratchBudgetError(this.scratchBudgetBytes());
            }
            const tips = this.parseRefs(await git(['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads', 'refs/tags'], { onStderr: undefined }));
            if (tips.length === 0) {
                return { refs: [], defaultBranch };
            }
            await this.writeBundle(request.bundleRoot, request.bundleFile, tips, haves, git);
            return { refs: tips.map(tip => tip.ref), defaultBranch };
        } finally {
            await this.removeScratch(scratch);
        }
    }

    protected assertValidRequest(request: QaapHostedGitFetchRequest): void {
        if (!this.isAllowedUrl(request.url)) {
            throw new Error('Hosted fetch only reads GitHub over HTTPS.');
        }
        if (!path.isAbsolute(request.bundleFile) || !path.isAbsolute(request.bundleRoot)) {
            throw new Error('Hosted fetch needs an absolute bundle path.');
        }
        this.bundleComponents(request.bundleRoot, request.bundleFile);
        if (request.objectsDirectory !== undefined) {
            this.assertValidObjectsDirectory(request.objectsDirectory);
        }
        this.assertValidToken(request.token, false);
    }

    /** The project's tips that exist as commits in its object store, deduplicated and capped. */
    protected async knownCommits(git: (args: string[], extra?: QaapSealedGitRunOptions) => Promise<string>, haves: readonly string[]): Promise<string[]> {
        const candidates = [...new Set(haves.filter(sha => SHA.test(sha)))].slice(0, MAX_HAVES);
        if (candidates.length === 0) {
            return [];
        }
        const output = await git(['cat-file', '--batch-check=%(objectname) %(objecttype)'], { input: candidates.map(sha => `${sha}\n`).join(''), onStderr: undefined });
        const known = new Set(output.split('\n').filter(line => line.endsWith(' commit')).map(line => line.slice(0, line.indexOf(' '))));
        return candidates.filter(sha => known.has(sha));
    }

    protected parseDefaultBranch(lsRemote: string): string | undefined {
        const match = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(lsRemote);
        return match && this.isBranchName(match[1]) ? match[1] : undefined;
    }

    protected parseRefs(forEachRef: string): Array<{ sha: string; ref: string }> {
        const tips: Array<{ sha: string; ref: string }> = [];
        for (const line of forEachRef.split('\n')) {
            const [sha, ref] = line.trim().split(' ');
            if (sha && ref && SHA.test(sha) && /^refs\/(?:heads|tags)\/\S+$/.test(ref)) {
                tips.push({ sha, ref });
            }
        }
        return tips;
    }

    protected isBranchName(name: string): boolean {
        return /^(?!-)(?!.*(?:\.\.|@\{|\/\.|\/\/|\.lock(?:\/|$)|\.$|\/$))[A-Za-z0-9._/+-]+$/.test(name);
    }

    /**
     * Creates the bundle file exclusively in the directory reached from `bundleRoot` without following
     * a symlink. The directories between `bundleRoot` and the bundle may be owned by the agent uid,
     * which could swap one for a symlink between any check and the `open` and make this backend create
     * a file in a directory only it can write (R3-2). On Linux each component is opened relative
     * to the previous descriptor (`/proc/self/fd/<fd>/<name>`, an `openat` without a race) and checked
     * not to be a symlink. On darwin the kernel refuses a symlink anywhere in the path
     * (`O_NOFOLLOW_ANY`), so a swapped directory never receives the file. Elsewhere the components
     * are checked with `lstat` before the open and the parent and the new file are compared by
     * dev/ino after it; a swap fails the call and the file just created is removed (R4-2).
     */
    protected async openBundleInPlace(bundleRoot: string, bundleFile: string): Promise<fs.promises.FileHandle> {
        const components = this.bundleComponents(bundleRoot, bundleFile);
        const name = path.basename(bundleFile);
        if (this.canOpenRelativeToDescriptor()) {
            return this.withBundleDirectory(bundleRoot, components, directory => this.openBundle(path.posix.join(directory, name)));
        }
        // `O_NOFOLLOW_ANY` also refuses symlinks above the trusted root (`/tmp`, `/var` on macOS).
        const root = this.noFollowAnyFlag() === undefined ? bundleRoot : await fs.promises.realpath(bundleRoot);
        const parent = path.join(root, ...components);
        const file = path.join(parent, name);
        const before = await this.lstatDirectoryChain(root, components);
        let handle: fs.promises.FileHandle;
        try {
            handle = await this.openBundle(file);
        } catch (error) {
            throw (error as NodeJS.ErrnoException).code === 'ELOOP' ? this.bundleDirectoryError() : error;
        }
        let opened: fs.BigIntStats | undefined;
        try {
            opened = await handle.stat({ bigint: true });
            const after = await this.lstatDirectoryChain(root, components);
            const atPath = await fs.promises.lstat(file, { bigint: true }).catch(() => undefined);
            if (after.dev !== before.dev || after.ino !== before.ino || !atPath?.isFile() || atPath.dev !== opened.dev || atPath.ino !== opened.ino) {
                throw this.bundleDirectoryError();
            }
            return handle;
        } catch (error) {
            await handle.truncate(0).catch(() => undefined);
            await handle.close();
            if (opened) {
                await this.removeSwappedBundle(file, opened);
            }
            throw error;
        }
    }

    /**
     * After a detected swap, removes the file the `open` created through the swapped path, if that
     * path still leads to the very inode. The bundle name is random and the file is new, so even if
     * the agent swaps again before the `unlink`, the only file with that name it could point us to
     * is the one this call created.
     */
    protected async removeSwappedBundle(file: string, opened: fs.BigIntStats): Promise<void> {
        const atPath = await fs.promises.lstat(file, { bigint: true }).catch(() => undefined);
        if (atPath?.isFile() && atPath.dev === opened.dev && atPath.ino === opened.ino) {
            await fs.promises.unlink(file).catch(() => undefined);
        }
    }

    /** Removes a bundle created by {@link openBundleInPlace}, through the same symlink-free directory walk. */
    async removeBundle(bundleRoot: string, bundleFile: string): Promise<void> {
        const components = this.bundleComponents(bundleRoot, bundleFile);
        const name = path.basename(bundleFile);
        try {
            if (this.canOpenRelativeToDescriptor()) {
                await this.withBundleDirectory(bundleRoot, components, directory => fs.promises.rm(path.posix.join(directory, name), { force: true }));
            } else {
                // No `unlinkat` here: a swap after this check can only point the unlink at a file with
                // the bundle's random name, which `openBundleInPlace` never created outside the walk.
                await this.lstatDirectoryChain(bundleRoot, components);
                await fs.promises.rm(path.join(bundleRoot, ...components, name), { force: true });
            }
        } catch {
            // A directory that is no longer plain never received the bundle.
        }
    }

    /** The directory names from `bundleRoot` to the bundle's parent; the bundle must lie strictly below the root. */
    protected bundleComponents(bundleRoot: string, bundleFile: string): string[] {
        const relative = path.relative(bundleRoot, path.dirname(bundleFile));
        const components = relative === '' ? [] : relative.split(path.sep);
        if (path.isAbsolute(relative) || components.some(component => component === '..' || component === '.' || component === '')) {
            throw new Error('Hosted fetch writes its bundle only below the repositories root.');
        }
        return components;
    }

    protected canOpenRelativeToDescriptor(): boolean {
        return process.platform === 'linux' && fs.existsSync('/proc/self/fd');
    }

    /**
     * darwin's `O_NOFOLLOW_ANY` (`sys/fcntl.h`, macOS 11 / Darwin 20 and later): `open` fails with
     * `ELOOP` if any component of the path is a symlink. Node passes numeric flags to `open` as is.
     */
    protected noFollowAnyFlag(): number | undefined {
        return process.platform === 'darwin' && Number(os.release().split('.')[0]) >= 20 ? O_NOFOLLOW_ANY_DARWIN : undefined;
    }

    /** Opens `bundleRoot`, then each component relative to its parent's descriptor ({@link openDirectoryEntry}). */
    protected async withBundleDirectory<T>(bundleRoot: string, components: readonly string[], use: (directory: string) => Promise<T>): Promise<T> {
        let directory = await fs.promises.open(bundleRoot, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
        try {
            for (const component of components) {
                const next = await this.openDirectoryEntry(directory, component);
                await directory.close();
                directory = next;
            }
            return await use(`/proc/self/fd/${directory.fd}`);
        } finally {
            await directory.close();
        }
    }

    /**
     * Opens `name` inside the directory `parent` without following a symlink. Some kernels (gVisor)
     * follow a final symlink despite `O_NOFOLLOW | O_DIRECTORY`, so the entry is then checked, through
     * the still-open parent, to be a plain directory and the very inode that was opened.
     */
    protected async openDirectoryEntry(parent: fs.promises.FileHandle, name: string): Promise<fs.promises.FileHandle> {
        const entry = `/proc/self/fd/${parent.fd}/${name}`;
        let opened: fs.promises.FileHandle;
        try {
            opened = await fs.promises.open(entry, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
        } catch {
            throw this.bundleDirectoryError();
        }
        try {
            const openedStat = await opened.stat({ bigint: true });
            const entryStat = await fs.promises.lstat(entry, { bigint: true });
            if (entryStat.isSymbolicLink() || !entryStat.isDirectory() || entryStat.dev !== openedStat.dev || entryStat.ino !== openedStat.ino) {
                throw this.bundleDirectoryError();
            }
            return opened;
        } catch {
            await opened.close();
            throw this.bundleDirectoryError();
        }
    }

    /** `lstat` of each component below `bundleRoot`: all plain directories. Returns the parent's stat. */
    protected async lstatDirectoryChain(bundleRoot: string, components: readonly string[]): Promise<fs.BigIntStats> {
        let current = bundleRoot;
        let stat = await fs.promises.stat(current, { bigint: true });
        for (const component of components) {
            current = path.join(current, component);
            stat = await fs.promises.lstat(current, { bigint: true });
            if (stat.isSymbolicLink() || !stat.isDirectory()) {
                throw this.bundleDirectoryError();
            }
        }
        return stat;
    }

    protected bundleDirectoryError(): Error {
        return new Error('The workspace directory changed while the hosted fetch was creating its bundle.');
    }

    /** Exclusive create: an existing file or symlink at `file` fails, and on darwin any symlink in its path. */
    protected openBundle(file: string): Promise<fs.promises.FileHandle> {
        const noFollowAny = this.noFollowAnyFlag();
        if (noFollowAny === undefined) {
            return fs.promises.open(file, 'wx', 0o644);
        }
        const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW } = fs.constants;
        return fs.promises.open(file, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | noFollowAny, 0o644);
    }

    /**
     * Writes a v2 bundle: every remote ref, the project's tips as prerequisites, and a thin pack of
     * the objects reachable from the refs but not from those tips. The file is created exclusively
     * (an existing file or symlink fails) and made world-readable through its descriptor, so the
     * tenant uid can read it whatever this process's umask is.
     */
    protected async writeBundle(
        bundleRoot: string,
        bundleFile: string,
        tips: ReadonlyArray<{ sha: string; ref: string }>,
        haves: readonly string[],
        git: (args: string[], extra?: QaapSealedGitRunOptions) => Promise<string>,
    ): Promise<void> {
        const handle = await this.openBundleInPlace(bundleRoot, bundleFile);
        let written = false;
        try {
            await handle.chmod(0o644);
            const header = [
                '# v2 git bundle',
                ...haves.map(sha => `-${sha}`),
                ...tips.map(tip => `${tip.sha} ${tip.ref}`),
                '',
                '',
            ].join('\n');
            await handle.write(header);
            const revisions = [...tips.map(tip => tip.sha), ...haves.map(sha => `^${sha}`)].join('\n');
            await git(['pack-objects', '--stdout', '--thin', '--delta-base-offset', '--revs', '--quiet'], {
                input: `${revisions}\n`,
                stdoutHandle: handle,
                maxBytes: this.maxTransferBytes(),
                onStderr: undefined,
            });
            written = true;
        } finally {
            await handle.close();
            if (!written) {
                await this.removeBundle(bundleRoot, bundleFile);
            }
        }
    }
}
