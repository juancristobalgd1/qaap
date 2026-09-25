// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { QaapGithubOauthEndpoint } from './qaap-github-oauth-endpoint';
import type { QaapProjectSessionSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { QaapPlanRepoLimitError } from '@theia/qaap-adapters/lib/common/qaap-billing-quota';

describe('QaapGithubOauthEndpoint.enrichSessionWithWorkspaceUri', () => {

    let reposRoot: string;
    let endpoint: QaapGithubOauthEndpoint;
    const login = 'alice';

    const session = (patch: Partial<QaapProjectSessionSummary> & { repoKey: string }): QaapProjectSessionSummary => ({
        branch: 'main',
        ...patch,
    });

    const enrich = (input: QaapProjectSessionSummary): QaapProjectSessionSummary =>
        (endpoint as unknown as {
            enrichSessionWithWorkspaceUri(l: string, s: QaapProjectSessionSummary): QaapProjectSessionSummary;
        }).enrichSessionWithWorkspaceUri(login, input);

    beforeEach(() => {
        reposRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-sessions-uri-'));
        endpoint = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        Object.assign(endpoint, { reposRoot });
    });

    afterEach(() => {
        fs.rmSync(reposRoot, { recursive: true, force: true });
    });

    it('attaches the owner clone path as a file: URI when the repository is cloned', () => {
        const clone = path.join(reposRoot, 'users', login, 'octocat', 'hello');
        fs.mkdirSync(clone, { recursive: true });
        const enriched = enrich(session({ repoKey: 'github:octocat/hello' }));
        expect(enriched.workspaceUri).to.match(/^file:\/\//);
        expect(enriched.workspaceUri).to.contain('/users/alice/octocat/hello');
    });

    it('leaves the session untouched when the repository is not cloned yet', () => {
        const input = session({ repoKey: 'github:octocat/uncloned' });
        expect(enrich(input)).to.equal(input);
    });

    it('never enriches non-github repoKeys', () => {
        const input = session({ repoKey: 'ws:file:///workspace/somewhere' });
        expect(enrich(input)).to.equal(input);
    });

    it('preserves an already-present workspaceUri', () => {
        const input = session({ repoKey: 'github:octocat/hello', workspaceUri: 'file:///already/there' });
        expect(enrich(input)).to.equal(input);
    });

    it('scopes the derived path to the SESSION OWNER, not any other user', () => {
        // Same repo cloned by another user must not leak into alice's session.
        fs.mkdirSync(path.join(reposRoot, 'users', 'bob', 'octocat', 'hello'), { recursive: true });
        const enriched = enrich(session({ repoKey: 'github:octocat/hello' }));
        expect(enriched.workspaceUri).to.equal(undefined);
    });
});

describe('QaapGithubOauthEndpoint skip-auth and on-disk clone sessions', () => {

    let reposRoot: string;
    let endpoint: QaapGithubOauthEndpoint;
    const login = '_dev';

    beforeEach(() => {
        reposRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-skip-sessions-'));
        endpoint = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        Object.assign(endpoint, { reposRoot });
    });

    afterEach(() => {
        fs.rmSync(reposRoot, { recursive: true, force: true });
    });

    it('lists cloned owner/repo directories that have a .git dir', () => {
        const clone = path.join(reposRoot, 'users', login, 'antfu-collective', 'vitesse-lite');
        fs.mkdirSync(path.join(clone, '.git'), { recursive: true });
        const listed = (endpoint as unknown as {
            listOnDiskGithubCloneSessions(l: string): QaapProjectSessionSummary[];
        }).listOnDiskGithubCloneSessions(login);
        expect(listed.map(s => s.repoKey)).to.deep.equal(['github:antfu-collective/vitesse-lite']);
    });

    it('does not list a nested folder without .git', () => {
        fs.mkdirSync(path.join(reposRoot, 'users', login, 'antfu-collective', 'not-a-repo'), { recursive: true });
        const listed = (endpoint as unknown as {
            listOnDiskGithubCloneSessions(l: string): QaapProjectSessionSummary[];
        }).listOnDiskGithubCloneSessions(login);
        expect(listed).to.deep.equal([]);
    });

    it('does not leak another user\'s clones into the skip-auth bucket', () => {
        fs.mkdirSync(path.join(reposRoot, 'users', 'alice', 'octocat', 'hello', '.git'), { recursive: true });
        const listed = (endpoint as unknown as {
            listOnDiskGithubCloneSessions(l: string): QaapProjectSessionSummary[];
        }).listOnDiskGithubCloneSessions(login);
        expect(listed).to.deep.equal([]);
    });

    it('merge prefers stored sessions over disk-only rows', () => {
        const clone = path.join(reposRoot, 'users', login, 'typicode', 'json-server');
        fs.mkdirSync(path.join(clone, '.git'), { recursive: true });
        const stored: QaapProjectSessionSummary[] = [{
            repoKey: 'github:typicode/json-server',
            branch: 'master',
            lastTask: 'from-store',
        }];
        const merged = (endpoint as unknown as {
            mergeOnDiskGithubSessions(l: string, s: QaapProjectSessionSummary[]): QaapProjectSessionSummary[];
        }).mergeOnDiskGithubSessions(login, stored);
        expect(merged).to.have.length(1);
        expect(merged[0].branch).to.equal('master');
        expect(merged[0].lastTask).to.equal('from-store');
    });
});

describe('QaapGithubOauthEndpoint.handleDeleteGithubRepository', () => {

    let reposRoot: string;
    let endpoint: QaapGithubOauthEndpoint;
    const login = 'alice';

    const makeRes = (): { statusCode?: number; body?: unknown; status: (code: number) => { json: (b: unknown) => void }; json: (b: unknown) => void } => {
        const res: {
            statusCode?: number;
            body?: unknown;
            status: (code: number) => { json: (b: unknown) => void };
            json: (b: unknown) => void;
            once: () => void;
        } = {
            once: () => undefined,
            status(code: number) {
                res.statusCode = code;
                return { json: (b: unknown) => { res.body = b; } };
            },
            json(b: unknown) {
                res.statusCode = 200;
                res.body = b;
            },
        };
        return res;
    };

    beforeEach(() => {
        reposRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-delete-repo-'));
        endpoint = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        Object.assign(endpoint, {
            reposRoot,
            auth: {
                authenticate: () => ({ kind: 'authenticated', userLogin: login }),
                resolveUserLogin: () => login,
                logSecurityEvent: () => undefined,
            },
            projectSessions: {
                deleted: [] as Array<{ login: string; repoKey: string }>,
                deleteForUser(user: string, repoKey: string) {
                    this.deleted.push({ login: user, repoKey });
                    return true;
                },
            },
            portRegistry: {
                listForOwnerUnderRoot: () => [],
                releasePreview: () => true,
            },
            cleanGithubPathSegment: (value: string | undefined) => {
                const decoded = typeof value === 'string' ? decodeURIComponent(value).trim() : '';
                return /^[A-Za-z0-9_.-]+$/.test(decoded) ? decoded : undefined;
            },
            pathExists: async (target: string) => fs.existsSync(target),
            releasePreviewsForWorkspace: QaapGithubOauthEndpoint.prototype['releasePreviewsForWorkspace'],
        });
    });

    afterEach(() => {
        fs.rmSync(reposRoot, { recursive: true, force: true });
    });

    it('deletes the caller clone and leaves another user\'s clone on disk', async () => {
        const aliceClone = path.join(reposRoot, 'users', login, 'octocat', 'hello');
        const bobClone = path.join(reposRoot, 'users', 'bob', 'octocat', 'hello');
        fs.mkdirSync(path.join(aliceClone, '.git'), { recursive: true });
        fs.writeFileSync(path.join(aliceClone, 'app.js'), 'alice-app');
        fs.mkdirSync(path.join(bobClone, '.git'), { recursive: true });
        fs.writeFileSync(path.join(bobClone, 'app.js'), 'bob-app');
        const res = makeRes();
        await (endpoint as unknown as {
            handleDeleteGithubRepository(req: { params: { owner: string; repo: string } }, response: typeof res): Promise<void>;
        }).handleDeleteGithubRepository({ params: { owner: 'octocat', repo: 'hello' } }, res);
        expect(res.statusCode).to.equal(200);
        expect(fs.existsSync(aliceClone)).to.equal(false);
        expect(fs.existsSync(bobClone)).to.equal(true);
        expect(fs.readFileSync(path.join(bobClone, 'app.js'), 'utf8')).to.equal('bob-app');
        expect((endpoint as unknown as { projectSessions: { deleted: Array<{ login: string; repoKey: string }> } }).projectSessions.deleted)
            .to.deep.equal([{ login, repoKey: 'github:octocat/hello' }]);
    });

    it('rejects invalid repository path segments', async () => {
        const res = makeRes();
        await (endpoint as unknown as {
            handleDeleteGithubRepository(req: { params: { owner: string; repo: string } }, response: typeof res): Promise<void>;
        }).handleDeleteGithubRepository({ params: { owner: '../etc', repo: 'hello' } }, res);
        expect(res.statusCode).to.equal(400);
    });

    it('returns 401 and does not delete when the caller is not signed in', async () => {
        const aliceClone = path.join(reposRoot, 'users', login, 'octocat', 'hello');
        fs.mkdirSync(path.join(aliceClone, '.git'), { recursive: true });
        Object.assign(endpoint, {
            auth: {
                authenticate: () => ({ kind: 'unauthorized' }),
                resolveUserLogin: () => undefined,
                logSecurityEvent: () => undefined,
            },
        });
        const res = makeRes();
        await (endpoint as unknown as {
            handleDeleteGithubRepository(req: { params: { owner: string; repo: string } }, response: typeof res): Promise<void>;
        }).handleDeleteGithubRepository({ params: { owner: 'octocat', repo: 'hello' } }, res);
        expect(res.statusCode).to.equal(401);
        expect(fs.existsSync(aliceClone)).to.equal(true);
    });
});

describe('QaapGithubOauthEndpoint plan repo limit', () => {

    it('returns 403 plan_repo_limit with the human message', () => {
        const endpoint = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        const res: {
            statusCode?: number;
            body?: unknown;
            status: (code: number) => { json: (b: unknown) => void };
        } = {
            status(code: number) {
                res.statusCode = code;
                return { json: (b: unknown) => { res.body = b; } };
            },
        };
        const handled = (endpoint as unknown as {
            respondBillingQuotaError(err: unknown, response: typeof res): boolean;
        }).respondBillingQuotaError(new QaapPlanRepoLimitError('starter', 3), res);
        expect(handled).to.equal(true);
        expect(res.statusCode).to.equal(403);
        expect(res.body).to.deep.include({
            error: 'plan_repo_limit',
            planId: 'starter',
            limit: 3,
        });
    });
});

describe('QaapGithubOauthEndpoint clone-by-URL lookup', () => {

    it('looks up a public repository directly even when the caller is authenticated', async () => {
        const endpoint = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        const calls: Array<{ accessToken: string | undefined; owner: string; name: string }> = [];
        const repository = {
            id: 1,
            fullName: 'octocat/Hello-World',
            owner: 'octocat',
            name: 'Hello-World',
            cloneUrl: 'https://github.com/octocat/Hello-World.git',
            htmlUrl: 'https://github.com/octocat/Hello-World',
            defaultBranch: 'main',
            private: false,
            updatedAt: new Date().toISOString(),
        };
        const res: {
            statusCode?: number;
            body?: unknown;
            status: (code: number) => { json: (b: unknown) => void };
            json: (b: unknown) => void;
            once: () => void;
        } = {
            once: () => undefined,
            status(code: number) {
                res.statusCode = code;
                return { json: (b: unknown) => { res.body = b; } };
            },
            json(b: unknown) {
                res.statusCode = 200;
                res.body = b;
            },
        };
        Object.assign(endpoint, {
            auth: {
                authenticate: () => ({
                    kind: 'authenticated',
                    userLogin: 'alice',
                    session: { accessToken: 'github-token' },
                }),
            },
            fetchRepositoryForClone: async (accessToken: string | undefined, owner: string, name: string) => {
                calls.push({ accessToken, owner, name });
                return repository;
            },
            ensureRepositoryWorkspace: async () => 'C:\\workspace\\repos\\users\\alice\\octocat\\Hello-World',
            rememberGithubCloneSession: () => undefined,
        });

        await (endpoint as unknown as {
            handleCloneGithubRepository(
                req: { body: { repository: string } },
                response: typeof res,
            ): Promise<void>;
        }).handleCloneGithubRepository({ body: { repository: 'octocat/Hello-World' } }, res);

        expect(res.statusCode).to.equal(200);
        expect(calls).to.deep.equal([{
            accessToken: 'github-token',
            owner: 'octocat',
            name: 'Hello-World',
        }]);
        expect(res.body).to.deep.include({ repository });
    });
});

describe('QaapGithubOauthEndpoint clone workspace cleanup', () => {

    it('removes a partial target when git clone fails', async () => {
        const reposRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-clone-cleanup-'));
        const endpoint = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        Object.assign(endpoint, {
            reposRoot,
            runGit: async (args: string[], _token: string | undefined, cwd: string) => {
                if (args[0] === 'clone') {
                    const destination = path.join(cwd, args[2]);
                    fs.mkdirSync(path.join(destination, '.git'), { recursive: true });
                    fs.writeFileSync(path.join(destination, 'partial-pack'), 'incomplete');
                }
                throw new Error('Git operation timed out after 120 seconds');
            },
        });

        try {
            await (endpoint as unknown as {
                ensureRepositoryWorkspace(
                    repository: { owner: string; name: string; cloneUrl: string },
                    accessToken: string | undefined,
                    userLogin: string,
                ): Promise<string>;
            }).ensureRepositoryWorkspace(
                {
                    owner: 'octocat',
                    name: 'Hello-World',
                    cloneUrl: 'https://github.com/octocat/Hello-World.git',
                },
                undefined,
                'alice',
            );
            expect.fail('Expected the clone to fail');
        } catch (err) {
            expect(err).to.be.instanceOf(Error);
            expect((err as Error).message).to.contain('timed out');
        }

        expect(fs.existsSync(path.join(reposRoot, 'users', 'alice', 'octocat', 'Hello-World'))).to.equal(false);
        expect(fs.readdirSync(path.join(reposRoot, 'users', 'alice', 'octocat'))).to.deep.equal([]);
        fs.rmSync(reposRoot, { recursive: true, force: true });
    });

    type WorkspaceEnsurer = {
        ensureRepositoryWorkspace(repository: { owner: string; name: string; cloneUrl: string }, accessToken: undefined, userLogin: string): Promise<string>;
    };
    const helloWorld = { owner: 'octocat', name: 'Hello-World', cloneUrl: 'https://github.com/octocat/Hello-World.git' };

    it('a git that keeps writing after a cancelled clone never creates the repository path', async () => {
        const reposRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-clone-cancel-'));
        const target = path.join(reposRoot, 'users', 'alice', 'octocat', 'Hello-World');
        let lateWrite: (() => void) | undefined;
        const endpoint = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        Object.assign(endpoint, {
            reposRoot,
            runGit: async (args: string[], _token: string | undefined, cwd: string) => {
                // The killed exec client returns, but git inside the worker still writes its destination later.
                lateWrite = () => fs.mkdirSync(path.join(cwd, args[2], '.git'), { recursive: true });
                throw new Error('Git operation cancelled');
            },
        });
        try {
            await (endpoint as unknown as WorkspaceEnsurer).ensureRepositoryWorkspace(helloWorld, undefined, 'alice');
            expect.fail('Expected the clone to fail');
        } catch (err) {
            expect((err as Error).message).to.contain('cancelled');
        }
        lateWrite!();
        expect(fs.existsSync(target)).to.equal(false);
        fs.rmSync(reposRoot, { recursive: true, force: true });
    });

    it('moves a finished clone into a pre-existing empty workspace directory', async () => {
        const reposRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-clone-empty-'));
        const target = path.join(reposRoot, 'users', 'alice', 'octocat', 'Hello-World');
        fs.mkdirSync(target, { recursive: true });
        const endpoint = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        Object.assign(endpoint, {
            reposRoot,
            runGit: async (args: string[], _token: string | undefined, cwd: string) => {
                if (args[0] === 'clone') {
                    fs.mkdirSync(path.join(cwd, args[2], '.git'), { recursive: true });
                    fs.writeFileSync(path.join(cwd, args[2], 'README.md'), 'hello');
                } else {
                    throw new Error(`unexpected git ${args.join(' ')}`);
                }
            },
        });
        expect(await (endpoint as unknown as WorkspaceEnsurer).ensureRepositoryWorkspace(helloWorld, undefined, 'alice')).to.equal(target);
        expect(fs.readFileSync(path.join(target, 'README.md'), 'utf8')).to.equal('hello');
        expect(fs.readdirSync(path.dirname(target))).to.deep.equal(['Hello-World']);
        fs.rmSync(reposRoot, { recursive: true, force: true });
    });
});

describe('QaapGithubOauthEndpoint git deadlines', () => {

    function createEndpoint(extra: Record<string, unknown> = {}): QaapGithubOauthEndpoint {
        const endpoint = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        Object.assign(endpoint, { gitOperationTimeoutMs: 120_000, workspacePrepareTimeoutMs: 150_000, ...extra });
        return endpoint;
    }

    it('shares one deadline between clone and the empty-repository seed', async () => {
        const reposRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-clone-deadline-'));
        const target = path.join(reposRoot, 'users', 'alice', 'octocat', 'empty');
        const deadlines: Array<number | undefined> = [];
        const endpoint = createEndpoint({
            reposRoot,
            runGit: async (args: string[], _token: string | undefined, cwd: string, options?: { deadline?: number }) => {
                deadlines.push(options?.deadline);
                if (args[0] === 'clone') {
                    fs.mkdirSync(path.join(cwd, args[2], '.git'), { recursive: true });
                }
            },
        });
        const before = Date.now();
        try {
            await (endpoint as unknown as {
                ensureRepositoryWorkspace(repository: { owner: string; name: string; cloneUrl: string }, token: undefined, login: string): Promise<string>;
            }).ensureRepositoryWorkspace({ owner: 'octocat', name: 'empty', cloneUrl: 'https://github.com/octocat/empty.git' }, undefined, 'alice');
            expect(fs.existsSync(path.join(target, '.git'))).to.equal(true);
            // clone + add + commit + push
            expect(deadlines).to.have.length(4);
            expect(new Set(deadlines).size).to.equal(1);
            expect(deadlines[0]).to.be.within(before + 150_000, Date.now() + 150_000);
        } finally {
            fs.rmSync(reposRoot, { recursive: true, force: true });
        }
    });

    it('fails fast without spawning git once the shared deadline has passed', async () => {
        const endpoint = createEndpoint() as unknown as {
            runLocalGit(cwd: string, args: string[], capture: boolean, options?: { deadline?: number }): Promise<string>;
        };
        let error: unknown;
        try {
            await endpoint.runLocalGit(os.tmpdir(), ['--version'], true, { deadline: Date.now() - 1 });
        } catch (err) {
            error = err;
        }
        expect((error as Error).message).to.contain('timed out');
    });

    it('runs local git with output under the per-operation cap', async () => {
        const endpoint = createEndpoint() as unknown as {
            runLocalGit(cwd: string, args: string[], capture: boolean, options?: { deadline?: number }): Promise<string>;
        };
        expect(await endpoint.runLocalGit(os.tmpdir(), ['--version'], true)).to.contain('git version');
    });

    it('kills a running local git child when the request is closed', async () => {
        const endpoint = createEndpoint() as unknown as {
            runLocalGit(cwd: string, args: string[], capture: boolean, options?: { signal?: AbortSignal }): Promise<string>;
        };
        const controller = new AbortController();
        const pending = endpoint.runLocalGit(os.tmpdir(), ['--version'], true, { signal: controller.signal });
        controller.abort();
        let error: unknown;
        try {
            await pending;
        } catch (err) {
            error = err;
        }
        expect((error as Error).message).to.contain('cancelled');
    });

    it('aborts the workspace signal only when the response closes before it finished', () => {
        const endpoint = createEndpoint() as unknown as { abortOnResponseClose(res: unknown): AbortSignal };
        const listeners: Array<() => void> = [];
        const once = (_event: string, listener: () => void): void => { listeners.push(listener); };
        const signal = endpoint.abortOnResponseClose({ writableFinished: false, once });
        listeners[0]();
        expect(signal.aborted).to.equal(true);
        const finishedSignal = endpoint.abortOnResponseClose({ writableFinished: true, once });
        listeners[1]();
        expect(finishedSignal.aborted).to.equal(false);
    });
});

describe('QaapGithubOauthEndpoint hosted git cancellation (runTenantGit)', () => {
    const children: ChildProcess[] = [];

    afterEach(() => {
        for (const child of children.splice(0)) {
            if (child.exitCode === null && child.signalCode === null) {
                child.kill('SIGKILL');
            }
        }
    });

    function longRunningChild(): ChildProcess {
        const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: ['ignore', 'ignore', 'pipe'] });
        children.push(child);
        return child;
    }

    function exitSignal(child: ChildProcess): Promise<NodeJS.Signals | null> {
        if (child.exitCode !== null || child.signalCode !== null) {
            return Promise.resolve(child.signalCode);
        }
        return new Promise(resolve => child.once('exit', (_code, signal) => resolve(signal)));
    }

    function createHostedEndpoint(spawnPrepared: () => Promise<ChildProcess>): {
        runTenantGit(cwd: string, args: string[], capture: boolean, options?: { signal?: AbortSignal; deadline?: number }): Promise<string>;
    } {
        const endpoint = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        Object.assign(endpoint, {
            gitOperationTimeoutMs: 60_000,
            tenantProcess: {
                resolveProcessEnv: (_cwd: string, env: NodeJS.ProcessEnv) => env,
                spawnArgvPreparedAsync: spawnPrepared,
            },
        });
        return endpoint as unknown as ReturnType<typeof createHostedEndpoint>;
    }

    async function rejection(promise: Promise<unknown>): Promise<Error> {
        try {
            await promise;
        } catch (err) {
            return err as Error;
        }
        throw new Error('expected a rejection');
    }

    it('kills the running tenant git child when the request is aborted', async () => {
        const child = longRunningChild();
        const endpoint = createHostedEndpoint(async () => child);
        const controller = new AbortController();
        const pending = endpoint.runTenantGit('/workspace', ['fetch'], false, { signal: controller.signal });
        await new Promise(resolve => setImmediate(resolve));
        controller.abort();
        expect((await rejection(pending)).message).to.contain('cancelled');
        expect(await exitSignal(child)).to.equal('SIGTERM');
    });

    it('kills a tenant worker that finishes starting after the request was aborted', async () => {
        let finishStarting!: (child: ChildProcess) => void;
        const endpoint = createHostedEndpoint(() => new Promise<ChildProcess>(resolve => { finishStarting = resolve; }));
        const controller = new AbortController();
        const pending = endpoint.runTenantGit('/workspace', ['clone'], false, { signal: controller.signal });
        controller.abort();
        expect((await rejection(pending)).message).to.contain('cancelled');
        // The worker only now comes up (e.g. slow Docker ensure): it must not run git unsupervised.
        const late = longRunningChild();
        finishStarting(late);
        expect(await exitSignal(late)).to.equal('SIGTERM');
    });

    it('does not start the tenant worker when the request was already aborted', async () => {
        let started = false;
        const endpoint = createHostedEndpoint(async () => {
            started = true;
            return longRunningChild();
        });
        const controller = new AbortController();
        controller.abort();
        expect((await rejection(endpoint.runTenantGit('/workspace', ['fetch'], false, { signal: controller.signal }))).message).to.contain('cancelled');
        expect(started).to.equal(false);
    });
});

