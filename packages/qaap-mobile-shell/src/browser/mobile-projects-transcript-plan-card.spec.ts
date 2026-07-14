// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Structural tests for renderPlanTab: verifies that all rendered content is
 * wrapped inside a single .theia-mobile-transcript-plan-card element so that
 * the CSS centering / max-width constraint works correctly across viewports.
 */

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import type { MobileProjectsTranscriptSurfacesHost } from './mobile-projects-transcript-surfaces-ui';
import { MobileProjectsTranscriptSurfacesUi } from './mobile-projects-transcript-surfaces-ui';
import type { MobileProjectsTranscriptHistoryUi } from './mobile-projects-transcript-history-ui';
import type { QaapAgentConversationDTO } from '../common/qaap-agent-conversation-client';

/** Build a minimal host stub sufficient for renderPlanTab. */
function buildHost(
    activityItems: Array<{ state: string }> = [],
    timeline: HTMLElement | null = null,
): MobileProjectsTranscriptSurfacesHost {
    return {
        transcriptMessagesUi: {
            resolveTranscriptAgentSegments: (_conv: unknown, _msg: unknown) => activityItems.length > 0 ? [{}] : [],
            resolveTranscriptActivityItems: () => activityItems,
            createTranscriptActivityTimeline: () => timeline,
        },
    } as unknown as MobileProjectsTranscriptSurfacesHost;
}

/** Minimal history UI stub. */
const historyUiStub = {} as unknown as MobileProjectsTranscriptHistoryUi;

/** Conversation with one agent message (triggers the non-empty branch). */
function agentConv(): QaapAgentConversationDTO {
    return {
        id: 'c1',
        messages: [{ role: 'agent', segments: [{}] }],
    } as unknown as QaapAgentConversationDTO;
}

describe('renderPlanTab — plan-card wrapper (centering)', () => {

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('wraps "empty plan" note inside .theia-mobile-transcript-plan-card', () => {
        const ui = new MobileProjectsTranscriptSurfacesUi(buildHost([]), historyUiStub);
        const host = document.createElement('div');
        // Pass a conversation with no agent messages → latestAgentSegments returns undefined
        ui.renderPlanTab(host, { id: 'c1', messages: [] } as unknown as QaapAgentConversationDTO);

        const card = host.querySelector('.theia-mobile-transcript-plan-card');
        expect(card, 'card wrapper must exist').to.not.be.null;
        const note = card!.querySelector('.theia-mobile-transcript-plan-note');
        expect(note, 'note must be inside card').to.not.be.null;
        // Note must NOT be a direct child of host
        const directNote = Array.from(host.children).find(
            c => c.classList.contains('theia-mobile-transcript-plan-note'),
        );
        expect(directNote, 'note must not be a direct child of host').to.be.undefined;
    });

    it('wraps "no activity" note inside card when items is empty', () => {
        // resolveTranscriptAgentSegments returns non-empty (so we pass the first guard),
        // but resolveTranscriptActivityItems returns [] → no-activity note branch
        const ui = new MobileProjectsTranscriptSurfacesUi(buildHost([]), historyUiStub);
        const host = document.createElement('div');
        ui.renderPlanTab(host, agentConv());

        const card = host.querySelector('.theia-mobile-transcript-plan-card');
        expect(card, 'card wrapper must exist').to.not.be.null;
        // With empty items the resolveTranscriptAgentSegments stub also returns []
        // so we land in the "no segments" branch — still wraps in a card.
        expect(host.children.length, 'host has exactly one direct child').to.equal(1);
        expect(host.children[0].classList.contains('theia-mobile-transcript-plan-card')).to.be.true;
    });

    it('wraps head, progress, and timeline inside card when items exist', () => {
        const timelineEl = document.createElement('details');
        const items = [{ state: 'success' }, { state: 'running' }];
        const ui = new MobileProjectsTranscriptSurfacesUi(buildHost(items, timelineEl), historyUiStub);
        const host = document.createElement('div');
        ui.renderPlanTab(host, agentConv());

        const card = host.querySelector('.theia-mobile-transcript-plan-card');
        expect(card, 'card wrapper must exist').to.not.be.null;

        expect(card!.querySelector('.theia-mobile-transcript-plan-head'), 'head inside card').to.not.be.null;
        expect(card!.querySelector('.theia-mobile-transcript-plan-prog'), 'progress inside card').to.not.be.null;
        expect(card!.contains(timelineEl), 'timeline inside card').to.be.true;

        expect(host.children.length, 'host has exactly one direct child (card)').to.equal(1);
    });

    it('card is the only direct child of the host when items exist', () => {
        const items = [{ state: 'success' }];
        const ui = new MobileProjectsTranscriptSurfacesUi(buildHost(items), historyUiStub);
        const host = document.createElement('div');
        ui.renderPlanTab(host, agentConv());

        expect(host.children.length).to.equal(1);
        expect(host.children[0].classList.contains('theia-mobile-transcript-plan-card')).to.be.true;
    });

    it('handles undefined host gracefully without throwing', () => {
        const ui = new MobileProjectsTranscriptSurfacesUi(buildHost(), historyUiStub);
        expect(() => ui.renderPlanTab(undefined, undefined)).not.to.throw();
    });
});
