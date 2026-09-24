// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

let disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { createAnnotationComposerSessionControls } from './qaap-preview-annotation-composer-session';

disableJSDOM();

describe('qaap-preview-annotation-composer-session', () => {
    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    it('mounts a sticky-composer agent chip and opens the agent sheet on click', () => {
        let sheetOpens = 0;
        let appliedRefresh: (() => void) | undefined;
        const session = createAnnotationComposerSessionControls({
            resolveAgentId: () => 'codex',
            resolveAgentLabel: () => 'Codex',
            resolveAgentModel: () => ({ provider: 'openai', vendor: 'openai', modelId: 'gpt-5' }),
            onOpenAgentSheet: (_anchor, onSelectionApplied) => {
                sheetOpens += 1;
                appliedRefresh = onSelectionApplied;
            },
        });
        const host = document.createElement('div');
        const attachment = session.attach(host);

        const agentBtn = host.querySelector('.theia-mobile-projects-sticky-composer-agent') as HTMLButtonElement;
        expect(agentBtn).to.exist;
        expect(agentBtn.getAttribute('aria-haspopup')).to.equal('dialog');
        expect(agentBtn.title).to.contain('Codex');
        expect(agentBtn.title).to.contain('gpt-5');
        expect(agentBtn.querySelector('.theia-mobile-projects-sticky-composer-agent-label')).to.exist;

        agentBtn.click();
        expect(sheetOpens).to.equal(1);
        expect(appliedRefresh).to.be.a('function');

        attachment.dispose();
        expect(host.children).to.have.length(0);
    });

    it('locks the agent control for legacy Theia chat sessions', () => {
        let sheetOpens = 0;
        const session = createAnnotationComposerSessionControls({
            resolveAgentId: () => 'Universal',
            resolveAgentLabel: () => 'Universal',
            resolveAgentModel: () => undefined,
            agentLocked: true,
            onOpenAgentSheet: () => { sheetOpens += 1; },
        });
        const host = document.createElement('div');
        const attachment = session.attach(host);
        const agentBtn = host.querySelector('.theia-mobile-projects-sticky-composer-agent') as HTMLButtonElement;

        expect(agentBtn.disabled).to.equal(true);
        expect(agentBtn.classList.contains('theia-mod-locked')).to.equal(true);
        agentBtn.click();
        expect(sheetOpens).to.equal(0);

        attachment.dispose();
    });
});
