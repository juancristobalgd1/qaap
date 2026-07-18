// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { parsePreviewFeedbackContextBody, splitPreviewFeedbackSource } from './qaap-preview-feedback-transcript';

/** Mirrors the output of `formatPreviewFeedbackAgentContext` in qaap-adapters. */
const FULL_BODY = [
    'Preview feedback annotations (compact context — not full DOM):',
    '',
    'Annotation 1:',
    '- Comment: Make this button darker',
    '- Route: /checkout',
    '- Viewport: mobile 375x812',
    '- Selector: .cart > button.checkout',
    '- Position in element: x=0.512, y=0.334',
    '- Document position: x=0.480, y=0.712',
    '- Element: <button>',
    '- Text: Pay now',
    '- Source: src/cart/checkout-button.tsx:42',
    '',
    'Annotation 2:',
    '- Comment: Too much spacing',
    'and it wraps to a second line',
    '- Route: /checkout',
    '- Viewport: mobile 375x812',
    '- Page position: x=0.100, y=0.200',
    '- Document position: x=0.100, y=0.200',
    '- Component: CheckoutSummary',
    '- Note: anchor unresolved (element missing; using last document ratios)',
].join('\n');

describe('qaap-preview-feedback-transcript', () => {

    it('parses annotations with element, selector and source details', () => {
        const details = parsePreviewFeedbackContextBody(FULL_BODY);
        expect(details).to.have.length(2);
        const first = details[0]!;
        expect(first.index).to.equal(1);
        expect(first.comment).to.equal('Make this button darker');
        expect(first.route).to.equal('/checkout');
        expect(first.viewport).to.equal('mobile 375x812');
        expect(first.selector).to.equal('.cart > button.checkout');
        expect(first.elementTag).to.equal('button');
        expect(first.elementText).to.equal('Pay now');
        expect(first.source).to.equal('src/cart/checkout-button.tsx:42');
        expect(first.unresolved).to.equal(undefined);
    });

    it('keeps multi-line comments together and flags unresolved anchors', () => {
        const details = parsePreviewFeedbackContextBody(FULL_BODY);
        const second = details[1]!;
        expect(second.index).to.equal(2);
        expect(second.comment).to.equal('Too much spacing\nand it wraps to a second line');
        expect(second.component).to.equal('CheckoutSummary');
        expect(second.selector).to.equal(undefined);
        expect(second.unresolved).to.equal(true);
    });

    it('returns an empty list for unrecognized bodies', () => {
        expect(parsePreviewFeedbackContextBody('')).to.deep.equal([]);
        expect(parsePreviewFeedbackContextBody('just some free text')).to.deep.equal([]);
    });

    it('skips annotations without a comment', () => {
        const body = 'Annotation 1:\n- Route: /\n\nAnnotation 2:\n- Comment: keep me';
        const details = parsePreviewFeedbackContextBody(body);
        expect(details).to.have.length(1);
        expect(details[0]!.comment).to.equal('keep me');
    });

    it('splitPreviewFeedbackSource separates the trailing line number', () => {
        expect(splitPreviewFeedbackSource('src/app/foo.tsx:42')).to.deep.equal({ path: 'src/app/foo.tsx', line: 42 });
        expect(splitPreviewFeedbackSource('src/app/foo.tsx')).to.deep.equal({ path: 'src/app/foo.tsx' });
    });
});
