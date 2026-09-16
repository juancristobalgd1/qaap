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

export async function mountTranscriptStickyComposerAsyncExtracted(ctx: any, host: HTMLElement,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    chatHost: HTMLElement,): Promise<void> {
    const focusEligibleBeforeMount = isIdleComposerFocusStealable(document.activeElement, undefined);
    const cwd = ctx.host.projectsService.getProjectCwd(project) ?? summary.cwd;
    warmAgentTurnPath(cwd, {
        warmLiveTransport: () => ctx.host.conversations?.warmLiveTransport(),
    });
    const mountKey = `${project.id}|${summary.id}`;
    const composerStable = ctx.host.transcriptComposerMountKey === mountKey
        && ctx.host.transcriptComposerHost === host
        && host.childElementCount > 0;
    if (composerStable) {
        ctx.syncTranscriptComposerQuickActionsVisibility(host, summary);
        ctx.host.transcriptComposerSendRefresh?.();
        ctx.refreshComposerActivityStack();
        return;
    }
    ctx.host.transcriptComposerMountKey = mountKey;
    ctx.host.transcriptComposerHost = host;
    ctx.host.transcriptComposerProject = project;
    ctx.host.transcriptComposerSummary = summary;
    ctx.host.transcriptComposerSendRefresh = undefined;
    await ctx.ensureTranscriptComposerPrefsForMount(project, summary);
    if (ctx.host.transcriptComposerHost !== host
        || ctx.host.transcriptComposerSummary?.id !== summary.id) {
        return;
    }
    // Conversations share the project's working tree — a git snapshot cached while another
    // session was open can be stale (e.g. committed meanwhile). Refetch per (re)mount so the
    // Changes pill + commit button reflect this conversation's current pending changes.
    // Latches (resolved/clean) are intentionally preserved across mounts: they prevent a brief
    // flash of the Changes pill between the mount and the first fresh git fetch completing.
    // The latches are updated naturally by selectComposerPillChanges once the fetch returns.
    ctx.composerActivityGitFilesByConversationId.delete(summary.id);
    ctx.host.stickyComposerContextUsageDispose.dispose();
    // Park the Working expand shell before wipe so transcript remounts cannot destroy it.
    parkWorkingControlFromAncestor(host);
    host.replaceChildren();
    ctx.syncTranscriptComposerQuickActionsVisibility(host, summary);
    const shell = document.createElement('div');
    shell.className = 'theia-mobile-projects-sticky-composer';
    shell.append(ctx.workHub.createAgentsHubQuickActionsBlock());
    const isLegacyTheiaChat = summary.source === 'theia-chat';
    const pinnedId = ctx.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary);
    const modes = resolveStickyComposerModes(pinnedId, ctx.host.chatAgentService);
    ctx.host.transcriptComposerModeId = reconcileComposerModeId(
        ctx.host.transcriptComposerModeId,
        modes,
        cwd,
    );
    ctx.host.transcriptComposerCapabilityLevel = reconcileModelCapabilityLevel(
        ctx.host.transcriptComposerCapabilityLevel,
        cwd,
    );
    const showApprovalPolicy = !isLegacyTheiaChat && agentSupportsApprovalPolicy(pinnedId);
    let capabilityTriggerRefresh: (() => void) | undefined;
    if (showApprovalPolicy) {
        ctx.host.transcriptComposerApprovalPolicyId = reconcileAgentApprovalPolicyId(
            ctx.host.transcriptComposerApprovalPolicyId,
            cwd,
        );
        ctx.host.transcriptComposerToolApprovalRules = reconcileAgentToolApprovalRules(
            ctx.host.transcriptComposerApprovalPolicyId,
            cwd,
            ctx.host.transcriptComposerToolApprovalRules,
        );
    } else {
        ctx.host.transcriptComposerApprovalPolicyId = undefined;
        ctx.host.transcriptComposerToolApprovalRules = undefined;
    }
    const activityOptions = ctx.buildTranscriptComposerActivityOptions(project, summary);
    const submitComposerFollowUp = (draft: string, forceDeliveryMode?: 'parallel' | 'interrupt'): void => {
        if (hasPendingComposerContextEntries(ctx.host.transcriptComposerContext)) {
            ctx.host.stickyComposerContextUi.notifyPendingComposerAttachments();
            return;
        }
        // Re-resolve the idle-composer target at SUBMIT time. The mount
        // closure can hold a stale project captured during boot — e.g.
        // the ephemeral workspace-container entry fabricated before the
        // projects list loaded — and an agent turn must never inherit
        // that cwd from the closure (observed live: the chip showed the
        // real project while the created conversation targeted the
        // multi-repo container).
        let submitProject = project;
        let submitSummary = summary;
        if (isAgentsHubIdleConversationSummary(summary)) {
            const fresh = ctx.workHub.resolveShellProject();
            if (fresh && fresh.id !== project.id) {
                submitProject = fresh;
                submitSummary = ctx.workHub.resolveShellSummary(fresh) ?? summary;
            }
        }
        void ctx.submitTranscriptComposerDraft(draft, submitProject, submitSummary, chatHost, {
            resolvedPinnedId: ctx.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(submitProject, submitSummary),
            showApprovalPolicy,
            isLegacyTheiaChat,
            forceDeliveryMode,
        });
    };
    const column = ctx.host.stickyComposerColumnUi.buildStickyComposerColumn({
        project,
        composerCwd: cwd,
        surface: 'task',
        agentLocked: isLegacyTheiaChat,
        activityStack: renderStickyComposerActivityStack(activityOptions),
        changesPill: renderStickyComposerChangesPill(activityOptions),
        getContext: () => ctx.host.transcriptComposerContext,
        clearContext: () => {
            disposeComposerContextEntries(ctx.host.transcriptComposerContext);
            ctx.host.transcriptComposerContext = [];
            ctx.remountTranscriptStickyComposer();
        },
        removeContextItem: index => {
            const entry = ctx.host.transcriptComposerContext[index];
            revokeComposerContextPreview(entry);
            ctx.host.transcriptComposerContext.splice(index, 1);
            ctx.host.handleComposerContextItemRemoved(entry);
            ctx.remountTranscriptStickyComposer();
        },
        formatContextChip: item => ctx.host.stickyComposerContextUi.formatComposerContextEntry(item),
        filesExpanded: ctx.host.transcriptComposerFilesExpanded,
        onFilesExpandedChange: expanded => { ctx.host.transcriptComposerFilesExpanded = expanded; },
        getDraft: () => ctx.host.transcriptComposerDraft,
        setDraft: value => {
            ctx.host.transcriptComposerDraft = value;
            if (isAgentsHubIdleConversationSummary(summary)) {
                // Shared idle summary id — persist per project instead of per conversation.
                writeProjectComposerDraft(project.id, value);
            } else {
                ctx.schedulePersistTranscriptComposerDraft(summary.id);
            }
        },
        resolveAgentLabel: () => ctx.host.transcriptComposerUi.resolveTranscriptComposerAgentLabel(),
        resolveAgentId: () => ctx.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary),
        resolveAgentModel: () => ctx.host.transcriptComposerUi.resolveTranscriptComposerAgentModel(
            ctx.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary),
            cwd,
        ),
        modes,
        resolveModeLabel: () => resolveComposerModeLabel(modes, ctx.host.transcriptComposerModeId),
        resolveModeId: () => ctx.host.transcriptComposerModeId,
        onOpenModeSheet: modes.length > 1
            ? anchor => { ctx.host.transcriptComposerUi.openTranscriptComposerModeSheet(project, summary, modes, anchor); }
            : undefined,
        approvalPolicyId: showApprovalPolicy ? ctx.host.transcriptComposerApprovalPolicyId : undefined,
        onOpenApprovalPolicySheet: showApprovalPolicy
            ? anchor => {
                ctx.host.transcriptComposerUi.openTranscriptComposerApprovalPolicySheet(
                    project,
                    summary,
                    ctx.host.transcriptComposerUi.resolveTranscriptComposerAgentLabel(),
                    anchor,
                );
            }
            : undefined,
        canSubmit: true,
        onImprovePrompt: ctx.host.composerPromptImprover
            ? createStickyComposerImprovePromptHandler({
                improver: ctx.host.composerPromptImprover,
                resolveAgentId: () => ctx.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary),
                resolveAgentModel: () => readStoredAgentModel(
                    cwd,
                    ctx.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary),
                ),
                resolveCwd: () => cwd,
            })
            : undefined,
        isAgentWorking: () => ctx.isTranscriptStickyComposerAgentWorking(),
        isAgentBeamIdle: () => ctx.isTranscriptStickyComposerAgentBeamIdle(),
        onStop: () => {
            // Re-resolve the target when the mount closure captured the idle placeholder
            // (a freshly-delegated task, or a new-chat that replaced idle→real after mount):
            // the closure summary would be `__qaap_agents_hub_idle__`, so a bare cancel hit a
            // conversation id the backend doesn't have and the Stop button did nothing. When
            // the closure already holds a REAL conversation, keep it — never re-resolve to the
            // shell's currently-selected project and cancel a different project's stream.
            let stopProject = project;
            let stopSummary = summary;
            if (isAgentsHubIdleConversationSummary(summary)) {
                stopProject = ctx.workHub.resolveShellProject() ?? project;
                stopSummary = ctx.workHub.resolveShellSummary(stopProject) ?? summary;
            }
            void ctx.host.onCancelConversation(stopProject, stopSummary);
        },
        onSendControlMounted: refresh => { ctx.host.transcriptComposerSendRefresh = refresh; },
        onAttach: anchor => { void ctx.onTranscriptComposerAttach(project, anchor); },
        onDropFiles: files => {
            ctx.host.stickyComposerContextUi.dropTranscriptComposerFiles(
                project,
                files,
                ctx.resolveComposerUploadTargetDir(project),
            );
        },
        onOpenAgentSheet: isLegacyTheiaChat
            ? () => { /* Legacy Theia chat is not agent-switchable */ }
            : anchor => { ctx.host.transcriptComposerUi.openTranscriptComposerAgentSheet(project, summary, anchor); },
        sendLabel: nls.localize('qaap/mobileProjects/transcriptSend', 'Send'),
        onSubmit: draft => {
            submitComposerFollowUp(draft);
        },
        onSubmitParallel: draft => {
            submitComposerFollowUp(draft, 'parallel');
        },
        onSubmitInterrupt: draft => {
            submitComposerFollowUp(draft, 'interrupt');
        },
        getMentionOptions: () => ctx.host.stickyComposerContextUi.resolveComposerMentionOptions(ctx.host.transcriptComposerBackendAgents, false),
        getVariableOptions: ctx.host.getComposerVariables
            ? () => ctx.host.stickyComposerContextUi.resolveComposerVariableOptions()
            : undefined,
        getSkillOptions: ctx.host.getComposerSkills
            ? () => ctx.host.stickyComposerContextUi.resolveComposerSkillOptions()
            : undefined,
        getSlashMenuSections: () => ctx.host.stickyComposerContextUi.resolveComposerSlashMenuSections(),
        onSlashAction: (actionId, prompt) => ctx.host.stickyComposerRenderUi.handleStickyComposerSlashAction(actionId, prompt),
        getInstalledMcpServerSlugs: () => ctx.host.stickyComposerRenderUi.resolveInstalledMcpServerSlugs(),
        onInstallMcpPlugin: pluginId => ctx.host.stickyComposerRenderUi.handleInstallMcpPlugin(pluginId),
        onRemoveMcpServer: slug => ctx.host.stickyComposerRenderUi.handleRemoveMcpServer(slug),
        onBrowseMcpMarketplace: () => ctx.host.stickyComposerRenderUi.handleBrowseMcpMarketplace(),
        getSkillNames: ctx.host.getComposerSkills
            ? () => ctx.host.getComposerSkills!().map(skill => skill.name)
            : undefined,
        inputPlaceholder: isAgentsHubIdleConversationSummary(summary)
            ? nls.localize('qaap/mobileProjects/stickyComposerNewTask', 'Delegate a task…')
            : isLegacyTheiaChat
                ? nls.localize('qaap/mobileProjects/transcriptLegacyTheiaPlaceholder', 'Start a new agent session…')
                : nls.localize('qaap/mobileProjects/transcriptTaskPlaceholder', 'Follow up on this task…'),
        resolveCapabilityLevel: () => ctx.host.transcriptComposerCapabilityLevel
            ?? reconcileModelCapabilityLevel(undefined, cwd),
        onOpenCapabilityPopover: !isLegacyTheiaChat
            ? anchor => {
                ctx.host.stickyComposerSheetsUi.openStickyComposerModelCapabilityPopover({
                    anchor,
                    cwd,
                    transcriptOverlay: !ctx.host.agentsHubShellActive,
                    resolveLevel: () => ctx.host.transcriptComposerCapabilityLevel
                        ?? reconcileModelCapabilityLevel(undefined, cwd),
                    assignLevel: level => { ctx.host.transcriptComposerCapabilityLevel = level; },
                    onCommit: () => capabilityTriggerRefresh?.(),
                });
            }
            : undefined,
        onCapabilityTriggerMounted: !isLegacyTheiaChat
            ? refresh => { capabilityTriggerRefresh = refresh; }
            : undefined,
        onContextUsageBadgeMounted: badge => {
            ctx.host.stickyComposerContextUsageDispose = ctx.host.stickyComposerRenderUi.mountStickyComposerContextUsage(
                badge,
                () => ctx.resolveTranscriptContextUsageTarget(summary),
            );
        },
        onOpenContextUsageSheet: anchor => {
            ctx.host.stickyComposerSheetsUi.openStickyComposerContextUsageSheet(
                () => {
                    const target = ctx.resolveTranscriptContextUsageTarget(summary);
                    if (target?.chatModel) {
                        return resolveChatModelContextUsageBreakdown(target.chatModel);
                    }
                    return resolveVpsContextUsageBreakdown(target?.summary, target?.full);
                },
                !ctx.host.agentsHubShellActive,
                anchor,
            );
        },
        transcriptOverlay: !ctx.host.agentsHubShellActive,
    });
    const modeHint = describeComposerInteractionMode(ctx.host.transcriptComposerModeId);
    if (modeHint) {
        const modeBanner = document.createElement('div');
        modeBanner.className = 'theia-mobile-sticky-composer-mode-banner';
        modeBanner.textContent = modeHint;
        shell.append(modeBanner);
    }
    if (isLegacyTheiaChat) {
        const legacyBanner = document.createElement('div');
        legacyBanner.className = 'theia-mobile-sticky-composer-legacy-banner';
        legacyBanner.textContent = nls.localize(
            'qaap/mobileProjects/transcriptLegacyTheiaBanner',
            'Legacy local chat — replies start a new QAIQ session in the cloud.',
        );
        shell.append(legacyBanner);
    }
    shell.append(column);
    host.append(shell);
    const isIdleComposer = isAgentsHubIdleConversationSummary(summary);
    ctx.agentsHubIdleComposerMounted = isIdleComposer;
    // Autofocus deterministically AFTER the frontend reaches 'ready' — the
    // boot sequence remounts the composer and shuffles focus (xterm's
    // hidden helper textarea, shell activation) at unpredictable times, so
    // timing heuristics lose. Every idle mount during the boot window
    // re-arms this; the ready-await plus the focus check at focus time
    // ensure exactly one deliberate focus that nothing later steals back.
    if (isIdleComposer && focusEligibleBeforeMount && Date.now() < ctx.idleComposerAutofocusDeadline) {
        void (ctx.host.whenFrontendReady?.() ?? Promise.resolve()).then(() => {
            window.requestAnimationFrame(() => {
                const textarea = host.querySelector<HTMLTextAreaElement>('.theia-mobile-projects-sticky-composer-input');
                if (!textarea || !textarea.isConnected || textarea.disabled) {
                    return;
                }
                if (!isIdleComposerFocusStealable(document.activeElement, textarea)) {
                    return;
                }
                textarea.focus();
                // Late boot stragglers can still steal this focus back to
                // <body> moments later — defend it for a short window.
                ctx.scheduleIdleComposerFocusRetention(textarea);
            });
        });
    }
    ctx.syncTranscriptComposerQuickActionsVisibility(host, summary);
    ctx.host.updateWorkingPillChrome();
    ctx.syncComposerActivityFingerprint(summary, project);
    if (ctx.host.transcriptLastConv?.id === summary.id) {
        ctx.host.transcriptLiveUi.syncTranscriptPendingApproval(ctx.host.transcriptLastConv);
    }
}

