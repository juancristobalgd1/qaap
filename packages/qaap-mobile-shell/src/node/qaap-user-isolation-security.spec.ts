// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    isPathUnderUserWorkspace,
    parseGithubFullNameFromWorkspacePath,
    qaapUserScopedStorageKey,
    resolveRepositoryWorkspacePath,
    resolveUserReposRoot,
    safeUserIdSegment,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';
import { QaapGithubSessionStore } from './qaap-github-session-store';
import type { Request, Response } from '@theia/core/shared/express';

/** Builds a fake req carrying a session cookie, and a res capturing status/body, for guard tests. */
function fakeReqRes(sessionId: string): { req: Request; res: Response; status: () => number } {
    const captured = { code: 0 };
    const req = { headers: { cookie: `qaap_sid=${encodeURIComponent(sessionId)}` } } as unknown as Request;
    const res = {
        status(code: number) { captured.code = code; return this; },
        json() { return this; },
    } as unknown as Response;
    return { req, res, status: () => captured.code };
}

describe('qaap-user-isolation', () => {

    const reposRoot = '/workspace/repos';

    it('scopes repository clones per GitHub login (case A)', () => {
        const userA = resolveRepositoryWorkspacePath(reposRoot, 'alice', 'acme', 'demo');
        const userB = resolveRepositoryWorkspacePath(reposRoot, 'bob', 'acme', 'demo');
        expect(userA).to.equal(path.join(reposRoot, 'users', 'alice', 'acme', 'demo'));
        expect(userB).to.equal(path.join(reposRoot, 'users', 'bob', 'acme', 'demo'));
        expect(userA).to.not.equal(userB);
    });

    it('denies cross-user workspace access (case B)', () => {
        const userAPath = resolveRepositoryWorkspacePath(reposRoot, 'alice', 'acme', 'secret');
        expect(isPathUnderUserWorkspace(userAPath, reposRoot, 'alice')).to.equal(true);
        expect(isPathUnderUserWorkspace(userAPath, reposRoot, 'bob')).to.equal(false);
    });

    it('parses owner/repo from user-scoped workspace paths', () => {
        const uriPath = 'file:///workspace/repos/users/alice/acme/widget';
        expect(parseGithubFullNameFromWorkspacePath(uriPath)).to.equal('acme/widget');
    });

    it('scopes browser cache keys per user (case D)', () => {
        const keyA = qaapUserScopedStorageKey('qaap.mobileProjects.sessionCache.v1', 'alice');
        const keyB = qaapUserScopedStorageKey('qaap.mobileProjects.sessionCache.v1', 'bob');
        expect(keyA).to.not.equal(keyB);
        expect(safeUserIdSegment('org/user')).to.equal('org_user');
    });
});

