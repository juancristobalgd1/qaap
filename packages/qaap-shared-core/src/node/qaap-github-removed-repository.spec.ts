// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
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
            fs.chmodSync(stubborn, 0o755);
        }
    });

    it('still opens (and clones) a repository that was never removed', async () => {
        fs.rmSync(clonePath(), { recursive: true, force: true });

        const res = makeRes();
        await endpoint.handleOpenGithubRepository({ params: { owner: 'acme', repo: 'shop' }, body: {} }, res);

        expect(res.statusCode).to.equal(200);
        expect(clones).to.deep.equal(['acme/shop']);
    });
});
