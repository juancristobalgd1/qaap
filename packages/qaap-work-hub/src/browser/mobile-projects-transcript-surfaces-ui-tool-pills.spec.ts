// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { formatPreviewLaunchFailureDetail } from './mobile-projects-transcript-surfaces-ui-tool-pills';

disableImportJSDOM();

describe('preview launch failure detail', () => {

    it('turns literal escaped line breaks into real lines and strips ANSI colors', () => {
        const raw = '\u001b[31merror\u001b[0m: boom\\nat main.js:1\\r\\nexit 1';
        const detail = formatPreviewLaunchFailureDetail(raw);
        expect(detail).to.equal('error: boom\nat main.js:1\nexit 1');
        expect(detail).to.not.contain('\\n');
        expect(detail).to.not.contain('\u001b');
    });

    it('keeps only the last lines of a long log and marks the cut with an ellipsis', () => {
        const lines = Array.from({ length: 50 }, (_, index) => `line ${index + 1}`);
        const detail = formatPreviewLaunchFailureDetail(lines.join('\n')) ?? '';
        expect(detail.startsWith('line 39\n')).to.equal(true);
        expect(detail.endsWith('line 50')).to.equal(true);
        expect(detail.split('\n')).to.have.length(12);
        expect(detail).to.not.contain('line 38');
    });

    it('marks an ellipsis when the kept lines still exceed the character budget', () => {
        const longLine = 'x'.repeat(2000);
        const detail = formatPreviewLaunchFailureDetail(longLine) ?? '';
        expect(detail.startsWith('…')).to.equal(true);
        expect(detail.length).to.be.at.most(1201);
    });

    it('returns undefined for an empty or whitespace-only error', () => {
        expect(formatPreviewLaunchFailureDetail(undefined)).to.be.undefined;
        expect(formatPreviewLaunchFailureDetail('')).to.be.undefined;
        expect(formatPreviewLaunchFailureDetail('  \n \r\n ')).to.be.undefined;
    });
});
