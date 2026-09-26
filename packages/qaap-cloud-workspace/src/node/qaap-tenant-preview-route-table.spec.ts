// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapSqliteStore } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { buildQaapPreviewId } from '@theia/qaap-shared-core/lib/common/qaap-preview-identity';
import { QaapTenantPreviewRouteTable } from './qaap-tenant-preview-route-table';
import { QaapDockerOrchestrator } from './qaap-docker-orchestrator';

/** In-memory stand-in for the SQLite store so the spec never touches the home directory. */
class MemoryRouteTable extends QaapTenantPreviewRouteTable {
    readonly persisted = new Map<string, unknown>();

    protected override getSqliteStore(): QaapSqliteStore {
        return {
            get: (key: string) => this.persisted.get(key),
            set: (key: string, value: unknown) => { this.persisted.set(key, value); },
            delete: (key: string) => this.persisted.delete(key),
        } as unknown as QaapSqliteStore;
    }

    forgetMemory(): void {
        this.memory.clear();
    }
}

describe('QaapTenantPreviewRouteTable', () => {
    const SHARE = 'AbCdEfGh_123-xy';
    const alicePreview = buildQaapPreviewId({
        userId: 'alice', workspaceId: 'file:///w', projectId: 'file:///w', conversationId: 'c', processId: '1b2c3d4e-0000-0000-0000-000000000000',
    });

    it('resolves what a tenant advertised and survives a restart (persisted)', () => {
        const table = new MemoryRouteTable();
        expect(table.record({ kind: 'share', id: SHARE }, 'Alice', 1_000)).to.equal(true);
        expect(table.record({ kind: 'preview', id: alicePreview }, 'alice', 1_000)).to.equal(true);
        table.forgetMemory();
        expect(table.resolve('share', SHARE, 2_000)).to.equal('Alice');
        expect(table.resolve('preview', alicePreview.toUpperCase(), 2_000)).to.equal('alice');
        // Share tokens are case-sensitive.
        expect(table.resolve('share', SHARE.toLowerCase(), 2_000)).to.equal(undefined);
    });

    it('never re-points a live route to another tenant (first advertiser wins)', () => {
        const table = new MemoryRouteTable();
        table.record({ kind: 'share', id: SHARE }, 'alice', 1_000);
        expect(table.record({ kind: 'share', id: SHARE }, 'mallory', 2_000)).to.equal(false);
        expect(table.resolve('share', SHARE, 3_000)).to.equal('alice');
        // The owner refreshing its own route is fine.
        expect(table.record({ kind: 'share', id: SHARE }, 'ALICE', 3_000)).to.equal(true);
    });

    it('refuses a preview id that names another tenant', () => {
        const table = new MemoryRouteTable();
        expect(table.record({ kind: 'preview', id: alicePreview }, 'mallory', 1_000)).to.equal(false);
        expect(table.resolve('preview', alicePreview, 1_000)).to.equal(undefined);
    });

    it('forgets expired routes, after which the identifier can be re-advertised', () => {
        const table = new MemoryRouteTable();
        table.record({ kind: 'share', id: SHARE }, 'alice', 0);
        const expired = 9 * 24 * 60 * 60_000;
        expect(table.resolve('share', SHARE, expired)).to.equal(undefined);
        expect(table.persisted.size).to.equal(0);
        expect(table.record({ kind: 'share', id: SHARE }, 'bob', expired)).to.equal(true);
    });

    it('ignores invalid identifiers and logins', () => {
        const table = new MemoryRouteTable();
        expect(table.record({ kind: 'share', id: 'x' }, 'alice')).to.equal(false);
        expect(table.record({ kind: 'share', id: SHARE }, '  ')).to.equal(false);
        expect(table.resolve('share', '../../etc/passwd')).to.equal(undefined);
    });
});

describe('tenant backend public-URL environment', () => {
    it('passes the preview host / share settings a backend needs to mint routable URLs', () => {
        const orchestrator = Object.create(QaapDockerOrchestrator.prototype) as { tenantBackendPublicUrlEnv(env: NodeJS.ProcessEnv): string[] };
        expect(orchestrator.tenantBackendPublicUrlEnv({
            QAAP_OAUTH_PUBLIC_URL: 'https://qaap.example.test',
            QAAP_PREVIEW_BASE_DOMAIN: ' preview.example.test ',
            QAAP_PREVIEW_ALLOW_SAME_SITE: '',
            QAAP_TENANT_BACKEND_MASTER_SECRET: 'never-copied',
        })).to.deep.equal(['QAAP_OAUTH_PUBLIC_URL=https://qaap.example.test', 'QAAP_PREVIEW_BASE_DOMAIN=preview.example.test']);
        expect(orchestrator.tenantBackendPublicUrlEnv({ QAAP_PREVIEW_BASE_DOMAIN: 'a\nINJECTED=1' })).to.deep.equal([]);
    });
});
