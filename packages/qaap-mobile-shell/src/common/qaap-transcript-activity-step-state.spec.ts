// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { shouldApplyTranscriptActivitySettleMotion } from './qaap-transcript-activity-step-state';

describe('shouldApplyTranscriptActivitySettleMotion', () => {
    it('is true when transitioning from live to settled states', () => {
        expect(shouldApplyTranscriptActivitySettleMotion('running', 'success')).to.equal(true);
        expect(shouldApplyTranscriptActivitySettleMotion('streaming', 'error')).to.equal(true);
        expect(shouldApplyTranscriptActivitySettleMotion('thinking', 'warning')).to.equal(true);
        expect(shouldApplyTranscriptActivitySettleMotion('waiting', 'cancelled')).to.equal(true);
        expect(shouldApplyTranscriptActivitySettleMotion('retrying', 'success')).to.equal(true);
    });

    it('is false when previous is missing, still live, or already settled', () => {
        expect(shouldApplyTranscriptActivitySettleMotion(undefined, 'success')).to.equal(false);
        expect(shouldApplyTranscriptActivitySettleMotion('running', 'streaming')).to.equal(false);
        expect(shouldApplyTranscriptActivitySettleMotion('success', 'error')).to.equal(false);
    });
});
