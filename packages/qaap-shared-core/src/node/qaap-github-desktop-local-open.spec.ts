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

interface DesktopOpenEndpoint {
    projectSessions: QaapProjectSessionStore;
    handleOpenGithubRepository(req: unknown, res: FakeResponse): Promise<void>;
}

interface EnsureCall {
    accessToken: string | undefined;
    login: string;
}

// Live desktop bug (Nov 2026): opening a project whose checkout is already on disk failed with
// "Could not open qa-sandbox/notes-dev: GitHub sign-in required" when Qaap had no GitHub session.
describe('QaapGithubOauthEndpoint desktop open without a Qaap GitHub session', () => {

    const login = '_dev';
    let reposRoot: string;
    let endpoint: DesktopOpenEndpoint;
    let ensureCalls: EnsureCall[];
    let githubLookups: number;
    let previousDesktop: string | undefined;

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

    const clonePath = (): string => path.join(reposRoot, 'users', login, 'qa-sandbox', 'notes-dev');
    const open = async (): Promise<FakeResponse> => {
        const res = makeRes();
        await endpoint.handleOpenGithubRepository({ params: { owner: 'qa-sandbox', repo: 'notes-dev' }, body: {} }, res);
        return res;
    };

    beforeEach(() => {
        previousDesktop = process.env.QAAP_DESKTOP;
        process.env.QAAP_DESKTOP = '1';
        reposRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-desktop-open-'));
        ensureCalls = [];
        githubLookups = 0;
        const instance = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        Object.assign(instance, {
            reposRoot,
            auth: {
                authenticate: () => ({ kind: 'skip', userLogin: login }),
                resolveUserLogin: () => login,
                logSecurityEvent: () => undefined,
            },
            projectSessions: new InMemoryProjectSessionStore(),
            runGitOutput: async () => 'feature/x',
            fetchRepositoryForClone: async () => {
                githubLookups++;
                throw new Error('GitHub repository API failed (404)');
            },
            resolveAccessibleRepository: async () => {
                throw new Error('must not need a GitHub token');
            },
            ensureRepositoryWorkspace: async (_repository: unknown, accessToken: string | undefined, userLogin: string) => {
                ensureCalls.push({ accessToken, login: userLogin });
                fs.mkdirSync(path.join(clonePath(), '.git', 'objects'), { recursive: true });
                fs.mkdirSync(path.join(clonePath(), '.git', 'refs'), { recursive: true });
                fs.writeFileSync(path.join(clonePath(), '.git', 'HEAD'), 'ref: refs/heads/main\n');
                return clonePath();
            },
        });
        endpoint = instance as unknown as DesktopOpenEndpoint;
    });

    afterEach(() => {
        if (previousDesktop === undefined) {
            delete process.env.QAAP_DESKTOP;
        } else {
            process.env.QAAP_DESKTOP = previousDesktop;
        }
        fs.rmSync(reposRoot, { recursive: true, force: true });
    });

    const seedCheckout = (): void => {
        fs.mkdirSync(path.join(clonePath(), '.git', 'objects'), { recursive: true });
        fs.mkdirSync(path.join(clonePath(), '.git', 'refs'), { recursive: true });
        fs.writeFileSync(path.join(clonePath(), '.git', 'HEAD'), 'ref: refs/heads/feature/x\n');
    };

    it('opens an existing local checkout without GitHub and without git network work', async () => {
        seedCheckout();

        const res = await open();

        expect(res.statusCode).to.equal(200);
        const body = res.body as { workspaceUri: string; repository: { fullName: string; defaultBranch: string } };
        expect(body.repository.fullName).to.equal('qa-sandbox/notes-dev');
        expect(body.repository.defaultBranch).to.equal('feature/x');
        expect(body.workspaceUri).to.match(/notes-dev$/);
        expect(ensureCalls).to.deep.equal([]);
        expect(githubLookups).to.equal(0);
        expect(endpoint.projectSessions.listForUser(login).map(session => session.repoKey)).to.deep.equal(['github:qa-sandbox/notes-dev']);
    });

    it('clones a missing checkout with the local git credentials, never a Qaap token', async () => {
        const res = await open();

        expect(res.statusCode).to.equal(200);
        expect(ensureCalls).to.deep.equal([{ accessToken: undefined, login }]);
        expect(githubLookups).to.equal(1);
    });

    it('explains the local credential path when the clone fails', async () => {
        Object.assign(endpoint, {
            ensureRepositoryWorkspace: async () => {
                throw new Error('Authentication failed');
            },
        });

        const res = await open();

        expect(res.statusCode).to.equal(502);
        expect((res.body as { error: string }).error).to.contain('gh auth login');
    });

    it('keeps a removed project removed', async () => {
        seedCheckout();
        endpoint.projectSessions.markRepositoryRemoved(login, 'github:qa-sandbox/notes-dev');

        const res = await open();

        expect(res.statusCode).to.equal(410);
    });

    it('web and VPS still require the owner GitHub session', async () => {
        delete process.env.QAAP_DESKTOP;
        seedCheckout();

        const res = await open();

        expect(res.statusCode).to.equal(503);
        expect((res.body as { error: string }).error).to.equal('GitHub sign-in required');
    });
});
