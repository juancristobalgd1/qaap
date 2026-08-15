// @ts-nocheck
// Extracted from mobile-projects-tasks-hub-ui.ts

import { Disposable } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { readQaapSignedIn } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import { startGithubOAuth } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { type QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import {
    isAgentsHubIdleConversationSummary,
    QAAP_AGENTS_HUB_LANDING_ENABLED,
    QAAP_AGENTS_HUB_QUICK_ACTIONS,
    QAAP_AGENTS_HUB_RECENT_LIMIT,
} from '../common/qaap-agents-hub-landing';
import { bindStickyComposerControlClick } from '../common/qaap-sticky-composer-control-click';
import { type QaapComposerSurface } from '../common/qaap-composer-surface';
import { type WorkHubTeamMember } from '../common/qaap-work-hub-team';
import { cancelConversation } from '../common/qaap-agent-conversation-client';
import { cancelAgentTask, fetchAgentTaskDetail } from '../common/qaap-agent-task-client';
import { type WorkHubApprovalItem } from './mobile-projects-team-hub-ui';
import { type MobileWorkHubInboxItem } from './mobile-work-hub-inbox';
import type { MobileProjectsActiveTasks, MobileProjectTaskView } from './mobile-projects-active-tasks';
import type { MobileProjectEntry } from './mobile-projects-types';
import { syncStickyComposerWorkingPillInRoots } from './qaap-sticky-composer-working-pill';
import {
    closeWorkingAgentsPopover,
    dismissWorkingAgentsExpandForStopAll,
    filterWorkingTeamMembers,
    getWorkingAgentsDetailMember,
    getWorkingAgentsDetailMemberId,
    isWorkingAgentsExpandPinnedOpen,
    isWorkingAgentsExpandSessionOpen,
    isWorkingAgentsPopoverOpen,
    isWorkingPillSuppressedAfterStopAll,
    noteWorkingPillChromeCount,
    openWorkingAgentsPopover,
    refreshWorkingAgentsDetailActivityFeed,
    refreshWorkingAgentsDetailCommandLog,
    restoreWorkingAgentsExpandIfNeeded,
    syncWorkingAgentsExpandContent,
} from './qaap-sticky-composer-working-agents-popover';
import {
    resolveWorkingAgentDetailActivityFeedFromConversation,
} from './qaap-sticky-composer-working-detail-activity';
import { shouldShowWorkingDetailTaskLog } from './qaap-sticky-composer-working-detail-task-log';
import { syncStickyComposerStepPillInRoots } from './qaap-sticky-composer-step-pill';
import {
    resolveLatestTranscriptTodos,
    resolveTodoStepProgress,
} from '../common/qaap-transcript-todo-step';
import { resolveAgentMessageSegments } from '../common/qaap-transcript-trace-model';
import { shouldShowTranscriptEmptyQuickActions } from '../common/qaap-transcript-turn-status';
import type { MobileProjectsConversations } from './mobile-projects-conversations';

export function collectAgentsHubRecentItemsExtracted(ctx: any, projects: MobileProjectEntry[],
        limit = QAAP_AGENTS_HUB_RECENT_LIMIT,
        scopeProject?: MobileProjectEntry,): Array<{ project: MobileProjectEntry; summary: QaapAgentConversationSummaryDTO }> {
        const query = ctx.host.query.trim().toLowerCase();
        const entries: Array<{
            project: MobileProjectEntry;
            summary: QaapAgentConversationSummaryDTO;
            updatedAt: number;
        }> = [];
        const scope = scopeProject ? [scopeProject] : projects;
        for (const project of scope) {
            const conversations = [
                ...ctx.host.conversationIndexUi.localChatsForProject(project),
                ...ctx.host.conversationIndexUi.vpsTasksForProject(project),
            ];
            for (const summary of conversations) {
                if (query && !ctx.host.hubQueryUi.conversationMatchesQuery(summary, query)) {
                    continue;
                }
                entries.push({ project, summary, updatedAt: summary.updatedAt });
            }
        }
        entries.sort((a, b) => b.updatedAt - a.updatedAt);
        return entries.slice(0, Math.max(0, limit)).map(({ project, summary }) => ({ project, summary }));
}

export function shouldEmbedAgentsHubRecentsInWorkspaceTranscriptExtracted(ctx: any): boolean {
        return QAAP_AGENTS_HUB_LANDING_ENABLED
            && ctx.host.transcriptSheet?.parentElement === document.body
            && !document.body.classList.contains('theia-mobile-mod-landing');
}

export function createAgentsHubLandingHeroBlockExtracted(ctx: any): HTMLElement {
        const hero = document.createElement('section');
        hero.className = 'theia-mobile-agents-hub-landing-hero';
        hero.setAttribute(
            'aria-label',
            nls.localize('qaap/agentsHub/landingHeroAria', 'New project'),
        );

        const title = document.createElement('h2');
        title.className = 'theia-mobile-agents-hub-landing-hero-title';
        title.textContent = nls.localize('qaap/agentsHub/landingHeroTitle', 'Start something new');

        const body = document.createElement('p');
        body.className = 'theia-mobile-agents-hub-landing-hero-body';
        body.textContent = nls.localize(
            'qaap/agentsHub/landingHeroBody',
            'Create a fresh workspace and delegate the first task to an agent.',
        );

        const actions = document.createElement('div');
        actions.className = 'theia-mobile-agents-hub-landing-hero-actions';

        const startNew = document.createElement('button');
        startNew.type = 'button';
        startNew.className = 'theia-mobile-agents-hub-onboarding-btn theia-mod-primary theia-mobile-agents-hub-landing-hero-cta';
        const startNewIcon = document.createElement('span');
        startNewIcon.className = 'codicon codicon-repo theia-mobile-agents-hub-onboarding-btn-icon';
        startNewIcon.setAttribute('aria-hidden', 'true');
        const startNewLabel = document.createElement('span');
        startNewLabel.className = 'theia-mobile-agents-hub-onboarding-btn-label';
        startNewLabel.textContent = nls.localize('qaap/mobileOpenRepo/startNewProject', 'Start new project');
        startNew.append(startNewIcon, startNewLabel);
        startNew.addEventListener('click', () => { void ctx.host.onStartNewProject(); });

        const addRepo = document.createElement('button');
        addRepo.type = 'button';
        addRepo.className = 'theia-mobile-agents-hub-onboarding-btn theia-mod-ghost theia-mobile-agents-hub-landing-hero-secondary';
        const addRepoIcon = document.createElement('span');
        addRepoIcon.className = 'codicon codicon-repo-clone theia-mobile-agents-hub-onboarding-btn-icon';
        addRepoIcon.setAttribute('aria-hidden', 'true');
        const addRepoLabel = document.createElement('span');
        addRepoLabel.className = 'theia-mobile-agents-hub-onboarding-btn-label';
        addRepoLabel.textContent = nls.localize('qaap/mobileProjects/newRepository', 'Add repository');
        addRepo.append(addRepoIcon, addRepoLabel);
        addRepo.addEventListener('click', () => { void ctx.host.onNewClick(); });

        const signedIn = typeof ctx.readQaapSignedIn === 'function' ? ctx.readQaapSignedIn() : readQaapSignedIn();
        if (!signedIn) {
            body.textContent = nls.localize(
                'qaap/agentsHub/landingHeroSignInBody',
                'Sign in with GitHub to open your repositories and start an agent.',
            );
            startNew.classList.remove('theia-mod-primary');
            startNew.classList.add('theia-mod-ghost');
            const signIn = document.createElement('button');
            signIn.type = 'button';
            signIn.className = 'theia-mobile-agents-hub-onboarding-btn theia-mod-primary theia-mobile-agents-hub-landing-hero-cta theia-mobile-agents-hub-signin-btn';
            const signInIcon = document.createElement('span');
            signInIcon.className = 'codicon codicon-github theia-mobile-agents-hub-onboarding-btn-icon';
            signInIcon.setAttribute('aria-hidden', 'true');
            const signInLabel = document.createElement('span');
            signInLabel.className = 'theia-mobile-agents-hub-onboarding-btn-label';
            signInLabel.textContent = nls.localize('qaap/agentsHub/signIn', 'Sign in with GitHub');
            signIn.append(signInIcon, signInLabel);
            signIn.addEventListener('click', () => startGithubOAuth());
            actions.append(signIn);
        }
        actions.append(startNew, addRepo);
        hero.append(title, body, actions);
        return hero;
}

export function createAgentsHubQuickActionsBlockExtracted(ctx: any): HTMLElement {
        const container = document.createElement('div');
        container.className = 'theia-mobile-agent-transcript-empty-actions';
        container.setAttribute('role', 'group');
        container.setAttribute(
            'aria-label',
            nls.localize('qaap/agentsHub/quickActions', 'Quick actions'),
        );
        for (const action of QAAP_AGENTS_HUB_QUICK_ACTIONS) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'theia-mobile-agent-transcript-empty-action';
            const iconWrap = document.createElement('span');
            iconWrap.className = 'theia-mobile-agent-transcript-empty-action-icon';
            const icon = document.createElement('i');
            icon.className = `codicon codicon-${action.icon}`;
            icon.setAttribute('aria-hidden', 'true');
            iconWrap.append(icon);
            const label = document.createElement('span');
            label.className = 'theia-mobile-agent-transcript-empty-action-label';
            label.textContent = nls.localize(action.labelKey, action.labelDefault);
            btn.append(iconWrap, label);
            bindStickyComposerControlClick(btn, () => {
                ctx.applyComposerQuickActionPrompt(nls.localize(action.promptKey, action.promptDefault));
            });
            container.append(btn);
        }
        return container;
}

