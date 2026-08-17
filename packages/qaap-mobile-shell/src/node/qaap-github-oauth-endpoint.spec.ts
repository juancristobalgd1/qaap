// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapGithubOauthEndpoint } from './qaap-github-oauth-endpoint';
import type { QaapProjectSessionSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';

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
        } = {
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
});
