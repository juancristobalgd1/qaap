// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { createAgentsHubQuickActionsBlockExtracted } from './mobile-projects-tasks-hub-ui-render';

enableJSDOM();

describe('mobile-projects-tasks-hub-ui-render', () => {
    it('renders Run app as a busy action while preview startup is pending', () => {
        const block = createAgentsHubQuickActionsBlockExtracted({
            host: {
                transcriptPreviewRequestRunning: true,
                transcriptPreviewRequestPending: false,
                transcriptOpenProject: undefined,
                transcriptComposerProject: undefined,
            },
            applyComposerQuickActionPrompt: () => undefined,
        });
        const runApp = Array.from(block.querySelectorAll('button')).find(button =>
            button.textContent?.includes('Starting preview…'));

        expect(runApp).to.not.equal(undefined);
        expect(runApp?.disabled).to.equal(true);
        expect(runApp?.classList.contains('theia-mod-preview-starting')).to.equal(true);
        expect(runApp?.getAttribute('aria-busy')).to.equal('true');
        expect(runApp?.querySelector('.codicon-loading')).to.not.equal(null);
    });
});