export function applyComposerQuickActionPromptExtracted(ctx: any, prompt: string): void {
        const trimmed = prompt.trim();
        if (!trimmed) {
            return;
        }
        if (ctx.host.transcriptComposerHost?.isConnected) {
            ctx.host.transcriptComposerDraft = trimmed;
            ctx.host.transcriptStickyComposerUi.remountTranscriptStickyComposer();
            ctx.host.transcriptMessagesUi.focusTranscriptComposerInput();
            return;
        }
        ctx.host.stickyComposerDraft = trimmed;
        ctx.host.stickyComposerRenderUi.renderStickyComposer();
        window.requestAnimationFrame(() => {
            const input = ctx.host.stickyComposerHost?.querySelector<HTMLTextAreaElement>(
                '.theia-mobile-projects-sticky-composer-input',
            );
            if (!input) {
                return;
            }
            input.focus();
            const end = input.value.length;
            input.setSelectionRange(end, end);
        });
}

export function createAgentsHubRecentsBlockExtracted(ctx: any, project: MobileProjectEntry): HTMLElement {
        const recents = ctx.collectAgentsHubRecentItems(ctx.host.projects, QAAP_AGENTS_HUB_RECENT_LIMIT, project);
        const block = document.createElement('section');
        block.className = 'theia-mobile-agents-hub-landing theia-mod-transcript-recents';
        if (recents.length === 0) {
            return block;
        }
        const head = document.createElement('div');
        head.className = 'theia-mobile-agents-hub-landing-section-head';
        const label = document.createElement('span');
        label.className = 'theia-mobile-agents-hub-landing-section-label q-overline';
        label.textContent = nls.localize('qaap/agentsHub/sessionsSection', 'Sessions');
        const count = document.createElement('span');
        count.className = 'theia-mobile-agents-hub-landing-section-count';
        count.textContent = String(recents.length);
        head.append(label, count);
        const list = document.createElement('div');
        list.className = 'theia-mobile-projects-chats-list theia-mobile-agents-hub-landing-list';
        const parentIds = new Set<string>();
        for (const entry of recents) {
            if (entry.summary.forkedFromId) {
                parentIds.add(entry.summary.forkedFromId);
            }
        }
        const activeInfo = ctx.host.conversationIndexUi.activeInfoForProject(project);
        for (const { summary } of recents) {
            const task = ctx.host.conversationIndexUi.summaryToTaskView(summary);
            list.append(ctx.host.projectRowsUi.createTaskItem(project, task, activeInfo, summary, parentIds));
        }
        block.append(head, list);
        const viewAll = document.createElement('button');
        viewAll.type = 'button';
        viewAll.className = 'theia-mobile-agents-hub-landing-view-all';
        viewAll.textContent = nls.localize('qaap/agentsHub/viewAllSessions', 'View all sessions');
        viewAll.addEventListener('click', () => {
            ctx.host.openWorkHubSessionsSidebar();
        });
        block.append(viewAll);
        return block;
}

