// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { formatTranscriptTraceCommandDetail, formatTranscriptTraceMonoPath } from './qaap-transcript-trace-path';

describe('formatTranscriptTraceMonoPath', () => {
    it('returns empty for blank paths', () => {
        expect(formatTranscriptTraceMonoPath('')).to.equal('');
        expect(formatTranscriptTraceMonoPath('   ')).to.equal('');
    });

    it('normalizes separators and strips leading ./', () => {
        expect(formatTranscriptTraceMonoPath('.\\src\\foo.ts')).to.equal('src/foo.ts');
    });

    it('leaves short paths unchanged', () => {
        expect(formatTranscriptTraceMonoPath('src/foo.ts', 42)).to.equal('src/foo.ts');
    });

    it('prefers first-dir ellipsis before tail ellipsis', () => {
        const path = 'packages/qaap-mobile-shell/src/browser/mobile-projects-panel.ts';
        const out = formatTranscriptTraceMonoPath(path, 42);
        expect(out).to.equal('packages/…/mobile-projects-panel.ts');
        expect(out.length).to.be.at.most(42);
    });

    it('falls back to tail segments when needed', () => {
        const path = 'very-long-root/packages/qaap-mobile-shell/src/browser/style/mobile-workbench.css';
        const out = formatTranscriptTraceMonoPath(path, 36);
        expect(out.startsWith('…/')).to.equal(true);
        expect(out.endsWith('mobile-workbench.css')).to.equal(true);
        expect(out.length).to.be.at.most(36);
    });
});

describe('formatTranscriptTraceCommandDetail', () => {
    it('collapses whitespace and truncates long commands', () => {
        const command = 'npm   run   build:browser   --scope   @theia/qaap-mobile-shell';
        const out = formatTranscriptTraceCommandDetail(command, 32);
        expect(out.endsWith('…')).to.equal(true);
        expect(out.length).to.be.at.most(32);
    });
});
