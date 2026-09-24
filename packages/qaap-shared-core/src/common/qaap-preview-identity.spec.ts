// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildQaapPreviewId,
    isQaapPreviewId,
    normalizeQaapPreviewProjectId,
    qaapPreviewProjectIdMatches,
    qaapPreviewFileUriMatchesProjectName,
    claimedPreviewCoordinatesMatchProject,
    resolveQaapPreviewIdentity,
} from './qaap-preview-identity';
import {
    buildQaapIdentityPreviewUrl,
    findQaapIdentityPreviewUrl,
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

    it('isolates process previews by user + workspace + project + conversation + process', () => {
        const processIdentity = {
            userId: 'alice',
            workspaceId: 'file:///workspace/repos/users/alice/acme/site',
            projectId: 'github:acme/site',
            conversationId: 'section-a',
            processId: 'process-123',
        };
        const previewId = buildQaapPreviewId(processIdentity);
        expect(isQaapPreviewId(previewId)).to.equal(true);
        expect(previewId.length).to.be.at.most(63);
        expect(buildQaapPreviewId({ ...processIdentity, userId: 'bob' })).not.to.equal(previewId);
        expect(buildQaapPreviewId({ ...processIdentity, workspaceId: 'file:///other' })).not.to.equal(previewId);
        expect(buildQaapPreviewId({ ...processIdentity, projectId: 'github:acme/other' })).not.to.equal(previewId);
        expect(buildQaapPreviewId({ ...processIdentity, conversationId: 'section-b' })).not.to.equal(previewId);
        expect(buildQaapPreviewId({ ...processIdentity, processId: 'process-456' })).not.to.equal(previewId);
        expect(buildQaapPreviewId({
            ...processIdentity,
            conversationId: 'section-a',
            processId: 'process-123',
        })).to.equal(previewId);
        expect(buildQaapPreviewId({
            ...processIdentity,
            conversationId: 'section-b',
            processId: 'process-123',
        })).not.to.equal(previewId);
    });

    it('matches canonical project roots across Work Hub routing keys', () => {
        const canonical = 'file:///workspace/repos/users/alice/acme/site';
        expect(normalizeQaapPreviewProjectId(`ws:${canonical}`)).to.equal(canonical);
        expect(normalizeQaapPreviewProjectId(`recent:${canonical}`)).to.equal(canonical);
        expect(qaapPreviewProjectIdMatches(canonical, `ws:${canonical}`)).to.equal(true);
        expect(qaapPreviewProjectIdMatches(canonical, 'github:acme/site', canonical)).to.equal(true);
        expect(qaapPreviewProjectIdMatches(canonical, 'ws:file:///workspace/repos/users/alice/acme/other')).to.equal(false);
        expect(qaapPreviewProjectIdMatches('github:acme/site', 'github:acme/site')).to.equal(true);
        expect(qaapPreviewProjectIdMatches('github:acme/site', canonical)).to.equal(false);
        expect(qaapPreviewFileUriMatchesProjectName(canonical, 'site')).to.equal(true);
        expect(qaapPreviewFileUriMatchesProjectName(canonical, 'other')).to.equal(false);
        expect(qaapPreviewFileUriMatchesProjectName('github:acme/site', 'site')).to.equal(false);
        expect(claimedPreviewCoordinatesMatchProject({
            probeProjectId: canonical,
            projectId: `ws:${canonical}`,
            projectName: 'Landing',
        })).to.equal(true);
        expect(claimedPreviewCoordinatesMatchProject({
            probeProjectId: canonical,
            projectId: 'other-project',
            projectName: 'site',
        })).to.equal(true);
        expect(claimedPreviewCoordinatesMatchProject({
            probeProjectId: canonical,
            projectId: 'other-project',
            projectName: 'Landing',
        })).to.equal(false);
        expect(claimedPreviewCoordinatesMatchProject({
            probeProjectId: undefined,
            projectId: canonical,
            projectName: 'site',
        })).to.equal(false);
    });

    it('builds and parses the identity-scoped proxy without exposing a port', () => {
        const previewId = buildQaapPreviewId(identity);
        expect(buildQaapIdentityPreviewUrl('https://qaap.example/', previewId, '/dashboard'))
            .to.equal(`https://qaap.example/qaap-preview/${previewId}/dashboard`);
        expect(parseQaapIdentityPreviewRequestPath(`/qaap-preview/${previewId}/dashboard`))
            .to.deep.equal({ previewId, targetPath: '/dashboard' });
    });

    it('prefers a stable identity candidate over agent-reported bare ports', () => {
        const previewId = buildQaapPreviewId(identity);
        const identityUrl = buildQaapIdentityPreviewUrl('https://qaap.example/', previewId);
        expect(findQaapIdentityPreviewUrl([
            'https://qaap.example/qaap-dev/8080/',
            identityUrl,
        ], 'https://qaap.example/')).to.equal(identityUrl);
        expect(findQaapIdentityPreviewUrl([
            'https://qaap.example/qaap-dev/8080/',
        ], 'https://qaap.example/')).to.equal(undefined);
    });
});
