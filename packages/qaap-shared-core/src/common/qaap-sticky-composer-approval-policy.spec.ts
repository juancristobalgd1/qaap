// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isApprovalPolicyUnsupportedByAgent,
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

    it('shows Autonomous mode for a harness that cannot ask when the stored preset is Ask before changes', () => {
        expect(resolveEffectiveAgentApprovalPolicyId('request-approval', 'pi')).to.equal('approve-for-me');
        expect(resolveEffectiveAgentApprovalPolicyId('request-approval', 'codex')).to.equal('approve-for-me');
        expect(isApprovalPolicyUnsupportedByAgent('request-approval', 'pi')).to.equal(true);
    });

    it('keeps the stored preset for QAIQ and OpenClaude, which can ask', () => {
        expect(resolveEffectiveAgentApprovalPolicyId('request-approval', 'qaiq')).to.equal('request-approval');
        expect(resolveEffectiveAgentApprovalPolicyId('request-approval', 'openclaude')).to.equal('request-approval');
        expect(isApprovalPolicyUnsupportedByAgent('request-approval', 'qaiq')).to.equal(false);
    });

    it('leaves other presets unchanged for every harness', () => {
        expect(resolveEffectiveAgentApprovalPolicyId('full-access', 'pi')).to.equal('full-access');
        expect(resolveEffectiveAgentApprovalPolicyId('approve-for-me', 'pi')).to.equal('approve-for-me');
        expect(resolveEffectiveAgentApprovalPolicyId(undefined, 'pi')).to.equal(undefined);
    });

    it('toolbar chip shows Autonomous mode with a warning for pi and a stored Ask before changes', () => {
        const display = resolveApprovalPolicyToolbarDisplay('request-approval', { id: 'pi', label: 'Pi' });
        expect(display.policy.id).to.equal('approve-for-me');
        expect(display.policy.label).to.equal(resolveAgentApprovalPolicyOption('approve-for-me').label);
        expect(display.policy.label).to.not.equal(resolveAgentApprovalPolicyOption('request-approval').label);
        expect(display.unsupportedText).to.equal('Pi can\'t ask before changes yet.');
    });

    it('toolbar chip keeps Ask before changes with no warning for QAIQ', () => {
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
