import type { MobileProjectsTranscriptStickyComposerUiContext } from './mobile-projects-transcript-sticky-composer-ui-context';
// Extracted from mobile-projects-transcript-sticky-composer-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { MobileSnackbar } from '@theia/qaap-mobile-shell/lib/browser/mobile-snackbar';
import {
    type QaapAgentConversationSummaryDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import {
    readStoredAgentModel,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { warmAgentTurnPath } from '@theia/qaap-shared-core/lib/common/qaap-agent-turn-warm';
import {
    agentSupportsApprovalPolicy,
    reconcileAgentApprovalPolicyId,
} from '@theia/qaap-shared-core/lib/common/qaap-sticky-composer-approval-policy';
import {
    reconcileAgentToolApprovalRules,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-tool-approval-rules';
import { buildAgentsHubIdleConversationSummary, isAgentsHubIdleConversationSummary } from '@theia/qaap-shared-core/lib/common/qaap-agents-hub-landing';
import { resolveComposerSubmitTarget } from '../common/qaap-composer-submit-target';
import { resolveComposerStopTarget } from '../common/qaap-composer-stop-target';
import { qaapStopAck } from '@theia/qaap-shared-core/lib/browser/qaap-stop-ack';
import { writeProjectComposerDraft } from '../common/qaap-project-composer-draft';
import {
    formatComposerRunPermissionsLabel,
    resolveApprovalPolicyFromConversation,
} from '../common/qaap-conversation-composer-state';
import {
    disposeComposerContextEntries,
    hasPendingComposerContextEntries,
    revokeComposerContextPreview,
} from '@theia/qaap-shared-core/lib/common/qaap-composer-context-entry';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { createStickyComposerImprovePromptHandler } from './qaap-composer-prompt-improve-handler';
import {
    renderStickyComposerActivityStack,
    renderStickyComposerChangesPill,
} from './qaap-sticky-composer-activity-stack';
import {
    isIdleComposerFocusStealable,
} from './mobile-projects-transcript-sticky-composer-helpers';
import {
    parkWorkingControlFromAncestor,
} from './qaap-sticky-composer-working-agents-popover';

export async function mountTranscriptStickyComposerAsyncExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext, host: HTMLElement,
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
    const showApprovalPolicy = !isLegacyTheiaChat && agentSupportsApprovalPolicy(pinnedId);
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
        } else {
            // Route by the composer's LIVE target, not only the mount closure: a cleared target
            // ("New task") starts a new task, and a target moved to another summary (isolated
            // parallel child, adopted task) receives the prompt.
            const target = resolveComposerSubmitTarget(summary, ctx.host.transcriptComposerSummary);
            if (target === 'newTask') {
                submitSummary = buildAgentsHubIdleConversationSummary(cwd ?? '');
            } else if (target === 'live' && ctx.host.transcriptComposerSummary) {
                submitSummary = ctx.host.transcriptComposerSummary;
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
        resolveAgentLabel: () => ctx.host.transcriptComposerUi.resolveTranscriptComposerAgentLabel(
            ctx.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary),
        ),
        resolveAgentId: () => ctx.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary),
        resolveAgentModel: () => ctx.host.transcriptComposerUi.resolveTranscriptComposerAgentModel(
            ctx.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary),
            cwd,
        ),
        canSubmit: true,
        isSubmitBlocked: () => qaapStopAck.isSendBlocked(ctx.host.transcriptLastConv?.id ?? summary.id),
        isStopRetryable: () => qaapStopAck.isStopRetryable(ctx.host.transcriptLastConv?.id ?? summary.id),
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
        resolveRunPermissionsLabel: showApprovalPolicy && !isAgentsHubIdleConversationSummary(summary)
            ? () => {
                // Permissions of the RUNNING turn come from the conversation, not from the
                // composer's next-turn selection.
                const conv = ctx.host.transcriptLastConv?.id === summary.id ? ctx.host.transcriptLastConv : undefined;
                const policyId = resolveApprovalPolicyFromConversation({
                    approvalPolicyId: conv?.approvalPolicyId ?? summary.approvalPolicyId
                        ?? ctx.host.transcriptComposerApprovalPolicyId,
                    autoApprove: conv?.autoApprove ?? summary.autoApprove,
                    cwd,
                });
                return formatComposerRunPermissionsLabel(undefined, policyId, conv?.agentId ?? summary.agentId);
            }
            : undefined,
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
            console.warn(`[qaap-stop] click origin=composer summary=${stopSummary.id} open=${ctx.host.transcriptLastConv?.id ?? '-'}`);
            // The open transcript decides the target: a closure captured before a conversation switch must not cancel the older one.
            const target = resolveComposerStopTarget(
                stopSummary,
                ctx.host.transcriptLastConv?.id,
                ctx.host.transcriptOpenSummary,
                isAgentsHubIdleConversationSummary(summary),
            );
            if (!target) {
                // Fail closed: no cancel is sent to a conversation the Stop does not belong to.
                console.warn(`[qaap-stop] no target: closure=${summary.id} open=${ctx.host.transcriptLastConv?.id ?? '-'}`);
                MobileSnackbar.show(nls.localize(
                    'qaap/mobileProjects/stopNoTarget',
                    'Stop is not available yet: the run it belongs to is still being created.'
                ), { kind: 'warning', duration: 3200 });
                return;
            }
            void ctx.host.onCancelConversation(stopProject, target);
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
        transcriptOverlay: !ctx.host.agentsHubShellActive,
    });
    if (isLegacyTheiaChat) {
        const legacyBanner = document.createElement('div');
        legacyBanner.className = 'theia-mobile-sticky-composer-legacy-banner';
        legacyBanner.textContent = nls.localize(
            'qaap/mobileProjects/transcriptLegacyTheiaBanner',
            'Legacy local chat — replies start a new cloud session.',
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
        // Paint the composer in its focused shape from the start (context tray tucked away) rather
        // than sliding the tray out when the deferred focus lands: on a phone the Work Hub mounts
        // seconds before 'ready' while the backend wakes, and the boot replica shows it focused.
        const card = host.querySelector<HTMLElement>('.theia-mobile-projects-sticky-composer-card');
        card?.classList.add('theia-mod-input-expanded');
        const releaseExpandedShape = (textarea: HTMLTextAreaElement | null): void => {
            if (card && document.activeElement !== textarea) {
                card.classList.remove('theia-mod-input-expanded');
            }
        };
        void (ctx.host.whenFrontendReady?.() ?? Promise.resolve()).then(() => {
            window.requestAnimationFrame(() => {
                const textarea = host.querySelector<HTMLTextAreaElement>('.theia-mobile-projects-sticky-composer-input');
                if (!textarea || !textarea.isConnected || textarea.disabled) {
                    releaseExpandedShape(textarea);
                    return;
                }
                if (!isIdleComposerFocusStealable(document.activeElement, textarea)) {
                    releaseExpandedShape(textarea);
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
