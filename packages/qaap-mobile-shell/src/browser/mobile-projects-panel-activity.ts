import type { MobileProjectsPanelContext } from './mobile-projects-panel-context';
// Extracted from mobile-projects-panel.ts

import { ChatSession } from '@theia/ai-chat';
import { MobileProjectChatViewWidget } from './mobile-project-ai-chat-input-widget';
import {
    MobileProjectEntry,
} from './mobile-projects-types';
import { MobileProjectsParallelUi } from './mobile-projects-parallel-ui';
import { MobileProjectsTeamUi } from './mobile-projects-team-ui';
import { MobileProjectsTeamHubUi } from './mobile-projects-team-hub-ui';
import { MobileProjectsHomeUi } from './mobile-projects-home-ui';
import { normalizeQaapPreviewConversationId } from '../common/qaap-preview-identity';
import {
    QaapAgentConversationDTO,
    QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import {
    revokeComposerContextPreview,
    type StickyComposerContextEntry,
} from '../common/qaap-composer-context-entry';
import {
    type QaapTranscriptLiveRefreshOptions,
} from '@theia/qaap-transcript-overlay/lib/browser/qaap-transcript-live-controller';

export function renderAgentsHubIdleSubmitOptimisticExtracted(ctx: MobileProjectsPanelContext, chatHost: HTMLElement,
    summary: QaapAgentConversationSummaryDTO,
    draft: string,
    agentId: string,
    imagePreviews?: readonly import('../common/qaap-transcript-user-image-preview').QaapTranscriptUserImagePreview[],
    contentOverride?: string,): void {
    ctx.agentsHubInlineUi.renderAgentsHubIdleSubmitOptimistic(chatHost, summary, draft, agentId, imagePreviews, contentOverride);
}

export async function openAgentsHubInlineTranscriptExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    await ctx.agentsHubInlineUi.openAgentsHubInlineTranscript(project, summary);
}

export async function refreshOpenTranscriptConversationExtracted(ctx: MobileProjectsPanelContext, options?: QaapTranscriptLiveRefreshOptions,): Promise<void> {
    await ctx.transcriptLiveUi.refreshOpenTranscriptConversation(options);
}

export function refreshTranscriptChecksViewsExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): void {
    ctx.transcriptVerifyUi.refreshTranscriptChecksViews(project, summary);
}

export function renderChecksSectionExtracted(ctx: MobileProjectsPanelContext, host: HTMLElement | undefined,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    options: { readonly embedded?: boolean } = {},): void {
    ctx.transcriptVerifyUi.renderChecksSection(host, project, summary, options);
}

export function handleTranscriptStatusForAutoVerifyExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    status: QaapAgentConversationSummaryDTO['status'],): void {
    ctx.transcriptVerifyUi.handleTranscriptStatusForAutoVerify(project, summary, status);
}

export async function syncTranscriptPreviewFromConversationExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    conv: QaapAgentConversationDTO,): Promise<void> {
    await ctx.transcriptSurfacesUi.syncTranscriptPreviewFromConversation(project, summary, conv);
}

export function beginTranscriptDevPreviewRequestExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): void {
    ctx.transcriptSurfacesUi.beginTranscriptDevPreviewRequest(project, summary);
}

export function stageTranscriptPreviewReadyUrlExtracted(ctx: MobileProjectsPanelContext, readyUrl: string): void {
    const conversationScopeId = normalizeQaapPreviewConversationId(
        ctx.transcriptController.state.transcriptOpenSummaryId,
    );
    ctx.transcriptSurfacesUi.stageTranscriptPreviewReadyUrl(conversationScopeId, readyUrl);
}

export function ensureOverlayUiExtracted(ctx: MobileProjectsPanelContext): {
    parallel: MobileProjectsParallelUi;
    team: MobileProjectsTeamUi;
    teamHub: MobileProjectsTeamHubUi;
    home: MobileProjectsHomeUi;
} {
    return ctx.overlayFactoryUi.ensureOverlayUi();
}

export function releasePreviewForConversationExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): void {
    ctx.transcriptSurfacesUi.disposePreviewForConversation(summary);
    ctx.transcriptSurfacesUi.disposeTranscriptTerminalSlidesForConversation(project, summary);
    ctx.projectBootstrap?.releasePreviewForConversation(summary.id);
}

export function attachTranscriptChatViewWidgetExtracted(ctx: MobileProjectsPanelContext, widget: MobileProjectChatViewWidget,
    chatHost: HTMLElement,
    session: ChatSession,): boolean {
    return ctx.theiaChatSessionUi.attachTranscriptChatViewWidget(widget, chatHost, session);
}

export function createComposerEditorContextPanelDelegateExtracted(ctx: MobileProjectsPanelContext): import('./qaap-composer-editor-context-service').QaapComposerEditorContextPanelDelegate {
    return {
        resolveActiveComposerContextTarget: () => ctx.resolveActiveComposerContextTarget(),
        getComposerContextEntries: target => target === 'transcript'
            ? ctx.transcriptController.state.transcriptComposerContext
            : ctx.stickyComposerContext,
        upsertEditorContextEntry: (target, entry) => {
            const entries = target === 'transcript'
                ? ctx.transcriptController.state.transcriptComposerContext
                : ctx.stickyComposerContext;
            const existingIndex = entries.findIndex((item: StickyComposerContextEntry) => item.request.variable.name === entry.request.variable.name);
            if (existingIndex >= 0) {
                revokeComposerContextPreview(entries[existingIndex]);
                entries.splice(existingIndex, 1, entry);
                return;
            }
            entries.push(entry);
        },
        notifyEditorContextRemoved: entry => {
            ctx.handleComposerContextItemRemoved(entry);
        },
        refreshComposerAfterContextPin: target => {
            if (target === 'transcript') {
                ctx.transcriptStickyComposerUi.remountTranscriptStickyComposer();
                return;
            }
            ctx.stickyComposerRenderUi.renderStickyComposer();
        },
        focusComposerInput: () => {
            const input = ctx.root.querySelector<HTMLTextAreaElement>('.theia-mobile-projects-sticky-composer-input-editor');
            input?.focus();
        },
    };
}

export function resolveActiveComposerContextTargetExtracted(ctx: MobileProjectsPanelContext): import('./qaap-composer-editor-context-service').ComposerEditorContextTarget {
    const state = ctx.transcriptController.state;
    if (state.transcriptOpenSummary || state.transcriptComposerSummary) {
        return 'transcript';
    }
    return 'sticky';
}