export function updateTasksAttentionChromeExtracted(ctx: any): void {
        ctx.updateWorkingPillChrome();
        if (!ctx.host.homeMode || !ctx.host.hubQueryUi.isTasksHubView() || ctx.host.tasksHubSurface === 'chat' || ctx.host.shouldUseAgentsHubLanding()) {
            ctx.host.titleAttentionEl.hidden = true;
            ctx.host.titleAttentionEl.setAttribute('aria-hidden', 'true');
            return;
        }
        const { needsYou } = ctx.host.countTasksAttention();
        if (needsYou <= 0) {
            ctx.host.titleAttentionEl.hidden = true;
            ctx.host.titleAttentionEl.setAttribute('aria-hidden', 'true');
            return;
        }
        ctx.host.titleAttentionEl.hidden = false;
        ctx.host.titleAttentionEl.setAttribute('aria-hidden', 'false');
        ctx.host.titleAttentionEl.textContent = String(needsYou);
        ctx.host.titleAttentionEl.title = nls.localize(
            'qaap/mobileProjects/tasksAttentionTitle',
            '{0} tasks need your attention',
            String(needsYou),
        );
}

export function updateWorkingPillChromeExtracted(ctx: any): void {
        const rawCount = ctx.countWorkingAgentsForPill();
        noteWorkingPillChromeCount(rawCount);
        // After Stop All, hide the pill until a new live working agent appears (attention
        // count can lag behind cancel; reading-retain must not keep "1 Working").
        const realCount = isWorkingPillSuppressedAfterStopAll() ? 0 : rawCount;
        const reading = isWorkingAgentsExpandPinnedOpen() && !isWorkingPillSuppressedAfterStopAll();
        const suppressForEmptyComposer = ctx.shouldSuppressWorkingPillForEmptyComposer();
        // Never auto-collapse while the user is reading (list or detail). Summary/settled
        // often drops the working count to 0 (streaming → idle); only ✕ / Escape / Stop All
        // / pill toggle may close in that case. Empty/new chat surfaces always hide the pill.
        if (suppressForEmptyComposer || (realCount <= 0 && !reading)) {
            closeWorkingAgentsPopover(true);
        }
        // Keep chrome alive while home/transcript composers exist, or while an expand session
        // is still open (pill may be briefly parked during remount).
        const composerMounted = !!(
            ctx.host.stickyComposerHost?.querySelector('.theia-mobile-projects-sticky-composer-inner')
            || ctx.host.transcriptComposerHost?.querySelector('.theia-mobile-projects-sticky-composer-inner')
        );
        const count = !suppressForEmptyComposer && (realCount > 0 || reading)
            && (ctx.host.homeMode || composerMounted || reading)
            ? Math.max(realCount, reading ? 1 : 0)
            : 0;
        // Per-section count: the transcript composer pill shows only agents working in the
        // currently open conversation/section (and its forks/subagents), not the global hub
        // count. The home sticky composer keeps the global count. When both hosts are the same
        // element (e.g. transcript overlay reusing the home host), a single sync with the
        // section-scoped count wins.
        const transcriptCount = ctx.countWorkingAgentsForTranscriptPill();
        const forceHide = isWorkingPillSuppressedAfterStopAll() || suppressForEmptyComposer;
        const homeRoot = ctx.host.stickyComposerHost;
        const transcriptRoot = ctx.host.transcriptComposerHost;
        const sameRoot = !!homeRoot && homeRoot === transcriptRoot;
        syncStickyComposerWorkingPillInRoots(
            sameRoot ? [] : [homeRoot],
            {
                count,
                forceHide,
                onOpen: anchor => ctx.openWorkingAgentsPopoverFromPill(anchor),
            },
        );
        syncStickyComposerWorkingPillInRoots(
            [transcriptRoot],
            {
                count: sameRoot ? count : transcriptCount,
                forceHide: sameRoot ? forceHide : (forceHide || transcriptCount <= 0),
                onOpen: anchor => ctx.openWorkingAgentsPopoverFromPill(anchor),
            },
        );
        ctx.updateStepPillChrome();
        if (count > 0 || reading) {
            const roots = [ctx.host.stickyComposerHost, ctx.host.transcriptComposerHost];
            let pill: HTMLButtonElement | undefined;
            for (const root of roots) {
                const candidate = root?.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-working-pill');
                if (candidate) {
                    pill = candidate;
                    break;
                }
            }
            const isTranscriptPill = !!pill?.closest('.theia-mobile-agent-transcript-root');
            const members = isTranscriptPill
                ? ctx.collectTeamMembersForTranscriptSection()
                : ctx.host.collectTeamMembersForHub();
            if (pill && (isWorkingAgentsPopoverOpen() || isWorkingAgentsExpandSessionOpen())) {
                restoreWorkingAgentsExpandIfNeeded({
                    anchor: pill,
                    members,
                    transcriptOverlay: isTranscriptPill,
                    onSelect: member => ctx.host.onTeamMemberClick(member),
                    onStop: member => ctx.stopWorkingAgent(member),
                    onStopAll: working => ctx.stopAllWorkingAgents(working),
                    resolveDetailActivityFeed: member => ctx.resolveWorkingDetailActivityFeed(member),
                    resolveDetailTranscriptExcerpt: member => ctx.resolveWorkingDetailTranscriptExcerpt(member),
                    onDetailMemberChange: member => ctx.bindWorkingDetailActivitySubscription(member),
                });
            } else if (isWorkingAgentsPopoverOpen()) {
                syncWorkingAgentsExpandContent(members);
            }
        }
}

