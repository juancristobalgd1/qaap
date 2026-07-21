// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import {
    createModeSheetOptionButton,
    populateAgentToolbarButton,
    populateApprovalPolicyToolbarButton,
    populateModeToolbarButton,
    resolveAgentDisplayLabel,
} from './qaap-agent-ui';
import { resolveAgentApprovalPolicyOption } from '../common/qaap-sticky-composer-approval-policy';
import { QAIQ_AGENT_ID } from '../common/qaap-agent-task-client';

describe('qaap-agent-ui', () => {

    it('resolveAgentDisplayLabel prefers brand label then fallback', () => {
        expect(resolveAgentDisplayLabel('codex')).to.equal('Codex');
        expect(resolveAgentDisplayLabel('unknown', 'Custom')).to.equal('Custom');
        expect(resolveAgentDisplayLabel(QAIQ_AGENT_ID)).to.equal('QAIQ');
    });

    it('populateAgentToolbarButton shows short model name with provider badge, not vendor text', () => {
        const button = document.createElement('button');
        populateAgentToolbarButton(button, {
            agentId: 'shell',
            label: '@shell',
            agentModel: { vendor: 'openrouter', modelId: 'tencent/hy3:free' },
        });
        expect(button.querySelector('.theia-mobile-projects-sticky-composer-agent-label')?.textContent)
            .to.equal('hy3:free');
        expect(button.querySelector('.theia-mobile-projects-sticky-composer-agent-provider-badge .theia-qaap-llm-provider-icon'))
            .to.exist;
        expect(button.classList.contains('theia-mod-logo-only')).to.equal(false);
    });

    it('createModeSheetOptionButton prepends Lucide icon by mode id', () => {
        for (const modeId of ['agent', 'plan', 'ask'] as const) {
            const button = createModeSheetOptionButton({
                modeId,
                label: modeId,
                onSelect: () => undefined,
            });
            expect(button.querySelector('.theia-qaap-mode-sheet-icon svg')).to.exist;
            expect(button.querySelector('.theia-mobile-sticky-composer-sheet-option-label')?.textContent)
                .to.equal(modeId);
        }
    });

    it('populateModeToolbarButton shows Lucide icon, label, and chevron', () => {
        for (const modeId of ['agent', 'plan', 'ask'] as const) {
            const button = document.createElement('button');
            populateModeToolbarButton(button, { modeId, label: modeId });
            expect(button.querySelector('.theia-qaap-mode-sheet-icon svg')).to.exist;
            expect(button.querySelector('.theia-mobile-projects-sticky-composer-mode-label')?.textContent)
                .to.equal(modeId);
            expect(button.querySelector('.codicon-chevron-down')).to.exist;
        }
    });

    it('populateApprovalPolicyToolbarButton shows policy label beside shield icon', () => {
        const button = document.createElement('button');
        const policy = resolveAgentApprovalPolicyOption('approve-for-me');
        populateApprovalPolicyToolbarButton(button, policy);
        expect(button.querySelector('.theia-qaap-approval-policy-toolbar-icon.codicon-shield')).to.exist;
        expect(button.querySelector('.theia-mobile-projects-sticky-composer-approval-policy-label')?.textContent)
            .to.equal(policy.label);
        expect(button.querySelector('.codicon-chevron-down')).to.exist;
    });
});
