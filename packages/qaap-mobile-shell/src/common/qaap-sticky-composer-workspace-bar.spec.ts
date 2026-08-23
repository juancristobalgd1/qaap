// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    appendStickyComposerWorkspaceContextField,
    createComposerWorkspaceSheetNavGroup,
    createStickyComposerWorkspacePill,
    renderStickyComposerWorkspaceBar,
} from '../browser/qaap-sticky-composer-workspace-bar';

describe('qaap-sticky-composer-workspace-bar', () => {
    // renderStickyComposerWorkspaceBar / pills are retained for sheet helpers; the sticky composer no longer mounts a bottom workspace bar.

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
                iconClass: 'codicon-repo',
                label: 'Current workspace',
                ariaLabel: 'Run in: Current workspace',
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
                iconClass: 'codicon-repo',
                label: 'Current workspace',
                ariaLabel: 'Run in: Current workspace',
                fieldKind: 'destination',
                onClick: () => undefined,
            }),
            'destination',
            { divider: false },
        );
        expect(bar.querySelectorAll('.theia-mobile-projects-sticky-composer-context-divider').length).to.equal(0);
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

    it('renders an accessible workspace sheet nav group with aria-pressed selection', () => {
        let selected: string | undefined;
        const nav = createComposerWorkspaceSheetNavGroup({
            active: 'branch',
            onSelect: kind => { selected = kind; },
        });
        document.body.append(nav);
        const group = nav.querySelector('[role="group"]');
        expect(group?.getAttribute('aria-label')).to.equal('Workspace context');
        const branchBtn = nav.querySelector<HTMLButtonElement>('.theia-qaap-segmented-option.theia-mod-selected');
        expect(branchBtn?.textContent?.trim()).to.equal('Branch');
        expect(branchBtn?.querySelector('.codicon-git-branch')).to.not.equal(null);
        expect(branchBtn?.getAttribute('aria-pressed')).to.equal('true');
        const projectBtn = nav.querySelector<HTMLButtonElement>('.theia-qaap-segmented-option[aria-label="Project"]');
        expect(projectBtn?.querySelector('.codicon-repo')).to.not.equal(null);
        const destinationBtn = nav.querySelector<HTMLButtonElement>('.theia-qaap-segmented-option[aria-label="Run in"]');
        expect(destinationBtn?.querySelector('.codicon-repo')).to.not.equal(null);
        expect(destinationBtn?.querySelector('.codicon')?.getAttribute('aria-hidden')).to.equal('true');
        projectBtn?.click();
        expect(selected).to.equal('project');
        nav.remove();
    });
});
