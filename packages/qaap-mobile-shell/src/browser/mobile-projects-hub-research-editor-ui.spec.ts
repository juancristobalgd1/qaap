// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { createFormFieldLabel, wireFormFieldLabel } from './qaap-mobile-form-ui';
import { MobileProjectsHubResearchEditorUi } from './mobile-projects-hub-research-editor-ui';

describe('mobile-projects-hub-research-editor-ui a11y', () => {
    let disableJSDOM: () => void;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => {
        disableJSDOM();
    });

    it('wires form labels to controls with for/aria-labelledby', () => {
        const label = createFormFieldLabel('Goal', { id: 'qaap-test-label' });
        const input = document.createElement('input');
        wireFormFieldLabel(label, input);
        expect(label.tagName).to.equal('LABEL');
        expect((label as HTMLLabelElement).htmlFor).to.equal(input.id);
        expect(input.getAttribute('aria-labelledby')).to.equal(label.id);
    });

    it('opens a named dialog with an accessible close control', () => {
        const host = {
            projects: [],
            visible: true,
            hubView: 'research' as const,
            researchSheet: undefined as HTMLElement | undefined,
            researchInteractionLock: false,
            projectsService: { getProjectCwd: () => '/tmp/repo' },
            messageService: undefined,
            refreshResearchGoals: async () => undefined,
            renderList: () => undefined,
        };
        const ui = new MobileProjectsHubResearchEditorUi(host as never);
        ui.openResearchEditor();
        expect(host.researchSheet).to.not.equal(undefined);
        expect(host.researchSheet!.getAttribute('role')).to.equal('dialog');
        expect(host.researchSheet!.getAttribute('aria-labelledby')).to.equal('qaap-research-sheet-title');
        const close = host.researchSheet!.querySelector('.theia-mobile-routine-sheet-close') as HTMLButtonElement;
        expect(close.getAttribute('aria-label')).to.be.a('string').and.not.empty;
        expect(host.researchSheet!.querySelectorAll('[aria-labelledby]').length).to.be.greaterThan(1);
        ui.closeResearchEditor();
        expect(host.researchSheet).to.equal(undefined);
    });
});
