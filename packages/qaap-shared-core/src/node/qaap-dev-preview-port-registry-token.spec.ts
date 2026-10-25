// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveQaapPreviewIdentity } from '../common/qaap-preview-identity';
import { QaapDevPreviewPortRegistry, type QaapDevPreviewRegistration } from './qaap-dev-preview-port-registry';
import { buildQaapPreviewHostLabel } from './qaap-preview-host';

/** Lets a test age a retained token past the claim TTL without waiting. */
class AgingTestRegistry extends QaapDevPreviewPortRegistry {
    ageRetainedToken(previewId: string, ms: number): void {
        const retained = this.retainedAccessTokens.get(previewId);
        if (retained) {
            this.retainedAccessTokens.set(previewId, { ...retained, retainedAt: retained.retainedAt - ms });
        }
    }
}

function registrationFor(overrides: Partial<QaapDevPreviewRegistration> = {}): QaapDevPreviewRegistration {
    const identity = resolveQaapPreviewIdentity({
        userId: 'alice',
        workspaceId: 'file:///workspace/alice/site',
        projectId: 'file:///workspace/alice/site',
        conversationId: 'section-a',
        processId: 'process-a',
    });
    return {
        ...identity,
        ownerLogin: 'alice',
        root: '/workspace/alice/site',
        port: 8124,
        ...overrides,
    };
}

describe('QaapDevPreviewPortRegistry access token rotation', () => {

    it('a re-claim of a live identity on the same owner, root and port keeps the access token', () => {
        const registry = new AgingTestRegistry();
        const first = registry.register(registrationFor())!;
        const again = registry.register(registrationFor())!;
        expect(again.previewId).to.equal(first.previewId);
        expect(again.accessToken).to.equal(first.accessToken);
        expect(buildQaapPreviewHostLabel(again.previewId, again.accessToken))
            .to.equal(buildQaapPreviewHostLabel(first.previewId, first.accessToken));
    });

    it('a claim re-registered after an internal release keeps the access token and the link label', () => {
        const registry = new AgingTestRegistry();
        const first = registry.register(registrationFor())!;
        expect(registry.releasePreview(first.previewId, 'alice', { keepAccessToken: true })).to.equal(true);
        const second = registry.register(registrationFor())!;
        expect(second.accessToken).to.equal(first.accessToken);
        expect(registry.getByHostLabel(buildQaapPreviewHostLabel(first.previewId, first.accessToken))?.previewId)
            .to.equal(first.previewId);
    });

    it('an explicit release rotates the access token so the old link stops resolving', () => {
        const registry = new AgingTestRegistry();
        const first = registry.register(registrationFor())!;
        registry.releasePreview(first.previewId, 'alice');
        const second = registry.register(registrationFor())!;
        expect(second.accessToken).to.not.equal(first.accessToken);
        expect(registry.getByHostLabel(buildQaapPreviewHostLabel(first.previewId, first.accessToken))).to.equal(undefined);
    });

    it('a retained token is not reused on another port', () => {
        const registry = new AgingTestRegistry();
        const first = registry.register(registrationFor({ port: 8124 }))!;
        registry.releasePreview(first.previewId, 'alice', { keepAccessToken: true });
        const moved = registry.register(registrationFor({ port: 8125 }))!;
        expect(moved.accessToken).to.not.equal(first.accessToken);
    });

    it('a retained token is not reused by another owner or another root', () => {
        const registry = new AgingTestRegistry();
        const first = registry.register(registrationFor())!;
        registry.releasePreview(first.previewId, 'alice', { keepAccessToken: true });
        const otherRoot = registry.register(registrationFor({ root: '/workspace/alice/other' }))!;
        expect(otherRoot.accessToken).to.not.equal(first.accessToken);
    });

    it('a retained token expires with the claim TTL and then rotates', () => {
        const registry = new AgingTestRegistry();
        const first = registry.register(registrationFor())!;
        registry.releasePreview(first.previewId, 'alice', { keepAccessToken: true });
        registry.ageRetainedToken(first.previewId, 365 * 24 * 60 * 60_000);
        const later = registry.register(registrationFor())!;
        expect(later.accessToken).to.not.equal(first.accessToken);
    });

    it('a retained token is consumed by the next registration only', () => {
        const registry = new AgingTestRegistry();
        const first = registry.register(registrationFor())!;
        registry.releasePreview(first.previewId, 'alice', { keepAccessToken: true });
        registry.register(registrationFor());
        registry.releasePreview(first.previewId, 'alice');
        const afterExplicitStop = registry.register(registrationFor())!;
        expect(afterExplicitStop.accessToken).to.not.equal(first.accessToken);
    });
});
