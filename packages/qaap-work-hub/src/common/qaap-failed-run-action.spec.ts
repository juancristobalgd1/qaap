// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { localizeAgentTurnTimeoutMessage, localizeGenericAgentFailureMessage } from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';
import { resolveQaapFailedRunAction } from './qaap-failed-run-action';

describe('resolveQaapFailedRunAction', () => {
    it('offers Continue on a turn the watchdog paused, whose reason itself says Continue', () => {
        for (const lastMessageError of [
            // Exact copy the turn watchdog records (`buildQaapTurnWatchdogMessage`).
            'Timed out after 15 minutes without output. Continue picks it up again.',
            'Timed out at the 120-minute task limit. Continue picks it up again.',
            'Waited 24 hours for your approval. Continue picks it up again.',
            localizeAgentTurnTimeoutMessage('idle', 15),
            localizeAgentTurnTimeoutMessage('max_duration', 120),
        ]) {
            expect(resolveQaapFailedRunAction({ lastMessageError }), lastMessageError).to.equal('continue');
        }
    });

    it('continues the other interrupted turns: restart, legacy watchdog stop, legacy interrupted copy', () => {
        for (const lastMessageError of [
            'The backend restarted while this turn was in progress, so it was interrupted. Continue picks it up again.',
            // Copies persisted before the wording pointed at Continue.
            'The backend restarted while this turn was in progress, so it was interrupted. Retry to continue.',
            'Timed out after 15 minutes without output. Continue runs it again from your original request.',
            'Stopped automatically after 46 min: the turn exceeded the maximum allowed time.',
            'Agent interrupted',
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
