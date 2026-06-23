// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isAgentToolResultFailure,
    isTranscriptErrorOutput,
    isTranscriptTerminalOutputText,
    looksLikeTranscriptMarkdown,
} from './qaap-transcript-content-display';

describe('qaap-transcript-content-display', () => {

    it('renders agent markdown instead of a terminal panel', () => {
        const markdown = [
            '# Match-Pro: Pattern Matching Library',
            '',
            '## Architecture Overview',
            '',
            '**Core Implementation**',
            '',
            '- `src/match.js` — main matcher',
            '- `match` — entry point',
            '- Error handling for invalid patterns',
        ].join('\n');
        expect(looksLikeTranscriptMarkdown(markdown)).to.equal(true);
        expect(isTranscriptTerminalOutputText(markdown)).to.equal(false);
        expect(isTranscriptErrorOutput(markdown)).to.equal(false);
    });

    it('keeps stack traces in the terminal panel', () => {
        const stack = [
            'TypeError: Cannot read properties of undefined',
            '    at Object.<anonymous> (file:///app/src/index.js:12:5)',
            '    at Module._compile (node:internal/modules/cjs/loader:1364:14)',
            '    at Module._extensions..js (node:internal/modules/cjs/loader:1422:10)',
        ].join('\n');
        expect(looksLikeTranscriptMarkdown(stack)).to.equal(false);
        expect(isTranscriptTerminalOutputText(stack)).to.equal(true);
        expect(isTranscriptErrorOutput(stack)).to.equal(true);
    });

    it('does not treat short error snippets as terminal output', () => {
        const short = 'Error: command not found';
        expect(isTranscriptTerminalOutputText(short)).to.equal(false);
    });

    it('isAgentToolResultFailure ignores error substrings inside file paths', () => {
        const globOutput = [
            'package.json',
            'index.html',
            'node_modules/postcss/lib/css-syntax-error.js',
            '(Results are truncated. Consider using a more specific path or pattern.)',
        ].join('\n');
        expect(isAgentToolResultFailure(globOutput)).to.equal(false);
        expect(isAgentToolResultFailure('fatal: not a git repository')).to.equal(true);
        expect(isAgentToolResultFailure('git log --oneline -10\nError: Exit code 128')).to.equal(true);
    });
});
