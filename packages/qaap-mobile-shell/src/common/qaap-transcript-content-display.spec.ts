// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isAgentToolResultFailure,
    isLikelyReadToolFileContent,
    isLikelySourceFileDump,
    isTranscriptErrorOutput,
    isTranscriptTerminalOutputText,
    looksLikeCompilerDiagnostic,
    looksLikeTranscriptMarkdown,
    stripAnsiEscapes,
    stripToolResultLineNumberPrefixes,
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

    it('renders a compiler/linter code frame literally, not as fragmented Markdown', () => {
        // Real biome output: the `> 252 │` pointer is not a blockquote and the frame is one block.
        // Markdown would shred it into stray code cards and a <blockquote> (the reported bug).
        const diagnostic = [
            'Error: Verification checks are still failing after 1 fix attempt.',
            'npm run lint exited with code 1.',
            '',
            '  × Provide an explicit type prop for the button element.',
            '',
            '    250 │         <div className="flex">',
            '    251 │           {ranges.map((range) => (',
            '  > 252 │             <button',
            '        │             ^^^^^^^',
            '  > 253 │               key={range.key}',
        ].join('\n');
        expect(looksLikeCompilerDiagnostic(diagnostic)).to.equal(true);
        expect(looksLikeTranscriptMarkdown(diagnostic)).to.equal(false);
        expect(isTranscriptTerminalOutputText(diagnostic)).to.equal(true);
    });

    it('recognizes the formatter twin-number gutter too', () => {
        const format = [
            'components/ui/date-range-picker.tsx format',
            '',
            '  × Formatter would have printed the following content:',
            '',
            '    13 13 │     maxDate?: Date',
            '    14 14 │   }) {',
        ].join('\n');
        expect(looksLikeCompilerDiagnostic(format)).to.equal(true);
        expect(isTranscriptTerminalOutputText(format)).to.equal(true);
    });

    it('does not mistake prose that merely quotes or numbers for a diagnostic', () => {
        // A genuine blockquote and an ordered list — no `N │` gutter, no caret run.
        const prose = [
            '## Summary',
            '',
            'Found the **bug**. Steps:',
            '',
            '1. Read the file',
            '2. Fix the nesting',
            '',
            '> Note: this changes the translations.',
        ].join('\n');
        expect(looksLikeCompilerDiagnostic(prose)).to.equal(false);
        expect(looksLikeTranscriptMarkdown(prose)).to.equal(true);
        expect(isTranscriptTerminalOutputText(prose)).to.equal(false);
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

    it('isLikelyReadToolFileContent detects Claude/QAIQ Read payloads', () => {
        const readOutput = [
            '<path>/repo/src/Canvas.tsx</path>',
            '<type>file</type>',
            '<content>',
            '1: import { useState } from \'react\';',
            '2: const [webglError, setWebglError] = useState<string | null>(null);',
            '3: error={webglError}',
            '</content>',
            '(End of file - total 3 lines)',
        ].join('\n');
        expect(isLikelyReadToolFileContent(readOutput)).to.equal(true);
        expect(isAgentToolResultFailure(readOutput, { toolName: 'Read' })).to.equal(false);
    });

    it('isAgentToolResultFailure still flags real Read failures', () => {
        expect(isAgentToolResultFailure('<tool_use_error>File not found</tool_use_error>', { toolName: 'Read' })).to.equal(true);
        expect(isAgentToolResultFailure('Error: File does not exist: /missing.ts', { toolName: 'Read' })).to.equal(true);
    });

    it('isLikelySourceFileDump detects shell cat/head dumps without line numbers', () => {
        const bashCatOutput = [
            'import { forwardRef, useState, useEffect, useRef, useCallback } from \'react\';',
            'import { useApp } from \'../../store\';',
            'import type { TextOverlay } from \'../../store\';',
            'import { GRADIENTS, MESH_GRADIENTS, PATTERNS, WALLPAPERS } from \'../../data/backgrounds\';',
            'import { probeWebGLSupport } from \'../../utils/webgl\';',
            '',
            'interface CanvasProps {',
            '  textOverlays: TextOverlay[];',
            '  onUpdateText: (id: string, updates: Partial<TextOverlay>) => void;',
            '}',
            '',
            'export const Canvas = forwardRef<HTMLDivElement, CanvasProps>(({ textOverlays }, ref) => {',
            '  const [webglError, setWebglError] = useState<string | null>(null);',
            '  const evaluateWebGL = useCallback(() => {',
            '    setWebglError(result.supported ? null : result.error ?? \'WebGL not available\');',
            '  }, []);',
            '});',
        ].join('\n');
        expect(isLikelySourceFileDump(bashCatOutput)).to.equal(true);
        expect(isLikelyReadToolFileContent(bashCatOutput)).to.equal(true);
        expect(isAgentToolResultFailure(bashCatOutput, { toolName: 'Bash' })).to.equal(false);
        expect(isTranscriptErrorOutput(bashCatOutput)).to.equal(false);
    });

    it('stripToolResultLineNumberPrefixes normalizes QAIQ arrow line markers', () => {
        const numbered = [
            '1→import { useState } from \'react\';',
            '2→const [webglError, setWebglError] = useState<string | null>(null);',
        ].join('\n');
        const stripped = stripToolResultLineNumberPrefixes(numbered);
        expect(stripped).to.include('import { useState }');
        expect(stripped).to.not.include('1→');
        expect(isLikelyReadToolFileContent(numbered)).to.equal(true);
    });

    it('isAgentToolResultFailure still flags real Bash failures', () => {
        expect(isAgentToolResultFailure('bash: line 1: npm: command not found', { toolName: 'Bash' })).to.equal(true);
        expect(isAgentToolResultFailure('Error: Exit code 1\nnpm ERR! Test failed', { toolName: 'Bash' })).to.equal(true);
    });

    describe('stripAnsiEscapes', () => {

        it('removes CSI color codes', () => {
            expect(stripAnsiEscapes('\u001b[32mgreen\u001b[0m')).to.equal('green');
        });

        it('removes OSC title sequences terminated by BEL', () => {
            expect(stripAnsiEscapes('\u001b]0;title\u0007body')).to.equal('body');
        });

        it('removes OSC title sequences terminated by ST', () => {
            expect(stripAnsiEscapes('\u001b]0;title\u001b\\body')).to.equal('body');
        });

        it('leaves plain text untouched', () => {
            expect(stripAnsiEscapes('hello world')).to.equal('hello world');
        });

        it('handles mixed CSI and OSC sequences', () => {
            const input = '\u001b[1;31mError\u001b[0m\n\u001b]0;window\u0007details';
            expect(stripAnsiEscapes(input)).to.equal('Error\ndetails');
        });

        it('returns empty string for empty input', () => {
            expect(stripAnsiEscapes('')).to.equal('');
        });
    });
});
