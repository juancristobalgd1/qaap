// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { CURRENT_CLAIM_LOG_MAX_SILENCE_MS, shouldLogCurrentClaim } from './qaap-dev-preview-endpoint-streaming';

describe('shouldLogCurrentClaim', () => {
    const claim = {
        projectId: 'project-claim-log-a',
        conversationId: 'conversation-claim-log-a',
        previewId: 'preview-claim-log-a',
        port: 4173,
        conversationFilter: undefined,
    };

    it('logs the first sighting of a claim', () => {
        expect(shouldLogCurrentClaim(claim, 1_000_000)).to.equal(true);
    });

    it('stays silent on repeated polls of an unchanged claim', () => {
        const start = 2_000_000;
        expect(shouldLogCurrentClaim(claim, start)).to.equal(true);
        for (let tick = 1; tick <= 30; tick++) {
            expect(shouldLogCurrentClaim(claim, start + tick * 1000)).to.equal(false);
        }
    });

    it('logs again once the silence window has elapsed', () => {
        const start = 3_000_000;
        expect(shouldLogCurrentClaim(claim, start)).to.equal(true);
        expect(shouldLogCurrentClaim(claim, start + CURRENT_CLAIM_LOG_MAX_SILENCE_MS - 1)).to.equal(false);
        expect(shouldLogCurrentClaim(claim, start + CURRENT_CLAIM_LOG_MAX_SILENCE_MS)).to.equal(true);
    });

    it('logs when a relevant field of the same previewId changes', () => {
        const start = 4_000_000;
        expect(shouldLogCurrentClaim(claim, start)).to.equal(true);
        expect(shouldLogCurrentClaim({ ...claim, port: 4174 }, start + 1000)).to.equal(true);
        expect(shouldLogCurrentClaim({ ...claim, port: 4174 }, start + 2000)).to.equal(false);
        expect(shouldLogCurrentClaim({ ...claim, port: 4174, conversationId: 'other-conversation' }, start + 3000)).to.equal(true);
        expect(shouldLogCurrentClaim({ ...claim, port: 4174, conversationId: 'other-conversation', conversationFilter: 'filter' }, start + 4000)).to.equal(true);
    });

    it('tracks each previewId independently', () => {
        const start = 5_000_000;
        expect(shouldLogCurrentClaim(claim, start)).to.equal(true);
        expect(shouldLogCurrentClaim({ ...claim, previewId: 'preview-claim-log-b' }, start + 1000)).to.equal(true);
        expect(shouldLogCurrentClaim(claim, start + 2000)).to.equal(false);
    });
});
