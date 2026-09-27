// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveTranscriptActivityDiffPeek } from './qaap-transcript-activity-diff-peek';

describe('resolveTranscriptActivityDiffPeek', () => {
    const diffResult = [
        '--- a/src/foo.ts',
        '+++ b/src/foo.ts',
        '@@ -1,2 +1,3 @@',
        '-old line',
        '+new line',
        '+another line',
    ].join('\n');

    const segments = [
        {
            type: 'tool' as const,
            name: 'write_file',
            args: '{}',
            finished: true,
            toolUseId: '1',
            result: diffResult,
        },
    ];

    it('returns undefined for non-editing or grouped rows', () => {
        expect(resolveTranscriptActivityDiffPeek({ toolKind: 'reading', segmentIndex: 0 }, segments)).to.equal(undefined);
        expect(resolveTranscriptActivityDiffPeek({ toolKind: 'editing', segmentIndex: 0, grouped: true }, segments)).to.equal(undefined);
    });

    it('extracts inline diff preview with edit stats', () => {
        const peek = resolveTranscriptActivityDiffPeek({
            toolKind: 'editing',
            segmentIndex: 0,
            editAdded: 2,
            editRemoved: 1,
        }, segments, 2);
        expect(peek).to.not.equal(undefined);
        expect(peek!.lines).to.have.length(2);
        expect(peek!.added).to.equal(2);
        expect(peek!.removed).to.equal(1);
    });

    it('returns undefined when result has no diff lines', () => {
        const plainSegments = [{ ...segments[0], result: 'File updated successfully.' }];
        expect(resolveTranscriptActivityDiffPeek({
            toolKind: 'editing',
            segmentIndex: 0,
        }, plainSegments)).to.equal(undefined);
    });
});
