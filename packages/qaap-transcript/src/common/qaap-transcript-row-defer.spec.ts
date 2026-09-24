// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { shouldDeferTranscriptRowHeavyContent } from './qaap-transcript-row-defer-math';

describe('qaap-transcript-row-defer', () => {

    it('shouldDeferTranscriptRowHeavyContent keeps the streaming tail eager', () => {
        expect(shouldDeferTranscriptRowHeavyContent({
            messageIndex: 4,
            messageCount: 5,
            conversationStreaming: true,
        })).to.equal(false);
    });

    it('shouldDeferTranscriptRowHeavyContent defers historical rows', () => {
        expect(shouldDeferTranscriptRowHeavyContent({
            messageIndex: 2,
            messageCount: 5,
            conversationStreaming: true,
        })).to.equal(true);
    });

    it('keeps the tail eager once the turn settles', () => {
        // Regression: keying the exemption on `conversationStreaming` un-exempted the answer
        // the moment it finished, so the next full render collapsed it to a ~180-char excerpt
        // and sprang back on hydration — a visible blink plus scroll jump at the end of every
        // turn, on exactly the row the reader is looking at.
        expect(shouldDeferTranscriptRowHeavyContent({
            messageIndex: 4,
            messageCount: 5,
            conversationStreaming: false,
        })).to.equal(false);
    });

    it('keeps the user turn above the settled answer eager too', () => {
        expect(shouldDeferTranscriptRowHeavyContent({
            messageIndex: 3,
            messageCount: 5,
            conversationStreaming: false,
        })).to.equal(false);
    });
});
