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
import { QaapProjectSessionStore } from './qaap-project-session-store';

class InMemoryProjectSessionStore extends QaapProjectSessionStore {
    protected override schedulePersist(): void {
        /* no disk in unit tests */
    }
    protected override persistRepositoryRemoval(): void {
        /* no disk in unit tests */
    }
}

interface FakeResponse {
    statusCode?: number;
    body?: unknown;
    writableFinished: boolean;
    once(event: string, listener: () => void): void;
    status(code: number): { json(body: unknown): void };
    json(body: unknown): void;
}

interface RemovedRepositoryEndpoint {
    projectSessions: QaapProjectSessionStore;
    handleDeleteGithubRepository(req: unknown, res: FakeResponse): Promise<void>;
    handleOpenGithubRepository(req: unknown, res: FakeResponse): Promise<void>;
    handleUpsertProjectSession(req: unknown, res: FakeResponse): void;
    handleProjectSessions(req: unknown, res: FakeResponse): void;
}

// Production bug: removing the open project deleted the clone, then the still-open hub re-registered
// its `github:` session and an implicit `/open` re-cloned the repository ~40 s later, so the card came back.
describe('QaapGithubOauthEndpoint removed repositories stay removed', () => {

    const login = 'alice';
    let reposRoot: string;
    let endpoint: RemovedRepositoryEndpoint;
    let clones: string[];

    const makeRes = (): FakeResponse => {
        const res: FakeResponse = {
            writableFinished: false,
            once: () => undefined,
            status(code: number) {
                res.statusCode = code;
                return { json: (body: unknown) => { res.body = body; res.writableFinished = true; } };
            },
            json(body: unknown) {
                res.statusCode = 200;
                res.body = body;
                res.writableFinished = true;
            },
        };
        return res;
    };

    const repository = { owner: 'acme', name: 'shop', fullName: 'acme/shop', defaultBranch: 'main', cloneUrl: 'https://github.com/acme/shop.git' };
    const clonePath = (): string => path.join(reposRoot, 'users', login, 'acme', 'shop');

    beforeEach(() => {
        reposRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-removed-repo-'));
        clones = [];
        const instance = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        Object.assign(instance, {
            reposRoot,
            auth: {
                authenticate: () => ({ kind: 'authenticated', userLogin: login, session: { accessToken: 'token', user: { login } } }),
                resolveUserLogin: () => login,
                logSecurityEvent: () => undefined,
            },
            projectSessions: new InMemoryProjectSessionStore(),
            portRegistry: { listForOwnerUnderRoot: () => [], releasePreview: () => true },
            resolveAccessibleRepository: async () => repository,
            ensureRepositoryWorkspace: async () => {
                clones.push(repository.fullName);
                fs.mkdirSync(path.join(clonePath(), '.git'), { recursive: true });
                return clonePath();
            },
            pathExists: async (target: string) => fs.existsSync(target),
        });
        endpoint = instance as unknown as RemovedRepositoryEndpoint;
        fs.mkdirSync(path.join(clonePath(), '.git'), { recursive: true });
        endpoint.projectSessions.upsertForUser(login, { repoKey: 'github:acme/shop' });
    });

    afterEach(() => {
        // A clone the delete could not remove sits read-only in the trash.
        makeTreeWritable(reposRoot);
        fs.rmSync(reposRoot, { recursive: true, force: true });
    });

    const removeRepository = async (): Promise<void> => {
        const res = makeRes();
        await endpoint.handleDeleteGithubRepository({ params: { owner: 'acme', repo: 'shop' } }, res);
        expect(res.statusCode).to.equal(200);
        expect(fs.existsSync(clonePath())).to.equal(false);
    };

    const listedRepoKeys = (): string[] => {
        const res = makeRes();
        endpoint.handleProjectSessions({}, res);
        return (res.body as { sessions: Array<{ repoKey: string }> }).sessions.map(session => session.repoKey);
    };

    it('does not re-clone a removed repository through an implicit open', async () => {
        await removeRepository();

        const res = makeRes();
        await endpoint.handleOpenGithubRepository({ params: { owner: 'acme', repo: 'shop' }, body: {} }, res);

        expect(clones).to.deep.equal([]);
        expect(res.statusCode).to.equal(410);
        expect((res.body as { code?: string }).code).to.equal('repository_removed');
        expect(fs.existsSync(clonePath())).to.equal(false);
        expect(listedRepoKeys()).to.deep.equal([]);
    });

    it('does not let a project-session upsert bring a removed repository back', async () => {
        await removeRepository();

        const res = makeRes();
        endpoint.handleUpsertProjectSession({ body: { repoKey: 'github:Acme/Shop', bootstrapPhase: 'run-failed' } }, res);

        expect(res.statusCode).to.equal(200);
        expect(listedRepoKeys()).to.deep.equal([]);
    });

    it('clones again only when the user explicitly asks for it', async () => {
        await removeRepository();

        const res = makeRes();
        await endpoint.handleOpenGithubRepository({ params: { owner: 'acme', repo: 'shop' }, body: { explicit: true } }, res);

        expect(res.statusCode).to.equal(200);
        expect(clones).to.deep.equal(['acme/shop']);
        expect(listedRepoKeys()).to.deep.equal(['github:acme/shop']);
        // Once re-imported, the hub's own session updates are accepted again.
        endpoint.handleUpsertProjectSession({ body: { repoKey: 'github:acme/shop', bootstrapPhase: 'ready' } }, makeRes());
        expect(listedRepoKeys()).to.deep.equal(['github:acme/shop']);
    });

    // Production bug (07 Oct): removing an open project raced the task-transcript deletes, which write
    // checkpoint refs into the clone's .git while it is being deleted; fs.rm failed, the handler answered
    // 502 before recording the removal, and the card came back on the next reload.
    it('keeps the project removed when the clone cannot be deleted right away', async () => {
        const stubborn = path.join(clonePath(), '.git', 'refs');
        fs.mkdirSync(path.join(stubborn, 'qaap'), { recursive: true });
        fs.writeFileSync(path.join(stubborn, 'qaap', 'checkpoint'), 'x');
        fs.chmodSync(stubborn, 0o555);
        try {
            const res = makeRes();
            await endpoint.handleDeleteGithubRepository({ params: { owner: 'acme', repo: 'shop' } }, res);

            expect(res.statusCode).to.equal(200);
            expect(endpoint.projectSessions.isRepositoryRemoved(login, 'github:acme/shop')).to.equal(true);
            expect(listedRepoKeys()).to.deep.equal([]);
        } finally {
            // Windows ignores the read-only bit on directories, so there the delete succeeds at once.
            makeTreeWritable(reposRoot);
        }
    });

    // Production bug (07 Oct): the agent uid owns `.git/objects/xx/*` and `.git/refs/qaap/checkpoints/*`, so
    // this uid could not delete them and the folder stayed at the repository path for good.
    it('frees the repository path at once by moving an undeletable clone to the trash', async () => {
        const stubborn = path.join(clonePath(), '.git', 'refs', 'qaap');
        fs.mkdirSync(path.join(stubborn, 'checkpoints'), { recursive: true });
        fs.writeFileSync(path.join(stubborn, 'checkpoints', 'turn'), 'x');
        fs.chmodSync(stubborn, 0o555);
        const ownerDir = path.dirname(clonePath());
        try {
            const res = makeRes();
            await endpoint.handleDeleteGithubRepository({ params: { owner: 'acme', repo: 'shop' } }, res);

            expect(res.statusCode).to.equal(200);
            expect(fs.existsSync(clonePath())).to.equal(false);
            if (process.platform !== 'win32') {
                const trashed = fs.readdirSync(ownerDir).filter(entry => entry.startsWith('.qaap-trash-shop-'));
                expect(trashed).to.have.length(1);
                expect(fs.existsSync(path.join(ownerDir, trashed[0], '.git', 'refs', 'qaap', 'checkpoints', 'turn'))).to.equal(true);
            }
            expect(listedRepoKeys()).to.deep.equal([]);
        } finally {
            makeTreeWritable(reposRoot);
        }
    });

    it('empties the trash with the agent identity when this uid cannot delete it', async () => {
        const ownerDir = path.dirname(clonePath());
        const trashed = path.join(ownerDir, '.qaap-trash-shop-1-abcd');
        const stubborn = path.join(trashed, '.git', 'objects', 'ab');
        fs.mkdirSync(stubborn, { recursive: true });
        fs.writeFileSync(path.join(stubborn, 'cdef'), 'blob');
        fs.chmodSync(path.join(stubborn, 'cdef'), 0o444);
        fs.chmodSync(stubborn, 0o555);
        const calls: Array<{ file: string; args: readonly string[]; cwd: string }> = [];
        Object.assign(endpoint, {
            tenantProcess: {
                resolveProcessEnv: (_cwd: string, base: NodeJS.ProcessEnv) => base,
                spawnArgvPreparedAsync: async (file: string, args: readonly string[], options: { cwd: string }) => {
                    calls.push({ file, args, cwd: options.cwd });
                    // The agent owns these directories, so it may delete what it wrote.
                    makeTreeWritable(trashed);
                    return spawn(file, [...args], { cwd: options.cwd, stdio: 'ignore' });
                },
            },
        });
        try {
            await (endpoint as unknown as { purgeRepositoryTrash(directory: string): Promise<void> }).purgeRepositoryTrash(ownerDir);

            expect(fs.existsSync(trashed)).to.equal(false);
            expect(fs.existsSync(clonePath())).to.equal(true);
            if (process.platform !== 'win32') {
                expect(calls).to.deep.equal([{ file: 'rm', args: ['-rf', '--', './.qaap-trash-shop-1-abcd'], cwd: ownerDir }]);
            }
        } finally {
            makeTreeWritable(reposRoot);
        }
    });

    // Production bug (07 Oct, juancristobalgd1/vyyq): the removal was recorded under `github:owner/repo`
    // only; the clone's `recent:file:///…` and `ws:file:///…` sessions survived and listed it again.
    describe('path-keyed sessions of the clone', () => {
        const cloneUri = (): string => `file://${clonePath().split(path.sep).join('/').replace(/^\/?/, '/')}`;

        // The temporary repos root is not called `repos`; production resolves paths against the real root.
        beforeEach(() => Object.assign(endpoint.projectSessions, { reposRoot }));

        it('removes them with the repository and never lists them again', async () => {
            endpoint.projectSessions.upsertForUser(login, { repoKey: `recent:${cloneUri()}`, agentState: 'working', lastTask: 'Starting dev server…' });
            endpoint.projectSessions.upsertForUser(login, { repoKey: `ws:${cloneUri()}` });

            await removeRepository();

            expect(listedRepoKeys()).to.deep.equal([]);
            expect(endpoint.projectSessions.listForUser(login)).to.deep.equal([]);
        });

        it('hides them when the removal was recorded before this fix (lazy migration)', () => {
            endpoint.projectSessions.deleteForUser(login, 'github:acme/shop');
            fs.rmSync(clonePath(), { recursive: true, force: true });
            endpoint.projectSessions.upsertForUser(login, { repoKey: `recent:${cloneUri()}`, agentState: 'working', previewUrl: 'https://preview.example/shop' });
            endpoint.projectSessions.upsertForUser(login, { repoKey: `ws:${cloneUri()}` });
            endpoint.projectSessions.markRepositoryRemoved(login, 'github:acme/shop');

            expect(listedRepoKeys()).to.deep.equal([]);
        });

        it('ignores late ws:/recent: upserts for the removed clone', async () => {
            await removeRepository();

            endpoint.handleUpsertProjectSession({ body: { repoKey: `ws:${cloneUri()}`, agentState: 'working' } }, makeRes());
            endpoint.handleUpsertProjectSession({ body: { repoKey: `recent:${cloneUri()}`, previewUrl: 'https://preview.example/shop' } }, makeRes());

            expect(listedRepoKeys()).to.deep.equal([]);
        });

        it('lists them again once the repository is explicitly re-imported', async () => {
            await removeRepository();
            const res = makeRes();
            await endpoint.handleOpenGithubRepository({ params: { owner: 'acme', repo: 'shop' }, body: { explicit: true } }, res);
            expect(res.statusCode).to.equal(200);

            endpoint.handleUpsertProjectSession({ body: { repoKey: `ws:${cloneUri()}` } }, makeRes());

            expect(listedRepoKeys().sort()).to.deep.equal(['github:acme/shop', `ws:${cloneUri()}`]);
        });
    });

    it('still opens (and clones) a repository that was never removed', async () => {
        fs.rmSync(clonePath(), { recursive: true, force: true });

        const res = makeRes();
        await endpoint.handleOpenGithubRepository({ params: { owner: 'acme', repo: 'shop' }, body: {} }, res);

        expect(res.statusCode).to.equal(200);
        expect(clones).to.deep.equal(['acme/shop']);
    });
});