describe('qaap-github-auth-guard security', () => {

    it('returns 403 for workspace paths outside the authenticated user (case B/C)', () => {
        const sessions = new QaapGithubSessionStore();
        const guard = new QaapGithubAuthGuard();
        (guard as unknown as { sessions: QaapGithubSessionStore }).sessions = sessions;
        (guard as unknown as { reposRoot: string }).reposRoot = '/workspace/repos';

        const sessionId = sessions.createSession({
            accessToken: 'token-a',
            user: { provider: 'github', login: 'alice', name: 'Alice' },
        });

        const req = {
            headers: {
                cookie: `qaap_sid=${encodeURIComponent(sessionId)}`,
            },
        } as unknown as Request;

        let statusCode = 0;
        let body: { error?: string } = {};
        const res = {
            status(code: number) {
                statusCode = code;
                return this;
            },
            json(payload: { error?: string }) {
                body = payload;
                return this;
            },
        } as unknown as Response;

        const foreignPath = resolveRepositoryWorkspacePath('/workspace/repos', 'bob', 'acme', 'widget');
        const owned = guard.assertWorkspacePathOwned(req, res, foreignPath, 'agent_conversation');
        expect(owned).to.equal(false);
        expect(statusCode).to.equal(403);
        expect(body.error).to.equal('Forbidden');

        const ownPath = resolveRepositoryWorkspacePath('/workspace/repos', 'alice', 'acme', 'widget');
        const allowed = guard.assertWorkspacePathOwned(req, res, ownPath, 'agent_conversation');
        expect(allowed).to.equal(true);
    });

    it('isolates user workspace roots', () => {
        expect(resolveUserReposRoot('/data/repos', 'alice')).to.equal(
            path.join('/data/repos', 'users', 'alice'),
        );
    });

    describe('symlink escape is denied end-to-end through the real guard (C3 / M2)', () => {
        let reposRoot: string;
        let sessions: QaapGithubSessionStore;
        let guard: QaapGithubAuthGuard;
        let aliceSession: string;

        beforeEach(() => {
            reposRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-tenancy-'));
            fs.mkdirSync(path.join(reposRoot, 'users', 'alice', 'repo'), { recursive: true });
            fs.mkdirSync(path.join(reposRoot, 'users', 'bob', 'secret'), { recursive: true });
            sessions = new QaapGithubSessionStore();
            guard = new QaapGithubAuthGuard();
            (guard as unknown as { sessions: QaapGithubSessionStore }).sessions = sessions;
            (guard as unknown as { reposRoot: string }).reposRoot = reposRoot;
            aliceSession = sessions.createSession({
                accessToken: 't', user: { provider: 'github', login: 'alice', name: 'Alice' },
            });
        });

        afterEach(() => fs.rmSync(reposRoot, { recursive: true, force: true }));

        it('403s a lexically-owned path that symlinks into another tenant', () => {
            // alice plants a symlink inside her own workspace pointing at bob's tree.
            const link = path.join(reposRoot, 'users', 'alice', 'evil');
            // Junctions exercise the same realpath escape on Windows without elevation.
            fs.symlinkSync(path.join(reposRoot, 'users', 'bob', 'secret'), link, process.platform === 'win32' ? 'junction' : 'dir');
            const { req, res, status } = fakeReqRes(aliceSession);
            // The path string still starts with alice's root (lexical check passes) — the guard must
            // still deny it because realpath lands in bob's tree.
            const allowed = guard.assertWorkspacePathOwned(req, res, link, 'agent_conversation');
            expect(allowed).to.equal(false);
            expect(status()).to.equal(403);
        });

        it('allows a genuine path inside the user workspace', () => {
            const { req, res } = fakeReqRes(aliceSession);
            const ownPath = path.join(reposRoot, 'users', 'alice', 'repo');
            expect(guard.assertWorkspacePathOwned(req, res, ownPath, 'agent_conversation')).to.equal(true);
        });
    });

    describe('skip-auth is refused in a production runtime', () => {
        const saved: Record<string, string | undefined> = {};
        const KEYS = ['QAAP_SKIP_AUTH', 'NODE_ENV', 'QAAP_CLOUD_MODE', 'QAAP_ALLOW_SKIP_AUTH_IN_PRODUCTION'];
        beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
        afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) { delete process.env[k]; } else { process.env[k] = saved[k]; } } });

        const guard = (): QaapGithubAuthGuard => new QaapGithubAuthGuard();

        it('honors skip-auth in local dev', () => {
            process.env.QAAP_SKIP_AUTH = 'true';
            expect(guard().isSkipAuthEnabled()).to.equal(true);
        });

        it('refuses skip-auth when NODE_ENV=production', () => {
            process.env.QAAP_SKIP_AUTH = 'true';
            process.env.NODE_ENV = 'production';
            expect(guard().isSkipAuthEnabled()).to.equal(false);
        });

        it('refuses skip-auth when QAAP_CLOUD_MODE is a non-local hosted mode', () => {
            process.env.QAAP_SKIP_AUTH = '1';
            process.env.QAAP_CLOUD_MODE = 'hosted';
            expect(guard().isSkipAuthEnabled()).to.equal(false);
        });

        it('allows the explicit production override', () => {
            process.env.QAAP_SKIP_AUTH = 'true';
            process.env.NODE_ENV = 'production';
            process.env.QAAP_ALLOW_SKIP_AUTH_IN_PRODUCTION = 'true';
            expect(guard().isSkipAuthEnabled()).to.equal(true);
        });

        it('is off by default regardless of runtime', () => {
            process.env.NODE_ENV = 'production';
            expect(guard().isSkipAuthEnabled()).to.equal(false);
        });
    });

    describe('resolveOwnedRepositoryCwd normalizes legacy / bare / container cwds', () => {
        let tmpBase: string;
        let reposRoot: string;
        let guard: QaapGithubAuthGuard;

        const p = (...seg: string[]): string => path.join(reposRoot, ...seg);
        const resolveFor = (login: string, cwd: string): { kind: string; cwd?: string } =>
            guard.resolveOwnedRepositoryCwdForLogin(login, cwd);

        beforeEach(() => {
            tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-cwd-'));
            // reposRoot MUST end in `repos` so legacy `.../repos/{owner}/{repo}` paths are recognizable.
            reposRoot = path.join(tmpBase, 'repos');
            for (const rel of [
                ['users', 'alice', 'acme', 'demo'],
                ['users', 'alice', 'acme', 'Vamello'], // uppercase — case-sensitivity guard
                ['users', 'alice', 'acme', 'dup'],
                ['users', 'alice', 'other', 'dup'],    // second owner with `dup` → ambiguous bare name
                ['users', 'alice', 'alice', 'solo'],   // unique bare name
                ['users', 'bob', 'acme', 'demo'],
            ]) {
                fs.mkdirSync(path.join(reposRoot, ...rel), { recursive: true });
            }
            guard = new QaapGithubAuthGuard();
            (guard as unknown as { reposRoot: string }).reposRoot = reposRoot;
        });

        afterEach(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

        it('passes through an already-correct per-user repository path', () => {
            expect(resolveFor('alice', p('users', 'alice', 'acme', 'demo')))
                .to.deep.equal({ kind: 'ok', cwd: p('users', 'alice', 'acme', 'demo') });
        });

        it('rebuilds a legacy flat path to the per-user clone when it exists', () => {
            expect(resolveFor('alice', p('acme', 'demo')))
                .to.deep.equal({ kind: 'ok', cwd: p('users', 'alice', 'acme', 'demo') });
        });

        it('denies a legacy flat path whose per-user clone does not exist', () => {
            expect(resolveFor('alice', p('acme', 'missing'))).to.deep.equal({ kind: 'denied' });
        });

        it('never crosses tenants — B requesting A\'s path rebuilds under B and is denied when absent', () => {
            // bob has no acme/Vamello clone → rebuilds under bob, does not exist → denied (no leak to alice).
            expect(resolveFor('bob', p('users', 'alice', 'acme', 'Vamello'))).to.deep.equal({ kind: 'denied' });
        });

        it('resolves a github:owner/repo key, preserving case', () => {
            // The resolver must NOT lowercase owner/repo (unlike parseGithubFullNameFromWorkspacePath):
            // on the case-sensitive production FS a lowercased tail would miss the real `Vamello` dir.
            expect(resolveFor('alice', 'github:acme/Vamello'))
                .to.deep.equal({ kind: 'ok', cwd: p('users', 'alice', 'acme', 'Vamello') });
        });

        it('resolves a unique bare repo name under the caller\'s own root', () => {
            expect(resolveFor('alice', 'solo'))
                .to.deep.equal({ kind: 'ok', cwd: p('users', 'alice', 'alice', 'solo') });
        });

        it('asks for a project when a bare name is ambiguous across owners', () => {
            expect(resolveFor('alice', 'dup')).to.deep.equal({ kind: 'needs-project' });
        });

        it('denies a bare name with no matching clone', () => {
            expect(resolveFor('alice', 'nope')).to.deep.equal({ kind: 'denied' });
        });

        it('treats container levels (repos root, user root, owner dir) as needs-project', () => {
            expect(resolveFor('alice', reposRoot).kind).to.equal('needs-project');
            expect(resolveFor('alice', p('users', 'alice')).kind).to.equal('needs-project');
            expect(resolveFor('alice', p('users', 'alice', 'acme')).kind).to.equal('needs-project');
        });

        it('makes ownsWorkspacePath tolerant of legacy paths that map to an owned clone', () => {
            const ctx = { kind: 'authenticated' as const, userLogin: 'alice', session: {} as never, sessionId: 's' };
            expect(guard.ownsWorkspacePath(ctx, p('acme', 'demo'))).to.equal(true);
            expect(guard.ownsWorkspacePath(ctx, p('acme', 'missing'))).to.equal(false);
            expect(guard.ownsWorkspacePath(ctx, reposRoot)).to.equal(false);
        });
    });

    it('scopes work-hub routine ownership by ownerLogin', () => {
        const routineAlice = { id: 'r1', ownerLogin: 'alice', cwd: '/any/path' };
        const routineBob = { id: 'r2', ownerLogin: 'bob', cwd: '/any/path' };
        const ctxAlice = { kind: 'authenticated' as const, userLogin: 'alice', session: {} as never, sessionId: 's1' };
        const root = '/workspace/repos';
        const owns = (ctx: typeof ctxAlice, routine: { ownerLogin?: string; cwd: string }): boolean => {
            if (routine.ownerLogin) {
                return routine.ownerLogin === ctx.userLogin;
            }
            return isPathUnderUserWorkspace(routine.cwd, root, ctx.userLogin);
        };
        expect(owns(ctxAlice, routineAlice)).to.equal(true);
        expect(owns(ctxAlice, routineBob)).to.equal(false);
    });
});
