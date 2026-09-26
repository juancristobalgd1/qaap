import type { MobileProjectsTasksHubUiContext } from './mobile-projects-tasks-hub-ui-context';
// Extracted from mobile-projects-tasks-hub-ui.ts

import { Disposable } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { readQaapSignedIn } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import { startGithubOAuth } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { type QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import {
    QAAP_AGENTS_HUB_LANDING_ENABLED,
    QAAP_AGENTS_HUB_QUICK_ACTIONS,
    QAAP_AGENTS_HUB_RECENT_LIMIT,
} from '@theia/qaap-shared-core/lib/common/qaap-agents-hub-landing';
import { bindStickyComposerControlClick } from '@theia/qaap-composer/lib/common/qaap-sticky-composer-control-click';
import { type WorkHubTeamMember } from '@theia/qaap-shared-core/lib/common/qaap-work-hub-team';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { syncStickyComposerWorkingPillInRoots } from '@theia/qaap-composer/lib/browser/qaap-sticky-composer-working-pill';
import { resolveWorkingPillDisplayCount } from '../common/qaap-working-pill-count';
import { MobileSnackbar } from '@theia/qaap-mobile-shell/lib/browser/mobile-snackbar';
import {
    closeWorkingAgentsPopover,
    getWorkingAgentsDetailMemberId,
    isWorkingAgentsExpandPinnedOpen,
    isWorkingAgentsExpandSessionOpen,
    isWorkingAgentsPopoverOpen,
    isWorkingPillSuppressedAfterStopAll,
    noteWorkingPillChromeCount,
    openWorkingAgentsPopover,
    refreshWorkingAgentsDetailActivityFeed,
    restoreWorkingAgentsExpandIfNeeded,
    syncWorkingAgentsExpandContent,
} from '@theia/qaap-composer/lib/browser/qaap-sticky-composer-working-agents-popover';
import { syncStickyComposerStepPillInRoots } from '@theia/qaap-composer/lib/browser/qaap-sticky-composer-step-pill';
import {
    resolveLatestTranscriptTodos,
    resolveTodoStepProgress,
} from '@theia/qaap-transcript/lib/common/qaap-transcript-todo-step';

export function collectAgentsHubRecentItemsExtracted(ctx: MobileProjectsTasksHubUiContext, projects: MobileProjectEntry[],
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

export function shouldEmbedAgentsHubRecentsInWorkspaceTranscriptExtracted(ctx: MobileProjectsTasksHubUiContext): boolean {
        return QAAP_AGENTS_HUB_LANDING_ENABLED
            && ctx.host.transcriptSheet?.parentElement === document.body
            && !document.body.classList.contains('theia-mobile-mod-landing');
}

export function createAgentsHubLandingHeroBlockExtracted(ctx: MobileProjectsTasksHubUiContext): HTMLElement {
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

export function createAgentsHubQuickActionsBlockExtracted(ctx: MobileProjectsTasksHubUiContext): HTMLElement {
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
            const previewStarting = action.id === 'run-app'
                && (!!ctx.host.transcriptPreviewRequestRunning || !!ctx.host.transcriptPreviewRequestPending);
            const actionLabel = previewStarting
                ? nls.localize('qaap/mobileProjects/previewStarting', 'Starting preview…')
                : nls.localize(action.labelKey, action.labelDefault);
            icon.className = `codicon codicon-${previewStarting ? 'loading' : action.icon}`;
            icon.setAttribute('aria-hidden', 'true');
            iconWrap.append(icon);
            const label = document.createElement('span');
            label.className = 'theia-mobile-agent-transcript-empty-action-label';
            label.textContent = actionLabel;
            if (previewStarting) {
                btn.classList.add('theia-mod-preview-starting');
                btn.disabled = true;
                btn.title = actionLabel;
                btn.setAttribute('aria-label', actionLabel);
                btn.setAttribute('aria-busy', 'true');
            }
            btn.append(iconWrap, label);
            if (previewStarting) {
                const borderBeamBloom = document.createElement('div');
                borderBeamBloom.className = 'qaap-border-beam-bloom';
                borderBeamBloom.setAttribute('aria-hidden', 'true');
                btn.append(borderBeamBloom);
            }
            bindStickyComposerControlClick(btn, () => {
                if (action.id === 'run-app') {
                    const project = ctx.host.transcriptOpenProject
                        ?? ctx.host.transcriptComposerProject
                        ?? ctx.host.resolveShellProject?.();
                    const summary = ctx.host.transcriptOpenSummary
                        ?? ctx.host.transcriptComposerSummary
                        ?? (project ? ctx.host.resolveShellSummary?.(project) : undefined);
                    if (project && summary) {
                        setAgentsHubQuickActionPreviewStarting(btn);
                        void ctx.host.transcriptStickyComposerUi.launchComposerDevPreview(project, summary);
                        return;
                    }
                    MobileSnackbar.show(nls.localize(
                        'qaap/mobileProjects/previewRootUnresolved',
                        'Could not resolve this project\'s folder — open the project and retry.',
                    ), { kind: 'warning' });
                    return;
                }
                ctx.applyComposerQuickActionPrompt(nls.localize(action.promptKey, action.promptDefault));
            });
            container.append(btn);
        }
        return container;
}

function setAgentsHubQuickActionPreviewStarting(btn: HTMLButtonElement): void {
        const actionLabel = nls.localize('qaap/mobileProjects/previewStarting', 'Starting preview…');
        const icon = btn.querySelector<HTMLElement>('.theia-mobile-agent-transcript-empty-action-icon > i');
        icon?.classList.remove('codicon-rocket');
        icon?.classList.add('codicon-loading');
        const label = btn.querySelector<HTMLElement>('.theia-mobile-agent-transcript-empty-action-label');
        if (label) {
            label.textContent = actionLabel;
        }
        btn.classList.add('theia-mod-preview-starting');
        btn.disabled = true;
        btn.title = actionLabel;
        btn.setAttribute('aria-label', actionLabel);
        btn.setAttribute('aria-busy', 'true');
        if (!btn.querySelector('.qaap-border-beam-bloom')) {
            const borderBeamBloom = document.createElement('div');
            borderBeamBloom.className = 'qaap-border-beam-bloom';
            borderBeamBloom.setAttribute('aria-hidden', 'true');
            btn.append(borderBeamBloom);
        }
}

export function applyComposerQuickActionPromptExtracted(ctx: MobileProjectsTasksHubUiContext, prompt: string): void {
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

export function createAgentsHubRecentsBlockExtracted(ctx: MobileProjectsTasksHubUiContext, project: MobileProjectEntry): HTMLElement {
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

export function updateTasksAttentionChromeExtracted(ctx: MobileProjectsTasksHubUiContext): void {
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

/** Last conversation section the Working pill was scoped to, per tasks-hub UI instance. */
const lastWorkingPillSectionByUi = new WeakMap<MobileProjectsTasksHubUiContext, string | undefined>();

/**
 * Conversation whose section the conversation composer's Working pill is scoped to. Undefined
 * when no conversation composer is mounted (hub home), where the pill stays global.
 */
function resolveWorkingPillSectionConversationId(ctx: MobileProjectsTasksHubUiContext): string | undefined {
        const host = ctx.host.transcriptComposerHost;
        if (!host?.isConnected) {
            return undefined;
        }
        const summary = ctx.host.transcriptComposerSummary ?? ctx.host.transcriptOpenSummary;
        return summary?.id?.trim() || undefined;
}

/**
 * True when the pill lives in the conversation composer — including the Agents Hub shell,
 * which mounts the conversation composer into the home sticky host (no transcript-root class).
 */
function isSectionScopedWorkingPill(ctx: MobileProjectsTasksHubUiContext, anchor: HTMLElement | undefined): boolean {
        const host = ctx.host.transcriptComposerHost;
        return !!anchor && !!host && host.contains(anchor)
            && resolveWorkingPillSectionConversationId(ctx) !== undefined;
}

function findWorkingPill(root: HTMLElement | undefined): HTMLButtonElement | undefined {
        return root?.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-working-pill') ?? undefined;
}

export function updateWorkingPillChromeExtracted(ctx: MobileProjectsTasksHubUiContext): void {
        const rawCount = ctx.countWorkingAgentsForPill();
        noteWorkingPillChromeCount(rawCount);
        // After Stop All, hide the pill until a new live working agent appears (attention
        // count can lag behind cancel; reading-retain must not keep "1 Working").
        const suppressedAfterStopAll = isWorkingPillSuppressedAfterStopAll();
        const suppressForEmptyComposer = ctx.shouldSuppressWorkingPillForEmptyComposer();
        const homeRoot = ctx.host.stickyComposerHost;
        const transcriptRoot = ctx.host.transcriptComposerHost;
        const sameRoot = !!homeRoot && homeRoot === transcriptRoot;
        const sectionId = resolveWorkingPillSectionConversationId(ctx);
        // Switching conversations must not carry the previous section's expand (and its
        // members) into the new one — the pill and its list are strictly per conversation.
        if (lastWorkingPillSectionByUi.has(ctx) && lastWorkingPillSectionByUi.get(ctx) !== sectionId
            && (isWorkingAgentsPopoverOpen() || isWorkingAgentsExpandSessionOpen())) {
            closeWorkingAgentsPopover(true);
        }
        lastWorkingPillSectionByUi.set(ctx, sectionId);
        // Per-section count: agents working in the open conversation plus its forks/subagents
        // and VPS subtasks only. The hub home pill (no conversation open) keeps the global count.
        const sectionCount = sectionId !== undefined ? ctx.countWorkingAgentsForTranscriptPill() : 0;
        const reading = isWorkingAgentsExpandPinnedOpen() && !suppressedAfterStopAll;
        const transcriptPill = findWorkingPill(transcriptRoot);
        const readingInSection = reading && sectionId !== undefined
            && (sameRoot || (!!transcriptPill && isWorkingAgentsPopoverOpen(transcriptPill)));
        const readingAtHome = reading && !readingInSection;
        // Never auto-collapse while the user is reading (list or detail). Summary/settled
        // often drops the working count to 0 (streaming → idle); only ✕ / Escape / Stop All
        // / pill toggle may close in that case. Empty/new chat surfaces always hide the pill.
        const activeLiveCount = suppressedAfterStopAll ? 0 : (sectionId !== undefined ? sectionCount : rawCount);
        if (suppressForEmptyComposer || (activeLiveCount <= 0 && !reading)) {
            closeWorkingAgentsPopover(true);
        }
        // Keep chrome alive while home/transcript composers exist, or while an expand session
        // is still open (pill may be briefly parked during remount).
        const composerMounted = !!(
            homeRoot?.querySelector('.theia-mobile-projects-sticky-composer-inner')
            || transcriptRoot?.querySelector('.theia-mobile-projects-sticky-composer-inner')
        );
        const forceHide = suppressedAfterStopAll || suppressForEmptyComposer;
        const homeCount = resolveWorkingPillDisplayCount({
            liveCount: rawCount,
            suppressedAfterStopAll,
            reading: readingAtHome,
            suppressForEmptyComposer,
            surfaceMounted: ctx.host.homeMode || composerMounted,
        });
        const sectionDisplayCount = sectionId === undefined ? 0 : resolveWorkingPillDisplayCount({
            liveCount: sectionCount,
            suppressedAfterStopAll,
            reading: readingInSection,
            suppressForEmptyComposer,
            surfaceMounted: composerMounted,
        });
        // When the conversation composer is mounted into the home host (Agents Hub shell),
        // that single pill IS the conversation's pill and must be section-scoped.
        if (!sameRoot) {
            syncStickyComposerWorkingPillInRoots([homeRoot], {
                count: homeCount,
                forceHide,
                onOpen: anchor => ctx.openWorkingAgentsPopoverFromPill(anchor),
            });
        }
        const conversationPillCount = sectionId !== undefined ? sectionDisplayCount : (sameRoot ? homeCount : 0);
        syncStickyComposerWorkingPillInRoots([transcriptRoot], {
            count: conversationPillCount,
            forceHide: forceHide || (sectionId !== undefined ? sectionDisplayCount <= 0 : !sameRoot),
            onOpen: anchor => ctx.openWorkingAgentsPopoverFromPill(anchor),
        });
        ctx.updateStepPillChrome();
        if (homeCount > 0 || conversationPillCount > 0 || reading) {
            // Prefer the conversation pill: it sits on top (overlay / shell) when both exist.
            const pill = findWorkingPill(transcriptRoot) ?? findWorkingPill(homeRoot);
            const members = isSectionScopedWorkingPill(ctx, pill)
                ? ctx.collectTeamMembersForTranscriptSection()
                : ctx.host.collectTeamMembersForHub();
            if (pill && (isWorkingAgentsPopoverOpen() || isWorkingAgentsExpandSessionOpen())) {
                restoreWorkingAgentsExpandIfNeeded({
                    anchor: pill,
                    members,
                    transcriptOverlay: !!pill.closest('.theia-mobile-agent-transcript-root'),
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

export function openWorkingAgentsPopoverFromPillExtracted(ctx: MobileProjectsTasksHubUiContext, anchor: HTMLButtonElement): void {
        // Positioning follows the transcript overlay; membership follows the composer the pill
        // belongs to — a conversation composer lists only this conversation's agents.
        const transcriptOverlay = !!anchor.closest('.theia-mobile-agent-transcript-root');
        const members = isSectionScopedWorkingPill(ctx, anchor)
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

export function updateStepPillChromeExtracted(ctx: MobileProjectsTasksHubUiContext): void {
        const progress = ctx.resolveActiveConversationTodoStepProgress();
        syncStickyComposerStepPillInRoots(
            [ctx.host.stickyComposerHost, ctx.host.transcriptComposerHost],
            { progress },
        );
}

export function resolveActiveConversationTodoStepProgressExtracted(ctx: MobileProjectsTasksHubUiContext): ReturnType<typeof resolveTodoStepProgress> {
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

export function bindWorkingDetailConversationSubscriptionExtracted(ctx: MobileProjectsTasksHubUiContext, member: WorkHubTeamMember | undefined): void {
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

