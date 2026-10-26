// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// The sync path reads window.location; enable jsdom for this suite only.
const disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import * as sinon from 'sinon';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { QaapAgentConversationDTO, QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectsTranscriptSurfacesUiContext } from './mobile-projects-transcript-surfaces-ui-context';
import { syncTranscriptPreviewFromConversationExtracted } from './mobile-projects-transcript-surfaces-ui-thought-brief';

disableJSDOM();

describe('syncTranscriptPreviewFromConversationExtracted — request chip flags', () => {

    const project = { id: 'project-1' } as unknown as MobileProjectEntry;
    const summary = { id: 'conversation-1' } as unknown as QaapAgentConversationSummaryDTO;
    const streamingConversation = { id: 'conversation-1', status: 'streaming', messages: [] } as unknown as QaapAgentConversationDTO;

    function buildContext(flags: { pending: boolean; running: boolean }): {
        ctx: MobileProjectsTranscriptSurfacesUiContext;
        refreshComposer: sinon.SinonSpy;
        host: { transcriptPreviewRequestPending: boolean; transcriptPreviewRequestRunning: boolean };
    } {
        const refreshComposer = sinon.spy();
        const host = {
            transcriptPreviewSuppressedByUser: false,
            transcriptPreviewRequestPending: flags.pending,
            transcriptPreviewRequestRunning: flags.running,
            executionSurfaceTabsUi: { activeExecutionTab: () => 'messages' },
            transcriptStickyComposerUi: { refreshComposerActivityStack: refreshComposer },
        };
        const ctx = {
            host,
            refreshTranscriptPreviewProject: async (candidate: MobileProjectEntry) => candidate,
            resolveTranscriptPreviewUrl: () => 'http://localhost:3000/',
            scheduleTranscriptPreviewTabProbe: () => undefined,
            previewScopeId: () => 'scope',
            matchesActivePreviewSummary: () => false,
        } as unknown as MobileProjectsTranscriptSurfacesUiContext;
        return { ctx, refreshComposer, host };
    }

    it('clears both Pending and Running once the preview URL resolves', async () => {
        const { ctx, refreshComposer, host } = buildContext({ pending: true, running: true });

        await syncTranscriptPreviewFromConversationExtracted(ctx, project, summary, streamingConversation);

        expect(host.transcriptPreviewRequestPending).to.equal(false);
        expect(host.transcriptPreviewRequestRunning).to.equal(false);
        expect(refreshComposer.callCount).to.equal(1);
    });

    it('clears a Running flag left behind after Pending was already released', async () => {
        const { ctx, refreshComposer, host } = buildContext({ pending: false, running: true });

        await syncTranscriptPreviewFromConversationExtracted(ctx, project, summary, streamingConversation);

        expect(host.transcriptPreviewRequestRunning).to.equal(false);
        expect(refreshComposer.callCount).to.equal(1);
    });

    it('does not refresh the composer when no request flag was set', async () => {
        const { ctx, refreshComposer } = buildContext({ pending: false, running: false });

        await syncTranscriptPreviewFromConversationExtracted(ctx, project, summary, streamingConversation);

        expect(refreshComposer.callCount).to.equal(0);
    });
});
