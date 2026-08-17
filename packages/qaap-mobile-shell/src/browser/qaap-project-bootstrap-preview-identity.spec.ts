// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import {
    resolvePreviewClaimWorkspaceRoot,
    shouldIgnoreWorkspaceRefreshForHubPin,
} from './qaap-project-bootstrap-helpers';

describe('Qaap project bootstrap preview identity', () => {

    it('claims preview identity from the detected project root, not the open IDE workspace', () => {
        const marked = URI.fromFilePath('/home/ubuntu/.qaap/workspaces/users/_dev/markedjs/marked');
        const vitesse = URI.fromFilePath('/home/ubuntu/.qaap/workspaces/users/_dev/antfu-collective/vitesse-lite');
        const root = resolvePreviewClaimWorkspaceRoot({
            _descriptor: { rootUri: marked },
            activeWorkspaceRoot: vitesse,
        }, marked);
        expect(root.toString()).to.equal(marked.toString());
    });

    it('ignores Theia workspace refresh while a different Work Hub project is pinned', () => {
        const marked = 'file:///ws/markedjs/marked';
        const vitesse = 'file:///ws/antfu-collective/vitesse-lite';
        expect(shouldIgnoreWorkspaceRefreshForHubPin(marked, vitesse)).to.equal(true);
        expect(shouldIgnoreWorkspaceRefreshForHubPin(marked, marked)).to.equal(false);
        expect(shouldIgnoreWorkspaceRefreshForHubPin(undefined, vitesse)).to.equal(false);
    });
});
