// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveCompletedTurnAuthFailureReason } from './qaap-agent-conversation-store-helpers';

describe('completed turn with an auxiliary-model quota line', () => {

    const titleQuotaLine = '2026-11-11T13:10:18.406Z ERROR run=7f3f3ab2 message="stream error" providerID=opencode modelID=gpt-5.4-nano small=true agent=title mode=primary error.error="AI_APICallError: You exceeded your current quota, please check your plan and billing details."';

    it('a clean exit (exit 0) whose only quota line is the title agent is delivered, not a failed turn', () => {
        const log = [
            '2026-11-11T13:10:17.000Z INFO run=7f3f3ab2 message="prompt" providerID=opencode modelID=beam-free mode=primary',
            titleQuotaLine,
            '{"type":"step_finish","reason":"stop"}',
        ].join('\n');
        expect(resolveCompletedTurnAuthFailureReason(log, 'opencode')).to.equal(undefined);
    });
});
