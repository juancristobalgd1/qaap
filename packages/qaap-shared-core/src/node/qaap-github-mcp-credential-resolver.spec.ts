// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapGithubMcpCredentialResolver } from './qaap-github-mcp-credential-resolver';
import { QaapGithubOwnerTokenCache } from './qaap-github-owner-token-cache';
import { QaapGithubSessionStore, QaapGithubStoredSession } from './qaap-github-session-store';

type GhOutcome = { kind: 'token'; token: string } | { kind: 'missing' } | { kind: 'failed' };

class TestResolver extends QaapGithubMcpCredentialResolver {
    fakeEnv: NodeJS.ProcessEnv = {};
    ghOutcome: GhOutcome = { kind: 'missing' };
    ghCalls = 0;

    constructor(sessions: QaapGithubStoredSession[] = [], owners: Array<[string, string]> = []) {
        super();
        const cache = new QaapGithubOwnerTokenCache();
        for (const [login, token] of owners) {
            cache.remember(login, token);
        }
        // The injected fields are readonly; the test seam assigns them once, before any call.
        const injected = this as unknown as { ownerTokenCache: QaapGithubOwnerTokenCache; sessionStore: QaapGithubSessionStore };
        injected.ownerTokenCache = cache;
        injected.sessionStore = { listSessions: (): QaapGithubStoredSession[] => sessions } as unknown as QaapGithubSessionStore;
    }

    protected override env(): NodeJS.ProcessEnv {
        return this.fakeEnv;
    }

    /** One fixed candidate, so the gh fallback is exercised whether or not the test machine has gh installed. */
    protected override ghCandidates(): string[] {
        return ['/fake/bin/gh'];
    }

    protected override runGh(): Promise<GhOutcome> {
        this.ghCalls++;
        return Promise.resolve(this.ghOutcome);
    }

    userCheck: 'rejected' | 'accepted' | 'unknown' = 'unknown';
    userChecks = 0;

    protected override checkUser(): Promise<'rejected' | 'accepted' | 'unknown'> {
        this.userChecks++;
        return Promise.resolve(this.userCheck);
    }
}

const session = (login: string, token: string): QaapGithubStoredSession => ({
    accessToken: token,
    user: { provider: 'github', login, name: login },
});

