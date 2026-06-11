// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    applyTranscriptApprovalCardOptimisticUi,
    buildTranscriptApprovalCard,
    TRANSCRIPT_APPROVAL_CARD_ALLOW_CLASS,
} from './qaap-transcript-approval-card-ui';

describe('qaap-transcript-approval-card-ui', () => {
    let disableJSDOM: () => void;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    it('applyTranscriptApprovalCardOptimisticUi resolves allow immediately', () => {
        const card = buildTranscriptApprovalCard({ title: 'Allow WebSearch?' }, {
            onApprove: () => undefined,
            onReject: () => undefined,
        });
        applyTranscriptApprovalCardOptimisticUi(card, 'allow');
        expect(card.classList.contains('theia-mod-resolved')).to.equal(true);
        expect(card.classList.contains('theia-mod-allowed')).to.equal(true);
        expect(card.querySelector(`.${TRANSCRIPT_APPROVAL_CARD_ALLOW_CLASS}`)).to.equal(null);
        expect(card.querySelector('.theia-mobile-agent-approval-card-title')?.textContent).to.equal('Allowed');
    });

    it('applyTranscriptApprovalCardOptimisticUi resolves deny immediately', () => {
        const card = buildTranscriptApprovalCard({ title: 'Allow Bash?' }, {
            onApprove: () => undefined,
            onReject: () => undefined,
        });
        applyTranscriptApprovalCardOptimisticUi(card, 'deny');
        expect(card.classList.contains('theia-mod-denied')).to.equal(true);
        expect(card.querySelector('.theia-mobile-agent-approval-card-title')?.textContent).to.equal('Denied');
    });

    it('applyTranscriptApprovalCardOptimisticUi is idempotent', () => {
        const card = buildTranscriptApprovalCard({ title: 'Allow Read?' }, {
            onApprove: () => undefined,
            onReject: () => undefined,
        });
        applyTranscriptApprovalCardOptimisticUi(card, 'allow');
        applyTranscriptApprovalCardOptimisticUi(card, 'deny');
        expect(card.classList.contains('theia-mod-allowed')).to.equal(true);
        expect(card.classList.contains('theia-mod-denied')).to.equal(false);
    });
});
