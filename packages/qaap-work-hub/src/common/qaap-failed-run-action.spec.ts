// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { localizeGenericAgentFailureMessage } from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';
import { resolveQaapFailedRunAction } from './qaap-failed-run-action';

describe('resolveQaapFailedRunAction', () => {
    it('continues turns that were interrupted rather than failed', () => {
        for (const lastMessageError of [
            'Agent interrupted',
            'Stopped automatically after 46 min: the turn exceeded the maximum allowed time.',
            localizeGenericAgentFailureMessage('interrupted'),
        ]) {
            expect(resolveQaapFailedRunAction({ lastMessageError }), lastMessageError).to.equal('continue');
        }
    });

    it('retries real failures and failures without a recorded error', () => {
        expect(resolveQaapFailedRunAction({ lastMessageError: 'Bash exited with code 1.' })).to.equal('retry');
        expect(resolveQaapFailedRunAction({ lastMessageError: 'Agent failed (exit 1)' })).to.equal('retry');
        expect(resolveQaapFailedRunAction({})).to.equal('retry');
    });
});
