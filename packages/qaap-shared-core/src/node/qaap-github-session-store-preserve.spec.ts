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

/** One simulated backend process sharing the SQLite file; exposes the raw stored rows. */
class PreserveProbe extends QaapGithubSessionStore {
    start(): this {
        this.init();
        return this;
    }

    rawValue(key: string): unknown {
        return this.getSqliteStore().get<unknown>(key);
    }

    /** Many simulated processes live in one test process: skip the process-level signal hooks. */
    protected override installShutdownHandlers(): void { }
}

const alice = { provider: 'github' as const, login: 'alice', name: 'Alice' };
const KEY_1 = Buffer.alloc(32, 10).toString('base64');
const KEY_2 = Buffer.alloc(32, 11).toString('base64');

describe('QaapGithubSessionStore: unreadable sealed rows are kept, not deleted', () => {
    let dir: string;
    let previousStorePath: string | undefined;
    let previousKeys: string | undefined;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-auth-keep-'));
        previousStorePath = process.env.QAAP_AUTH_STORE_PATH;
        previousKeys = process.env.QAAP_SECRETS_KEYS;
        process.env.QAAP_AUTH_STORE_PATH = path.join(dir, 'sessions.json');
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

    it('treats an unreadable session as signed out, but leaves its row byte-identical through later writes', () => {
        process.env.QAAP_SECRETS_KEYS = `k1:${KEY_1}`;
        const writer = new PreserveProbe().start();
        const id = writer.createSession({ accessToken: 'gho_kept', user: alice });
        writer.flushPendingPersist();
        const sealedRow = writer.rawValue(`session:${id}`);

        // Restarted with a key set that cannot open the row, then doing unrelated writes.
        process.env.QAAP_SECRETS_KEYS = `k2:${KEY_2}`;
        const reader = new PreserveProbe().start();
        expect(reader.getSession(id)).to.equal(undefined);
        reader.createSession({ accessToken: 'gho_other', user: { ...alice, login: 'bob' } });
        reader.flushPendingPersist();
        reader.deleteSession('unrelated-id');

        expect(reader.rawValue(`session:${id}`)).to.deep.equal(sealedRow);

        // Once the original key is back, the session opens again.
        process.env.QAAP_SECRETS_KEYS = `k1:${KEY_1}`;
        expect(new PreserveProbe().start().getSession(id)?.accessToken).to.equal('gho_kept');
    });
});
