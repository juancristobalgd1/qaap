// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteConnectionRegistry } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { QaapGithubSessionStore } from './qaap-github-session-store';

/** One simulated backend process sharing the SQLite file; exposes the raw stored values. */
class SealedSessionStoreProbe extends QaapGithubSessionStore {
    start(): this {
        this.init();
        return this;
    }

    rawValue(key: string): unknown {
        return this.getSqliteStore().get<unknown>(key);
    }

    rawSet(key: string, value: unknown): void {
        this.getSqliteStore().set(key, value);
    }

    /** Many simulated processes live in one test process: skip the process-level signal hooks. */
    protected override installShutdownHandlers(): void { }
}

const alice = { accessToken: 't', user: { provider: 'github' as const, login: 'alice', name: 'Alice' } };

describe('QaapGithubSessionStore (GitHub token sealed at rest)', () => {
    const KEY = Buffer.alloc(32, 3).toString('base64');
    let dir: string;
    let previousStorePath: string | undefined;
    let previousKeys: string | undefined;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-auth-seal-'));
        previousStorePath = process.env.QAAP_AUTH_STORE_PATH;
        previousKeys = process.env.QAAP_SECRETS_KEYS;
        process.env.QAAP_AUTH_STORE_PATH = path.join(dir, 'sessions.json');
        delete process.env.QAAP_SECRETS_KEYS;
    });

    afterEach(() => {
        if (previousStorePath === undefined) {
            delete process.env.QAAP_AUTH_STORE_PATH;
        } else {
            process.env.QAAP_AUTH_STORE_PATH = previousStorePath;
        }
        if (previousKeys === undefined) {
            delete process.env.QAAP_SECRETS_KEYS;
        } else {
            process.env.QAAP_SECRETS_KEYS = previousKeys;
        }
        QaapSqliteConnectionRegistry.shared.closeUnder(dir);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('stores the access token sealed, and another backend process opens it', () => {
        process.env.QAAP_SECRETS_KEYS = `k1:${KEY}`;
        const writer = new SealedSessionStoreProbe().start();
        const id = writer.createSession({ accessToken: 'gho_sealed_token', user: alice.user });
        writer.flushPendingPersist();
        const raw = writer.rawValue(`session:${id}`) as { accessToken: string };
        expect(raw.accessToken).to.match(/^qaapenc:v1:k1:/);
        expect(JSON.stringify(raw)).not.to.contain('gho_sealed_token');

        const reader = new SealedSessionStoreProbe().start();
        expect(reader.getSession(id)?.accessToken).to.equal('gho_sealed_token');
        expect(reader.findAccessTokenForLogin('alice')).to.equal('gho_sealed_token');
    });

    it('rejects a sealed token copied under another session id', () => {
        process.env.QAAP_SECRETS_KEYS = `k1:${KEY}`;
        const writer = new SealedSessionStoreProbe().start();
        const id = writer.createSession({ accessToken: 'gho_bound', user: alice.user });
        writer.flushPendingPersist();
        writer.rawSet('session:copied-id', writer.rawValue(`session:${id}`));

        const reader = new SealedSessionStoreProbe().start();
        expect(reader.getSession('copied-id')).to.equal(undefined);
        expect(reader.getSession(id)?.accessToken).to.equal('gho_bound');
    });

    it('accepts a legacy plain token and seals it on the next flush', () => {
        const legacy = new SealedSessionStoreProbe().start();
        const id = legacy.createSession({ accessToken: 'gho_legacy', user: alice.user });
        legacy.flushPendingPersist();
        expect((legacy.rawValue(`session:${id}`) as { accessToken: string }).accessToken).to.equal('gho_legacy');

        process.env.QAAP_SECRETS_KEYS = `k1:${KEY}`;
        const upgraded = new SealedSessionStoreProbe().start();
        expect(upgraded.getSession(id)?.accessToken).to.equal('gho_legacy');
        upgraded.flushPendingPersist();
        const raw = upgraded.rawValue(`session:${id}`) as { accessToken: string };
        expect(raw.accessToken).to.match(/^qaapenc:v1:k1:/);
        expect(new SealedSessionStoreProbe().start().getSession(id)?.accessToken).to.equal('gho_legacy');
    });
});
