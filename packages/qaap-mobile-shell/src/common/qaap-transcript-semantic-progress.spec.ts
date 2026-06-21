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

    it('buildTranscriptSemanticProgressKey tracks thinking and active tool output', () => {
        const thinking: TranscriptSemanticProgressSegment[] = [
            { type: 'thinking', content: 'long internal plan that keeps growing' },
        ];
        expect(buildTranscriptSemanticProgressKey(thinking))
            .to.equal(`0:0:0:${thinking[0].content!.length}:0`);
        const withTool: TranscriptSemanticProgressSegment[] = [
            { type: 'thinking', content: 'a' },
            { type: 'tool', finished: false },
        ];
        expect(buildTranscriptSemanticProgressKey(withTool)).to.equal('1:0:0:1:0');
        expect(buildTranscriptSemanticProgressKey([
            { type: 'text', content: 'Hello' },
        ])).to.equal('0:0:5:0:0');
        expect(buildTranscriptSemanticProgressKey([
            { type: 'tool', finished: false, result: 'partial output' },
        ])).to.equal('1:0:0:0:14');
    });

    it('advanceTranscriptSemanticProgressClock moves on thinking and tool output changes', () => {
        const start = seedTranscriptSemanticProgressClock(1_000);
        const thinkingOnly = advanceTranscriptSemanticProgressClock(
            [{ type: 'thinking', content: 'still planning' }],
            start,
            20_000,
        );
        expect(thinkingOnly.at).to.equal(20_000);

        const thinkingGrowth = advanceTranscriptSemanticProgressClock(
            [{ type: 'thinking', content: 'still planning more' }],
            thinkingOnly,
            21_000,
        );
        expect(thinkingGrowth.at).to.equal(21_000);

        const withTool = advanceTranscriptSemanticProgressClock(
            [{ type: 'tool', finished: false }],
            thinkingGrowth,
            22_000,
        );
        expect(withTool.at).to.equal(22_000);
    });
});
