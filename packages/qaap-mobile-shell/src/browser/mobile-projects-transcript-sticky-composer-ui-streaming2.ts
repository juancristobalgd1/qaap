// @ts-nocheck
// Extracted from mobile-projects-transcript-sticky-composer-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { ensureTranscriptDevPreview } from './qaap-transcript-preview-bootstrap';
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

export async function runComposerGitFileActionExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    endpoint: 'stage' | 'discard',
    files: readonly StickyComposerChangedFileView[],): Promise<void> {
    const cwd = ctx.resolveComposerWorkspaceRoot(project, summary);
    if (!cwd || files.length === 0) {
        return;
    }
    for (const file of files) {
        const response = await fetch(`${QAAP_GIT_REVIEW_API_PATH}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ root: cwd, file: file.path }),
        });
        if (!response.ok) {
            const body = await response.json().catch(() => ({})) as { error?: string };
            throw new Error(body.error ?? `${endpoint} failed (${response.status})`);
        }
    }
}

export async function syncComposerGitSnapshotExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<StickyComposerChangedFileView[]> {
    const files = await ctx.fetchWorkspaceChangedFiles(project, summary);
    ctx.composerActivityGitFilesByConversationId.set(summary.id, files);
    return files;
}

export async function undoAllComposerChangedFilesExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    if (ctx.composerChangedFilesBulkBusy) {
        return;
    }
    const confirmed = await new ConfirmDialog({
        title: nls.localize('qaap/mobileProjects/stickyComposerDiscardAllTitle', 'Discard changes'),
        msg: nls.localize(
            'qaap/mobileProjects/stickyComposerDiscardAllMsg',
            'Discard all pending changes? This cannot be undone.',
        ),
        ok: nls.localize('qaap/mobileProjects/stickyComposerDiscardAllConfirm', 'Discard'),
        cancel: nls.localize('qaap/mobileProjects/parallelCancel', 'Back'),
    }).open();
    if (!confirmed) {
        return;
    }
    ctx.composerChangedFilesBulkBusy = true;
    ctx.refreshComposerActivityStack();
    try {
        const files = await ctx.fetchWorkspaceChangedFiles(project, summary);
        if (files.length === 0) {
            return;
        }
        await ctx.runComposerGitFileAction(project, summary, 'discard', files);
        await ctx.syncComposerGitSnapshot(project, summary);
        ctx.refreshComposerActivityStack();
        MobileSnackbar.show(
            nls.localize('qaap/mobileProjects/stickyComposerUndoAllDone', 'All changes discarded'),
            { kind: 'success', duration: 1800 },
        );
    } catch {
        MobileSnackbar.show(
            nls.localize('qaap/mobileProjects/stickyComposerUndoAllFailed', 'Could not discard all changes'),
            { kind: 'warning', duration: 2800 },
        );
    } finally {
        ctx.composerChangedFilesBulkBusy = false;
        ctx.refreshComposerActivityStack();
    }
}

export async function keepAllComposerChangedFilesExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    if (ctx.composerChangedFilesBulkBusy) {
        return;
    }
    ctx.composerChangedFilesBulkBusy = true;
    ctx.refreshComposerActivityStack();
    try {
        const files = await ctx.fetchWorkspaceChangedFiles(project, summary);
        if (files.length === 0) {
            return;
        }
        await ctx.runComposerGitFileAction(project, summary, 'stage', files);
        await ctx.syncComposerGitSnapshot(project, summary);
        ctx.refreshComposerActivityStack();
        MobileSnackbar.show(
            nls.localize('qaap/mobileProjects/stickyComposerKeepAllDone', 'All changes kept'),
            { kind: 'success', duration: 1800 },
        );
    } catch {
        MobileSnackbar.show(
            nls.localize('qaap/mobileProjects/stickyComposerKeepAllFailed', 'Could not keep all changes'),
            { kind: 'warning', duration: 2800 },
        );
    } finally {
        ctx.composerChangedFilesBulkBusy = false;
        ctx.refreshComposerActivityStack();
    }
}

export async function refreshComposerActivityGitFilesIfNeededExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    conv: QaapAgentConversationDTO | undefined,
    activityFiles: {
        readonly files: readonly StickyComposerChangedFileView[];
        readonly stats?: { readonly added: number; readonly removed: number };
    },): Promise<void> {
    if (!ctx.isComposerBackgroundWorkAllowed()) {
        return;
    }
    if (!ctx.shouldRefetchComposerGitSnapshot(summary.id, conv)) {
        return;
    }
    if (ctx.composerActivityGitFilesByConversationId.has(summary.id)) {
        ctx.composerActivityGitFilesByConversationId.delete(summary.id);
    }
    // Skip the repo-wide git snapshot until the agent has actually edited files here.
    // Tool-call evidence alone must count: some agent CLIs (e.g. opencode/QAIQ) report
    // Edit/Write tool calls without parseable paths or diff stats, leaving activityFiles
    // empty even though the agent did change files — same gate as the pill itself.
    if (!ctx.hasComposerAgentActivity(activityFiles)
        && !ctx.host.transcriptMessagesUi.hasComposerFileChangeToolCalls(conv)) {
        return;
    }
    const cwd = ctx.host.projectsService.getProjectCwd(project) ?? summary.cwd;
    if (!cwd) {
        return;
    }
    try {
        const response = await fetch(
            `${QAAP_GIT_REVIEW_API_PATH}/changes?root=${encodeURIComponent(cwd)}`,
            { credentials: 'include' },
        );
        if (!response.ok) {
            return;
        }
        const body = await response.json() as { files?: QaapGitChangedFile[] };
        const files = (body.files ?? []).map(file => ctx.mapGitChangedFileToComposerView(file));
        // While the agent is still running, an empty snapshot usually means the edit hasn't
        // landed on disk yet — don't latch a false "clean tree" for the Changes row.
        if (files.length === 0 && conv?.status === 'streaming') {
            return;
        }
        ctx.composerActivityGitFilesByConversationId.set(summary.id, files);
        if (ctx.host.transcriptComposerSummary?.id !== summary.id) {
            return;
        }
        if (buildStickyComposerChangesPillFingerprint(ctx.buildTranscriptComposerActivityOptions(project, summary))
            === ctx.lastComposerChangesPillFingerprint) {
            return;
        }
        ctx.refreshComposerActivityStack();
    } catch {
        // Git review is optional — composer still shows aggregate diff stats.
    }
}

export function buildTranscriptComposerActivityOptionsExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): StickyComposerActivityStackOptions {
    const conv = ctx.host.transcriptLastConv?.id === summary.id ? ctx.host.transcriptLastConv : undefined;
    const activityFiles = ctx.resolveComposerActivityFilesForStack(project, summary, conv);
    void ctx.refreshComposerActivityGitFilesIfNeeded(project, summary, conv, activityFiles);
    const agentWorking = ctx.isTranscriptStickyComposerAgentWorking();
    // Everything below is gated on the agent having actually edited files in THIS conversation.
    // A fresh/idle conversation has no activity and no git snapshot, so the whole row stays gone.
    const hasFileActivity = ctx.hasComposerFileActivity(conv);
    const hasCommittableChanges = hasFileActivity && ctx.hasComposerCommittableChangesFromGit(summary);
    const previewRuntime = ctx.resolveComposerPreviewRuntime(project);
    const previewCandidate = resolveComposerPreviewCandidate(previewRuntime);
    ctx.syncComposerPreviewAvailability(project, previewCandidate);
    const verifiedPreviewUrl = ctx.verifiedComposerPreview?.projectId === project.id
        ? resolveVerifiedComposerPreviewUrl(previewRuntime, ctx.verifiedComposerPreview.url)
        : undefined;
    return {
        queueEntries: ctx.host.transcriptFollowUpQueue.peek(summary.id),
        queueExpanded: ctx.host.transcriptComposerQueueExpanded,
        onQueueExpandedChange: expanded => { ctx.host.transcriptComposerQueueExpanded = expanded; },
        onQueueEdit: (index, entry) => {
            ctx.host.transcriptComposerDraft = entry.draft;
            const existingRequests = new Set(ctx.host.transcriptComposerContext.map(item => item.request));
            const restored = (entry.variables ?? [])
                .filter(request => !existingRequests.has(request))
                .map(request => createComposerContextEntry(request));
            ctx.host.transcriptComposerContext = [...restored, ...ctx.host.transcriptComposerContext];
            ctx.host.transcriptFollowUpQueue.removeAt(summary.id, index);
            if (entry.serverPendingId && ctx.host.transcriptMessagesUi?.cancelQueuedMessage) {
                void ctx.host.transcriptMessagesUi.cancelQueuedMessage(summary.id, entry.serverPendingId);
            }
            ctx.syncTranscriptQueuedFollowUpBubbles(summary);
            ctx.remountTranscriptStickyComposer();
        },
        onQueueSendNow: index => {
            void ctx.sendQueuedFollowUpNow(project, summary, index);
        },
        onQueueInterrupt: index => {
            void ctx.interruptQueuedFollowUp(project, summary, index);
        },
        onQueueRemove: index => {
            const removed = ctx.host.transcriptFollowUpQueue.takeAt(summary.id, index);
            if (removed?.serverPendingId && ctx.host.transcriptMessagesUi?.cancelQueuedMessage) {
                void ctx.host.transcriptMessagesUi.cancelQueuedMessage(summary.id, removed.serverPendingId);
            }
            ctx.refreshComposerActivityStack();
        },
        onQueueClose: index => {
            const removed = ctx.host.transcriptFollowUpQueue.takeAt(summary.id, index);
            if (removed?.serverPendingId && ctx.host.transcriptMessagesUi?.cancelQueuedMessage) {
                void ctx.host.transcriptMessagesUi.cancelQueuedMessage(summary.id, removed.serverPendingId);
            }
            ctx.refreshComposerActivityStack();
        },
        onQueueReorder: (fromIndex, toIndex) => {
            // FLIP animation: record first positions before re-render.
            const wrap = ctx.host.transcriptComposerHost?.querySelector('.theia-mobile-projects-sticky-composer-inner');
            const oldItems = wrap ? Array.from(wrap.querySelectorAll<HTMLElement>('.theia-mobile-sticky-composer-queue-item')) : [];
            const firstRects = oldItems.map(el => el.getBoundingClientRect());
            ctx.host.transcriptFollowUpQueue.moveTo(summary.id, fromIndex, toIndex);
            // Force a full re-render (not a patch) by clearing the fingerprint.
            ctx.lastComposerActivityStackFingerprint = '';
            ctx.refreshComposerActivityStack();
            // FLIP: animate from old position to new position.
            if (wrap) {
                requestAnimationFrame(() => {
                    const newItems = Array.from(wrap.querySelectorAll<HTMLElement>('.theia-mobile-sticky-composer-queue-item'));
                    newItems.forEach((el, i) => {
                        if (i >= firstRects.length) { return; }
                        const newRect = el.getBoundingClientRect();
                        const deltaY = firstRects[i].top - newRect.top;
                        if (deltaY === 0) { return; }
                        el.style.transform = `translateY(${deltaY}px)`;
                        el.style.transition = 'none';
                        requestAnimationFrame(() => {
                            el.style.transition = 'transform 0.28s cubic-bezier(0.2, 0.9, 0.3, 1)';
                            el.style.transform = '';
                            el.addEventListener('transitionend', () => {
                                el.style.transition = '';
                                el.style.transform = '';
                            }, { once: true });
                        });
                    });
                });
            }
        },
        changedFiles: activityFiles.files,
        diffStats: activityFiles.stats,
        hasFileActivity,
        hasCommittableChanges,
        filesExpanded: ctx.peekTranscriptComposerChangedFilesExpanded(summary.id),
        onFilesExpandedChange: expanded => { ctx.setTranscriptComposerChangedFilesExpanded(summary.id, expanded); },
        agentWorking,
        onReview: () => {
            ctx.host.executionSurfaceTabsUi.selectTranscriptTab('review', project, summary);
        },
        onRunApp: () => {
            void ctx.launchComposerDevPreview(project, summary);
        },
        onOpenPreview: verifiedPreviewUrl
            ? () => { void ctx.openComposerPreview(project.id); }
            : undefined,
        onKeepAll: () => { void ctx.keepAllComposerChangedFiles(project, summary); },
        onUndoAll: () => { void ctx.undoAllComposerChangedFiles(project, summary); },
        changedFilesBulkBusy: ctx.composerChangedFilesBulkBusy,
        onCommitAction: (ctx.host.commitMessageAi || ctx.host.quickInputService)
            ? action => { void ctx.runComposerCommitAction(project, summary, action); }
            : undefined,
        commitBusy: ctx.composerCommitBusy || ctx.composerChangedFilesBulkBusy,
    };
}

export async function launchComposerDevPreviewExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    const bootstrap = ctx.host.projectBootstrap;
    if (!bootstrap) {
        return;
    }
    const projectRoot = ctx.host.projectsService.getProjectCwd(project)
        ?? ctx.host.preparedCwdByProjectId?.get?.(project.id)
        ?? summary.cwd;
    if (!projectRoot) {
        MobileSnackbar.show(nls.localize(
            'qaap/mobileProjects/previewRootUnresolved',
            'Could not resolve this project\'s folder — open the project and retry.',
        ), { kind: 'warning' });
        return;
    }
    // Clear any stale preview state for this section and switch to the Preview tab so the
    // user sees the loading surface immediately while the dev server starts.
    ctx.host.beginTranscriptDevPreviewRequest(project, summary);
    ctx.host.executionSurfaceTabsUi.selectTranscriptTab('preview', project, summary);
    await bootstrap.refreshFromProjectRoot(projectRoot, project.id);
    const readyUrl = await ensureTranscriptDevPreview(bootstrap, {
        conversationId: summary.id,
        projectId: project.id,
        workspaceRoot: projectRoot,
        skipConversationPortProbe: true,
    });
    if (!readyUrl) {
        void ctx.host.transcriptSurfacesUi?.discoverAndMountTranscriptPreviewIfReady?.(project, summary);
        return;
    }
    if (typeof ctx.host.transcriptSurfacesUi?.adoptReadyTranscriptPreview === 'function') {
        ctx.host.transcriptSurfacesUi.adoptReadyTranscriptPreview(project, summary, readyUrl);
        return;
    }
    // `renderPreviewTab` reads `host.projects`, not the object passed to selectTranscriptTab.
    const refreshed = ctx.host.projects.find(candidate => candidate.id === project.id) ?? project;
    const readyProject = { ...refreshed, previewUrl: readyUrl };
    ctx.host.projects = ctx.host.projects.map(candidate => candidate.id === refreshed.id
        ? readyProject
        : candidate);
    if (ctx.host.transcriptOpenProject?.id === project.id) {
        ctx.host.transcriptOpenProject = readyProject;
    }
    void ctx.host.projectsService.recordProjectPreviewUrl(readyProject, readyUrl);
    ctx.host.executionSurfaceTabsUi.selectTranscriptTab('preview', readyProject, summary);
}

export async function submitRunGeneratedAppFollowUpExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    const chatHost = ctx.host.resolveActiveTranscriptChatHost() ?? ctx.host.transcriptChatHost;
    if (!chatHost) {
        ctx.host.transcriptComposerDraft = nls.localize(
            'qaap/mobileProjects/runGeneratedAppPrompt',
            'Run the generated app now. Install dependencies if needed, start the dev server, fix any startup errors, and open or report the preview URL.',
        );
        ctx.remountTranscriptStickyComposer();
        return;
    }
    const pinnedId = ctx.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary);
    await ctx.submitTranscriptComposerDraft(
        nls.localize(
            'qaap/mobileProjects/runGeneratedAppPrompt',
            'Run the generated app now. Install dependencies if needed, start the dev server, fix any startup errors, and open or report the preview URL.',
        ),
        project,
        summary,
        chatHost,
        {
            resolvedPinnedId: pinnedId,
            showApprovalPolicy: agentSupportsApprovalPolicy(pinnedId),
            isLegacyTheiaChat: summary.source === 'theia-chat',
        },
    );
}

export async function runComposerCommitActionExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    action: QaapGitCommitWorkflowAction,): Promise<void> {
    const cwd = ctx.host.projectsService.getProjectCwd(project) ?? summary.cwd;
    if (!cwd || ctx.composerCommitBusy) {
        return;
    }
    ctx.composerCommitBusy = true;
    ctx.refreshComposerActivityStack();
    try {
        // The AI writes the commit message automatically from the diff (Cursor-agents style).
        const generated = await ctx.host.commitMessageAi?.generate(cwd);
        let message = generated?.message;
        if (!message) {
            message = (await ctx.host.quickInputService?.input({
                title: nls.localize('qaap/mobileProjects/commitMessageTitle', 'Commit message'),
                placeHolder: nls.localize('qaap/mobileProjects/commitMessagePlaceholder', 'Describe your changes'),
                prompt: nls.localize('qaap/mobileProjects/commitMessagePrompt', 'Message for this commit'),
            }))?.trim();
        }
        if (!message) {
            return;
        }
        const needsBranch = action === 'create-branch-commit' || action === 'create-branch-commit-push';
        let branchName: string | undefined;
        if (needsBranch) {
            branchName = ctx.host.quickInputService
                ? (await ctx.host.quickInputService.input({
                    title: nls.localize('qaap/mobileProjects/newBranchTitle', 'Create branch'),
                    value: generated?.branchName,
                    placeHolder: nls.localize('qaap/mobileProjects/newBranchPlaceholder', 'feature/my-change'),
                    prompt: nls.localize('qaap/mobileProjects/newBranchPrompt', 'Name for the new branch'),
                }))?.trim()
                : generated?.branchName;
            if (!branchName) {
                return;
            }
        }
        const pendingGitActionId = ctx.appendRunningGitActionToTranscript(summary, action);
        const response = await fetch(`${QAAP_GIT_REVIEW_API_PATH}/commit-workflow`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ root: cwd, action, branchName, message }),
        });
        if (!response.ok) {
            const body = await response.json().catch(() => ({})) as { error?: string };
            throw new Error(body.error ?? `commit workflow failed (${response.status})`);
        }
        const result = await response.json().catch(() => ({})) as {
            branch?: string;
            stat?: { files: number; insertions: number; deletions: number };
        };
        if (action === 'commit-create-pr' && ctx.host.commands) {
            try {
                await ctx.host.commands.executeCommand('pr.pushAndCreate', { repoPath: cwd });
            } catch {
                await ctx.host.commands.executeCommand('pr.create', { repoPath: cwd });
            }
        }
        // `git add -A && git commit` leaves the tree clean — hide the Changes pill and the
        // commit buttons right away, then re-verify against the real working tree.
        ctx.composerActivityGitFilesByConversationId.set(summary.id, []);
        void ctx.syncComposerGitSnapshot(project, summary)
            .then(() => ctx.refreshComposerActivityStack())
            .catch(() => undefined);
        MobileSnackbar.show(
            formatCommitFeedback(
                nls.localize('qaap/mobileProjects/stickyComposerCommitDone', 'Changes committed'),
                result.branch,
                result.stat,
            ),
            { kind: 'success', duration: 2400 },
        );
        void ctx.recordComposerGitActionInTranscript(summary, action, {
            branch: result.branch,
            stat: result.stat,
            status: 'completed',
            replaceMessageId: pendingGitActionId,
        });
    } catch (error) {
        ctx.markPendingGitActionFailed(summary, action);
        void ctx.recordComposerGitActionInTranscript(summary, action, {
            status: 'failed',
            replaceMessageId: ctx.pendingGitActionMessageId,
        });
        MobileSnackbar.show(
            error instanceof Error && error.message
                ? error.message
                : nls.localize('qaap/mobileProjects/stickyComposerCommitFailed', 'Commit failed'),
            { kind: 'warning', duration: 3200 },
        );
    } finally {
        ctx.pendingGitActionMessageId = undefined;
        ctx.composerCommitBusy = false;
        ctx.refreshComposerActivityStack();
    }
}

export function buildGitActionMetadataExtracted(ctx: any, action: QaapGitCommitWorkflowAction,
    status: ComposerGitActionDisplayMetadata['status'],
    options: {
        readonly branch?: string;
        readonly stat?: { files: number; insertions: number; deletions: number };
    } = {},): ComposerGitActionDisplayMetadata {
    return {
        action,
        label: ctx.resolveGitCommitWorkflowLabel(action),
        status,
        ...(options.branch ? { branch: options.branch } : {}),
        ...(options.stat ? {
            files: options.stat.files,
            insertions: options.stat.insertions,
            deletions: options.stat.deletions,
        } : {}),
    };
}