export function openWorkingAgentsPopoverFromPillExtracted(ctx: any, anchor: HTMLButtonElement): void {
        const transcriptOverlay = !!anchor.closest('.theia-mobile-agent-transcript-root');
        // When the pill is in the transcript overlay, show only this section's working agents.
        // The home sticky composer pill shows the full hub team.
        const members = transcriptOverlay
            ? ctx.collectTeamMembersForTranscriptSection()
            : ctx.host.collectTeamMembersForHub();
        ctx.prefetchWorkingDetailDocuments(members);
        openWorkingAgentsPopover({
            anchor,
            members,
            transcriptOverlay,
            onSelect: member => ctx.host.onTeamMemberClick(member),
            onStop: member => ctx.stopWorkingAgent(member),
            onStopAll: working => ctx.stopAllWorkingAgents(working),
            resolveDetailActivityFeed: member => ctx.resolveWorkingDetailActivityFeed(member),
            resolveDetailTranscriptExcerpt: member => ctx.resolveWorkingDetailTranscriptExcerpt(member),
            onDetailMemberChange: member => ctx.bindWorkingDetailActivitySubscription(member),
        });
}

export function updateStepPillChromeExtracted(ctx: any): void {
        const progress = ctx.resolveActiveConversationTodoStepProgress();
        syncStickyComposerStepPillInRoots(
            [ctx.host.stickyComposerHost, ctx.host.transcriptComposerHost],
            { progress },
        );
}

