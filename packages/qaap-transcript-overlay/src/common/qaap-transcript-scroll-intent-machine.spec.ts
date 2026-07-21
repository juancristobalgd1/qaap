// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    reduceTranscriptScrollPhase,
    transcriptScrollPhaseAllowsAutoFollow,
    transcriptScrollPhaseAllowsViewportMutation,
    type TranscriptScrollPhase,
} from './qaap-transcript-scroll-intent-machine';

// Spec covers the pure phase machine; browser controller is covered via integration paths.

describe('qaap-transcript-scroll-intent-machine', () => {
    it('opens conversations idle and keeps streaming lifecycle phase-neutral', () => {
        expect(reduceTranscriptScrollPhase('following', { type: 'conversation-open' })).to.equal('idle');
        expect(reduceTranscriptScrollPhase('detached', { type: 'streaming-start' })).to.equal('detached');
        expect(reduceTranscriptScrollPhase('following', { type: 'streaming-end' })).to.equal('following');
    });

    it('always detaches on explicit user intent', () => {
        const phases: readonly TranscriptScrollPhase[] = ['idle', 'following', 'detached', 'restoring', 'positioning-turn'];
        for (const phase of phases) {
            expect(reduceTranscriptScrollPhase(phase, { type: 'user-detach', reason: 'wheel' })).to.equal('detached');
        }
    });

    it('restores without enabling follow', () => {
        const restoring = reduceTranscriptScrollPhase('idle', { type: 'restore-start' });
        expect(restoring).to.equal('restoring');
        expect(reduceTranscriptScrollPhase(restoring, { type: 'restore-done' })).to.equal('detached');
    });

    it('positions a new turn once and then follows', () => {
        const positioning = reduceTranscriptScrollPhase('detached', { type: 'position-turn-start' });
        expect(positioning).to.equal('positioning-turn');
        expect(reduceTranscriptScrollPhase(positioning, { type: 'position-turn-done' })).to.equal('following');
    });

    it('enables following only for explicit live-edge gestures', () => {
        expect(reduceTranscriptScrollPhase('detached', { type: 'jump-to-latest' })).to.equal('following');
        expect(reduceTranscriptScrollPhase('detached', { type: 'user-return-to-live-edge' })).to.equal('following');
        expect(reduceTranscriptScrollPhase('idle', { type: 'user-return-to-live-edge' })).to.equal('following');
        expect(reduceTranscriptScrollPhase('restoring', { type: 'user-return-to-live-edge' })).to.equal('restoring');
    });

    it('never re-follows because a programmatic or content-height change lands near bottom', () => {
        const phases: readonly TranscriptScrollPhase[] = ['idle', 'following', 'detached', 'restoring', 'positioning-turn'];
        for (const phase of phases) {
            expect(reduceTranscriptScrollPhase(phase, { type: 'programmatic-near-bottom' })).to.equal(phase);
        }
        const detached = reduceTranscriptScrollPhase('following', { type: 'user-detach' });
        expect(reduceTranscriptScrollPhase(detached, { type: 'programmatic-near-bottom' })).to.equal('detached');
    });

    it('allows auto-follow and viewport writes only in their owning phases', () => {
        expect(transcriptScrollPhaseAllowsAutoFollow('following')).to.equal(true);
        expect(transcriptScrollPhaseAllowsAutoFollow('detached')).to.equal(false);
        expect(transcriptScrollPhaseAllowsViewportMutation('following', 'follow-tail')).to.equal(true);
        expect(transcriptScrollPhaseAllowsViewportMutation('detached', 'follow-tail')).to.equal(false);
        expect(transcriptScrollPhaseAllowsViewportMutation('positioning-turn', 'position-turn')).to.equal(true);
        expect(transcriptScrollPhaseAllowsViewportMutation('restoring', 'restore')).to.equal(true);
        expect(transcriptScrollPhaseAllowsViewportMutation('detached', 'preserve-anchor')).to.equal(true);
    });
});
