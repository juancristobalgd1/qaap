// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    formatTranscriptActivityStepDuration,
    excerptTranscriptToolError,
} from './qaap-transcript-activity-step-state';
import {
    TranscriptActivityTimingStore,
    formatTranscriptActivityStepDurationSuffix,
    formatTranscriptActivityStepMeta,
    formatTranscriptActivityStepRelativeTime,
} from './qaap-transcript-activity-timing';

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

    it('tracks live and settled thinking segment duration', () => {
        const store = new TranscriptActivityTimingStore();
        const thinking = { type: 'thinking' as const, content: 'planning' };
        store.observe('msg-3', [thinking], 1000, { streaming: true });
        expect(store.resolveDurationMs('msg-3', 0, thinking, 4200)).to.equal(3200);
        store.observe('msg-3', [
            thinking,
            { type: 'tool' as const, name: 'read_file', args: '{}', finished: false, toolUseId: '1' },
        ], 5000, { streaming: true });
        expect(store.resolveDurationMs('msg-3', 0, thinking)).to.equal(4000);
        expect(store.resolveTimestamp('msg-3', 0, thinking)).to.equal(5000);
    });

    it('sums grouped thinking durations via navigation resolveStepDurationMs', () => {
        const store = new TranscriptActivityTimingStore();
        const first = { type: 'thinking' as const, content: 'Plan A' };
        const second = { type: 'thinking' as const, content: 'Plan B' };
        store.observe('msg-4', [first], 1000, { streaming: true });
        store.observe('msg-4', [first, second], 2500, { streaming: true });
        store.observe('msg-4', [
            first,
            second,
            { type: 'tool' as const, name: 'read_file', args: '{}', finished: true, toolUseId: '1' },
        ], 6000, { streaming: false });
        expect(store.resolveDurationMs('msg-4', 0, first)).to.equal(1500);
        expect(store.resolveDurationMs('msg-4', 1, second)).to.equal(3500);
    });

    it('skips cold-loaded settled thinking without client timing', () => {
        const store = new TranscriptActivityTimingStore();
        const thinking = { type: 'thinking' as const, content: 'done planning' };
        store.observe('msg-5', [thinking], 9000, { streaming: false });
        expect(store.resolveDurationMs('msg-5', 0, thinking)).to.equal(undefined);
    });

    it('skips cold-loaded finished tools without wire timestamps', () => {
        const store = new TranscriptActivityTimingStore();
        const tool = {
            type: 'tool' as const,
            name: 'read_file',
            args: '{}',
            finished: true,
            toolUseId: '1',
        };
        store.observe('msg-6', [tool], 9000);
        expect(store.resolveDurationMs('msg-6', 0, tool)).to.equal(undefined);
    });

    it('joins duration and relative timestamps in step meta', () => {
        const now = 600_000;
        expect(formatTranscriptActivityStepMeta(2400, 570_000, now)).to.equal('2.4s · just now');
        expect(formatTranscriptActivityStepRelativeTime(570_000, now)).to.equal('just now');
        expect(formatTranscriptActivityStepRelativeTime(420_000, now)).to.equal('3m ago');
    });

    it('formats cursor-trace duration suffix', () => {
        expect(formatTranscriptActivityStepDurationSuffix(undefined)).to.equal(undefined);
        expect(formatTranscriptActivityStepDurationSuffix(1200)).to.equal('· 1.2s');
    });
});
