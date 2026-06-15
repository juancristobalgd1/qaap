// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    extractTranscriptCommandTail,
    resolveTranscriptCursorTraceLabel,
} from './qaap-transcript-cursor-trace-label';

describe('resolveTranscriptCursorTraceLabel', () => {
    it('formats grep rows with pattern tail', () => {
        expect(resolveTranscriptCursorTraceLabel('Grep', JSON.stringify({ pattern: '*.txt' }), {})).to.deep.equal({
            verb: 'Grepped',
            detail: '*.txt',
            tail: undefined,
        });
    });

    it('formats shell rows with command tail tags', () => {
        expect(resolveTranscriptCursorTraceLabel(
            'Bash',
            JSON.stringify({ command: 'cd /repo && npm run build:browser' }),
            { command: 'cd /repo && npm run build:browser' },
        )).to.deep.equal({
            verb: 'Ran',
            detail: 'npm run build:browser',
            tail: 'cd, npm',
        });
    });
});

describe('extractTranscriptCommandTail', () => {
    it('collects common shell tokens', () => {
        expect(extractTranscriptCommandTail('cd /repo && npm test')).to.equal('cd, npm');
    });
});
