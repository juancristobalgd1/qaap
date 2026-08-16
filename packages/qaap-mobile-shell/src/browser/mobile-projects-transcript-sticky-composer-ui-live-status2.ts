// @ts-nocheck
// Extracted from mobile-projects-transcript-sticky-composer-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { ConfirmDialog } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import type { QuickInputService } from '@theia/core/lib/common/quick-pick-service';
import { ChatAgentService } from '@theia/ai-chat/lib/common/chat-agent-service';
import { ChatMode, ChatModel } from '@theia/ai-chat';
import { Disposable } from '@theia/core/lib/common/disposable';
import {
    conversationToSummary,
    getConversation,
    isMaxConcurrentRunsError,
    recordConversationGitAction,
    updateConversation,
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
    type QaapAgentMessageDTO,
} from '../common/qaap-agent-conversation-client';
import { createComposerGitActionDisplayMarker, type ComposerGitActionDisplayMetadata } from '../common/qaap-composer-git-action-display';
import {
    QAAP_COMPOSER_DEFAULT_AGENT_ID,
    QAAP_PRIMARY_AGENT_ID,
    readStoredAgentModel,
    resolveExplicitAgentForSubmit,
    type QaapAgentTaskAgentOption,
} from '../common/qaap-agent-task-client';
import { warmAgentTurnPath } from '../common/qaap-agent-turn-warm';
import { formatCommitFeedback } from '../common/qaap-commit-feedback';
import { createComposerContextEntry } from '../common/qaap-composer-context-entry';
import { isTranscriptAgentExecutionBusy, resolveTranscriptEffectiveStatus, isTranscriptSummaryAgentWorking, shouldShowTranscriptEmptyQuickActions } from '../common/qaap-transcript-turn-status';
import type { MobileComposerAttachHandlers } from './qaap-mobile-composer-device-attach';
import {
    resolveChatModelContextUsageBreakdown,
    resolveVpsContextUsageBreakdown,
} from './qaap-chat-context-usage-panel';
import {
    applyConversationComposerPrefs,
    applyProjectComposerDefaults,
    buildRuntimeComposerPersistPatch,
    clearConversationComposerDraft,
    extractConversationComposerPrefs,
    extractConversationComposerPrefsFromSummary,
    readConversationComposerDraft,
    writeConversationComposerDraft,
} from '../common/qaap-conversation-composer-state';
import {
    describeComposerInteractionMode,
    reconcileComposerModeId,
    resolveComposerModeLabel,
    resolveStickyComposerModes,
} from '../common/qaap-sticky-composer-mode';
import {
    reconcileModelCapabilityLevel,
} from '../common/qaap-sticky-composer-model-capability';
import {
    agentSupportsApprovalPolicy,
    reconcileAgentApprovalPolicyId,
    resolveComposerAutoApprove,
    type QaapAgentApprovalPolicyId,
} from '../common/qaap-sticky-composer-approval-policy';
import {
    reconcileAgentToolApprovalRules,
    type QaapAgentToolApprovalRules,
} from '../common/qaap-agent-tool-approval-rules';
import {
    MAX_TRANSCRIPT_FOLLOW_UP_QUEUE,
    TranscriptFollowUpQueue,
    type TranscriptFollowUpEntry,
} from '../common/qaap-transcript-follow-up-queue';
import {
    resolveBusyFollowUpDeliveryMode,
    shouldBypassLocalFollowUpQueue,
} from './qaap-delivery-mode-strip';
import { isAgentsHubIdleConversationSummary } from '../common/qaap-agents-hub-landing';
import { readProjectComposerDraft, writeProjectComposerDraft } from '../common/qaap-project-composer-draft';
import type { StickyComposerContextChipView } from './qaap-sticky-composer-context-ui';
import { collectComposerImagePreviews } from './qaap-sticky-composer-context-ui';
import {
    composerContextRequests,
    disposeComposerContextEntries,
    hasPendingComposerContextEntries,
    revokeComposerContextPreview,
    type StickyComposerContextEntry,
} from '../common/qaap-composer-context-entry';
import type { StickyComposerTokenOption } from '../common/qaap-sticky-composer-mention';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import type { MobileProjectsService } from './mobile-projects-service';
import type { MobileProjectsTranscriptComposerUi } from './mobile-projects-transcript-composer-ui';
import { createStickyComposerImprovePromptHandler } from './qaap-composer-prompt-improve-handler';
import type { WorkHubTranscriptBridge } from './work-hub-transcript-bridge';
import { MobileSnackbar } from './mobile-snackbar';
import {
    QAAP_GIT_REVIEW_API_PATH,
    type QaapGitChangedFile,
    type QaapGitCommitWorkflowAction,
} from '../common/qaap-git-review';
import {
    renderStickyComposerActivityStack,
    buildStickyComposerActivityStackFingerprint,
    buildStickyComposerChangesPillFingerprint,
    patchStickyComposerActivityStack,
    patchStickyComposerChangesPillHost,
    renderStickyComposerChangesPill,
    selectComposerPillChanges,
    type StickyComposerActivityStackOptions,
    type StickyComposerChangedFileView,
} from './qaap-sticky-composer-activity-stack';
import { syncTranscriptQueuedBubbles } from './qaap-transcript-queued-bubbles';
import {
    mergeFailedComposerDraft,
    isIdleComposerFocusStealable,
    hasComposerAgentActivity as hasComposerAgentActivityHelper,
    resolveChangedFilesStats as resolveChangedFilesStatsHelper,
    mapGitChangedFileToComposerView as mapGitChangedFileToComposerViewHelper,
    resolveGitCommitWorkflowLabel as resolveGitCommitWorkflowLabelHelper,
    isComposerBackgroundWorkAllowed as isComposerBackgroundWorkAllowedHelper,
} from './mobile-projects-transcript-sticky-composer-helpers';
import {
    parkWorkingControlFromAncestor,
    transferWorkingControlToHost,
} from './qaap-sticky-composer-working-agents-popover';
import { transferStepPillToHost } from './qaap-sticky-composer-step-pill';
import { probeQaapDevPreviewPort, probeQaapIdentityPreview } from './qaap-dev-preview-client';
import { extractTranscriptPreviewId } from './mobile-projects-transcript-messages-content-ui';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import { extractDevPreviewPortFromUrl } from './qaap-transcript-preview-bootstrap';
import {
    openCurrentComposerPreview,
    resolveComposerPreviewCandidate,
    resolveVerifiedComposerPreviewUrl,
    type ComposerPreviewRuntime,
} from './qaap-composer-preview-action';

