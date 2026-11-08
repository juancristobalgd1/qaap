// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveTaskAutoApproveFromPolicy } from './qaap-agent-auto-approve';
import { patchConversationAutoApprove } from './qaap-agent-conversation-auto-approve';

describe('explicit approval policy decides auto-approve', () => {

    let savedEnv: string | undefined;
    beforeEach(() => {
        savedEnv = process.env.QAAP_AGENT_AUTO_APPROVE;
        delete process.env.QAAP_AGENT_AUTO_APPROVE;
    });
    afterEach(() => {
        if (savedEnv === undefined) {
            delete process.env.QAAP_AGENT_AUTO_APPROVE;
        } else {
            process.env.QAAP_AGENT_AUTO_APPROVE = savedEnv;
        }
    });

    describe('resolveTaskAutoApproveFromPolicy', () => {
        it('approve-for-me ignores an inherited false', () => {
            expect(resolveTaskAutoApproveFromPolicy('approve-for-me', false)).to.equal(true);
        });

        it('full-access ignores an inherited false', () => {
            expect(resolveTaskAutoApproveFromPolicy('full-access', false)).to.equal(true);
        });

        it('request-approval is always false, even with an inherited true', () => {
            expect(resolveTaskAutoApproveFromPolicy('request-approval', true)).to.equal(false);
            expect(resolveTaskAutoApproveFromPolicy('request-approval', undefined)).to.equal(false);
        });

        it('QAAP_AGENT_AUTO_APPROVE=0 still turns explicit autonomous policies off', () => {
            process.env.QAAP_AGENT_AUTO_APPROVE = '0';
            expect(resolveTaskAutoApproveFromPolicy('approve-for-me', false)).to.equal(false);
        });

        it('without an explicit policy the inherited value decides', () => {
            expect(resolveTaskAutoApproveFromPolicy(undefined, false)).to.equal(false);
            expect(resolveTaskAutoApproveFromPolicy(undefined, undefined)).to.equal(true);
            expect(resolveTaskAutoApproveFromPolicy(undefined, true)).to.equal(true);
        });
    });

    describe('patchConversationAutoApprove', () => {
        it('a turn with approve-for-me clears a stored false', () => {
            expect(patchConversationAutoApprove({ autoApprove: false }, undefined, 'approve-for-me'))
                .to.deep.equal({ autoApprove: undefined });
        });

        it('a turn with request-approval stores false even when the composer said true', () => {
            expect(patchConversationAutoApprove({ autoApprove: undefined }, true, 'request-approval'))
                .to.deep.equal({ autoApprove: false });
        });

        it('a turn without a policy inherits the conversation value', () => {
            expect(patchConversationAutoApprove({ autoApprove: false })).to.deep.equal({ autoApprove: false });
            expect(patchConversationAutoApprove({ autoApprove: undefined })).to.deep.equal({ autoApprove: undefined });
        });
    });
});
