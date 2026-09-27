// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { pickScopedPreviewClaim } from './qaap-preview-claim-scope';

describe('pickScopedPreviewClaim', () => {

    const sectionA = {
        ready: true,
        previewUrl: 'http://localhost/qaap-preview/section-a/',
        conversationId: 'conversation-a',
    };
    const sectionB = {
        ready: true,
        previewUrl: 'http://localhost/qaap-preview/section-b/',
        conversationId: 'conversation-b',
    };

    it('keeps the claim that matches the open section', () => {
        expect(pickScopedPreviewClaim(sectionA, 'conversation-a')).to.equal(sectionA);
    });

    it('rejects a sibling section even when that claim is newer/ready', () => {
        expect(pickScopedPreviewClaim(sectionB, 'conversation-a')).to.equal(undefined);
    });

    it('does not invent a claim when the scoped lookup missed', () => {
        expect(pickScopedPreviewClaim(undefined, 'conversation-a')).to.equal(undefined);
        expect(pickScopedPreviewClaim({ ready: false, previewUrl: sectionA.previewUrl }, 'conversation-a'))
            .to.equal(undefined);
    });

    it('accepts a scoped claim that predates conversationId on the wire', () => {
        const legacy = { ready: true, previewUrl: sectionA.previewUrl };
        expect(pickScopedPreviewClaim(legacy, 'conversation-a')).to.equal(legacy);
    });
});
