// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

let disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { QaapAgentPreviewChromeStyle as Style } from './qaap-agent-preview-chrome-style';
import {
    collectPreviewMaximizeScopeRoots,
    createPreviewMaximizeButton,
    createPreviewMaximizeControl,
    QaapPreviewMaximizeController,
    syncPreviewMaximizeButton,
} from './qaap-preview-maximize';

disableJSDOM();

describe('qaap-preview-maximize chrome', () => {
    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    afterEach(() => {
        document.body.classList.remove(Style.PREVIEW_MAXIMIZED);
        document.body.replaceChildren();
    });

    it('collectPreviewMaximizeScopeRoots includes preview root, body, and Work Hub shell', () => {
        const workHub = document.createElement('div');
        workHub.className = 'theia-mobile-projects';
        const previewHost = document.createElement('div');
        previewHost.className = 'theia-mobile-transcript-preview';
        const previewRoot = document.createElement('div');
        previewRoot.className = 'qaap-agent-preview-embedded';
        previewHost.append(previewRoot);
        workHub.append(previewHost);
        document.body.append(workHub);

        const roots = collectPreviewMaximizeScopeRoots(previewRoot);
        expect(roots).to.include(previewRoot);
        expect(roots).to.include(document.body);
        expect(roots).to.include(workHub);
    });

    it('toggle adds qaap-mod-preview-maximized to scope roots and updates the button', () => {
        const previewRoot = document.createElement('div');
        previewRoot.className = 'qaap-agent-preview-embedded';
        document.body.append(previewRoot);

        const toDispose = new DisposableCollection();
        const { button, controller } = createPreviewMaximizeControl({
            getPreviewRoot: () => previewRoot,
            toDispose,
        });

        expect(button.getAttribute('aria-label')).to.equal('Maximize');
        expect(button.querySelector('svg')).to.exist;

        button.click();
        expect(controller.isMaximized()).to.equal(true);
        expect(previewRoot.classList.contains(Style.PREVIEW_MAXIMIZED)).to.equal(true);
        expect(document.body.classList.contains(Style.PREVIEW_MAXIMIZED)).to.equal(true);
        expect(button.getAttribute('aria-label')).to.equal('Restore');
        expect(button.getAttribute('aria-pressed')).to.equal('true');

        button.click();
        expect(controller.isMaximized()).to.equal(false);
        expect(previewRoot.classList.contains(Style.PREVIEW_MAXIMIZED)).to.equal(false);
        expect(document.body.classList.contains(Style.PREVIEW_MAXIMIZED)).to.equal(false);
        expect(button.getAttribute('aria-label')).to.equal('Maximize');

        toDispose.dispose();
    });

    it('dispose clears maximized chrome state', () => {
        const previewRoot = document.createElement('div');
        previewRoot.className = 'qaap-agent-preview-embedded';
        document.body.append(previewRoot);

        const controller = new QaapPreviewMaximizeController(() => previewRoot);
        controller.setMaximized(true);
        expect(document.body.classList.contains(Style.PREVIEW_MAXIMIZED)).to.equal(true);

        controller.dispose();
        expect(document.body.classList.contains(Style.PREVIEW_MAXIMIZED)).to.equal(false);
        expect(previewRoot.classList.contains(Style.PREVIEW_MAXIMIZED)).to.equal(false);
    });

    it('syncPreviewMaximizeButton swaps icons for maximize vs restore', () => {
        const button = createPreviewMaximizeButton(new QaapPreviewMaximizeController(() => document.createElement('div')));
        syncPreviewMaximizeButton(button, false);
        const maximizePaths = [...button.querySelectorAll('path')].map(node => node.getAttribute('d'));
        expect(maximizePaths).to.deep.equal([
            'M15 3h6v6',
            'm21 3-7 7',
            'm3 21 7-7',
            'M9 21H3v-6',
        ]);

        syncPreviewMaximizeButton(button, true);
        expect(button.getAttribute('aria-label')).to.equal('Restore');
        const restorePaths = [...button.querySelectorAll('path')].map(node => node.getAttribute('d'));
        expect(restorePaths).to.have.length(8);
    });

    it('workbench controls host Maximize then Edit with no DOM separator between them', () => {
        const previewRoot = document.createElement('div');
        previewRoot.className = 'qaap-agent-preview-embedded';
        const workbench = document.createElement('div');
        workbench.className = 'theia-mini-browser-workbench-controls';
        previewRoot.append(workbench);
        document.body.append(previewRoot);

        const toDispose = new DisposableCollection();
        const { button: maximizeBtn } = createPreviewMaximizeControl({
            getPreviewRoot: () => previewRoot,
            toDispose,
        });
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.classList.add('theia-mini-browser-workbench-button', 'qaap-preview-edit-button');
        workbench.append(maximizeBtn, editBtn);

        expect([...workbench.children].map(node => node.nodeName)).to.deep.equal(['BUTTON', 'BUTTON']);
        expect(workbench.querySelectorAll('[role="separator"], hr, .separator, .divider').length).to.equal(0);
        expect(maximizeBtn.nextElementSibling).to.equal(editBtn);
        expect(maximizeBtn.classList.contains(Style.TOOLBAR_MAXIMIZE)).to.equal(true);
        expect(editBtn.classList.contains('qaap-preview-edit-button')).to.equal(true);

        toDispose.dispose();
    });
});
