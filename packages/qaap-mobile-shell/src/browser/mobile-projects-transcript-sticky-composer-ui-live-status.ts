import type { MobileProjectsTranscriptStickyComposerUiContext } from './mobile-projects-transcript-sticky-composer-ui-context';
// Extracted from mobile-projects-transcript-sticky-composer-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import {
    isMaxConcurrentRunsError,
    type QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import {
    QAAP_PRIMARY_AGENT_ID,
    resolveExplicitAgentForSubmit,
} from '../common/qaap-agent-task-client';
import {
    clearConversationComposerDraft,
    writeConversationComposerDraft,
} from '../common/qaap-conversation-composer-state';
import {
    reconcileAgentApprovalPolicyId,
    resolveComposerAutoApprove,
} from '../common/qaap-sticky-composer-approval-policy';
import {
    type TranscriptFollowUpEntry,
} from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-follow-up-queue';
import {
    resolveBusyFollowUpDeliveryMode,
    shouldBypassLocalFollowUpQueue,
} from '@theia/qaap-transcript-overlay/lib/browser/qaap-composer-delivery-mode';
import { isAgentsHubIdleConversationSummary } from '../common/qaap-agents-hub-landing';
import { writeProjectComposerDraft } from '../common/qaap-project-composer-draft';
import { collectComposerImagePreviews } from './qaap-sticky-composer-context-ui';
import {
    composerContextRequests,
    disposeComposerContextEntries,
} from '../common/qaap-composer-context-entry';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { QaapTranscriptUserImagePreview } from '../common/qaap-transcript-user-image-preview';
import {
    mergeFailedComposerDraft,
} from './mobile-projects-transcript-sticky-composer-helpers';

export async function submitTranscriptComposerDraftExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext, draft: string,
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
    let imagePreviews: QaapTranscriptUserImagePreview[] = [];
    try {
        imagePreviews = await collectComposerImagePreviews(
            contextSnapshot,
            ctx.host.resolveAttachmentPreview,
        );
    } catch (error) {
        // A preview is cosmetic; a failed device/file preview must never abort the actual
        // prompt submission after the composer has already accepted it.
        console.warn('[qaap] failed to collect composer image previews', error);
    }
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
        try {
            const activeChatHost = ctx.resolveComposerTranscriptChatHost(chatHost);
            if (activeChatHost) {
                ctx.workHub.renderIdleSubmitOptimistic(activeChatHost, summary, draft, selectedAgentId, imagePreviews);
            }
        } catch (error) {
            // The optimistic row must not be allowed to block the real create request. This can
            // happen while the Work Hub is replacing a detached inline transcript host; the
            // conversation open path below will paint the live transcript once it exists.
            console.warn('[qaap] failed to render optimistic transcript submit', error);
        }
        ctx.host.transcriptComposerSendRefresh?.();
        try {
            const started = await ctx.host.submitBackgroundAgentTask(project, draft, {
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
            // Background submission reports preflight/create failures as `undefined` after
            // surfacing the actionable error (for example when QAIQ is missing). Keep the
            // prompt recoverable instead of treating that failure as a successful send.
            if (started) {
                commitComposerSubmission();
            } else {
                restoreComposerSubmission();
            }
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
            const started = await ctx.host.submitBackgroundAgentTask(project, draft, {
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
            if (started) {
                commitComposerSubmission();
            } else {
                restoreComposerSubmission();
            }
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

export function remountTranscriptStickyComposerExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext): void {
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
