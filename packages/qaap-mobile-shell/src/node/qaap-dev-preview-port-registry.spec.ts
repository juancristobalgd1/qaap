// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveQaapPreviewIdentity } from '../common/qaap-preview-identity';
import { QaapDevPreviewPortRegistry } from './qaap-dev-preview-port-registry';

class PersistentTestRegistry extends QaapDevPreviewPortRegistry {
    initialize(): void {
        this.init();
    }

    flush(): void {
        this.persistNow();
    }
}

describe('QaapDevPreviewPortRegistry rebindPort', () => {
    it('moves a claim to a free listening port without changing preview identity', () => {
        const identity = resolveQaapPreviewIdentity({
            userId: 'alice',
            workspaceId: 'file:///workspace/alice/site',
            projectId: 'file:///workspace/alice/site',
            conversationId: 'section-a',
            processId: 'process-a',
        });
        const registry = new QaapDevPreviewPortRegistry();
        const reserved = registry.register({
            ...identity,
            ownerLogin: 'alice',
            root: '/workspace/alice/site',
            port: 8124,
        })!;
        const rebound = registry.rebindPort(reserved.previewId, 'alice', 8123);
        expect(rebound?.port).to.equal(8123);
        expect(rebound?.previewId).to.equal(reserved.previewId);
        expect(registry.getByPort(8124)).to.equal(undefined);
        expect(registry.getByPort(8123)?.previewId).to.equal(reserved.previewId);
    });

    it('refuses to steal another preview identity port', () => {
        const first = resolveQaapPreviewIdentity({
            userId: 'alice',
            workspaceId: 'file:///workspace/alice/a',
            projectId: 'file:///workspace/alice/a',
            conversationId: 'section-a',
            processId: 'process-a',
        });
        const second = resolveQaapPreviewIdentity({
            userId: 'alice',
            workspaceId: 'file:///workspace/alice/b',
            projectId: 'file:///workspace/alice/b',
            conversationId: 'section-b',
            processId: 'process-b',
        });
        const registry = new QaapDevPreviewPortRegistry();
        registry.register({
            ...first,
            ownerLogin: 'alice',
            root: '/workspace/alice/a',
            port: 8123,
        });
        const other = registry.register({
            ...second,
            ownerLogin: 'alice',
            root: '/workspace/alice/b',
            port: 8124,
        })!;
        expect(registry.rebindPort(other.previewId, 'alice', 8123)).to.equal(undefined);
        expect(registry.getByPort(8124)?.previewId).to.equal(other.previewId);
    });
});

describe('QaapDevPreviewPortRegistry persistence', () => {
    it('restores a process preview across a backend restart and keeps the capability private', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-preview-registry-'));
        const storePath = path.join(tempDir, 'previews.json');
        const previousPath = process.env.QAAP_PREVIEW_REGISTRY_PATH;
        process.env.QAAP_PREVIEW_REGISTRY_PATH = storePath;
        try {
            const identity = resolveQaapPreviewIdentity({
                userId: 'alice',
                workspaceId: 'file:///workspace/repos/users/alice/acme/site',
                projectId: 'github:acme/site',
                conversationId: 'section-a',
                processId: 'process-a',
            });
            const first = new PersistentTestRegistry();
            first.initialize();
            const record = first.register({
                ...identity,
                ownerLogin: 'alice',
                root: '/workspace/repos/users/alice/acme/site',
                port: 5173,
            })!;
            first.flush();

            const restored = new PersistentTestRegistry();
            restored.initialize();
            expect(restored.getForOwner(identity.previewId, 'alice')).to.include({
                previewId: identity.previewId,
                port: 5173,
                processId: 'process-a',
            });
            expect(restored.getForOwner(identity.previewId, 'alice')?.accessToken).to.equal(record.accessToken);
            expect(restored.getForOwner(identity.previewId, 'bob')).to.equal(undefined);
            expect(fs.statSync(storePath).mode & 0o777).to.equal(0o600);
        } finally {
            if (previousPath === undefined) {
                delete process.env.QAAP_PREVIEW_REGISTRY_PATH;
            } else {
                process.env.QAAP_PREVIEW_REGISTRY_PATH = previousPath;
            }
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
