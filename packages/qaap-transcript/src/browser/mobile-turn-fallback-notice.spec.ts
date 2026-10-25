// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { QaapAgentConversationDTO, QaapAgentMessageDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { QaapCreateAgentTaskQaiqModel } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { formatQaiqModelIdShortLabel } from '@theia/qaap-shared-core/lib/common/qaap-qaiq-model-catalog';
import {
    MOBILE_TURN_FALLBACK_NOTICE_CLASS,
    MOBILE_TURN_PROVENANCE_STANDALONE_CLASS,
    syncTranscriptStandaloneTurnProvenance,
    turnFallbackOf,
} from './mobile-turn-provenance-badge';
import { adoptTurnFallbackModelExtracted } from './mobile-projects-transcript-live-ui-render';

disableImportJSDOM();

const requested: QaapCreateAgentTaskQaiqModel = { provider: 'openai', vendor: 'openrouter', modelId: 'minimax/minimax-m3.1-flash' };
const used: QaapCreateAgentTaskQaiqModel = { provider: 'openai', vendor: 'openrouter', modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free' };

describe('turn fallback notice in the transcript', () => {
    let body: HTMLElement;

    beforeEach(() => {
        body = document.createElement('div');
    });

    it('states the swap under the provenance badge when the turn ran on a fallback model', () => {
        syncTranscriptStandaloneTurnProvenance(body, 'qaiq', used, { fromModel: requested, reason: 'model-unavailable' });
        const notice = body.querySelector<HTMLElement>(`:scope > .${MOBILE_TURN_FALLBACK_NOTICE_CLASS}`);
        expect(notice, 'notice mounted').to.not.equal(null);
        expect(notice!.textContent).to.contain(formatQaiqModelIdShortLabel(requested.modelId));
        expect(notice!.textContent).to.contain(formatQaiqModelIdShortLabel(used.modelId));
        expect(notice!.textContent).to.contain('is unavailable');
        const badge = body.querySelector(`:scope > .${MOBILE_TURN_PROVENANCE_STANDALONE_CLASS}`);
        expect(badge!.nextElementSibling).to.equal(notice);
    });

    it('says a turn that did not finish was re-run, not that the model is unavailable', () => {
        syncTranscriptStandaloneTurnProvenance(body, 'qaiq', used, { fromModel: requested, reason: 'turn-failed' });
        const notice = body.querySelector(`.${MOBILE_TURN_FALLBACK_NOTICE_CLASS}`);
        expect(notice!.textContent).to.contain('did not finish the turn');
    });

    it('mounts no notice for a turn on the model it was sent with', () => {
        syncTranscriptStandaloneTurnProvenance(body, 'qaiq', used);
        expect(body.querySelector(`.${MOBILE_TURN_FALLBACK_NOTICE_CLASS}`)).to.equal(null);
    });

    it('is idempotent across streaming ticks and removed with the badge', () => {
        const fallback = { fromModel: requested, reason: 'model-unavailable' as const };
        syncTranscriptStandaloneTurnProvenance(body, 'qaiq', used, fallback);
        syncTranscriptStandaloneTurnProvenance(body, 'qaiq', used, fallback);
        expect(body.querySelectorAll(`.${MOBILE_TURN_FALLBACK_NOTICE_CLASS}`)).to.have.length(1);
        syncTranscriptStandaloneTurnProvenance(body, undefined, undefined);
        expect(body.querySelector(`.${MOBILE_TURN_FALLBACK_NOTICE_CLASS}`)).to.equal(null);
        expect(body.querySelector(`.${MOBILE_TURN_PROVENANCE_STANDALONE_CLASS}`)).to.equal(null);
    });

    it('reads the fallback off a sealed user turn only', () => {
        expect(turnFallbackOf({ fallbackFromModel: requested, fallbackReason: 'model-unavailable' })).to.deep.equal({ fromModel: requested, reason: 'model-unavailable' });
        expect(turnFallbackOf({})).to.equal(undefined);
        expect(turnFallbackOf(undefined)).to.equal(undefined);
    });
});

describe('composer adopts the fallback model for that conversation only', () => {
    const conversationId = 'conv-1';
    let applied: Array<{ agentModel?: QaapCreateAgentTaskQaiqModel }>;
    let composerModel: QaapCreateAgentTaskQaiqModel | undefined;
    let ctx: { host: Record<string, unknown> };

    const fallbackMessage = (id: string): QaapAgentMessageDTO => ({
        id,
        role: 'user',
        content: 'levanta la app',
        createdAt: 1,
        turnAgentId: 'qaiq',
        turnAgentModel: used,
        fallbackFromModel: requested,
        fallbackReason: 'model-unavailable',
    });

    beforeEach(() => {
        applied = [];
        composerModel = requested;
        ctx = {
            host: {
                transcriptLastConv: { id: conversationId, agentId: 'qaiq', agentModel: requested, qaiqModel: requested, messages: [] } as unknown as QaapAgentConversationDTO,
                transcriptOpenProject: {},
                transcriptOpenSummary: { id: conversationId },
                transcriptComposerPrefsConvId: conversationId,
                get transcriptComposerAgentModel(): QaapCreateAgentTaskQaiqModel | undefined {
                    return composerModel;
                },
                applyTranscriptComposerPrefsFromConversation: (conv: { agentModel?: QaapCreateAgentTaskQaiqModel }): void => {
                    applied.push({ agentModel: conv.agentModel });
                    composerModel = conv.agentModel;
                },
            },
        };
    });

    it('adopts the model the turn actually ran on, once', () => {
        adoptTurnFallbackModelExtracted(ctx as never, conversationId, fallbackMessage('u1'));
        expect(applied).to.have.length(1);
        expect(applied[0].agentModel).to.deep.equal(used);
        adoptTurnFallbackModelExtracted(ctx as never, conversationId, fallbackMessage('u1'));
        expect(applied, 'same turn is not re-adopted').to.have.length(1);
    });

    it('keeps the composer model when the turn merely failed transiently (notice only)', () => {
        const transient = { ...fallbackMessage('u9'), fallbackReason: 'turn-failed' as const };
        adoptTurnFallbackModelExtracted(ctx as never, conversationId, transient);
        expect(applied, 'no adoption, no persistence').to.have.length(0);
        expect(composerModel).to.deep.equal(requested);
    });

    it('does not override a later manual pick for the same turn', () => {
        adoptTurnFallbackModelExtracted(ctx as never, conversationId, fallbackMessage('u1'));
        composerModel = requested;
        adoptTurnFallbackModelExtracted(ctx as never, conversationId, fallbackMessage('u1'));
        expect(composerModel).to.deep.equal(requested);
    });

    it('ignores other conversations and turns without a fallback', () => {
        adoptTurnFallbackModelExtracted(ctx as never, 'other-conv', fallbackMessage('u1'));
        adoptTurnFallbackModelExtracted(ctx as never, conversationId, { ...fallbackMessage('u2'), fallbackFromModel: undefined });
        ctx.host.transcriptComposerPrefsConvId = 'other-conv';
        adoptTurnFallbackModelExtracted(ctx as never, conversationId, fallbackMessage('u3'));
        expect(applied).to.have.length(0);
    });
});
