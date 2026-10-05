// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import { QaapSealedGithubGit, type QaapSealedGitRunOptions } from './qaap-sealed-github-git';

/** One GitHub fetch for a hosted project, delivered as a tokenless bundle file. */
export interface QaapHostedGitFetchRequest {
    /** Canonical `https://github.com/<owner>/<repo>.git`, built by the backend. */
    readonly url: string;
    /** The signed-in user's GitHub token, if any. Lives only in this backend and the fetch child's env. */
    readonly token?: string;
    /** Absolute path of the bundle to create. It must not exist yet. */
    readonly bundleFile: string;
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

    async fetchBundle(request: QaapHostedGitFetchRequest, options: QaapSealedGitRunOptions = {}): Promise<QaapHostedGitFetchResult> {
        this.assertValidRequest(request);
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
            await withToken(['fetch', '--progress', '--no-tags', '--no-write-fetch-head', request.url, '+refs/heads/*:refs/heads/*', '+refs/tags/*:refs/tags/*'],
                { watchDirectory: scratch, maxBytes });
            if (await this.directorySize(scratch) > maxBytes) {
                throw this.transferLimitError(maxBytes);
            }
            const tips = this.parseRefs(await git(['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads', 'refs/tags'], { onStderr: undefined }));
            if (tips.length === 0) {
                return { refs: [], defaultBranch };
            }
            await this.writeBundle(request.bundleFile, tips, haves, git);
            return { refs: tips.map(tip => tip.ref), defaultBranch };
        } finally {
            await this.removeScratch(scratch);
        }
    }

    protected assertValidRequest(request: QaapHostedGitFetchRequest): void {
        if (!this.isAllowedUrl(request.url)) {
            throw new Error('Hosted fetch only reads GitHub over HTTPS.');
        }
        if (!path.isAbsolute(request.bundleFile)) {
            throw new Error('Hosted fetch needs an absolute bundle path.');
        }
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
     * Writes a v2 bundle: every remote ref, the project's tips as prerequisites, and a thin pack of
     * the objects reachable from the refs but not from those tips. The file is created exclusively
     * (an existing file or symlink fails) and made world-readable through its descriptor, so the
     * tenant uid can read it whatever this process's umask is.
     */
    protected async writeBundle(
        bundleFile: string,
        tips: ReadonlyArray<{ sha: string; ref: string }>,
        haves: readonly string[],
        git: (args: string[], extra?: QaapSealedGitRunOptions) => Promise<string>,
    ): Promise<void> {
        const handle = await fs.promises.open(bundleFile, 'wx', 0o644);
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
                await fs.promises.rm(bundleFile, { force: true });
            }
        }
    }
}