describe('QaapGithubMcpCredentialResolver', () => {

    it('prefers GH_TOKEN over GITHUB_TOKEN on the desktop', async () => {
        const resolver = new TestResolver();
        resolver.fakeEnv = { QAAP_DESKTOP: '1', GITHUB_TOKEN: 'ghp_second', GH_TOKEN: 'ghp_first' };
        const credential = await resolver.resolve();
        expect(credential).to.deep.equal({ token: 'ghp_first', source: 'env' });
        expect(resolver.ghCalls).to.equal(0);
    });

    it('falls back to GITHUB_TOKEN, then to gh, when no environment token is set', async () => {
        const resolver = new TestResolver();
        resolver.fakeEnv = { QAAP_DESKTOP: '1', GITHUB_TOKEN: 'ghp_env' };
        expect(await resolver.resolve()).to.deep.equal({ token: 'ghp_env', source: 'env' });

        const viaGh = new TestResolver();
        viaGh.fakeEnv = { QAAP_DESKTOP: '1' };
        viaGh.ghOutcome = { kind: 'token', token: 'gho_from_gh' };
        expect(await viaGh.resolve()).to.deep.equal({ token: 'gho_from_gh', source: 'gh-cli' });
    });

    it('treats a missing gh binary, a failing gh call and empty output as no credential', async () => {
        for (const outcome of [{ kind: 'missing' }, { kind: 'failed' }, { kind: 'token', token: '' }] as GhOutcome[]) {
            const resolver = new TestResolver([], []);
            resolver.fakeEnv = { QAAP_DESKTOP: '1' };
            resolver.ghOutcome = outcome;
            expect(await resolver.resolve()).to.equal(undefined);
        }
    });

    it('uses the most recent OAuth session on the desktop when nothing else is set', async () => {
        const resolver = new TestResolver([session('alice', 'gho_old'), session('bob', 'gho_new')]);
        resolver.fakeEnv = { QAAP_DESKTOP: '1' };
        expect(await resolver.resolve()).to.deep.equal({ token: 'gho_new', source: 'oauth-session' });
    });

    it('accepts an OAuth session in local development only when exactly one login exists', async () => {
        const single = new TestResolver([session('alice', 'gho_one')]);
        single.fakeEnv = { QAAP_LOCAL_DEV: '1' };
        expect(single.mode()).to.equal('local');
        expect(await single.resolve()).to.deep.equal({ token: 'gho_one', source: 'oauth-session' });

        const several = new TestResolver([session('alice', 'gho_one'), session('bob', 'gho_two')]);
        several.fakeEnv = { QAAP_CLOUD_MODE: 'local' };
        expect(await several.resolve()).to.equal(undefined);
    });

    it('ignores environment variables and gh in a tenant backend and reads only the owner cache', async () => {
        const resolver = new TestResolver([session('alice', 'gho_session')], [['alice', 'gho_owner']]);
        resolver.fakeEnv = { QAAP_TENANT_BACKEND_MODE: '1', QAAP_TENANT_LOGIN: 'alice', GH_TOKEN: 'ghp_env', QAAP_DESKTOP: '1' };
        expect(resolver.mode()).to.equal('tenant');
        expect(await resolver.resolve()).to.deep.equal({ token: 'gho_owner', source: 'owner-token-cache' });
        expect(resolver.ghCalls).to.equal(0);
    });

    it('returns no credential for a tenant whose owner has no cached token', async () => {
        const resolver = new TestResolver([session('bob', 'gho_other')], [['bob', 'gho_other']]);
        resolver.fakeEnv = { QAAP_TENANT_BACKEND_MODE: '1', QAAP_TENANT_LOGIN: 'alice' };
        expect(await resolver.resolve()).to.equal(undefined);
        expect(resolver.ghCalls).to.equal(0);
    });

    it('registers nothing on a shared hosted backend without an owner', async () => {
        const resolver = new TestResolver([session('alice', 'gho_session')]);
        resolver.fakeEnv = { NODE_ENV: 'production', GH_TOKEN: 'ghp_env', QAAP_DESKTOP: '1' };
        expect(resolver.mode()).to.equal('none');
        expect(await resolver.describe()).to.deep.equal({ available: false, source: undefined, mode: 'none', rejectedByPolicy: false });
        expect(await resolver.resolve()).to.equal(undefined);
        expect(resolver.ghCalls).to.equal(0);
    });

    it('is none, and reads nothing, when the runtime is not stated explicitly', async () => {
        const resolver = new TestResolver([session('alice', 'gho_only_session')]);
        resolver.fakeEnv = { GH_TOKEN: 'ghp_env' };
        expect(resolver.mode()).to.equal('none');
        expect(await resolver.resolve()).to.equal(undefined);
        expect(resolver.ghCalls).to.equal(0);
    });

    it('is none on a tenant backend without an owner login, even with desktop or local flags', async () => {
        const resolver = new TestResolver([session('alice', 'gho_session')]);
        resolver.fakeEnv = { QAAP_TENANT_BACKEND_MODE: '1', QAAP_DESKTOP: '1', QAAP_LOCAL_DEV: '1', GH_TOKEN: 'ghp_env' };
        expect(resolver.mode()).to.equal('none');
        expect(await resolver.resolve()).to.equal(undefined);
    });

    it('is none on a hosted backend even with QAAP_LOCAL_DEV', () => {
        const resolver = new TestResolver();
        resolver.fakeEnv = { QAAP_CLOUD_MODE: 'docker', QAAP_LOCAL_DEV: '1' };
        expect(resolver.mode()).to.equal('none');
    });

    it('memoizes a successful lookup until invalidate', async () => {
        const resolver = new TestResolver();
        resolver.fakeEnv = { QAAP_DESKTOP: '1' };
        resolver.ghOutcome = { kind: 'token', token: 'gho_first' };
        expect((await resolver.resolve())?.token).to.equal('gho_first');
        resolver.ghOutcome = { kind: 'token', token: 'gho_second' };
        expect((await resolver.resolve())?.token).to.equal('gho_first');
        resolver.invalidate();
        expect((await resolver.resolve())?.token).to.equal('gho_second');
    });

    it('forgets a tenant token only when GitHub /user also rejects it', async () => {
        const rejecting = new TestResolver([], [['alice', 'gho_owner']]);
        rejecting.fakeEnv = { QAAP_TENANT_BACKEND_MODE: '1', QAAP_TENANT_LOGIN: 'alice' };
        rejecting.userCheck = 'rejected';
        expect(await rejecting.reportRejected('gho_owner')).to.equal('forgotten');
        expect(await rejecting.resolve()).to.equal(undefined);

        const accepting = new TestResolver([], [['alice', 'gho_owner']]);
        accepting.fakeEnv = { QAAP_TENANT_BACKEND_MODE: '1', QAAP_TENANT_LOGIN: 'alice' };
        accepting.userCheck = 'accepted';
        expect(await accepting.reportRejected('gho_owner')).to.equal('token-valid');
        expect(await accepting.resolve()).to.deep.equal({ token: 'gho_owner', source: 'owner-token-cache' });
    });

    it('checks GitHub /user at most once per token in the rate window', async () => {
        const resolver = new TestResolver([], [['alice', 'gho_owner']]);
        resolver.fakeEnv = { QAAP_TENANT_BACKEND_MODE: '1', QAAP_TENANT_LOGIN: 'alice' };
        resolver.userCheck = 'accepted';
        for (let i = 0; i < 5; i++) {
            expect(await resolver.reportRejected('gho_owner')).to.equal('token-valid');
        }
        expect(resolver.userChecks).to.equal(1);
        expect(await resolver.reportRejected('gho_other')).to.equal('token-valid');
        expect(resolver.userChecks).to.equal(2);
    });

    it('on the desktop checks GitHub /user but never forgets anything', async () => {
        const resolver = new TestResolver();
        resolver.fakeEnv = { QAAP_DESKTOP: '1', GH_TOKEN: 'ghp_env' };
        expect((await resolver.resolve())?.source).to.equal('env');
        resolver.userCheck = 'rejected';
        expect(await resolver.reportRejected('ghp_env')).to.equal('not-checked');
        expect(resolver.userChecks).to.equal(1);
        expect((await resolver.resolve())?.token).to.equal('ghp_env');
    });

    it('records a policy refusal when /user accepts the token, and reports it in describe() without the value', async () => {
        const resolver = new TestResolver();
        resolver.fakeEnv = { QAAP_DESKTOP: '1', GH_TOKEN: 'ghp_policy_secret' };
        expect((await resolver.describe()).rejectedByPolicy).to.equal(false);
        resolver.userCheck = 'accepted';
        expect(await resolver.reportRejected('ghp_policy_secret')).to.equal('token-valid');
        const status = await resolver.describe();
        expect(status).to.deep.equal({ available: true, source: 'env', mode: 'desktop', rejectedByPolicy: true });
        expect(JSON.stringify(status)).to.not.contain('ghp_policy_secret');
        // A different token (for example after `gh auth login`) is not affected.
        resolver.fakeEnv = { QAAP_DESKTOP: '1', GH_TOKEN: 'ghp_new' };
        resolver.invalidate();
        expect((await resolver.describe()).rejectedByPolicy).to.equal(false);
        // The refusal expires.
        expect(resolver.isRejectedByPolicy('ghp_policy_secret', Date.now() + 61 * 60 * 1000)).to.equal(false);
    });

    it('describes availability without the token value', async () => {
        const resolver = new TestResolver();
        resolver.fakeEnv = { QAAP_DESKTOP: '1', GH_TOKEN: 'ghp_secret_value' };
        const status = await resolver.describe();
        expect(status).to.deep.equal({ available: true, source: 'env', mode: 'desktop', rejectedByPolicy: false });
        expect(JSON.stringify(status)).to.not.contain('ghp_secret_value');
    });
});

