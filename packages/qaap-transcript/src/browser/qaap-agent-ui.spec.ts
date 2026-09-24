// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import {
    createModeSheetOptionButton,
    populateAgentToolbarButton,
    populateApprovalPolicyToolbarButton,
    populateModeToolbarButton,
    resolveAgentDisplayLabel,
} from '@theia/qaap-agents-ui/lib/browser/qaap-agent-ui';
import { resolveAgentApprovalPolicyOption } from '@theia/qaap-shared-core/lib/common/qaap-sticky-composer-approval-policy';
import { QAIQ_AGENT_ID } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { useSuiteJSDOM } from './test/qaap-jsdom-suite';

disableImportJSDOM();

describe('qaap-agent-ui', () => {

    useSuiteJSDOM();

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

    it('shows an optional intent label before the selected model', () => {
        const button = document.createElement('button');
        populateAgentToolbarButton(button, {
            agentId: 'shell',
            label: '@shell',
            agentModel: { vendor: 'openai', modelId: 'gpt-5.6-luna' },
            intentLabel: 'Next run',
        });

        const identity = button.querySelector('.theia-qaap-agent-identity');
        expect(identity?.querySelector('.theia-mobile-projects-sticky-composer-agent-intent')?.textContent)
            .to.equal('Next run');
        expect(identity?.querySelector('.theia-qaap-agent-identity-label')?.textContent)
            .to.equal('gpt-5.6-luna');
    });

    it('createModeSheetOptionButton prepends Lucide icon by mode id', () => {
        for (const modeId of ['agent', 'plan'] as const) {
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
        for (const modeId of ['agent', 'plan'] as const) {
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
