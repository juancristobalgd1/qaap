// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    classifyVerificationFailureScope,
    findOutOfScopeChanges,
    isPerFileVerificationScript,
    parseWorktreeStatusZ,
} from './qaap-verification-scope';

describe('qaap-verification-scope', () => {

    it('parses porcelain -z entries, untracked files and renames', () => {
        const changes = parseWorktreeStatusZ(' M src/a.ts\0?? notes/new.md\0R  src/b.ts\0src/old-b.ts\0');
        expect(changes).to.deep.equal([
            { path: 'src/a.ts', untracked: false },
            { path: 'notes/new.md', untracked: true },
            { path: 'src/b.ts', untracked: false },
        ]);
    });

    it('finds changes outside the allowed set', () => {
        const current = parseWorktreeStatusZ(' M src/a.ts\0 M src/c.ts\0');
        expect(findOutOfScopeChanges(current, new Set(['src/a.ts'])).map(change => change.path)).to.deep.equal(['src/c.ts']);
    });

    it('recognizes lint-style scripts only', () => {
        expect(isPerFileVerificationScript('npm run lint')).to.equal(true);
        expect(isPerFileVerificationScript('npm run lint:fix')).to.equal(true);
        expect(isPerFileVerificationScript('npm run eslint')).to.equal(true);
        expect(isPerFileVerificationScript('npm run typecheck')).to.equal(false);
        expect(isPerFileVerificationScript('npm run build')).to.equal(false);
        expect(isPerFileVerificationScript('npm run test')).to.equal(false);
    });

    it('attributes a failure to the task when it names an edited file', () => {
        expect(classifyVerificationFailureScope('/srv/repo/src/Hero.tsx\n 3:1 error', ['src/Hero.tsx'])).to.equal('in-scope');
        expect(classifyVerificationFailureScope('src\\Hero.tsx(3,1): error', ['src/Hero.tsx'])).to.equal('in-scope');
    });

    it('marks failures naming only other files as out of scope', () => {
        expect(classifyVerificationFailureScope('/srv/repo/src/Newsletter.tsx\n 3:1 warning', ['src/Hero.tsx'])).to.equal('out-of-scope');
        expect(classifyVerificationFailureScope('/srv/repo/src/MyHero.tsx\n 3:1 warning', ['src/Hero.tsx'])).to.equal('out-of-scope');
    });

    it('returns unknown when the output names no file, and ignores node_modules frames', () => {
        expect(classifyVerificationFailureScope('Process exited with code 1', ['src/Hero.tsx'])).to.equal('unknown');
        expect(classifyVerificationFailureScope('at node_modules/eslint/lib/cli.js:10', ['src/Hero.tsx'])).to.equal('unknown');
    });
});
