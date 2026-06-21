// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    resolveTranscriptBootstrapAgentLabel,
    resolveTranscriptStreamingBootstrapActivityItems,
} from './qaap-transcript-streaming-bootstrap';
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

    it('resolveTranscriptStreamingBootstrapActivityItems uses the requested copy', () => {
        const items = resolveTranscriptStreamingBootstrapActivityItems('opencode');
        expect(items).to.have.length(3);
        expect(items[0]?.label).to.equal('Preparando workspace');
        expect(items[0]?.state).to.equal('success');
        expect(items[1]?.label).to.equal('Esperando respuesta del modelo (OpenCode / …)');
        expect(items[1]?.state).to.equal('running');
        expect(items[2]?.label).to.equal('Conectado al Cloud');
        expect(items[2]?.state).to.equal('success');
    });

    it('marks the waiting step as warning when stalled', () => {
        const items = resolveTranscriptStreamingBootstrapActivityItems('qaiq', { stalled: true });
        expect(items[1]?.state).to.equal('warning');
    });

    it('marks the waiting step as error when timed out', () => {
        const items = resolveTranscriptStreamingBootstrapActivityItems('qaiq', { timedOut: true });
        expect(items[1]?.state).to.equal('error');
    });

    it('shows bootstrap timeline during thinking-only streaming', () => {
        expect(shouldShowTranscriptStreamingBootstrapTimeline([], true)).to.equal(true);
        expect(shouldShowTranscriptInlineTimeline([], true)).to.equal(true);
        expect(shouldExpandTranscriptInlineTimeline([], true)).to.equal(true);
        expect(shouldShowTranscriptStreamingBootstrapTimeline([{ type: 'thinking', content: 'plan' }], true)).to.equal(true);
    });

    it('hides bootstrap timeline once tools or substantive text arrive', () => {
        expect(shouldShowTranscriptStreamingBootstrapTimeline([{ type: 'tool' }], true)).to.equal(false);
        expect(shouldShowTranscriptStreamingBootstrapTimeline([
            { type: 'text', content: 'Here is a full answer with enough detail to continue streaming.' },
        ], true)).to.equal(false);
    });
});
