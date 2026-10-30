// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteConnectionRegistry } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { QaapProjectFolderTrustEndpoint } from './qaap-project-folder-trust-endpoint';
import { QaapProjectFolderTrustStore } from './qaap-project-folder-trust-store';

class TestProjectFolderTrustStore extends QaapProjectFolderTrustStore {
    constructor(protected readonly dbPath: string) {
        super();
    }
    protected override resolveDatabasePath(): string {
        return this.dbPath;
    }
}

type Handler = (req: unknown, res: unknown) => void;

interface FakeResponse {
    statusCode: number;
    body: unknown;
    status(code: number): FakeResponse;
    json(body: unknown): FakeResponse;
}

function fakeResponse(): FakeResponse {
    const response: FakeResponse = {
        statusCode: 200,
        body: undefined,
        status(code: number): FakeResponse {
            response.statusCode = code;
            return response;
        },
        json(body: unknown): FakeResponse {
            response.body = body;
            return response;
        },
    };
    return response;
}

/** Owner `login` may only use folders under `/owned/<login>/`; everything else is refused as not theirs. */
function fakeAuth(login: string): unknown {
    return {
        authenticate: () => ({ kind: 'user', userLogin: login }),
        resolveUserLogin: () => login,
        resolveOwnedRepositoryCwd: (_ctx: unknown, raw: string | undefined) => raw?.startsWith(`/owned/${login}/`)
            ? { kind: 'ok', cwd: raw }
            : { kind: 'denied' },
        denyForbidden: (res: FakeResponse) => res.status(403).json({ ok: false }),
    };
}

describe('qaap project folder trust endpoint', function (): void {
    this.timeout(10_000);

    let tempDir: string;
    let store: TestProjectFolderTrustStore;
    let handlers: { get: Handler; put: Handler };
    const savedSqlitePath = process.env.QAAP_SQLITE_STORE_PATH;

    const endpointFor = (login: string): void => {
        const endpoint = new QaapProjectFolderTrustEndpoint();
        Object.assign(endpoint, { store, auth: fakeAuth(login) });
        handlers = { get: undefined as unknown as Handler, put: undefined as unknown as Handler };
        endpoint.configure({
            get: (_path: string, handler: Handler) => { handlers.get = handler; },
            put: (_path: string, handler: Handler) => { handlers.put = handler; },
        } as never);
    };

    beforeEach(() => {
        delete process.env.QAAP_SQLITE_STORE_PATH;
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-folder-trust-endpoint-'));
        store = new TestProjectFolderTrustStore(path.join(tempDir, 'state', 'project-folder-trust.sqlite'));
    });

    afterEach(() => {
        if (savedSqlitePath === undefined) {
            delete process.env.QAAP_SQLITE_STORE_PATH;
        } else {
            process.env.QAAP_SQLITE_STORE_PATH = savedSqlitePath;
        }
        QaapSqliteConnectionRegistry.shared.closeUnder(tempDir);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('reports an undecided owned folder as not decided and not trusted', () => {
        endpointFor('alice');
        const res = fakeResponse();
        handlers.get({ query: { cwd: '/owned/alice/app' } }, res);
        expect(res.statusCode).to.equal(200);
        expect(res.body).to.deep.include({ cwd: '/owned/alice/app', decided: false, trusted: false });
    });

    it('stores the decision for the caller and reads it back', () => {
        endpointFor('alice');
        const put = fakeResponse();
        handlers.put({ body: { cwd: '/owned/alice/app', trusted: true } }, put);
        expect(put.statusCode).to.equal(200);
        const get = fakeResponse();
        handlers.get({ query: { cwd: '/owned/alice/app' } }, get);
        expect(get.body).to.deep.include({ decided: true, trusted: true });
    });

    it('refuses to read or set a folder the caller does not own', () => {
        endpointFor('bob');
        const get = fakeResponse();
        handlers.get({ query: { cwd: '/owned/alice/app' } }, get);
        expect(get.statusCode).to.equal(403);

        const put = fakeResponse();
        handlers.put({ body: { cwd: '/owned/alice/app', trusted: true } }, put);
        expect(put.statusCode).to.equal(403);
        expect(store.isTrusted('alice', '/owned/alice/app')).to.be.false;
    });

    it('rejects a non-boolean trusted value', () => {
        endpointFor('alice');
        const put = fakeResponse();
        handlers.put({ body: { cwd: '/owned/alice/app', trusted: 'yes' } }, put);
        expect(put.statusCode).to.equal(400);
    });

    it('keeps another owner decision out of this caller view', () => {
        endpointFor('alice');
        const put = fakeResponse();
        handlers.put({ body: { cwd: '/owned/alice/app', trusted: true } }, put);
        expect(put.statusCode).to.equal(200);

        endpointFor('alice');
        expect(store.isTrusted('bob', '/owned/alice/app')).to.be.false;
    });
});

describe('qaap project folder trust endpoint without user auth', function (): void {
    this.timeout(10_000);

    it('answers 401 to a PUT that carries only the agent helper token header', () => {
        // The guard only honours a user session, an API token or the tenant assertion. The helper token
        // (x-qaap-task-token) is a per-task credential and must never set a folder decision.
        const helperOnlyAuth = {
            authenticate: (req: { headers: Record<string, string> }) => {
                const hasUserCredential = !!req.headers.cookie || !!req.headers.authorization;
                return hasUserCredential ? { kind: 'authenticated', userLogin: 'alice' } : { kind: 'unauthorized' };
            },
            resolveUserLogin: () => 'alice',
            resolveOwnedRepositoryCwd: () => ({ kind: 'ok', cwd: '/owned/alice/app' }),
            denyForbidden: (res: FakeResponse) => res.status(403).json({ ok: false }),
        };
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-folder-trust-helper-'));
        const savedSqlitePath = process.env.QAAP_SQLITE_STORE_PATH;
        delete process.env.QAAP_SQLITE_STORE_PATH;
        try {
            const store = new TestProjectFolderTrustStore(path.join(tempDir, 'state', 'project-folder-trust.sqlite'));
            const endpoint = new QaapProjectFolderTrustEndpoint();
            Object.assign(endpoint, { store, auth: helperOnlyAuth });
            let putHandler: ((req: unknown, res: unknown) => void) | undefined;
            endpoint.configure({ get: () => undefined, put: (_path: string, handler: (req: unknown, res: unknown) => void) => { putHandler = handler; } } as never);
            const res = fakeResponse();
            putHandler?.({ headers: { 'x-qaap-task-token': 'task-secret' }, body: { cwd: '/owned/alice/app', trusted: true } }, res);
            expect(res.statusCode).to.equal(401);
            expect(store.isTrusted('alice', '/owned/alice/app')).to.be.false;
        } finally {
            if (savedSqlitePath !== undefined) {
                process.env.QAAP_SQLITE_STORE_PATH = savedSqlitePath;
            }
            QaapSqliteConnectionRegistry.shared.closeUnder(tempDir);
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
