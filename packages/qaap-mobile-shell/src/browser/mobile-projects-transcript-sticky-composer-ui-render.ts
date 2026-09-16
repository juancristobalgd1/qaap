// @ts-nocheck
// Extracted from mobile-projects-transcript-sticky-composer-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import URI from '@theia/core/lib/common/uri';
import { resolveWorkspaceHostFsPath } from './qaap-project-bootstrap-shell';
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
import { COMPOSER_PREVIEW_HEALTH_INTERVAL_MS } from './mobile-projects-transcript-sticky-composer-ui';

export function scheduleIdleComposerFocusRetentionExtracted(ctx: any, textarea: HTMLTextAreaElement): void {
        ctx.clearIdleComposerFocusRetention();
        let lastUserInteraction = 0;
        const markInteraction = (): void => { lastUserInteraction = Date.now(); };
        const onFocusOut = (): void => {
            // Let the new focus target settle before inspecting it.
            setTimeout(() => {
                if (!textarea.isConnected || textarea.disabled) {
                    ctx.clearIdleComposerFocusRetention();
                    return;
                }
                const active = document.activeElement;
                const userDriven = Date.now() - lastUserInteraction < 500;
                if (isIdleComposerFocusStealable(active, textarea) && !userDriven) {
                    textarea.focus();
                }
            }, 0);
        };
        window.addEventListener('pointerdown', markInteraction, true);
        window.addEventListener('keydown', markInteraction, true);
        textarea.addEventListener('focusout', onFocusOut);
        const expiry = setTimeout(() => ctx.clearIdleComposerFocusRetention(), 10_000);
        ctx.idleComposerFocusRetentionDispose = () => {
            clearTimeout(expiry);
            window.removeEventListener('pointerdown', markInteraction, true);
            window.removeEventListener('keydown', markInteraction, true);
            textarea.removeEventListener('focusout', onFocusOut);
        };
}

export function resolveComposerPreviewRuntimeExtracted(ctx: any, project: MobileProjectEntry): ComposerPreviewRuntime {
        const bootstrap = ctx.host.projectBootstrap;
        const descriptor = bootstrap?.descriptor;
        return {
            projectId: project.id,
            projectCwd: ctx.host.projectsService.getProjectCwd(project),
            bootstrapRoot: descriptor ? resolveWorkspaceHostFsPath(descriptor.rootUri) : undefined,
            dependenciesInstalled: descriptor?.nodeModulesPresent === true,
            phase: bootstrap?.phase ?? 'idle',
            previewUrl: bootstrap?.previewUrl,
        };
}

export function clearComposerPreviewHealthTimerExtracted(ctx: any): void {
        if (ctx.composerPreviewHealthTimer !== undefined) {
            window.clearTimeout(ctx.composerPreviewHealthTimer);
            ctx.composerPreviewHealthTimer = undefined;
        }
}

export function scheduleComposerPreviewHealthCheckExtracted(ctx: any, projectId: string): void {
        ctx.clearComposerPreviewHealthTimer();
        ctx.composerPreviewHealthTimer = window.setTimeout(() => {
            ctx.composerPreviewHealthTimer = undefined;
            if (ctx.host.transcriptComposerProject?.id !== projectId
                || !ctx.host.transcriptComposerHost?.isConnected) {
                return;
            }
            ctx.composerPreviewLastCheckedAt = 0;
            ctx.refreshComposerActivityStack();
        }, COMPOSER_PREVIEW_HEALTH_INTERVAL_MS);
}

