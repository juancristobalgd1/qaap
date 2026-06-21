// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    advanceTranscriptSemanticProgressClock,
    buildTranscriptSemanticProgressKey,
    seedTranscriptSemanticProgressClock,
    type TranscriptSemanticProgressSegment,
} from './qaap-transcript-semantic-progress';

describe('qaap-transcript-semantic-progress', () => {

    it('buildTranscriptSemanticProgressKey ignores thinking segments', () => {
        const thinking: TranscriptSemanticProgressSegment[] = [
            { type: 'thinking', content: 'long internal plan that keeps growing' },
        ];
        expect(buildTranscriptSemanticProgressKey(thinking)).to.equal('0:0:0');
        const withTool: TranscriptSemanticProgressSegment[] = [
            { type: 'thinking', content: 'a' },
            { type: 'tool', finished: false },
        ];
        expect(buildTranscriptSemanticProgressKey(withTool)).to.equal('1:0:0');
        expect(buildTranscriptSemanticProgressKey([
            { type: 'text', content: 'Hello' },
        ])).to.equal('0:0:5');
    });

    it('advanceTranscriptSemanticProgressClock only moves on tool/text changes', () => {
        const start = seedTranscriptSemanticProgressClock(1_000);
        const thinkingOnly = advanceTranscriptSemanticProgressClock(
            [{ type: 'thinking', content: 'still planning' }],
            start,
            20_000,
        );
        expect(thinkingOnly.at).to.equal(1_000);

        const withTool = advanceTranscriptSemanticProgressClock(
            [{ type: 'tool', finished: false }],
            thinkingOnly,
            21_000,
        );
        expect(withTool.at).to.equal(21_000);
    });
});
