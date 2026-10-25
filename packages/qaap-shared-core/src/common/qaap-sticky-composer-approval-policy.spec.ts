// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_AGENT_APPROVAL_POLICIES, resolveAgentApprovalPolicyOption, type QaapAgentApprovalPolicyId } from './qaap-sticky-composer-approval-policy';

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

});
