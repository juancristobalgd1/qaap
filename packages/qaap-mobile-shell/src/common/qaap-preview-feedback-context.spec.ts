// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { createComposerContextEntry } from './qaap-composer-context-entry';
import {
    buildPreviewFeedbackAttachmentRequest,
    findPreviewFeedbackEntryIndex,
    isPreviewFeedbackRequest,
    isQaapAttachComposerContextArgs,
    resolvePreviewFeedbackVariable,
} from './qaap-preview-feedback-context';

describe('qaap-preview-feedback-context', () => {
    it('builds and resolves preview feedback requests', () => {
        const request = buildPreviewFeedbackAttachmentRequest({
            chipTitle: 'Preview feedback · 2 annotations · /home · Mobile',
            contextBody: 'Annotation 1:\n- Comment: Move button',
            dedupeKey: 'previewFeedback|ws|t1|url|/home|a,b',
        });
        expect(isPreviewFeedbackRequest(request)).to.equal(true);
        const resolved = resolvePreviewFeedbackVariable(request);
        expect(resolved?.contextValue).to.contain('Move button');
        expect(resolved?.value).to.equal('previewFeedback|ws|t1|url|/home|a,b');
    });

    it('accepts optional submit flag on attach args', () => {
        expect(isQaapAttachComposerContextArgs({
            chipTitle: 'Preview feedback',
            contextBody: 'body',
            dedupeKey: 'key-1',
            submit: true,
        })).to.equal(true);
        expect(isQaapAttachComposerContextArgs({
            chipTitle: 'Preview feedback',
            contextBody: 'body',
            dedupeKey: 'key-1',
        })).to.equal(true);
    });

    it('finds entries by dedupe key for replace', () => {
        const first = createComposerContextEntry(buildPreviewFeedbackAttachmentRequest({
            chipTitle: 'old',
            contextBody: 'body-1',
            dedupeKey: 'key-1',
        }));
        const second = createComposerContextEntry(buildPreviewFeedbackAttachmentRequest({
            chipTitle: 'other',
            contextBody: 'body-2',
            dedupeKey: 'key-2',
        }));
        const entries = [first, second];
        expect(findPreviewFeedbackEntryIndex(entries, 'key-1')).to.equal(0);
        expect(findPreviewFeedbackEntryIndex(entries, 'missing')).to.equal(-1);
    });
});
