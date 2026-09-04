// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableJSDOM = enableJSDOM();

import { createEmptyAgentModelsCta } from './qaap-agent-sheet-empty-models-cta';

describe('createEmptyAgentModelsCta', () => {
    after(() => disableJSDOM());

    it('shows Open AI Features when the catalog needs API keys', () => {
        let opened = false;
        const node = createEmptyAgentModelsCta({
            settingsCatalog: true,
            onOpenAiFeatures: () => { opened = true; },
        });
        expect(node.querySelector('.theia-qaap-agent-sheet-empty-models')?.textContent)
            .to.contain('AI Features');
        const button = node.querySelector<HTMLButtonElement>('.theia-qaap-agent-sheet-open-ai-features');
        expect(button).to.exist;
        expect(button!.textContent).to.equal('Open AI Features');
        button!.click();
        expect(opened).to.equal(true);
    });

    it('omits the CTA when there is no open handler', () => {
        const node = createEmptyAgentModelsCta({ settingsCatalog: true });
        expect(node.querySelector('.theia-qaap-agent-sheet-open-ai-features')).to.equal(null);
    });

    it('uses the agent-empty copy without a settings button', () => {
        const node = createEmptyAgentModelsCta({
            settingsCatalog: false,
            emptyAgentMessage: 'No models available.',
            onOpenAiFeatures: () => undefined,
        });
        expect(node.textContent).to.equal('No models available.');
        expect(node.querySelector('.theia-qaap-agent-sheet-open-ai-features')).to.equal(null);
    });
});
