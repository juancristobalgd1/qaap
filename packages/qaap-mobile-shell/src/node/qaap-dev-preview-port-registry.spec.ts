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
