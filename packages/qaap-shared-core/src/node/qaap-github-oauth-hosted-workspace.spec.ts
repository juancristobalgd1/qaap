// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapGithubOauthEndpoint } from './qaap-github-oauth-endpoint';
import { QaapHostedGitFetch, type QaapHostedGitFetchRequest, type QaapHostedGitFetchResult } from './qaap-hosted-git-fetch';
import type { QaapHostedGitPushRequest } from './qaap-hosted-git-push';
import type { QaapSealedGitRunOptions } from './qaap-sealed-github-git';

const TOKEN = 'gho_hostedWorkspaceTokenCanary42';

/** The sealed fetch, reading a local bare repository where the backend asked for GitHub. */
class LocalHostedGitFetch extends QaapHostedGitFetch {
    readonly requests: QaapHostedGitFetchRequest[] = [];

    constructor(protected readonly remoteUrl: string) {
        super();
    }

    override fetchBundle(request: QaapHostedGitFetchRequest, options?: QaapSealedGitRunOptions): Promise<QaapHostedGitFetchResult> {
        this.requests.push(request);
        return super.fetchBundle({ ...request, url: this.remoteUrl }, options);
    }

    protected override isAllowedUrl(url: string): boolean {
        return url.startsWith('file://');
    }

    protected override allowedProtocol(): string {
        return 'file';
    }
}

function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
}

function fileUrl(directory: string): string {
    const posix = directory.split(path.sep).join('/');
    return `file://${posix.startsWith('/') ? '' : '/'}${posix}`;
}

function commit(repo: string, file: string, content: string): string {
    fs.writeFileSync(path.join(repo, file), content);
    git(repo, 'add', file);
    git(repo, '-c', 'user.email=spec@qaap.test', '-c', 'user.name=Spec', 'commit', '--quiet', '-m', file);
    return git(repo, 'rev-parse', 'HEAD');
}

interface WorkspaceEnsurer {
    ensureRepositoryWorkspace(repository: { owner: string; name: string; cloneUrl: string }, accessToken: string | undefined, userLogin: string): Promise<string>;
}

