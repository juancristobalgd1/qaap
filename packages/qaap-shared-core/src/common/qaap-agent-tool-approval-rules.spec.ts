// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    DEFAULT_APPROVE_FOR_ME_TOOL_RULES,
    reconcileAgentToolApprovalRules,
} from './qaap-agent-tool-approval-rules';

describe('qaap-agent-tool-approval-rules', () => {

    it('reconcileAgentToolApprovalRules defaults shell on and network off for approve-for-me', () => {
        expect(reconcileAgentToolApprovalRules('approve-for-me', '/tmp/repo', undefined))
            .to.deep.equal(DEFAULT_APPROVE_FOR_ME_TOOL_RULES);
    });

    it('reconcileAgentToolApprovalRules enables all scopes for full-access', () => {
        expect(reconcileAgentToolApprovalRules('full-access', '/tmp/repo', undefined))
            .to.deep.equal({ shell: true, network: true });
    });

    it('approve-for-me ignores a stale shell:false left by Request approval', () => {
        expect(reconcileAgentToolApprovalRules('approve-for-me', '/tmp/repo', { shell: false, network: false }))
            .to.deep.equal({ shell: true, network: false });
    });

    it('approve-for-me does not inherit network:true from Full access', () => {
        expect(reconcileAgentToolApprovalRules('approve-for-me', '/tmp/repo', { shell: true, network: true }))
            .to.deep.equal({ shell: true, network: false });
    });

    it('approve-for-me returns a fresh object, not the shared default', () => {
        const rules = reconcileAgentToolApprovalRules('approve-for-me', '/tmp/repo', undefined);
        expect(rules).to.not.equal(DEFAULT_APPROVE_FOR_ME_TOOL_RULES);
    });

    it('request-approval keeps shell and network off', () => {
        expect(reconcileAgentToolApprovalRules('request-approval', '/tmp/repo', { shell: true, network: true }))
            .to.deep.equal({ shell: false, network: false });
    });
});
