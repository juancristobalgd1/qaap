// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { formatQaiqModelDisplayLabel } from '@theia/qaap-shared-core/lib/common/qaap-qaiq-model-catalog';
import { createAgentIdentityElement, populateAgentToolbarButton } from './qaap-agent-ui';

disableImportJSDOM();

describe('model chip label', () => {
    let disableJSDOM: () => void;
    beforeEach(() => { disableJSDOM = enableJSDOM(); });
    afterEach(() => disableJSDOM());

    it('prefers the catalog label over the raw slug', () => {
        expect(formatQaiqModelDisplayLabel({ modelId: 'opencode/big-pickle', label: 'Big Pickle' })).to.equal('Big Pickle');
    });

    it('resolves a catalog label from the id alone', () => {
        expect(formatQaiqModelDisplayLabel({ modelId: 'opencode/big-pickle' })).to.equal('Big Pickle');
        expect(formatQaiqModelDisplayLabel({ modelId: 'opencode/mimo-v2.5-free' })).to.equal('MiMo V2.5 Free');
    });

    it('falls back to the short slug for models the catalog does not know', () => {
        expect(formatQaiqModelDisplayLabel({ modelId: 'nvidia/llama-3.3-70b' })).to.equal('llama-3.3-70b');
        expect(formatQaiqModelDisplayLabel({ modelId: 'gpt-5.1', label: '  ' })).to.equal('gpt-5.1');
    });

    it('identity (sidebar rows) swaps a raw slug label for the catalog label', () => {
        const model = { vendor: 'opencode', modelId: 'opencode/big-pickle' };
        const identity = createAgentIdentityElement({ agentId: 'opencode', agentModel: model, label: model.modelId });
        expect(identity.querySelector('.theia-qaap-agent-identity-label')?.textContent).to.equal('Big Pickle');
    });

    it('composer chip shows the label and a Connect warning only when disconnected', () => {
        const model = { vendor: 'opencode', modelId: 'opencode/big-pickle' };
        const connected = document.createElement('button');
        populateAgentToolbarButton(connected, { agentId: 'opencode', label: 'OpenCode', agentModel: model, connectionState: 'connected' });
        expect(connected.textContent).to.contain('Big Pickle');
        expect(connected.querySelector('.theia-qaap-agent-disconnected-dot')).to.equal(null);

        const unknown = document.createElement('button');
        populateAgentToolbarButton(unknown, { agentId: 'opencode', label: 'OpenCode', agentModel: model, connectionState: 'unknown' });
        expect(unknown.querySelector('.theia-qaap-agent-connect-chip')).to.equal(null);

        const disconnected = document.createElement('button');
        populateAgentToolbarButton(disconnected, { agentId: 'opencode', label: 'OpenCode', agentModel: model, connectionState: 'disconnected' });
        expect(disconnected.querySelector('.theia-qaap-agent-disconnected-dot')).not.to.equal(null);
        expect(disconnected.querySelector('.theia-qaap-agent-connect-chip')?.textContent).to.equal('Connect');
        expect(disconnected.classList.contains('theia-mod-disconnected')).to.equal(true);
    });
});
