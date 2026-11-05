// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { buildAutoApprovePatch } from '../common/mobile-projects-auto-approve-patch';

/** The Auto-approve switch saves the switch and the approval policy together, so the chip never disagrees with it. */
describe('mobile-projects-conversation-actions-ui auto-approve patch', () => {

    it('switch off sends autoApprove false and request-approval', () => {
        expect(buildAutoApprovePatch(false)).to.deep.equal({ autoApprove: false, approvalPolicyId: 'request-approval' });
    });

    it('switch on sends autoApprove true and approve-for-me', () => {
        expect(buildAutoApprovePatch(true)).to.deep.equal({ autoApprove: true, approvalPolicyId: 'approve-for-me' });
    });
});
