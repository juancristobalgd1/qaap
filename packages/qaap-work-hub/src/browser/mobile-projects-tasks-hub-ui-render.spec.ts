// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { MobileProjectsTasksHubUiContext } from './mobile-projects-tasks-hub-ui-context';
import { createAgentsHubQuickActionsBlockExtracted } from './mobile-projects-tasks-hub-ui-render';

let disableJSDOM = enableJSDOM();

// Each suite (re-)enables its own DOM: another spec's disableJSDOM() deletes the shared globals.

describe('mobile-projects-tasks-hub-ui-render', () => {

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });
    it('turns Run app into a busy colored action immediately when pressed', () => {
        let launched = false;
        const block = createAgentsHubQuickActionsBlockExtracted({
            host: {
                transcriptPreviewRequestRunning: false,
                transcriptPreviewRequestPending: false,
                transcriptOpenProject: { id: 'project' },
                transcriptComposerProject: undefined,
                transcriptOpenSummary: { id: 'summary' },
                transcriptComposerSummary: undefined,
                transcriptStickyComposerUi: {
                    launchComposerDevPreview: () => { launched = true; },
                },
            },
            applyComposerQuickActionPrompt: () => undefined,
        } as unknown as MobileProjectsTasksHubUiContext);
        const runApp = Array.from(block.querySelectorAll<HTMLButtonElement>('button')).find(button =>
            button.textContent?.trim() === 'Run app');

        expect(runApp).to.not.equal(undefined);
        runApp?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));

        expect(launched).to.equal(true);
        expect(runApp?.textContent).to.include('Starting preview…');
        expect(runApp?.disabled).to.equal(true);
        expect(runApp?.classList.contains('theia-mod-preview-starting')).to.equal(true);
        expect(runApp?.getAttribute('aria-busy')).to.equal('true');
        expect(runApp?.querySelector('.codicon-loading')).to.not.equal(null);
        expect(runApp?.querySelector('.qaap-border-beam-bloom')).to.not.equal(null);
    });

    it('renders Run app as a busy action while preview startup is pending', () => {
        const block = createAgentsHubQuickActionsBlockExtracted({
            host: {
                transcriptPreviewRequestRunning: true,
                transcriptPreviewRequestPending: false,
                transcriptOpenProject: undefined,
                transcriptComposerProject: undefined,
            },
            applyComposerQuickActionPrompt: () => undefined,
        } as unknown as MobileProjectsTasksHubUiContext);
        const runApp = Array.from(block.querySelectorAll('button')).find(button =>
            button.textContent?.includes('Starting preview…'));

        expect(runApp).to.not.equal(undefined);
        expect(runApp?.disabled).to.equal(true);
        expect(runApp?.classList.contains('theia-mod-preview-starting')).to.equal(true);
        expect(runApp?.getAttribute('aria-busy')).to.equal('true');
        expect(runApp?.querySelector('.codicon-loading')).to.not.equal(null);
        expect(runApp?.querySelector('.qaap-border-beam-bloom')).to.not.equal(null);
    });
});
