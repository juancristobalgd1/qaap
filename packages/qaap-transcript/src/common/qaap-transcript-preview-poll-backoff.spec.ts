// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { transcriptPreviewProbeBackoffMs } from '@theia/qaap-shared-core/lib/common/qaap-transcript-preview-offer';
import { nextTranscriptPreviewPollMisses } from './qaap-transcript-preview-poll-backoff';

describe('nextTranscriptPreviewPollMisses', () => {
    const opened = 'http://abc.localhost:3000/';

    it('backs off while the probe keeps finding the preview that is already open', () => {
        let misses = nextTranscriptPreviewPollMisses(0, opened, undefined);
        expect(misses).to.equal(0);
        const delays: number[] = [];
        for (let i = 0; i < 6; i++) {
            misses = nextTranscriptPreviewPollMisses(misses, opened, opened);
            delays.push(transcriptPreviewProbeBackoffMs(misses, 900, 30_000));
        }
        // Before: every unchanged answer reset to 900 ms (one sweep per second for the whole window).
        expect(delays).to.deep.equal([1800, 3600, 7200, 14400, 28800, 30000]);
    });

    it('resets for a newly ready URL and keeps backing off when nothing answers', () => {
        expect(nextTranscriptPreviewPollMisses(5, 'http://new.localhost:3000/', opened)).to.equal(0);
        expect(nextTranscriptPreviewPollMisses(2, undefined, opened)).to.equal(3);
    });
});
