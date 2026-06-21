// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { parseTranscriptSearchMatches } from './qaap-transcript-search-matches-core';

describe('qaap-transcript-search-matches-core', () => {

    it('parses ripgrep-style file:line:snippet rows', () => {
        const raw = [
            'Found 2 matching lines',
            'packages/qaap-mobile-shell/src/browser/foo.ts:42:  const answer = 42;',
            'packages/qaap-mobile-shell/src/browser/bar.ts:10:export function bar() {',
        ].join('\n');
        expect(parseTranscriptSearchMatches(raw)).to.deep.equal([
            { file: 'browser/foo.ts', line: 42, snippet: 'const answer = 42;' },
            { file: 'browser/bar.ts', line: 10, snippet: 'export function bar() {' },
        ]);
    });

    it('parses file-on-previous-line blocks', () => {
        const raw = [
            'src/common/util.ts',
            '15: return true;',
            'src/common/other.ts',
            '3→ import { x } from "./x";',
        ].join('\n');
        expect(parseTranscriptSearchMatches(raw)).to.deep.equal([
            { file: 'src/common/util.ts', line: 15, snippet: 'return true;' },
            { file: 'src/common/other.ts', line: 3, snippet: 'import { x } from "./x";' },
        ]);
    });

    it('returns undefined for non-search payloads', () => {
        expect(parseTranscriptSearchMatches('ok')).to.equal(undefined);
        expect(parseTranscriptSearchMatches('just some log\nwithout paths')).to.equal(undefined);
        expect(parseTranscriptSearchMatches('--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@')).to.equal(undefined);
    });
});