describe('QaapGithubOauthEndpoint GitHub credential transport', () => {
    const token = 'ghp_argvLeakCanary123';
    const encoded = Buffer.from(`x-access-token:${token}`).toString('base64');
    let previousCloudMode: string | undefined;
    let previousNodeEnv: string | undefined;

    beforeEach(() => {
        previousCloudMode = process.env.QAAP_CLOUD_MODE;
        previousNodeEnv = process.env.NODE_ENV;
    });

    afterEach(() => {
        const restore = (key: string, value: string | undefined): void => {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        };
        restore('QAAP_CLOUD_MODE', previousCloudMode);
        restore('NODE_ENV', previousNodeEnv);
    });

    function exitingChild(): ChildProcess {
        return spawn(process.execPath, ['-e', ''], { stdio: ['ignore', 'pipe', 'pipe'] });
    }

    function expectNoToken(argv: readonly string[]): void {
        const joined = argv.join(' ');
        expect(joined).to.not.include(token);
        expect(joined).to.not.include(encoded);
        expect(joined).to.not.include('extraheader');
    }

    it('hosted: passes the auth header through env config, never through the git argv', async () => {
        process.env.QAAP_CLOUD_MODE = 'docker';
        const calls: Array<{ file: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
        const endpoint = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        Object.assign(endpoint, {
            gitOperationTimeoutMs: 60_000,
            reposRoot: '/workspace/repos',
            tenantProcess: {
                resolveProcessEnv: (_cwd: string, env: NodeJS.ProcessEnv) => env,
                spawnArgvPreparedAsync: async (file: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
                    calls.push({ file, args, env: options.env });
                    return exitingChild();
                },
            },
        });
        await (endpoint as unknown as { runGit(args: string[], accessToken: string | undefined, cwd: string): Promise<void> })
            .runGit(['-C', '/workspace/repos/users/alice/o/r', 'fetch', '--all'], token, '/workspace/repos/users/alice/o/r');

        expect(calls).to.have.length(1);
        expectNoToken([calls[0].file, ...calls[0].args]);
        expect(calls[0].args).to.include.members(['core.hooksPath=/dev/null', 'fetch', '--all']);
        expect(calls[0].env.GIT_CONFIG_COUNT).to.equal('1');
        expect(calls[0].env.GIT_CONFIG_KEY_0).to.equal('http.https://github.com/.extraheader');
        expect(calls[0].env.GIT_CONFIG_VALUE_0).to.equal(`AUTHORIZATION: basic ${encoded}`);
    });

    it('local: passes the auth header through env config, never through the git argv', async () => {
        delete process.env.QAAP_CLOUD_MODE;
        process.env.NODE_ENV = 'test';
        const calls: Array<{ args: readonly string[]; env: NodeJS.ProcessEnv | undefined }> = [];
        const endpoint = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        Object.assign(endpoint, {
            gitOperationTimeoutMs: 60_000,
            reposRoot: os.tmpdir(),
            spawnLocalGit: (_cwd: string, args: readonly string[], _capture: boolean, env?: NodeJS.ProcessEnv) => {
                calls.push({ args, env });
                return exitingChild();
            },
        });
        const runner = endpoint as unknown as {
            runGit(args: string[], accessToken: string | undefined, cwd: string): Promise<void>;
            runGitOutput(args: string[], cwd: string): Promise<string>;
        };
        await runner.runGit(['clone', 'https://github.com/o/r.git', 'r'], token, os.tmpdir());
        await runner.runGitOutput(['rev-parse', 'HEAD'], os.tmpdir());

        expect(calls).to.have.length(2);
        expectNoToken(calls[0].args);
        const index = Number(calls[0].env?.GIT_CONFIG_COUNT) - 1;
        expect(calls[0].env?.[`GIT_CONFIG_KEY_${index}`]).to.equal('http.https://github.com/.extraheader');
        expect(calls[0].env?.[`GIT_CONFIG_VALUE_${index}`]).to.equal(`AUTHORIZATION: basic ${encoded}`);
        expect(calls[0].env?.PATH).to.equal(process.env.PATH);
        // Token-less reads keep inheriting process.env unchanged.
        expect(calls[1].env).to.equal(undefined);
    });

    it('appends the header after git env-config entries already present', () => {
        const endpoint = Object.create(QaapGithubOauthEndpoint.prototype) as unknown as {
            githubAuthEnvironment(accessToken: string, base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
        };
        const env = endpoint.githubAuthEnvironment(token, { GIT_CONFIG_COUNT: '2' });
        expect(env).to.deep.equal({
            GIT_CONFIG_COUNT: '3',
            GIT_CONFIG_KEY_2: 'http.https://github.com/.extraheader',
            GIT_CONFIG_VALUE_2: `AUTHORIZATION: basic ${encoded}`,
        });
    });
});

describe('QaapGithubOauthEndpoint create repository when the clone fails', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('says the repository exists on GitHub and that opening it will clone it', async () => {
        globalThis.fetch = (async () => new Response(JSON.stringify({
            id: 1, full_name: 'alice/demo', name: 'demo', owner: { login: 'alice' },
            clone_url: 'https://github.com/alice/demo.git', html_url: 'https://github.com/alice/demo',
            default_branch: 'main', private: true, updated_at: '2026-01-01T00:00:00Z',
        }), { status: 201, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
        const endpoint = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        Object.assign(endpoint, {
            auth: { authenticate: () => ({ kind: 'authenticated', userLogin: 'alice', session: { accessToken: 'token' } }) },
            assertBillingAllowsNewRepo: async () => undefined,
            ensureRepositoryWorkspace: async () => { throw new Error('Git operation cancelled: the request was closed.'); },
        });
        const res = {
            statusCode: 0,
            body: undefined as unknown,
            once: () => undefined,
            status(code: number): { json: (body: unknown) => void } {
                res.statusCode = code;
                return { json: body => { res.body = body; } };
            },
            json(body: unknown): void {
                res.statusCode = 200;
                res.body = body;
            },
        };
        await (endpoint as unknown as {
            handleCreateGithubRepository(req: unknown, response: typeof res): Promise<void>;
        }).handleCreateGithubRepository({ body: { name: 'demo' } }, res);
        expect(res.statusCode).to.equal(502);
        const error = (res.body as { error: string }).error;
        expect(error).to.contain('alice/demo was created on GitHub');
        expect(error).to.contain('Git operation cancelled');
        expect(error).to.contain('Open it from your repository list to clone it');
    });
});
