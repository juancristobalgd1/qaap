// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveTranscriptBootstrapAgentLabel } from './qaap-transcript-streaming-bootstrap';
import {
    shouldExpandTranscriptInlineTimeline,
    shouldShowTranscriptInlineTimeline,
    shouldShowTranscriptStreamingBootstrapTimeline,
} from './qaap-transcript-stream-status';

describe('qaap-transcript-streaming-bootstrap', () => {

    it('resolveTranscriptBootstrapAgentLabel maps built-in agents', () => {
        expect(resolveTranscriptBootstrapAgentLabel('opencode')).to.equal('OpenCode');
        expect(resolveTranscriptBootstrapAgentLabel(undefined)).to.equal('…');
    });

    it('does not show bootstrap filler rows during early streaming', () => {
        expect(shouldShowTranscriptStreamingBootstrapTimeline([], true)).to.equal(false);
        expect(shouldShowTranscriptStreamingBootstrapTimeline([{ type: 'thinking', content: 'plan' }], true)).to.equal(false);
    });

    it('uses normal timeline rules without bootstrap chrome', () => {
        expect(shouldShowTranscriptInlineTimeline([], true)).to.equal(false);
        expect(shouldExpandTranscriptInlineTimeline([], true)).to.equal(false);
        expect(shouldShowTranscriptInlineTimeline([{ type: 'tool' }], true)).to.equal(true);
    });
});