export function syncComposerPreviewAvailabilityExtracted(ctx: any, project: MobileProjectEntry, candidate: string | undefined): void {
        if (!candidate) {
            ctx.clearComposerPreviewHealthTimer();
            if (ctx.verifiedComposerPreview?.projectId === project.id) {
                ctx.verifiedComposerPreview = undefined;
            }
            return;
        }
        const runtime = ctx.resolveComposerPreviewRuntime(project);
        const verified = ctx.verifiedComposerPreview?.projectId === project.id
            ? resolveVerifiedComposerPreviewUrl(runtime, ctx.verifiedComposerPreview.url)
            : undefined;
        if (verified && Date.now() - ctx.composerPreviewLastCheckedAt < COMPOSER_PREVIEW_HEALTH_INTERVAL_MS) {
            ctx.scheduleComposerPreviewHealthCheck(project.id);
            return;
        }
        if (ctx.composerPreviewProbeInFlight) {
            return;
        }
        // Identity preview URLs (`/qaap-preview/<id>/`) carry no port — verify them through the
        // identity probe instead of silently bailing, or the "Open preview" pill can never appear
        // for identity-proxied apps (the "started the app but nothing to click" failure).
        const port = extractDevPreviewPortFromUrl(candidate);
        const identityId = port === undefined
            ? extractTranscriptPreviewId(candidate, window.location.origin)
            : undefined;
        if (port === undefined && !identityId) {
            return;
        }
        const probePromise = port !== undefined
            ? probeQaapDevPreviewPort(port)
            : probeQaapIdentityPreview(identityId!);
        ctx.composerPreviewProbeInFlight = probePromise.then(async probe => {
            ctx.composerPreviewLastCheckedAt = Date.now();
            const currentProject = ctx.host.transcriptComposerProject;
            const stillCurrent = currentProject?.id === project.id
                && resolveComposerPreviewCandidate(ctx.resolveComposerPreviewRuntime(currentProject));
            if (!probe.ready && stillCurrent) {
                // The candidate claim may have been superseded by a newer run (retry, second
                // tab, backend restart) — its identity probe then 403s although the project has
                // a live preview. Adopting the successor refreshes `bootstrap.previewUrl`, so
                // the re-sync below verifies the live claim instead of dropping the pill.
                const adopted = await ctx.host.projectBootstrap?.reconcileSupersededPreviewClaim()
                    .catch(() => false);
                if (adopted && ctx.host.transcriptComposerProject?.id === project.id) {
                    ctx.composerPreviewLastCheckedAt = 0;
                    window.setTimeout(() => {
                        if (ctx.host.transcriptComposerProject?.id === project.id) {
                            ctx.refreshComposerActivityStack();
                        }
                    }, 0);
                }
            }
            const next = probe.ready && stillCurrent
                ? { projectId: project.id, url: probe.previewUrl }
                : undefined;
            const changed = ctx.verifiedComposerPreview?.projectId !== next?.projectId
                || ctx.verifiedComposerPreview?.url !== next?.url;
            ctx.verifiedComposerPreview = next;
            if (stillCurrent) {
                ctx.scheduleComposerPreviewHealthCheck(project.id);
            } else {
                ctx.clearComposerPreviewHealthTimer();
            }
            if (changed) {
                ctx.refreshComposerActivityStack();
            }
        }).finally(() => {
            ctx.composerPreviewProbeInFlight = undefined;
        });
}

export async function openComposerPreviewExtracted(ctx: any, projectId: string): Promise<void> {
        const opened = await openCurrentComposerPreview(
            projectId,
            () => {
                const current = ctx.host.transcriptComposerProject;
                return current ? ctx.resolveComposerPreviewRuntime(current) : undefined;
            },
            target => target.previewId !== undefined
                ? probeQaapIdentityPreview(target.previewId)
                : probeQaapDevPreviewPort(target.port!),
            url => ctx.host.transcriptOpenProject?.id === projectId
                ? ctx.host.transcriptMessagesUi.openTranscriptPreviewUrlFromLink(url)
                : Promise.resolve(false),
        );
        if (!opened) {
            // A URL the backend just verified as ready must not dead-end in a silent no-op (the
            // transcript surface can lack an open summary right after a reload). Route through the
            // bootstrap opener: its qaap-bootstrap-preview-opened event surfaces the hub Preview
            // tab, and the IDE surface gets the mini-browser widget as before. Keep the pill.
            //
            // ONLY when the active bootstrap actually belongs to this project: the bootstrap is
            // scoped to the active workspace, so falling back while another project's transcript
            // is open would surface (and record) the WRONG app's preview — observed live as an
            // empty repo getting another project's previewUrl persisted onto its hub session.
            const bootstrap = ctx.host.projectBootstrap;
            const project = ctx.host.transcriptComposerProject;
            const ownsBootstrap = !!project
                && project.id === projectId
                && !!resolveComposerPreviewCandidate(ctx.resolveComposerPreviewRuntime(project));
            if (bootstrap && ownsBootstrap) {
                await bootstrap.focusPreview();
                return;
            }
            ctx.verifiedComposerPreview = undefined;
            ctx.composerPreviewLastCheckedAt = 0;
            ctx.refreshComposerActivityStack();
        }
}

