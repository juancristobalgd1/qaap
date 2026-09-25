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
            // POSIX permission bits are not authoritative on Windows/NTFS. The production
            // chmod remains best-effort there; verify the exact private mode where the host
            // filesystem exposes it.
            if (process.platform !== 'win32') {
                expect(fs.statSync(storePath).mode & 0o777).to.equal(0o600);
            }
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

describe('QaapDevPreviewPortRegistry onDidReleasePort', () => {
    it('fires for new registrations, rebinds, releases and preview releases', () => {
        const identity = resolveQaapPreviewIdentity({
            userId: 'alice',
            workspaceId: 'file:///workspace/alice/site',
            projectId: 'file:///workspace/alice/site',
            conversationId: 'section-a',
            processId: 'process-a',
        });
        const registry = new QaapDevPreviewPortRegistry();
        const fired: number[] = [];
        registry.onDidReleasePort(port => fired.push(port));
        const registration = { ...identity, ownerLogin: 'alice', root: '/workspace/alice/site', port: 8124 };
        const record = registry.register(registration)!;
        expect(fired).to.deep.equal([8124]);
        registry.register(registration);
        expect(fired).to.deep.equal([8124], 'refreshing the same registration keeps the caches');
        registry.rebindPort(record.previewId, 'alice', 8123);
        expect(fired).to.deep.equal([8124, 8124, 8123]);
        registry.releasePreview(record.previewId, 'alice');
        expect(fired).to.deep.equal([8124, 8124, 8123, 8123]);
        registry.claim(9000, 'bob');
        registry.release(9000);
        expect(fired).to.deep.equal([8124, 8124, 8123, 8123, 9000]);
    });
});

describe('QaapDevPreviewPortRegistry sweepExpiredClaims', () => {
    class AgingRegistry extends QaapDevPreviewPortRegistry {
        age(port: number, ms: number): void {
            const entry = this.claims.get(port)!;
            this.claims.set(port, { ...entry, at: entry.at - ms });
        }
    }

    it('reports each TTL expiry once and re-arms when the claim is refreshed', () => {
        const registry = new AgingRegistry();
        const fired: number[] = [];
        registry.onDidReleasePort(port => fired.push(port));
        // Every sweep gets an explicit clock; claims are aged relative to their own timestamp, so
        // the verdict never depends on wall time. The refresh happens in the same millisecond as
        // the original claim on fast runs — the case that used to be misread as "already reported".
        registry.claim(5173, 'alice');
        registry.claim(5174, 'alice');
        const now = Date.now() + 60_000;
        expect(registry.sweepExpiredClaims(now)).to.deep.equal([]);
        registry.age(5173, 31 * 60_000 + 60_000);
        expect(registry.sweepExpiredClaims(now)).to.deep.equal([5173]);
        expect(registry.sweepExpiredClaims(now)).to.deep.equal([], 'reported once');
        expect(registry.staleOwnerOf(5173)).to.equal('alice', 'the stale claim itself is kept');
        registry.claim(5173, 'alice');
        registry.age(5173, 31 * 60_000 + 60_000);
        expect(registry.sweepExpiredClaims(now)).to.deep.equal([5173]);
        expect(fired).to.deep.equal([5173, 5173]);
    });
});

