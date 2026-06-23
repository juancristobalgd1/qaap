// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    appendStickyComposerWorkspaceContextField,
    createStickyComposerWorkspacePill,
    renderStickyComposerWorkspaceBar,
} from '../browser/qaap-sticky-composer-workspace-bar';

describe('qaap-sticky-composer-workspace-bar', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    it('separates branch and destination with a divider in the workspace context bar', () => {
        const bar = renderStickyComposerWorkspaceBar({
            view: { projectName: 'Demo', branchName: 'main' },
            includeProject: false,
            onOpenProject: () => undefined,
            onOpenBranch: () => undefined,
        });
        appendStickyComposerWorkspaceContextField(
            bar,
            createStickyComposerWorkspacePill({
                iconClass: 'codicon-device-desktop',
                label: 'Local',
                ariaLabel: 'Run in: Local',
                fieldKind: 'destination',
                onClick: () => undefined,
            }),
            'destination',
        );
        expect(bar.querySelectorAll('.theia-mobile-projects-sticky-composer-context-divider').length).to.equal(1);
        expect(bar.querySelector('.theia-mod-branch')).to.not.equal(null);
        expect(bar.querySelector('.theia-mod-destination')).to.not.equal(null);
    });

    it('omits the divider when appendStickyComposerWorkspaceContextField divider is false', () => {
        const bar = renderStickyComposerWorkspaceBar({
            view: { projectName: 'Demo', branchName: 'main' },
            includeProject: false,
            onOpenProject: () => undefined,
            onOpenBranch: () => undefined,
        });
        appendStickyComposerWorkspaceContextField(
            bar,
            createStickyComposerWorkspacePill({
                iconClass: 'codicon-device-desktop',
                label: 'Local',
                ariaLabel: 'Run in: Local',
                fieldKind: 'destination',
                onClick: () => undefined,
            }),
            'destination',
            { divider: false },
        );
        expect(bar.querySelectorAll('.theia-mobile-projects-sticky-composer-context-divider').length).to.equal(0);
    });
});
