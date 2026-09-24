// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveTranscriptStreamingActivityFromSegments } from './qaap-transcript-streaming-activity';

describe('qaap-transcript-streaming-activity', () => {

    it('returns stall state when requested', () => {
        const view = resolveTranscriptStreamingActivityFromSegments([], { stalled: true, stallTitle: 'Slow' });
        expect(view.kind).to.equal('stall');
        expect(view.title).to.equal('Slow');
    });

    it('returns timeout state when requested', () => {
        const view = resolveTranscriptStreamingActivityFromSegments([], { timedOut: true });
        expect(view.kind).to.equal('timeout');
        expect(view.title).to.equal('The agent didn’t respond in time');
    });

    it('prefers the active unfinished tool', () => {
        const view = resolveTranscriptStreamingActivityFromSegments([
            { type: 'tool', name: 'read_file', args: '{"path":"src/a.ts"}', finished: true, toolUseId: '1' },
            { type: 'tool', name: 'edit_file', args: '{"path":"src/b.ts"}', finished: false, toolUseId: '2' },
        ]);
        expect(view.kind).to.equal('editing');
        expect(view.title).to.match(/edit/i);
    });

    it('returns writing when answer text is present', () => {
        const view = resolveTranscriptStreamingActivityFromSegments([
            { type: 'tool', name: 'read_file', args: '{}', finished: true, toolUseId: '1' },
            { type: 'text', content: 'Done' },
        ]);
        expect(view.kind).to.equal('writing');
    });

    it('returns planning during thinking-only segments', () => {
        const view = resolveTranscriptStreamingActivityFromSegments([
            { type: 'thinking', content: 'planning' },
        ]);
        expect(view.kind).to.equal('planning');
    });

    it('surfaces the latest thinking text as the detail during the thinking phase', () => {
        const view = resolveTranscriptStreamingActivityFromSegments([
            { type: 'thinking', content: 'First I will read the router\n\nconfig.' },
        ]);
        expect(view.kind).to.equal('planning');
        // Whitespace collapsed to a single clean line.
        expect(view.detail).to.equal('First I will read the router config.');
    });

    it('truncates a long thinking snippet at a word boundary with an ellipsis', () => {
        const long = 'I need to trace how the authentication middleware validates the incoming session token before the request reaches the handler';
        const view = resolveTranscriptStreamingActivityFromSegments([{ type: 'thinking', content: long }]);
        expect(view.detail.length).to.be.at.most(97);
        expect(view.detail.endsWith('…')).to.equal(true);
        expect(view.detail).to.not.contain('  ');
    });
});