describe('QaapGithubOauthEndpoint hosted clone/fetch (token boundary)', function (): void {
    this.timeout(60_000);
    let base: string;
    let remote: string;
    let upstream: string;
    let previousCloudMode: string | undefined;
    let tenantCalls: Array<{ args: readonly string[]; env: NodeJS.ProcessEnv }>;
    let pushes: QaapHostedGitPushRequest[];

    beforeEach(() => {
        previousCloudMode = process.env.QAAP_CLOUD_MODE;
        process.env.QAAP_CLOUD_MODE = 'docker';
        base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-hosted-ws-')));
        remote = path.join(base, 'remote.git');
        upstream = path.join(base, 'upstream');
        git(base, 'init', '--bare', '--quiet', '-b', 'main', remote);
        git(base, 'init', '--quiet', '-b', 'main', upstream);
        tenantCalls = [];
        pushes = [];
    });

    afterEach(() => {
        if (previousCloudMode === undefined) {
            delete process.env.QAAP_CLOUD_MODE;
        } else {
            process.env.QAAP_CLOUD_MODE = previousCloudMode;
        }
        // A detached `git gc --auto` can still be writing into .git on macOS; retry instead of racing it.
        fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    function createEndpoint(fetcher: LocalHostedGitFetch): WorkspaceEnsurer {
        const reposRoot = path.join(base, 'repos');
        fs.mkdirSync(reposRoot);
        const endpoint = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        Object.assign(endpoint, {
            reposRoot,
            gitOperationTimeoutMs: 60_000,
            workspacePrepareTimeoutMs: 60_000,
            hostedFetch: fetcher,
            hostedPush: { push: async (request: QaapHostedGitPushRequest) => { pushes.push(request); } },
            // The tenant worker: records what the agent uid would receive, then runs plain local git.
            tenantProcess: {
                resolveProcessEnv: (_cwd: string, env: NodeJS.ProcessEnv) => env,
                spawnArgvPreparedAsync: async (file: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ['ignore', 'pipe' | 'ignore', 'pipe'] }) => {
                    tenantCalls.push({ args, env: options.env });
                    return spawn(file, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: options.stdio });
                },
            },
        });
        return endpoint as unknown as WorkspaceEnsurer;
    }

    function expectTenantNeverSawToken(): void {
        expect(tenantCalls.length).to.be.greaterThan(0);
        for (const call of tenantCalls) {
            const visible = [...call.args, ...Object.keys(call.env), ...Object.values(call.env).map(String)].join('\n');
            expect(visible).to.not.include(TOKEN);
            expect(visible).to.not.include(Buffer.from(`x-access-token:${TOKEN}`).toString('base64'));
            expect(visible.toLowerCase()).to.not.include('extraheader');
        }
    }

    it('clones and later fetches through the sealed fetch; tenant git only reads a tokenless bundle', async () => {
        const first = commit(upstream, 'a.txt', 'one\n');
        git(upstream, 'branch', 'feature');
        git(upstream, 'tag', 'v1');
        git(upstream, 'push', '--quiet', remote, 'main', 'feature', 'v1');
        const fetcher = new LocalHostedGitFetch(fileUrl(remote));
        const endpoint = createEndpoint(fetcher);
        const repository = { owner: 'octocat', name: 'hello', cloneUrl: 'https://evil.example/agent-chosen.git' };

        const target = await endpoint.ensureRepositoryWorkspace(repository, TOKEN, 'alice');

        expect(target).to.equal(path.join(base, 'repos', 'users', 'alice', 'octocat', 'hello'));
        expect(fs.readFileSync(path.join(target, 'a.txt'), 'utf8')).to.equal('one\n');
        expect(git(target, 'rev-parse', 'HEAD')).to.equal(first);
        expect(git(target, 'remote', 'get-url', 'origin')).to.equal('https://github.com/octocat/hello.git');
        expect(git(target, 'for-each-ref', '--format=%(refname)', 'refs/remotes/origin/feature')).to.equal('refs/remotes/origin/feature');
        expect(fetcher.requests[0]).to.deep.include({ url: 'https://github.com/octocat/hello.git', token: TOKEN });
        expect(fetcher.requests[0].objectsDirectory).to.equal(undefined);

        const second = commit(upstream, 'b.txt', 'two\n');
        git(upstream, 'tag', 'v2');
        git(upstream, 'push', '--quiet', remote, 'main', 'v2');
        // An agent rewrites the project's remote: the sealed fetch must not follow it.
        git(target, 'remote', 'set-url', 'origin', 'https://attacker.example/steal.git');

        expect(await endpoint.ensureRepositoryWorkspace(repository, TOKEN, 'alice')).to.equal(target);

        expect(fetcher.requests[1]).to.deep.include({
            url: 'https://github.com/octocat/hello.git',
            token: TOKEN,
            objectsDirectory: fs.realpathSync.native(path.join(target, '.git', 'objects')),
        });
        expect(fetcher.requests[1].haves).to.include(first);
        expect(git(target, 'rev-parse', 'refs/remotes/origin/main')).to.equal(second);
        expect(git(target, 'rev-parse', 'refs/remotes/origin/feature')).to.equal(first);
        expect(git(target, 'tag', '--list')).to.equal('v1\nv2');
        expectTenantNeverSawToken();
        // Bundles are removed; only the workspace remains next to it.
        expect(fs.readdirSync(path.dirname(target))).to.deep.equal(['hello']);
    });

    it('an empty GitHub repository is initialised locally and its seed goes through the sealed push', async () => {
        const fetcher = new LocalHostedGitFetch(fileUrl(remote));
        const endpoint = createEndpoint(fetcher);

        const target = await endpoint.ensureRepositoryWorkspace({ owner: 'octocat', name: 'hello', cloneUrl: 'https://github.com/octocat/hello.git' }, TOKEN, 'alice');

        expect(git(target, 'remote', 'get-url', 'origin')).to.equal('https://github.com/octocat/hello.git');
        expect(git(target, 'ls-files')).to.equal('index.html\npackage.json');
        expect(pushes).to.deep.equal([{
            objectsDirectory: fs.realpathSync.native(path.join(target, '.git', 'objects')),
            url: 'https://github.com/octocat/hello.git',
            sha: git(target, 'rev-parse', 'HEAD'),
            ref: 'refs/heads/main',
            token: TOKEN,
        }]);
        expectTenantNeverSawToken();
    });

    it('fetches everything instead of reading a symlinked objects directory as the backend uid', async function (): Promise<void> {
        if (process.platform === 'win32') {
            // Creating symlinks needs a privilege Windows runners do not grant.
            this.skip();
        }
        commit(upstream, 'a.txt', 'one\n');
        git(upstream, 'push', '--quiet', remote, 'main');
        const fetcher = new LocalHostedGitFetch(fileUrl(remote));
        const endpoint = createEndpoint(fetcher);
        const repository = { owner: 'octocat', name: 'hello', cloneUrl: 'https://github.com/octocat/hello.git' };
        const target = await endpoint.ensureRepositoryWorkspace(repository, TOKEN, 'alice');
        const elsewhere = path.join(base, 'elsewhere-objects');
        fs.renameSync(path.join(target, '.git', 'objects'), elsewhere);
        fs.symlinkSync(elsewhere, path.join(target, '.git', 'objects'));

        await endpoint.ensureRepositoryWorkspace(repository, TOKEN, 'alice');

        expect(fetcher.requests[1].objectsDirectory).to.equal(undefined);
        expect(fetcher.requests[1].haves).to.equal(undefined);
    });
});
