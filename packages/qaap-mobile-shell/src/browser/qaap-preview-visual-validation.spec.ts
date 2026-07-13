// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { expect } from 'chai';
import { validateQaapPreviewDocument } from './qaap-preview-visual-validation';

describe('validateQaapPreviewDocument', () => {
    let disableJSDOM: () => void;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => {
        disableJSDOM();
    });

    it('passes a simple accessible page', () => {
        document.body.innerHTML = '<h1>Dashboard</h1><p>Welcome to the project dashboard.</p><button>Continue</button>';
        const result = validateQaapPreviewDocument(document, { clientWidth: 1024 });
        expect(result.status).to.equal('passed');
        expect(result.issues).to.deep.equal([]);
    });

    it('reports empty content and unnamed controls', () => {
        document.body.innerHTML = '<button aria-hidden="true"></button><input type="text">';
        const result = validateQaapPreviewDocument(document, { clientWidth: 1024 });
        expect(result.status).to.equal('warning');
        expect(result.issues.some(issue => issue.includes('empty'))).to.equal(true);
        expect(result.issues.some(issue => issue.includes('accessible name'))).to.equal(true);
        expect(result.issues.some(issue => issue.includes('lack a label'))).to.equal(true);
    });
});
