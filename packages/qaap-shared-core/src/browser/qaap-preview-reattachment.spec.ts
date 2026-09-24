// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveQaapReattachedPreviewIdentity } from './qaap-preview-reattachment';

describe('preview reattachment', () => {
    it('restores the original process identity before refreshing a claim after reload', () => {
        const restored = resolveQaapReattachedPreviewIdentity(5174, {
            ready: true,
            previewId: 'u-alice-w-workspace-p-project-x-process-0123456789abcd',
            previewUrl: 'http://qaap.test/qaap-preview/u-alice-w-workspace-p-project-x-process-0123456789abcd/',
            workspaceId: 'file:///workspace/project',
            projectId: 'github:alice/project',
            processId: 'process-before-reload',
        });

        expect(restored).to.deep.equal({
            processId: 'process-before-reload',
            claim: {
                previewId: 'u-alice-w-workspace-p-project-x-process-0123456789abcd',
                previewUrl: 'http://qaap.test/qaap-preview/u-alice-w-workspace-p-project-x-process-0123456789abcd/',
                port: 5174,
            },
        });
    });

    it('does not turn a legacy probe into an unverifiable process identity', () => {
        expect(resolveQaapReattachedPreviewIdentity(8080, {
            ready: true,
            previewUrl: 'http://qaap.test/qaap-dev/8080/',
        })).to.equal(undefined);
    });
});