export async function submitTranscriptComposerDraftExtracted(ctx: any, draft: string,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    chatHost: HTMLElement,
    options: {
        readonly resolvedPinnedId: string;
        readonly showApprovalPolicy: boolean;
        readonly isLegacyTheiaChat: boolean;
        /** When set, bypass the queue and dispatch directly with this delivery mode. */
        readonly forceDeliveryMode?: 'queue' | 'parallel' | 'interrupt';
    },): Promise<void> {
    const contextSnapshot = [...ctx.host.transcriptComposerContext];
    const selectedAgentId = resolveExplicitAgentForSubmit(draft, {
        pinnedChatAgentId: options.resolvedPinnedId,
    }) ?? options.resolvedPinnedId;
    const requests = composerContextRequests(contextSnapshot);
    const variables = requests.length > 0 ? requests : undefined;
    const imagePreviews = await collectComposerImagePreviews(
        contextSnapshot,
        ctx.host.resolveAttachmentPreview,
    );
    const modeId = ctx.host.transcriptComposerModeId;
    const autoApprove = resolveComposerAutoApprove(
        options.showApprovalPolicy,
        ctx.host.transcriptComposerApprovalPolicyId,
        summary.cwd,
    );
    ctx.host.transcriptComposerContext = [];
    const commitComposerSubmission = (): void => {
        disposeComposerContextEntries(contextSnapshot);
    };
    const restoreComposerSubmission = (): void => {
        const existingIds = new Set(ctx.host.transcriptComposerContext.map(entry => entry.id));
        ctx.host.transcriptComposerContext = [
            ...contextSnapshot.filter(entry => !existingIds.has(entry.id)),
            ...ctx.host.transcriptComposerContext,
        ];
        ctx.host.transcriptComposerDraft = mergeFailedComposerDraft(
            draft,
            ctx.host.transcriptComposerDraft,
        );
        if (isAgentsHubIdleConversationSummary(summary)) {
            writeProjectComposerDraft(project.id, ctx.host.transcriptComposerDraft);
        } else {
            writeConversationComposerDraft(summary.id, ctx.host.transcriptComposerDraft);
        }
    };
    const clearComposerDraft = (): void => {
        if (ctx.host.transcriptComposerDraftPersistTimer !== undefined) {
            window.clearTimeout(ctx.host.transcriptComposerDraftPersistTimer);
            ctx.host.transcriptComposerDraftPersistTimer = undefined;
        }
        if (isAgentsHubIdleConversationSummary(summary)) {
            // Shared idle summary id — clear the project-scoped draft instead of the (unrelated) per-conversation one.
            writeProjectComposerDraft(project.id, '');
        } else {
            clearConversationComposerDraft(summary.id);
        }
        ctx.host.transcriptComposerDraft = '';
    };
    if ((ctx.isTranscriptStickyComposerAgentWorking() || summary.status === 'streaming' || summary.status === 'settled') && !isAgentsHubIdleConversationSummary(summary)) {
        // Busy follow-up: Queue stays in the composer popover (Edit / Send now / wait).
        // Parallel / Interrupt bypass that UI and POST immediately. Queue is also mirrored
        // to durable server pendingUserMessages so F5 does not drop the follow-up.
        //
        // The draft is kept in the composer until the follow-up is actually captured —
        // locally queued or accepted by the peer-run POST. If either fails, the user still
        // has their text and attachments in the box instead of losing them to a toast.
        const deliveryMode = resolveBusyFollowUpDeliveryMode({
            forceDeliveryMode: options.forceDeliveryMode,
        });
        const entry: TranscriptFollowUpEntry = {
            draft,
            selectedAgentId,
            modeId,
            autoApprove,
            approvalPolicyId: reconcileAgentApprovalPolicyId(
                ctx.host.transcriptComposerApprovalPolicyId,
                summary.cwd,
            ),
            variables,
            imagePreviews,
            deliveryMode,
        };
        const refreshComposerAfterCapture = (): void => {
            clearComposerDraft();
            const input = ctx.host.transcriptComposerHost?.querySelector('.theia-mobile-projects-sticky-composer-input');
            input?.dispatchEvent(new Event('input', { bubbles: true }));
            ctx.host.transcriptComposerSendRefresh?.();
        };
        if (shouldBypassLocalFollowUpQueue(deliveryMode)) {
            const ok = await ctx.startPeerRunOrQueue(project, summary, entry);
            if (!ok) {
                restoreComposerSubmission();
                ctx.host.messageService?.warn(nls.localize(
                    'qaap/mobileProjects/followUpSendFailedRestored',
                    'Could not send the follow-up. Your draft and attachments were restored.',
                ));
                ctx.remountTranscriptStickyComposer();
                return;
            }
            refreshComposerAfterCapture();
            ctx.remountTranscriptStickyComposer();
            return;
        }
        const queued = ctx.queuePeerRunMessage(summary, entry);
        if (!queued) {
            // queuePeerRunMessage already surfaced the "queue full" error.
            restoreComposerSubmission();
            ctx.remountTranscriptStickyComposer();
            return;
        }
        refreshComposerAfterCapture();
        const mirrored = await ctx.mirrorFollowUpToServerQueue(project, summary, entry);
        if (mirrored === false) {
            ctx.host.messageService?.warn(nls.localize(
                'qaap/mobileProjects/followUpMirrorFailed',
                'Queued locally; could not sync to server. It may not survive reload.',
            ));
        }
        ctx.remountTranscriptStickyComposer();
        return;
    }
    clearComposerDraft();
    if (isAgentsHubIdleConversationSummary(summary)) {
        const activeChatHost = ctx.resolveComposerTranscriptChatHost(chatHost);
        if (activeChatHost) {
            ctx.workHub.renderIdleSubmitOptimistic(activeChatHost, summary, draft, selectedAgentId, imagePreviews);
        }
        ctx.host.transcriptComposerSendRefresh?.();
        try {
            await ctx.host.submitBackgroundAgentTask(project, draft, {
                openConversation: true,
                forceVps: true,
                selectedAgentId,
                modeId,
                variables,
                autoApprove,
                worktree: ctx.host.stickyComposerWorkspaceUi.resolveComposerWorkspaceDestination(project) === 'worktree',
                approvalPolicyId: reconcileAgentApprovalPolicyId(
                    ctx.host.transcriptComposerApprovalPolicyId,
                    summary.cwd,
                ),
                agentModel: ctx.host.transcriptComposerAgentModel,
                imagePreviews,
            });
            commitComposerSubmission();
        } catch {
            restoreComposerSubmission();
            /* submitBackgroundAgentTask surfaces errors */
        } finally {
            if (ctx.host.transcriptComposerHost?.isConnected) {
                ctx.remountTranscriptStickyComposer();
            } else {
                ctx.host.stickyComposerRenderUi.renderStickyComposer();
            }
        }
        return;
    }
    // Existing backend conversations render their optimistic row inside
    // submitTranscriptViaBackendConversation. Painting it here as well races with that
    // submission and can leave the follow-up visible twice.
    try {
        if (options.isLegacyTheiaChat) {
            await ctx.host.submitBackgroundAgentTask(project, draft, {
                openConversation: true,
                forceVps: true,
                selectedAgentId: QAAP_PRIMARY_AGENT_ID,
                modeId,
                variables,
                autoApprove,
                approvalPolicyId: reconcileAgentApprovalPolicyId(
                    ctx.host.transcriptComposerApprovalPolicyId,
                    summary.cwd,
                ),
                imagePreviews,
            });
            commitComposerSubmission();
        } else {
            const submitted = await ctx.host.submitTranscriptViaBackendConversation(project, summary, draft, {
                selectedAgentId,
                modeId,
                variables,
                autoApprove,
                approvalPolicyId: reconcileAgentApprovalPolicyId(
                    ctx.host.transcriptComposerApprovalPolicyId,
                    summary.cwd,
                ),
                agentModel: ctx.host.transcriptComposerAgentModel,
                imagePreviews,
            });
            if (!submitted) {
                restoreComposerSubmission();
                ctx.host.messageService?.warn(nls.localize(
                    'qaap/mobileProjects/transcriptSendInFlight',
                    'Another message is still being sent. Your draft and attachments were restored.',
                ));
                return;
            }
            commitComposerSubmission();
        }
    } catch (error) {
        restoreComposerSubmission();
        if (isMaxConcurrentRunsError(error)) {
            // The conversation already has the maximum number of concurrent agent runs.
            // Show a friendly message instead of a generic error — the user can wait for
            // one of the running tasks to finish and then resend.
            ctx.host.messageService?.warn(nls.localize(
                'qaap/mobileProjects/maxConcurrentRuns',
                'This task already has the maximum number of agents running. Wait for one to finish, then resend.',
            ));
        } else {
            const detail = error instanceof Error ? error.message : String(error);
            ctx.host.messageService?.error(nls.localize(
                'qaap/mobileProjects/transcriptSendFailed', 'Could not send: {0}', detail
            ));
        }
    } finally {
        ctx.remountTranscriptStickyComposer();
    }
}

export function remountTranscriptStickyComposerExtracted(ctx: any): void {
    const host = ctx.host.transcriptComposerHost;
    const project = ctx.host.transcriptComposerProject;
    const summary = ctx.host.transcriptComposerSummary;
    const chatHost = ctx.resolveComposerTranscriptChatHost(ctx.host.transcriptChatHost);
    if (!host?.isConnected || !project || !summary) {
        return;
    }
    ctx.host.transcriptComposerMountKey = undefined;
    ctx.mountTranscriptStickyComposer(host, project, summary, chatHost ?? host);
}