describe('QaapGithubMcpCredentialResolver gh invocation', () => {

    class GhResolver extends QaapGithubMcpCredentialResolver {
        fakeEnv: NodeJS.ProcessEnv = {};
        protected override env(): NodeJS.ProcessEnv {
            return this.fakeEnv;
        }
        candidates(): string[] {
            return this.ghCandidates();
        }
        childEnv(): NodeJS.ProcessEnv {
            return this.ghEnv();
        }
    }

    it('runs gh only by an absolute path and never from a relative PATH entry or the working directory', function (): void {
        if (process.platform === 'win32') {
            this.skip();
        }
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-gh-'));
        const relative = fs.mkdtempSync(path.join(process.cwd(), '.qaap-gh-rel-'));
        try {
            fs.writeFileSync(path.join(dir, 'gh'), '#!/bin/sh\n', { mode: 0o755 });
            fs.writeFileSync(path.join(relative, 'gh'), '#!/bin/sh\n', { mode: 0o755 });
            const resolver = new GhResolver();
            resolver.fakeEnv = { PATH: ['.', '', path.basename(relative), dir].join(path.delimiter) };
            const candidates = resolver.candidates();
            expect(candidates[0]).to.equal(path.join(dir, 'gh'));
            expect(candidates.every(candidate => path.isAbsolute(candidate))).to.equal(true);
            expect(candidates).to.not.include(path.join(relative, 'gh'));
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
            fs.rmSync(relative, { recursive: true, force: true });
        }
    });

    it('drops GH_* overrides from the gh environment except GH_PROMPT_DISABLED', () => {
        const resolver = new GhResolver();
        resolver.fakeEnv = { PATH: '/usr/bin', HOME: '/home/a', GH_CONFIG_DIR: '/tmp/evil', GH_HOST: 'evil.example', GH_ENTERPRISE_TOKEN: 'x' };
        const env = resolver.childEnv();
        expect(env).to.include({ PATH: '/usr/bin', HOME: '/home/a', GH_PROMPT_DISABLED: '1', NO_COLOR: '1' });
        expect(env).to.not.have.property('GH_CONFIG_DIR');
        expect(env).to.not.have.property('GH_HOST');
        expect(env).to.not.have.property('GH_ENTERPRISE_TOKEN');
    });
});
