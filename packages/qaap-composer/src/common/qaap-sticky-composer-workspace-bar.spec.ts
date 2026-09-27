// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { createComposerWorkspaceSheetNavGroup } from '../browser/qaap-sticky-composer-workspace-bar';

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
