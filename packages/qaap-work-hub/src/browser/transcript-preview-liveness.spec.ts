// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    classifyTranscriptPreviewLoss,
    decideTranscriptPreviewLiveness,
    isSameTranscriptPreviewClaim,
    TRANSCRIPT_PREVIEW_LIVENESS_MAX_PROBES,
    TRANSCRIPT_PREVIEW_SHOWING_PAGE_FAILURES_TO_DEAD,
} from './transcript-preview-liveness';

describe('decideTranscriptPreviewLiveness', () => {

    const showing = { failuresToDead: TRANSCRIPT_PREVIEW_SHOWING_PAGE_FAILURES_TO_DEAD, maxProbes: TRANSCRIPT_PREVIEW_LIVENESS_MAX_PROBES };
    const empty = { failuresToDead: 1, maxProbes: TRANSCRIPT_PREVIEW_LIVENESS_MAX_PROBES };

    it('never declares a showing page dead on a single failed probe', () => {
        expect(decideTranscriptPreviewLiveness(['stopped'], showing)).to.equal('probe-again');
        expect(decideTranscriptPreviewLiveness(['gone'], showing)).to.equal('probe-again');
        expect(decideTranscriptPreviewLiveness(['stopped', 'stopped'], showing)).to.equal('dead');
        expect(decideTranscriptPreviewLiveness(['stopped', 'gone'], showing)).to.equal('dead');
    });

    it('decides on the first definitive failure when nothing would be blanked', () => {
        expect(decideTranscriptPreviewLiveness(['gone'], empty)).to.equal('dead');
        expect(decideTranscriptPreviewLiveness(['stopped'], empty)).to.equal('dead');
    });

    it('never counts transient failures towards dead', () => {
        expect(decideTranscriptPreviewLiveness(['unknown'], empty)).to.equal('probe-again');
        expect(decideTranscriptPreviewLiveness(['unknown', 'unknown', 'unknown'], empty)).to.equal('unreachable');
        // A transient probe breaks a run of definitive failures.
        expect(decideTranscriptPreviewLiveness(['stopped', 'unknown', 'stopped'], showing)).to.equal('unreachable');
        expect(decideTranscriptPreviewLiveness(['stopped', 'unknown'], {
            failuresToDead: 2,
            maxProbes: Number.POSITIVE_INFINITY,
        })).to.equal('probe-again');
    });

    it('reports ready and booting from the latest probe', () => {
        expect(decideTranscriptPreviewLiveness(['stopped', 'ready'], showing)).to.equal('ready');
        expect(decideTranscriptPreviewLiveness(['unknown', 'booting'], showing)).to.equal('booting');
        expect(decideTranscriptPreviewLiveness([], showing)).to.equal('probe-again');
    });
});

describe('classifyTranscriptPreviewLoss', () => {

    const stale = 'http://ide.test/qaap-preview/p-old/';

    it('swaps to a newer live claim whatever the stored claim said', () => {
        for (const verdict of ['dead', 'booting', 'unreachable'] as const) {
            expect(classifyTranscriptPreviewLoss({
                verdict,
                staleUrl: stale,
                currentClaimUrl: 'http://ide.test/qaap-preview/p-new/',
                currentClaimBooting: false,
            })).to.equal('superseded');
        }
    });

    it('reports a stopped dev server only when the claim is dead and nothing replaces it', () => {
        expect(classifyTranscriptPreviewLoss({ verdict: 'dead', staleUrl: stale, currentClaimBooting: false })).to.equal('stopped');
        expect(classifyTranscriptPreviewLoss({ verdict: 'dead', staleUrl: stale, currentClaimBooting: true })).to.equal('starting');
        expect(classifyTranscriptPreviewLoss({ verdict: 'booting', staleUrl: stale, currentClaimBooting: false })).to.equal('starting');
        expect(classifyTranscriptPreviewLoss({ verdict: 'unreachable', staleUrl: stale, currentClaimBooting: false })).to.equal('starting');
    });

    it('treats the same claim answering on /api/current as starting, not superseded', () => {
        expect(classifyTranscriptPreviewLoss({
            verdict: 'dead',
            staleUrl: stale,
            currentClaimUrl: 'http://ide.test/qaap-preview/p-old/docs/',
            currentClaimBooting: false,
        })).to.equal('starting');
    });

    it('compares identity claims by preview id', () => {
        expect(isSameTranscriptPreviewClaim('/qaap-preview/p-a/', 'http://ide.test/qaap-preview/p-a/x')).to.equal(true);
        expect(isSameTranscriptPreviewClaim('/qaap-preview/p-a/', '/qaap-preview/p-b/')).to.equal(false);
        expect(isSameTranscriptPreviewClaim('http://localhost/qaap-dev/5173/', 'http://localhost/qaap-dev/5174/')).to.equal(false);
    });
});
