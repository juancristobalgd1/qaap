// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { buildSingleHunkPatch } from './qaap-git-review';

const DIFF = [
    'diff --git a/file.txt b/file.txt',
    'index 111..222 100644',
    '--- a/file.txt',
    '+++ b/file.txt',
    '@@ -1,3 +1,4 @@',
    ' line1',
    '+added-top',
    ' line2',
    ' line3',
    '@@ -10,3 +11,4 @@',
    ' line10',
    '+added-bottom',
    ' line11',
    ' line12',
    '',
].join('\n');

describe('buildSingleHunkPatch', () => {
    it('extracts the first hunk with the file header', () => {
        const patch = buildSingleHunkPatch(DIFF, 0)!;
        expect(patch).to.contain('--- a/file.txt');
        expect(patch).to.contain('@@ -1,3 +1,4 @@');
        expect(patch).to.contain('+added-top');
        expect(patch).to.not.contain('+added-bottom');
        expect(patch.endsWith('\n')).to.equal(true);
    });

    it('extracts the second hunk with the file header', () => {
        const patch = buildSingleHunkPatch(DIFF, 1)!;
        expect(patch).to.contain('--- a/file.txt');
        expect(patch).to.contain('@@ -10,3 +11,4 @@');
        expect(patch).to.contain('+added-bottom');
        expect(patch).to.not.contain('+added-top');
    });

    it('returns undefined for an out-of-range or negative index', () => {
        expect(buildSingleHunkPatch(DIFF, 2)).to.equal(undefined);
        expect(buildSingleHunkPatch(DIFF, -1)).to.equal(undefined);
    });

    it('returns undefined when there is no hunk', () => {
        expect(buildSingleHunkPatch('diff --git a/x b/x\n', 0)).to.equal(undefined);
    });
});
