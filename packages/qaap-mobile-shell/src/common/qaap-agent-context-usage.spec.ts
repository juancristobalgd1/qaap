// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    estimateConversationContextBreakdown,
    estimateConversationTokensFromMessages,
    totalTokensFromContextUsage,
} from './qaap-agent-context-usage';

describe('qaap-agent-context-usage', () => {
    it('does not count the plain projection and structured segments twice', () => {
        const tokens = estimateConversationTokensFromMessages([{
            content: 'duplicated plain projection',
            segments: [{ type: 'text', content: '12345678' }],
        }]);
        expect(tokens).to.equal(2);
    });

    it('separates active prompt, compacted summary, and conversation estimates', () => {
        const breakdown = estimateConversationContextBreakdown(
            [
                { content: 'old message' },
                { content: '12345678' },
            ],
            '1234',
            { status: 'complete', summary: '12345678', compactedMessageCount: 1 },
        );
        expect(breakdown).to.deep.equal({
            promptContextTokens: 1,
            summarizedConversationTokens: 2,
            conversationTokens: 2,
            totalTokens: 5,
        });
    });

    it('includes provider-reported reasoning tokens in totals', () => {
        expect(totalTokensFromContextUsage({
            inputTokens: 10,
            outputTokens: 5,
            reasoningTokens: 3,
        })).to.equal(18);
    });
});
