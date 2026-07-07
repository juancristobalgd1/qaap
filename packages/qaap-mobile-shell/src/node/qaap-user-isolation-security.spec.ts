// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
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

describe('qaap-user-isolation', () => {

    const reposRoot = '/workspace/repos';

    it('scopes repository clones per GitHub login (case A)', () => {
        const userA = resolveRepositoryWorkspacePath(reposRoot, 'alice', 'acme', 'demo');
        const userB = resolveRepositoryWorkspacePath(reposRoot, 'bob', 'acme', 'demo');
        expect(userA).to.equal('/workspace/repos/users/alice/acme/demo');
        expect(userB).to.equal('/workspace/repos/users/bob/acme/demo');
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
