// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveQaapConversationAgentActivityAt } from '@theia/qaap-shared-core/lib/common/qaap-conversation-read-marks';
import { QaapConversationReadMarkEndpoint } from './qaap-conversation-read-mark-endpoint';
import { QaapConversationReadMarkStore } from './qaap-conversation-read-mark-store';
import { QaapSqliteConnectionRegistry } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';

class TestReadMarkStore extends QaapConversationReadMarkStore {
    constructor(protected readonly databasePath: string) {
        super();
    }
    protected override resolveDatabasePath(): string {
        return this.databasePath;
    }
}

interface FakeResponse {
    statusCode?: number;
    body?: unknown;
    status(code: number): FakeResponse;
    json(body: unknown): void;
}

function fakeResponse(): FakeResponse {
    const res: FakeResponse = {
        status(code: number): FakeResponse {
            res.statusCode = code;
            return res;
        },
        json(body: unknown): void {
            res.statusCode ??= 200;
            res.body = body;
        },
    };
    return res;
}

describe('QaapConversationReadMarkStore', () => {

    let dir: string;
    let store: QaapConversationReadMarkStore;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-read-marks-'));
        store = new TestReadMarkStore(path.join(dir, 'qaap.sqlite'));
    });

    afterEach(() => {
        // Windows refuses to delete an open SQLite file: close the connection first.
        QaapSqliteConnectionRegistry.shared.closeUnder(dir);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('keeps each user\'s marks apart', () => {
        store.markRead('alice', 'A', 100, 1_000);

        expect(store.list('alice')).to.deep.equal({ A: 100 });
        expect(store.list('bob')).to.deep.equal({});
    });

    it('never moves a mark back and never past the server clock', () => {
        expect(store.markRead('alice', 'A', 500, 1_000)).to.equal(500);
        expect(store.markRead('alice', 'A', 200, 1_000)).to.equal(500);
        expect(store.markRead('alice', 'A', 9_999, 1_000)).to.equal(1_000);
        expect(store.markRead('alice', 'A', undefined, 2_000)).to.equal(2_000);
    });

    it('survives a backend restart (new store over the same database)', () => {
        store.markRead('alice', 'A', 100, 1_000);

        expect(new TestReadMarkStore(path.join(dir, 'qaap.sqlite')).list('alice')).to.deep.equal({ A: 100 });
    });
});

describe('QaapConversationReadMarkEndpoint', () => {

    function endpoint(options: { login?: string; owns?: boolean; conversation?: boolean } = {}): {
        endpoint: QaapConversationReadMarkEndpoint;
        calls: Array<[string | undefined, string, number | undefined]>;
    } {
        const calls: Array<[string | undefined, string, number | undefined]> = [];
        const instance = Object.create(QaapConversationReadMarkEndpoint.prototype) as QaapConversationReadMarkEndpoint;
        Object.assign(instance, {
            auth: {
                authenticate: () => options.login ? { kind: 'authenticated', userLogin: options.login } : { kind: 'unauthorized' },
                resolveUserLogin: (ctx: { userLogin?: string }) => ctx.userLogin,
                ownsWorkspacePath: () => options.owns ?? true,
                denyForbidden: (res: FakeResponse) => res.status(403).json({ error: 'Forbidden' }),
            },
            conversations: { get: (id: string) => options.conversation === false ? undefined : { id, cwd: '/repos/alice/app' } },
            readMarks: {
                list: (login: string | undefined) => ({ [`${login}-conv`]: 1 }),
                markRead: (login: string | undefined, id: string, readAt?: number) => {
                    calls.push([login, id, readAt]);
                    return readAt ?? 7;
                },
            },
        });
        return { endpoint: instance, calls };
    }

    type Handlers = { handleList(req: object, res: FakeResponse): void; handleMarkRead(req: object, res: FakeResponse): void };

    it('lists only the signed-in user\'s marks and rejects anonymous calls', () => {
        const res = fakeResponse();
        (endpoint({ login: 'alice' }).endpoint as unknown as Handlers).handleList({}, res);
        expect(res.body).to.deep.equal({ marks: { 'alice-conv': 1 } });

        const anonymous = fakeResponse();
        (endpoint().endpoint as unknown as Handlers).handleList({}, anonymous);
        expect(anonymous.statusCode).to.equal(401);
    });

    it('records the mark for the signed-in user', () => {
        const { endpoint: instance, calls } = endpoint({ login: 'alice' });
        const res = fakeResponse();
        (instance as unknown as Handlers).handleMarkRead({ params: { id: 'conv-1' }, body: { readAt: 42 } }, res);

        expect(calls).to.deep.equal([['alice', 'conv-1', 42]]);
        expect(res.body).to.deep.equal({ conversationId: 'conv-1', readAt: 42 });
    });

    it('refuses marks on unknown or foreign conversations', () => {
        const unknown = endpoint({ login: 'alice', conversation: false });
        const unknownRes = fakeResponse();
        (unknown.endpoint as unknown as Handlers).handleMarkRead({ params: { id: 'x' }, body: {} }, unknownRes);
        expect(unknownRes.statusCode).to.equal(404);

        const foreign = endpoint({ login: 'bob', owns: false });
        const foreignRes = fakeResponse();
        (foreign.endpoint as unknown as Handlers).handleMarkRead({ params: { id: 'conv-1' }, body: {} }, foreignRes);
        expect(foreignRes.statusCode).to.equal(403);
        expect(unknown.calls.concat(foreign.calls)).to.deep.equal([]);
    });
});

describe('resolveQaapConversationAgentActivityAt', () => {

    it('ignores updatedAt bumps that are not agent messages (PATCH of composer prefs, title, flags)', () => {
        const messages = [{ role: 'user', createdAt: 10 }, { role: 'agent', createdAt: 20, runFinishedAt: 30 }];

        expect(resolveQaapConversationAgentActivityAt({ status: 'idle', updatedAt: 999, messages })).to.equal(30);
        expect(resolveQaapConversationAgentActivityAt({ status: 'streaming', updatedAt: 999, messages })).to.equal(999);
        expect(resolveQaapConversationAgentActivityAt({ status: 'idle', updatedAt: 999, messages: messages.slice(0, 1) })).to.equal(undefined);
    });
});
