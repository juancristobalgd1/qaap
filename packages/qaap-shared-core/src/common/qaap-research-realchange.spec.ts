// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { realChangeFingerprint, type RealFileChange } from './qaap-research-realchange';

describe('qaap-research-realchange', () => {

    describe('realChangeFingerprint', () => {

        it('is deterministic for the same real changes (simulates cross-process stability: fresh arrays, same result)', () => {
            const build = (): RealFileChange[] => [
                { path: 'train.py', content: 'x = 2\n' },
                { path: 'config.json', content: '{"lr": 0.01}' },
            ];
            expect(realChangeFingerprint(build())).to.equal(realChangeFingerprint(build()));
        });

        it('is insensitive to the order changes are passed in — the same real edit always fingerprints the same', () => {
            const left: RealFileChange[] = [
                { path: 'train.py', content: 'x = 2\n' },
                { path: 'config.json', content: '{"lr": 0.01}' },
            ];
            const right: RealFileChange[] = [
                { path: 'config.json', content: '{"lr": 0.01}' },
                { path: 'train.py', content: 'x = 2\n' },
            ];
            expect(realChangeFingerprint(left)).to.equal(realChangeFingerprint(right));
        });

        it('differs when the resulting content differs, even for the same path', () => {
            const a = realChangeFingerprint([{ path: 'train.py', content: 'x = 2\n' }]);
            const b = realChangeFingerprint([{ path: 'train.py', content: 'x = 3\n' }]);
            expect(a).to.not.equal(b);
        });

        it('differs when the set of changed paths differs, even with identical content', () => {
            const a = realChangeFingerprint([{ path: 'train.py', content: 'x = 2\n' }]);
            const b = realChangeFingerprint([{ path: 'other.py', content: 'x = 2\n' }]);
            expect(a).to.not.equal(b);
        });

        it('treats a deletion (content: undefined) as distinct from an empty-string file', () => {
            const deleted = realChangeFingerprint([{ path: 'train.py', content: undefined }]);
            const empty = realChangeFingerprint([{ path: 'train.py', content: '' }]);
            expect(deleted).to.not.equal(empty);
        });

        it('is empty-input stable: no real changes always fingerprints the same, regardless of caller', () => {
            expect(realChangeFingerprint([])).to.equal(realChangeFingerprint([]));
        });

        it('two logically identical repeats (same paths, same resulting content) collide, exactly what the repeat-guard needs', () => {
            const round1: RealFileChange[] = [{ path: 'train.py', content: 'learning_rate = 0.01\n' }];
            const round2: RealFileChange[] = [{ path: 'train.py', content: 'learning_rate = 0.01\n' }];
            expect(realChangeFingerprint(round1)).to.equal(realChangeFingerprint(round2));
        });

        it('two different real edits never collide, even if a caller were to (wrongly) claim they are the same config', () => {
            const round1: RealFileChange[] = [{ path: 'train.py', content: 'learning_rate = 0.01\n' }];
            const round2: RealFileChange[] = [{ path: 'train.py', content: 'learning_rate = 0.02\n' }];
            expect(realChangeFingerprint(round1)).to.not.equal(realChangeFingerprint(round2));
        });

        it('collides for the same content reindented — a pure indentation/spacing change cannot evade the repeat-guard', () => {
            const twoSpaces = realChangeFingerprint([{ path: 'config.json', content: '{\n  "x": 3,\n  "y": 4\n}\n' }]);
            const fourSpaces = realChangeFingerprint([{ path: 'config.json', content: '{\n    "x": 3,\n    "y": 4\n}\n' }]);
            expect(twoSpaces).to.equal(fourSpaces);
        });

        it('collides for differently-spaced JSON that is the same logical config', () => {
            const compact = realChangeFingerprint([{ path: 'config.json', content: '{"x":3}' }]);
            const spaced = realChangeFingerprint([{ path: 'config.json', content: '{"x": 3}' }]);
            const padded = realChangeFingerprint([{ path: 'config.json', content: '{ "x" : 3 }' }]);
            expect(compact).to.equal(spaced);
            expect(spaced).to.equal(padded);
        });

        it('still differs when the actual value changes, not just its formatting', () => {
            const a = realChangeFingerprint([{ path: 'config.json', content: '{"x": 3}' }]);
            const b = realChangeFingerprint([{ path: 'config.json', content: '{"x": 4}' }]);
            expect(a).to.not.equal(b);
        });

        it('collides for CRLF vs LF line endings of the same content', () => {
            const lf = realChangeFingerprint([{ path: 'train.py', content: 'x = 2\ny = 3\n' }]);
            const crlf = realChangeFingerprint([{ path: 'train.py', content: 'x = 2\r\ny = 3\r\n' }]);
            expect(lf).to.equal(crlf);
        });

        it('collides regardless of trailing whitespace or trailing blank lines', () => {
            const clean = realChangeFingerprint([{ path: 'train.py', content: 'x = 2\n' }]);
            const trailingWhitespace = realChangeFingerprint([{ path: 'train.py', content: 'x = 2   \n' }]);
            const trailingBlankLines = realChangeFingerprint([{ path: 'train.py', content: 'x = 2\n\n\n' }]);
            expect(clean).to.equal(trailingWhitespace);
            expect(clean).to.equal(trailingBlankLines);
        });
    });
});
