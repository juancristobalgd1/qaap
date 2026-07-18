// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildQaapPreviewId,
    isQaapPreviewId,
    resolveQaapPreviewIdentity,
} from './qaap-preview-identity';
import {
    buildQaapIdentityPreviewUrl,
    parseQaapIdentityPreviewRequestPath,
} from './qaap-dev-preview';

describe('qaap-preview-identity', () => {
    const identity = {
        projectId: 'Project 1234567890 long',
        conversationId: 'conv/abcdef-1234567890',
        runId: 'run:9876543210-abcdef',
    };

    it('derives a deterministic DNS label from project + conversation + run', () => {
        const previewId = buildQaapPreviewId(identity);
        expect(previewId).to.equal(buildQaapPreviewId(identity));
        expect(previewId.length).to.be.at.most(63);
        expect(isQaapPreviewId(previewId)).to.equal(true);
        expect(resolveQaapPreviewIdentity(identity)).to.deep.equal({ ...identity, previewId });
    });

    it('does not collapse different runs onto one preview', () => {
        expect(buildQaapPreviewId({ ...identity, runId: 'run-a' }))
            .not.to.equal(buildQaapPreviewId({ ...identity, runId: 'run-b' }));
    });

    it('isolates process previews by user + workspace + project + process, not conversation', () => {
        const processIdentity = {
            userId: 'alice',
            workspaceId: 'file:///workspace/repos/users/alice/acme/site',
            projectId: 'github:acme/site',
            processId: 'process-123',
        };
        const previewId = buildQaapPreviewId(processIdentity);
        expect(isQaapPreviewId(previewId)).to.equal(true);
        expect(previewId.length).to.be.at.most(63);
        expect(buildQaapPreviewId({ ...processIdentity, userId: 'bob' })).not.to.equal(previewId);
        expect(buildQaapPreviewId({ ...processIdentity, workspaceId: 'file:///other' })).not.to.equal(previewId);
        expect(buildQaapPreviewId({ ...processIdentity, projectId: 'github:acme/other' })).not.to.equal(previewId);
        expect(buildQaapPreviewId({ ...processIdentity, processId: 'process-456' })).not.to.equal(previewId);
    });

    it('builds and parses the identity-scoped proxy without exposing a port', () => {
        const previewId = buildQaapPreviewId(identity);
        expect(buildQaapIdentityPreviewUrl('https://qaap.example/', previewId, '/dashboard'))
            .to.equal(`https://qaap.example/qaap-preview/${previewId}/dashboard`);
        expect(parseQaapIdentityPreviewRequestPath(`/qaap-preview/${previewId}/dashboard`))
            .to.deep.equal({ previewId, targetPath: '/dashboard' });
    });
});
