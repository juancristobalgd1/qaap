// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { QaapAgentConversationDTO, QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectsTranscriptLiveUiContext } from './mobile-projects-transcript-live-ui-context';
import { applyOptimisticConversationCancelExtracted } from './mobile-projects-transcript-live-ui-render';

disableImportJSDOM();

function streamingConversation(): QaapAgentConversationDTO {
    return {
        id: 'c1',
        cwd: '/tmp/project',
        agentId: 'claude',
        title: 'Session',
        status: 'streaming',
        createdAt: 1,
        updatedAt: 2,
        messages: [
            { id: 'user-1', role: 'user', content: 'cambia el color del título a azul', createdAt: 1 },
            { id: 'agent-1', role: 'agent', content: '', createdAt: 2, runActive: true },
        ],
    };
}

interface CancelHarness {
    readonly ctx: MobileProjectsTranscriptLiveUiContext;
    readonly host: { transcriptLastConv?: QaapAgentConversationDTO };
    readonly settledCalls: number[];
}

function createHarness(conv: QaapAgentConversationDTO): CancelHarness {
    const settledCalls: number[] = [];
    const host = {
        transcriptLastConv: conv as QaapAgentConversationDTO | undefined,
        transcriptLastFingerprint: 'fp' as string | undefined,
        transcriptOpenSummary: undefined,
        transcriptMessagesUi: { renderTranscriptMessages: (): void => undefined },
        transcriptHeaderUi: { refreshTranscriptExecutionChrome: (): void => undefined },
        transcriptComposerSendRefresh: (): void => undefined,
    };
    const ctx = {
        host,
        pendingSseRenderConv: undefined as QaapAgentConversationDTO | undefined,
        resolveActiveTranscriptChatHost: (): HTMLElement | undefined => undefined,
        scheduleTranscriptComposerActivityRefresh: (): void => undefined,
        syncTranscriptConversationSettledChrome: (): void => {
            settledCalls.push(host.transcriptLastConv?.status === 'idle' ? 1 : 0);
        },
    } as unknown as MobileProjectsTranscriptLiveUiContext;
    return { ctx, host, settledCalls };
}

describe('applyOptimisticConversationCancelExtracted', () => {

    const summary = { id: 'c1', cwd: '/tmp/project', status: 'streaming' } as QaapAgentConversationSummaryDTO;

    it('drops a coalesced pre-Stop streaming snapshot so it cannot repaint the stopped turn as working', () => {
        const { ctx, host } = createHarness(streamingConversation());
        ctx.pendingSseRenderConv = { ...streamingConversation(), updatedAt: 3 };

        applyOptimisticConversationCancelExtracted(ctx, summary);

        expect(ctx.pendingSseRenderConv).to.equal(undefined);
        expect(host.transcriptLastConv?.status).to.equal('idle');
        expect(host.transcriptLastConv?.messages.map(message => message.id)).to.deep.equal(['user-1', 'agent-1']);
        expect(host.transcriptLastConv?.messages[1].runActive).to.equal(undefined);
    });

    it('runs the settled chrome (which dispatches queued follow-ups) once the open copy is idle', () => {
        const { ctx, settledCalls } = createHarness(streamingConversation());

        applyOptimisticConversationCancelExtracted(ctx, summary);

        expect(settledCalls).to.deep.equal([1]);
    });

    it('leaves another conversation untouched', () => {
        const other = { ...streamingConversation(), id: 'c2' };
        const { ctx, host, settledCalls } = createHarness(other);
        ctx.pendingSseRenderConv = other;

        applyOptimisticConversationCancelExtracted(ctx, summary);

        expect(host.transcriptLastConv).to.equal(other);
        expect(ctx.pendingSseRenderConv).to.equal(other);
        expect(settledCalls).to.deep.equal([]);
    });
});
