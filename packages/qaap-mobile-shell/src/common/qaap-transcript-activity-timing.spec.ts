// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    formatTranscriptActivityStepDuration,
    excerptTranscriptToolError,
} from './qaap-transcript-activity-step-state';
import { TranscriptActivityTimingStore, formatTranscriptActivityStepMeta, formatTranscriptActivityStepRelativeTime } from './qaap-transcript-activity-timing';

describe('qaap-transcript-activity-step-state', () => {

    it('formats sub-10s durations with one decimal', () => {
        expect(formatTranscriptActivityStepDuration(2400)).to.equal('2.4s');
    });

    it('excerpts the first non-empty error line', () => {
        expect(excerptTranscriptToolError('\n\nPort 3000 already in use\nmore detail'))
            .to.equal('Port 3000 already in use');
    });
});

describe('qaap-transcript-activity-timing', () => {

    it('tracks client-side duration until a tool finishes', () => {
        const store = new TranscriptActivityTimingStore();
        const segments = [
            { type: 'tool' as const, name: 'bash', args: '{}', finished: false, toolUseId: '1' },
        ];
        store.observe('msg-1', segments, 1000);
        expect(store.resolveDurationMs('msg-1', 0, segments[0], 3500)).to.equal(2500);
        const finished = [{ ...segments[0], finished: true }];
        store.observe('msg-1', finished, 4000);
        expect(store.resolveDurationMs('msg-1', 0, finished[0])).to.equal(3000);
    });

    it('prefers wire timestamps when the backend supplies them', () => {
        const store = new TranscriptActivityTimingStore();
        const segment = {
            type: 'tool' as const,
            name: 'read_file',
            args: '{}',
            finished: true,
            toolUseId: '1',
            startedAt: 1000,
            finishedAt: 4500,
        };
        store.observe('msg-2', [segment], 9000);
        expect(store.resolveDurationMs('msg-2', 0, segment)).to.equal(3500);
        expect(store.resolveTimestamp('msg-2', 0, segment)).to.equal(4500);
    });

    it('joins duration and relative timestamps in step meta', () => {
        const now = 600_000;
        expect(formatTranscriptActivityStepMeta(2400, 570_000, now)).to.equal('2.4s · just now');
        expect(formatTranscriptActivityStepRelativeTime(570_000, now)).to.equal('just now');
        expect(formatTranscriptActivityStepRelativeTime(420_000, now)).to.equal('3m ago');
    });
});
