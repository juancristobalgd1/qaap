// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isApprovalPolicyUnsupportedByAgent,
    resolveApprovalPolicyUnsupportedMode,
    QAAP_AGENT_APPROVAL_POLICIES,
    resolveAgentApprovalPolicyOption,
    resolveApprovalPolicyToolbarDisplay,
    resolveEffectiveAgentApprovalPolicyId,
    type QaapAgentApprovalPolicyId,
} from './qaap-sticky-composer-approval-policy';

describe('qaap-sticky-composer-approval-policy', () => {

    it('keeps the internal policy ids and shows the requested labels, descriptions and icons', () => {
        const expected: { readonly id: QaapAgentApprovalPolicyId; readonly label: string; readonly description: string; readonly icon: string }[] = [
            {
                id: 'request-approval',
                label: 'Ask before changes',
                description: 'Ask before file changes.',
                icon: 'codicon-debug-pause',
            },
            {
                id: 'approve-for-me',
                label: 'Autonomous mode',
                description: 'Ask when there\'s risk.',
                icon: 'codicon-workspace-trusted',
            },
            {
                id: 'full-access',
                label: 'Full access',
                description: 'Run with fewer confirmations.',
                icon: 'codicon-workspace-untrusted',
            },
        ];
        expect(QAAP_AGENT_APPROVAL_POLICIES.map(policy => policy.id)).to.deep.equal(expected.map(policy => policy.id));
        for (const policy of expected) {
            const option = resolveAgentApprovalPolicyOption(policy.id);
            expect(option.label).to.equal(policy.label);
            expect(option.description).to.equal(policy.description);
            expect(option.toolbarIconClass).to.equal(policy.icon);
            expect(option.sheetIconClass).to.equal(policy.icon);
        }
    });

    it('shows Autonomous mode only for a harness that runs every action unchecked (custom agents)', () => {
        expect(resolveEffectiveAgentApprovalPolicyId('request-approval', 'my-custom-agent')).to.equal('approve-for-me');
        expect(resolveApprovalPolicyUnsupportedMode('request-approval', 'my-custom-agent')).to.equal('runs-unchecked');
        expect(isApprovalPolicyUnsupportedByAgent('request-approval', 'my-custom-agent')).to.equal(true);
    });

    it('keeps Ask before changes for Pi, which asks through the gate extension', () => {
        expect(resolveEffectiveAgentApprovalPolicyId('request-approval', 'pi')).to.equal('request-approval');
        expect(resolveApprovalPolicyUnsupportedMode('request-approval', 'pi')).to.equal(undefined);
        expect(isApprovalPolicyUnsupportedByAgent('request-approval', 'pi')).to.equal(false);
    });

    it('keeps Ask before changes for Claude Code, which asks over the stdio gate', () => {
        expect(resolveEffectiveAgentApprovalPolicyId('request-approval', 'claude')).to.equal('request-approval');
        expect(resolveApprovalPolicyUnsupportedMode('request-approval', 'claude')).to.equal(undefined);
        expect(isApprovalPolicyUnsupportedByAgent('request-approval', 'claude')).to.equal(false);
    });

    it('keeps Ask before changes for a harness that refuses gated actions (opencode)', () => {
        for (const id of ['opencode']) {
            expect(resolveEffectiveAgentApprovalPolicyId('request-approval', id), id).to.equal('request-approval');
            expect(resolveApprovalPolicyUnsupportedMode('request-approval', id), id).to.equal('refuses');
        }
    });

    it('keeps Ask before changes for Codex without a warning: its PreToolUse hook can ask', () => {
        expect(resolveEffectiveAgentApprovalPolicyId('request-approval', 'codex')).to.equal('request-approval');
        expect(resolveApprovalPolicyUnsupportedMode('request-approval', 'codex')).to.equal(undefined);
    });

    it('treats an unknown harness as runs-unchecked', () => {
        expect(resolveApprovalPolicyUnsupportedMode('request-approval', 'my-custom-agent')).to.equal('runs-unchecked');
        expect(resolveEffectiveAgentApprovalPolicyId('request-approval', 'my-custom-agent')).to.equal('approve-for-me');
    });

    it('keeps the stored preset for QAIQ and OpenClaude, which can ask', () => {
        expect(resolveEffectiveAgentApprovalPolicyId('request-approval', 'qaiq')).to.equal('request-approval');
        expect(resolveEffectiveAgentApprovalPolicyId('request-approval', 'openclaude')).to.equal('request-approval');
        expect(resolveApprovalPolicyUnsupportedMode('request-approval', 'qaiq')).to.equal(undefined);
        expect(isApprovalPolicyUnsupportedByAgent('request-approval', 'qaiq')).to.equal(false);
    });

    it('leaves other presets unchanged for every harness', () => {
        expect(resolveEffectiveAgentApprovalPolicyId('full-access', 'pi')).to.equal('full-access');
        expect(resolveEffectiveAgentApprovalPolicyId('approve-for-me', 'pi')).to.equal('approve-for-me');
        expect(resolveEffectiveAgentApprovalPolicyId(undefined, 'pi')).to.equal(undefined);
    });

    it('toolbar chip for a custom agent shows Autonomous mode with the runs-unchecked warning', () => {
        const display = resolveApprovalPolicyToolbarDisplay('request-approval', { id: 'my-custom-agent', label: 'Custom' });
        expect(display.policy.id).to.equal('approve-for-me');
        expect(display.unsupportedText).to.equal('Custom can\'t ask before changes yet; it runs every action without asking.');
    });

    it('toolbar chip for pi keeps Ask before changes with no warning', () => {
        const display = resolveApprovalPolicyToolbarDisplay('request-approval', { id: 'pi', label: 'Pi' });
        expect(display.policy.id).to.equal('request-approval');
        expect(display.unsupportedText).to.equal(undefined);
    });

    it('toolbar chip for claude keeps Ask before changes with no warning', () => {
        const display = resolveApprovalPolicyToolbarDisplay('request-approval', { id: 'claude', label: 'Claude Code' });
        expect(display.policy.id).to.equal('request-approval');
        expect(display.unsupportedText).to.equal(undefined);
    });

    it('toolbar chip for QAIQ keeps Ask before changes with no warning', () => {
        const display = resolveApprovalPolicyToolbarDisplay('request-approval', { id: 'qaiq', label: 'QAIQ' });
        expect(display.policy.id).to.equal('request-approval');
        expect(display.unsupportedText).to.equal(undefined);
    });

    it('keeps the stored preset without a warning when no agent is given', () => {
        expect(resolveApprovalPolicyToolbarDisplay('full-access', { id: 'pi', label: 'Pi' }).unsupportedText).to.equal(undefined);
        expect(resolveApprovalPolicyToolbarDisplay('request-approval', undefined).policy.id).to.equal('request-approval');
        expect(resolveEffectiveAgentApprovalPolicyId('request-approval', '')).to.equal('request-approval');
    });
});
