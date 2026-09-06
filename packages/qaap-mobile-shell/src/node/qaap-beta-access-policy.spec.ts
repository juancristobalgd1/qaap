// *****************************************************************************
// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapBetaAccessPolicy } from './qaap-beta-access-policy';
import { QaapGithubSessionStore, QaapGithubStoredSession } from './qaap-github-session-store';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';
import type { Request } from '@theia/core/shared/express';

class BetaSessionStore extends QaapGithubSessionStore {
    protected override readonly betaAccess: QaapBetaAccessPolicy;

    constructor(env: NodeJS.ProcessEnv) {
        super();
        this.betaAccess = new QaapBetaAccessPolicy(env);
    }

    restoreSession(id: string, data: QaapGithubStoredSession): void {
        this.sessions.set(id, data);
    }

    expireState(state: string): void {
        this.oauthStates.set(state, Date.now() - 11 * 60 * 1000);
    }
}

const session = (login: string): QaapGithubStoredSession => ({
    accessToken: 'test-only-token', user: { provider: 'github', login, name: login },
});

class BetaAuthGuard extends QaapGithubAuthGuard {
    constructor(store: QaapGithubSessionStore) {
        super();
        Object.assign(this, { sessions: store });
    }

    override isSkipAuthEnabled(): boolean {
        return false;
    }
}

describe('Qaap beta admission', () => {
    it('denies all production users when the invitation list is absent or malformed', () => {
        for (const list of [undefined, '', '*', 'alice,', 'alice,bad/name', 'alice,,bob']) {
            const policy = new QaapBetaAccessPolicy({ NODE_ENV: 'production', QAAP_BETA_ALLOWED_LOGINS: list });
            expect(policy.isRequired()).to.equal(true);
            expect(policy.isConfigured()).to.equal(false);
            expect(policy.allows('alice')).to.equal(false);
        }
    });

    it('matches whole GitHub logins case-insensitively without exposing other accounts', () => {
        const policy = new QaapBetaAccessPolicy({ NODE_ENV: 'production', QAAP_BETA_ALLOWED_LOGINS: ' Alice, bob-2 ' });
        expect(policy.isConfigured()).to.equal(true);
        expect(policy.allows('ALICE')).to.equal(true);
        expect(policy.allows('bob-2')).to.equal(true);
        expect(policy.allows('alice-admin')).to.equal(false);
        expect(policy.allows('mallory')).to.equal(false);
    });

    it('preserves local development unless a list is explicitly set', () => {
        expect(new QaapBetaAccessPolicy({ NODE_ENV: 'development', QAAP_CLOUD_MODE: 'local' }).allows('dev')).to.equal(true);
        expect(new QaapBetaAccessPolicy({ QAAP_CLOUD_MODE: 'hosted' }).allows('dev')).to.equal(false);
        expect(new QaapBetaAccessPolicy({ QAAP_BETA_ALLOWED_LOGINS: '' }).allows('dev')).to.equal(false);
    });

    it('rejects uninvited session creation and hides sessions restored from disk', () => {
        const store = new BetaSessionStore({ NODE_ENV: 'production', QAAP_BETA_ALLOWED_LOGINS: 'alice' });
        expect(() => store.createSession(session('mallory'))).to.throw(/not invited/);
        store.restoreSession('old-cookie', session('mallory'));
        expect(store.getSession('old-cookie')).to.equal(undefined);
        expect(store.listSessions()).to.deep.equal([]);
        expect(store.getAnySession()).to.equal(undefined);
        const id = store.createSession(session('alice'));
        expect(store.getSession(id)?.user.login).to.equal('alice');
    });

    it('rechecks admission for existing credentials when the server policy changes', () => {
        const env = { NODE_ENV: 'production', QAAP_BETA_ALLOWED_LOGINS: 'alice,bob' };
        const store = new BetaSessionStore(env);
        const aliceId = store.createSession(session('alice'));
        const bobId = store.createSession(session('bob'));
        env.QAAP_BETA_ALLOWED_LOGINS = 'alice';
        expect(store.getSession(bobId)).to.equal(undefined);
        expect(store.getSession(aliceId)?.user.login).to.equal('alice');
        expect(store.listSessions().map(value => value.user.login)).to.deep.equal(['alice']);
        const guard = new BetaAuthGuard(store);
        const request = { headers: { cookie: `qaap_sid=${bobId}` } } as Request;
        expect(guard.authenticate(request).kind).to.equal('unauthorized');
    });

    it('rejects expired OAuth state at consumption and prevents replay', () => {
        const store = new BetaSessionStore({});
        const expired = store.createOAuthState();
        store.expireState(expired);
        expect(store.consumeOAuthState(expired)).to.equal(false);
        const fresh = store.createOAuthState();
        expect(store.consumeOAuthState(fresh)).to.equal(true);
        expect(store.consumeOAuthState(fresh)).to.equal(false);
    });
});
