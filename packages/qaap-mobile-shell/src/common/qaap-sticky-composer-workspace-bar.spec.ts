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

    it('renders branch and destination fields in the workspace context bar', () => {
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
        expect(bar.querySelectorAll('.theia-mobile-projects-sticky-composer-context-divider').length).to.equal(0);
        expect(bar.querySelector('.theia-mod-branch')).to.not.equal(null);
        expect(bar.querySelector('.theia-mod-destination')).to.not.equal(null);
    });

    it('renders branch without destination when only the branch field is needed', () => {
        const bar = renderStickyComposerWorkspaceBar({
            view: { projectName: 'Demo', branchName: 'fix/critical-bugs' },
            includeProject: false,
            onOpenProject: () => undefined,
            onOpenBranch: () => undefined,
        });
        bar.classList.add('theia-mod-branch-only');
        expect(bar.querySelector('.theia-mod-branch')).to.not.equal(null);
        expect(bar.querySelector('.theia-mod-destination')).to.equal(null);
    });
});
