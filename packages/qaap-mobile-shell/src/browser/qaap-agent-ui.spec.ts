// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { populateAgentToolbarButton, resolveAgentDisplayLabel } from './qaap-agent-ui';
import { QAIQ_AGENT_ID } from '../common/qaap-agent-task-client';

describe('qaap-agent-ui', () => {

    it('resolveAgentDisplayLabel prefers brand label then fallback', () => {
        expect(resolveAgentDisplayLabel('codex')).to.equal('Codex');
        expect(resolveAgentDisplayLabel('unknown', 'Custom')).to.equal('Custom');
        expect(resolveAgentDisplayLabel(QAIQ_AGENT_ID)).to.equal('QAIQ');
    });

    it('populateAgentToolbarButton shows model id with provider badge, not vendor text', () => {
        const button = document.createElement('button');
        populateAgentToolbarButton(button, {
            agentId: 'shell',
            label: '@shell',
            agentModel: { vendor: 'openrouter', modelId: 'tencent/hy3:free' },
        });
        expect(button.querySelector('.theia-mobile-projects-sticky-composer-agent-label')?.textContent)
            .to.equal('tencent/hy3:free');
        expect(button.querySelector('.theia-mobile-projects-sticky-composer-agent-provider-badge .theia-qaap-llm-provider-icon'))
            .to.exist;
        expect(button.classList.contains('theia-mod-logo-only')).to.equal(false);
    });
});