/** Undo the read-only bits a test set so the temporary tree can be deleted. */
function makeTreeWritable(root: string): void {
    if (!fs.existsSync(root)) {
        return;
    }
    fs.chmodSync(root, 0o755);
    if (fs.statSync(root).isDirectory()) {
        for (const entry of fs.readdirSync(root)) {
            makeTreeWritable(path.join(root, entry));
        }
    }
}

// Production bug (07 Oct): a removal that could not delete the agent's files left `<repo>/.git` without
// HEAD, and importing the repository again failed with "fatal: not a git repository".
describe('QaapGithubOauthEndpoint re-imports a repository over a broken clone', () => {

    let scratch: string;

    beforeEach(() => {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-reclone-'));
    });

    afterEach(() => {
        makeTreeWritable(scratch);
        fs.rmSync(scratch, { recursive: true, force: true });
    });

    const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

    it('moves a leftover .git without HEAD aside and clones cleanly', async () => {
        const origin = path.join(scratch, 'origin');
        fs.mkdirSync(origin);
        git(origin, 'init', '--quiet');
        fs.writeFileSync(path.join(origin, 'README.md'), 'shop');
        fs.writeFileSync(path.join(origin, 'app.js'), 'console.log(1);');
        git(origin, 'add', '.');
        git(origin, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '--quiet', '-m', 'init');

        const reposRoot = path.join(scratch, 'repos');
        const target = path.join(reposRoot, 'users', 'alice', 'acme', 'shop');
        const leftover = path.join(target, '.git');
        fs.mkdirSync(path.join(leftover, 'objects', 'ab'), { recursive: true });
        fs.writeFileSync(path.join(leftover, 'objects', 'ab', 'cdef'), 'blob');
        fs.chmodSync(path.join(leftover, 'objects', 'ab', 'cdef'), 0o444);
        fs.mkdirSync(path.join(leftover, 'refs', 'qaap', 'checkpoints', 'conversation'), { recursive: true });
        fs.writeFileSync(path.join(leftover, 'refs', 'qaap', 'checkpoints', 'conversation', 'turn'), 'x');
        // Written by the agent uid: this uid cannot delete what is inside.
        fs.chmodSync(path.join(leftover, 'refs', 'qaap'), 0o555);

        const projectSessions = new InMemoryProjectSessionStore();
        projectSessions.markRepositoryRemoved('alice', 'github:acme/shop');
        const instance = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        Object.assign(instance, { reposRoot, projectSessions, gitOperationTimeoutMs: 60_000, workspacePrepareTimeoutMs: 60_000 });
        const workspace = await (instance as unknown as {
            ensureRepositoryWorkspace(repository: { owner: string; name: string; cloneUrl: string }, token: undefined, login: string): Promise<string>;
        }).ensureRepositoryWorkspace({ owner: 'acme', name: 'shop', cloneUrl: origin }, undefined, 'alice');

        expect(workspace).to.equal(target);
        expect(git(target, 'rev-parse', 'HEAD')).to.equal(git(origin, 'rev-parse', 'HEAD'));
        expect(fs.readFileSync(path.join(target, 'README.md'), 'utf8')).to.equal('shop');
        expect(fs.existsSync(path.join(target, '.git', 'refs', 'qaap'))).to.equal(false);
        if (process.platform !== 'win32') {
            const trashed = fs.readdirSync(path.dirname(target)).filter(entry => entry.startsWith('.qaap-trash-shop-'));
            expect(trashed).to.have.length(1);
        }
    });
});