export function syncTranscriptComposerQuickActionsVisibilityExtracted(ctx: any, host: HTMLElement,
        summary: QaapAgentConversationSummaryDTO,): void {
        const current = ctx.host.transcriptLastConv?.id === summary.id
            ? ctx.host.transcriptLastConv
            : ctx.host.transcriptLiveUi.peekCachedOpenTranscript(summary.id);
        const conv = current ?? {
            id: summary.id,
            cwd: summary.cwd,
            agentId: summary.agentId,
            title: summary.title,
            status: summary.status,
            createdAt: summary.createdAt,
            updatedAt: summary.updatedAt,
            messages: [],
        };
        host.classList.toggle(
            'theia-mod-show-quick-actions',
            shouldShowTranscriptEmptyQuickActions(conv, current),
        );
}

export async function onTranscriptComposerAttachExtracted(ctx: any, project: MobileProjectEntry,
        anchor: HTMLElement,): Promise<void> {
        if (!ctx.host.pickContextVariable) {
            return;
        }
        const uploadTargetDir = ctx.resolveComposerUploadTargetDir(project);
        const variables = await ctx.host.pickContextVariable(
            anchor,
            ctx.host.stickyComposerContextUi.createTranscriptComposerAttachHandlers(uploadTargetDir),
        );
        if (variables.length === 0) {
            return;
        }
        for (const request of variables) {
            ctx.host.transcriptComposerContext.push(createComposerContextEntry(request));
        }
        ctx.remountTranscriptStickyComposer();
}

export function resolveComposerUploadTargetDirExtracted(ctx: any, project: MobileProjectEntry): URI | undefined {
        if (project.uri) {
            return project.uri;
        }
        const cwd = ctx.host.projectsService.getProjectCwd(project);
        return cwd ? new URI().withScheme('file').withPath(cwd) : undefined;
}

export function resolveTranscriptContextUsageTargetExtracted(ctx: any, summary: QaapAgentConversationSummaryDTO,): {
        readonly summary?: QaapAgentConversationSummaryDTO;
        readonly chatModel?: ChatModel;
        readonly full?: QaapAgentConversationDTO;
    } {
        if (summary.source === 'theia-chat') {
            const chatModel = ctx.resolveTranscriptTheiaChatModel(summary);
            return chatModel ? { chatModel } : {};
        }
        const live = ctx.host.conversations?.findSummaryById(summary.id) ?? summary;
        if (ctx.host.transcriptLastConv?.id === summary.id) {
            const effectiveStatus = resolveTranscriptEffectiveStatus(ctx.host.transcriptLastConv);
            return {
                summary: { ...live, status: effectiveStatus },
                full: ctx.host.transcriptLastConv,
            };
        }
        return { summary: live };
}

export function resolveTranscriptTheiaChatModelExtracted(ctx: any, summary: QaapAgentConversationSummaryDTO): ChatModel | undefined {
        if (summary.source !== 'theia-chat' || !summary.sessionId || !ctx.host.chatService) {
            return undefined;
        }
        return ctx.host.chatService.getSession(summary.sessionId)?.model;
}

export function enqueueTranscriptFollowUpExtracted(ctx: any, conversationId: string,
        entry: TranscriptFollowUpEntry,): boolean {
        const wasEmpty = ctx.host.transcriptFollowUpQueue.size(conversationId) === 0;
        const ok = ctx.host.transcriptFollowUpQueue.enqueue(conversationId, entry);
        if (!ok) {
            MobileSnackbar.show(
                nls.localize(
                    'qaap/mobileProjects/transcriptFollowUpQueueFull',
                    'Queue is full ({0} messages). Wait for the agent to finish.',
                    String(MAX_TRANSCRIPT_FOLLOW_UP_QUEUE),
                ),
                { kind: 'warning', duration: 2800 },
            );
            return false;
        }
        // A persisted collapsed state is useful for an existing queue, but a newly queued
        // follow-up must be discoverable while the current agent turn is still running.
        if (wasEmpty && ctx.isTranscriptStickyComposerAgentWorking?.()) {
            ctx.host.transcriptComposerQueueExpanded = true;
        }
        const count = ctx.host.transcriptFollowUpQueue.size(conversationId);
        MobileSnackbar.show(
            nls.localize(
                'qaap/mobileProjects/transcriptFollowUpQueued',
                '{0} message(s) queued — will send when the agent finishes',
                String(count),
            ),
            { kind: 'success', duration: 1600 },
        );
        return true;
}

