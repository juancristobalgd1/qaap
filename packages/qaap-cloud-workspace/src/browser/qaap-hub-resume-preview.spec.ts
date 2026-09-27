// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { qaapPreviewWidgetUri } from '@theia/qaap-adapters/lib/browser/qaap-preview-widget-uri';
import { qaapHubPreviewWidgetKeyFromProject } from './qaap-hub-resume-preview';

describe('qaapHubPreviewWidgetKeyFromProject', () => {

    const projectA = 'file:///workspace/repos/users/alice/alice/app-a';
    const projectB = 'file:///workspace/repos/users/alice/alice/app-b';

    it('keys the preview widget on the clone URI, not the hub routing prefix', () => {
        const key = qaapHubPreviewWidgetKeyFromProject({
            id: `ws:${projectA}`,
            uri: new URI(projectA),
        });
        expect(key).to.deep.equal({ workspaceId: projectA, projectId: projectA });
        expect(qaapPreviewWidgetUri(key).toString()).to.not.equal(qaapPreviewWidgetUri().toString());
    });

    it('gives distinct widgets to two projects so resume cannot share the legacy singleton', () => {
        const keyA = qaapHubPreviewWidgetKeyFromProject({ id: projectA, uri: new URI(projectA) });
        const keyB = qaapHubPreviewWidgetKeyFromProject({ id: projectB, uri: new URI(projectB) });
        expect(qaapPreviewWidgetUri(keyA).toString()).to.not.equal(qaapPreviewWidgetUri(keyB).toString());
    });

    it('strips ws:/recent: prefixes when only the routing key is available', () => {
        expect(qaapHubPreviewWidgetKeyFromProject({ id: `recent:${projectA}` })).to.deep.equal({
            workspaceId: projectA,
            projectId: projectA,
        });
    });

    it('prefers explicitly stored coordinates from a pending resume action', () => {
        expect(qaapHubPreviewWidgetKeyFromProject({
            id: 'github:alice/app-a',
            workspaceId: projectA,
            projectId: projectA,
        })).to.deep.equal({ workspaceId: projectA, projectId: projectA });
    });
});
