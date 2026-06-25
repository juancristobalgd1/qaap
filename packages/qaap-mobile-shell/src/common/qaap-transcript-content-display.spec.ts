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
    looksLikeTranscriptMarkdown,
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
});