export function resolveComposerActivityFilesForStackExtracted(ctx: any, _project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        conv: QaapAgentConversationDTO | undefined,): {
        readonly files: StickyComposerChangedFileView[];
        readonly stats?: { readonly added: number; readonly removed: number };
    } {
        const activityFiles = ctx.host.transcriptMessagesUi.resolveComposerActivityFiles(conv, summary);
        if (!ctx.hasComposerFileActivity(conv)) {
            return { files: [] };
        }
        const gitFiles = ctx.composerActivityGitFilesByConversationId.get(summary.id);
        const selection = selectComposerPillChanges(
            gitFiles,
            ctx.composerChangesResolvedByConversationId.has(summary.id),
            ctx.composerCleanTreeByConversationId.has(summary.id),
        );
        // Persist clean/resolved only when the git snapshot confirms there is nothing left. The
        // transcript permanently records agent edits, so a later snapshot invalidation would
        // otherwise fall through to transcript-derived stats and resurrect stale controls.
        if (selection.resolved) {
            ctx.composerChangesResolvedByConversationId.add(summary.id);
        } else {
            ctx.composerChangesResolvedByConversationId.delete(summary.id);
        }
        if (selection.clean) {
            ctx.composerCleanTreeByConversationId.add(summary.id);
        } else {
            ctx.composerCleanTreeByConversationId.delete(summary.id);
        }
        if (selection.hidden) {
            return { files: [] };
        }
        if (selection.files) {
            return {
                files: selection.files,
                stats: ctx.resolveChangedFilesStats(selection.files, activityFiles.stats),
            };
        }
        return activityFiles;
}

export function hasComposerFileActivityExtracted(ctx: any, conv: QaapAgentConversationDTO | undefined): boolean {
        const transcriptEvidence = ctx.host.transcriptMessagesUi.resolveComposerActivityFiles(conv, undefined, { allTurns: true });
        return ctx.hasComposerAgentActivity(transcriptEvidence)
            || ctx.host.transcriptMessagesUi.hasComposerFileChangeToolCalls(conv);
}

export function shouldRefetchComposerGitSnapshotExtracted(ctx: any, summaryId: string,
        conv: QaapAgentConversationDTO | undefined,): boolean {
        if (!ctx.composerActivityGitFilesByConversationId.has(summaryId)) {
            return true;
        }
        const cached = ctx.composerActivityGitFilesByConversationId.get(summaryId);
        if (!cached || cached.length > 0) {
            return false;
        }
        // Empty snapshot: if the resolved or clean latch is set the tree was intentionally
        // cleared by an explicit user action (Accept staged all / Discard cleaned the tree).
        // Do NOT delete + re-fetch here — that creates a gap where the snapshot is undefined
        // while clearStaleComposerGitLatches is still wiping the latches, which lets
        // transcript-derived evidence resurface the Changes pill until the fetch resolves.
        if (ctx.composerChangesResolvedByConversationId.has(summaryId)
            || ctx.composerCleanTreeByConversationId.has(summaryId)) {
            return false;
        }
        return ctx.hasComposerFileActivity(conv);
}

export function hasComposerCommittableChangesFromGitExtracted(ctx: any, summary: QaapAgentConversationSummaryDTO): boolean {
        const gitFiles = ctx.composerActivityGitFilesByConversationId.get(summary.id);
        if (gitFiles) {
            return gitFiles.length > 0;
        }
        return !ctx.composerCleanTreeByConversationId.has(summary.id);
}

export function hasComposerAgentActivityExtracted(ctx: any, activityFiles: {
        readonly files: readonly StickyComposerChangedFileView[];
        readonly stats?: { readonly added: number; readonly removed: number };
    }): boolean {
        return hasComposerAgentActivityHelper(activityFiles);
}

export function resolveChangedFilesStatsExtracted(ctx: any, files: readonly StickyComposerChangedFileView[],
        fallback?: { readonly added: number; readonly removed: number },): { readonly added: number; readonly removed: number } | undefined {
        return resolveChangedFilesStatsHelper(files, fallback);
}

export function resolveComposerWorkspaceRootExtracted(ctx: any, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,): string | undefined {
        return ctx.host.projectsService.getProjectCwd(project) ?? summary.cwd;
}

export async function fetchWorkspaceChangedFilesExtracted(ctx: any, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,): Promise<StickyComposerChangedFileView[]> {
        const cwd = ctx.resolveComposerWorkspaceRoot(project, summary);
        if (!cwd) {
            return [];
        }
        const response = await fetch(
            `${QAAP_GIT_REVIEW_API_PATH}/changes?root=${encodeURIComponent(cwd)}`,
            { credentials: 'include' },
        );
        if (!response.ok) {
            throw new Error(`git changes request failed (${response.status})`);
        }
        const body = await response.json() as { files?: QaapGitChangedFile[] };
        return (body.files ?? []).map(file => ctx.mapGitChangedFileToComposerView(file));
}