export function resolveActiveConversationTodoStepProgressExtracted(ctx: any): ReturnType<typeof resolveTodoStepProgress> {
        const summary = ctx.host.transcriptComposerSummary ?? ctx.host.transcriptOpenSummary;
        const conversationId = summary?.id?.trim();
        if (!conversationId) {
            ctx.lastStepPillConversationId = undefined;
            ctx.lastStepPillProgress = undefined;
            return undefined;
        }
        const document = ctx.host.conversations?.threadStore.getDocument(conversationId);
        const liveConv = ctx.host.transcriptLastConv?.id === conversationId
            ? ctx.host.transcriptLastConv
            : undefined;
        const messages = document?.messages?.length
            ? document.messages
            : liveConv?.messages;
        if (!messages?.length) {
            // Best-effort warm: live/chrome refresh will re-sync once the doc lands.
            ctx.host.conversations?.prefetchDocument(conversationId);
            // Keep the previous Step chrome for this conversation during transient gaps.
            if (ctx.lastStepPillConversationId === conversationId) {
                return ctx.lastStepPillProgress;
            }
            return undefined;
        }
        const items = resolveLatestTranscriptTodos(messages);
        const progress = items ? resolveTodoStepProgress(items) : undefined;
        ctx.lastStepPillConversationId = conversationId;
        ctx.lastStepPillProgress = progress;
        return progress;
}

export function bindWorkingDetailConversationSubscriptionExtracted(ctx: any, member: WorkHubTeamMember | undefined): void {
        const conversationId = member?.conversationId?.trim();
        if (!conversationId || !member) {
            ctx.workingDetailActivityDispose.dispose();
            ctx.workingDetailActivityDispose = Disposable.NULL;
            ctx.workingDetailActivityConversationId = undefined;
            return;
        }
        if (ctx.workingDetailActivityConversationId === conversationId
            && ctx.workingDetailActivityDispose !== Disposable.NULL) {
            // Same live thread — keep the existing subscription; still warm the cache.
            ctx.host.conversations?.prefetchDocument(conversationId);
            refreshWorkingAgentsDetailActivityFeed();
            return;
        }
        ctx.workingDetailActivityDispose.dispose();
        ctx.workingDetailActivityConversationId = conversationId;
        const conversations = ctx.host.conversations;
        if (!conversations) {
            ctx.workingDetailActivityDispose = Disposable.NULL;
            return;
        }
        const memberId = member.id;
        conversations.prefetchDocument(conversationId);
        ctx.workingDetailActivityDispose = conversations.threadStore.subscribe(
            () => {
                if (getWorkingAgentsDetailMemberId() !== memberId) {
                    return;
                }
                refreshWorkingAgentsDetailActivityFeed();
            },
            snapshot => snapshot.document,
            conversationId,
        );
}

