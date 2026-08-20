// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import {
    QAAP_GIT_REVIEW_API_PATH,
    isQaapGitReviewMissingRootError,
    isQaapGitReviewNotRepoError,
    readQaapGitReviewErrorBody,
    type QaapGitBranchesResponse,
} from '../common/qaap-git-review';
import { isAgentsHubIdleConversationSummary } from '../common/qaap-agents-hub-landing';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import {
    createComposerWorkspaceSheetNavGroup,
    type ComposerWorkspaceSheetNavKind,
    type StickyComposerWorkspaceBarView,
} from './qaap-sticky-composer-workspace-bar';
import {
    isWorkHubHeaderProjectPopoverAnchor,
    markStickyComposerPopoverAnchor,
    mountStickyComposerBottomSheet,
    mountStickyComposerSheetPopover,
    scheduleStickyComposerPopoverPosition,
    shouldUseStickyComposerPopover,
    type StickyComposerPopoverAlign,
} from './qaap-sticky-composer-popover';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsService } from './mobile-projects-service';
import type { MobileProjectsTranscriptComposerUi } from './mobile-projects-transcript-composer-ui';
import type { MobileProjectsTranscriptStickyComposerUi } from './mobile-projects-transcript-sticky-composer-ui';
import { MobileSnackbar } from './mobile-snackbar';
import {
    closeComposerBranchSheetMenu,
    COMPOSER_BRANCH_SHEET_ROW_SELECTOR,
    copyComposerBranchName,
    createComposerBranchSheetRow,
    findComposerBranchSheetRow,
    indexComposerBranchSheetRow,
} from './qaap-composer-branch-sheet-row';

export interface MobileProjectsStickyComposerWorkspaceHost {
composerWorkspaceBranchByProjectId: Map<string, string>;
preparedCwdByProjectId: Map<string, string>;
projects: MobileProjectEntry[];
agentsHubSelectedProjectId: string | undefined;
agentsHubShellActive: boolean;
agentsHubInlineActive: boolean;
transcriptOpenProject: MobileProjectEntry | undefined;
stickyComposerWorkspaceSheet: HTMLElement | undefined;
transcriptComposerHost: HTMLElement | undefined;
transcriptComposerProject: MobileProjectEntry | undefined;
transcriptComposerSummary: import('../common/qaap-agent-conversation-client').QaapAgentConversationSummaryDTO | undefined;
projectsService: MobileProjectsService;
delegate: { onProjectsChanged?: () => void };
transcriptComposerUi: MobileProjectsTranscriptComposerUi;
transcriptStickyComposerUi: MobileProjectsTranscriptStickyComposerUi;
conversationIndexUi: import('./mobile-projects-conversation-index-ui').MobileProjectsConversationIndexUi;
render(): void;
renderAgentsHubExecutionShell(): void;
openProject(project: MobileProjectEntry): Promise<void>;
openAgentsHubInlineTranscript(
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
): Promise<void>;
onNewClick(): Promise<void>;
activateAgentsHubProject(project: MobileProjectEntry): Promise<void>;
stickyComposerRenderUi: import('./mobile-projects-sticky-composer-render-ui').MobileProjectsStickyComposerRenderUi;
stickyComposerSheetsUi: import('./mobile-projects-sticky-composer-sheets-ui').MobileProjectsStickyComposerSheetsUi;
}

/** Where a new composer task runs: the project's working tree or a fresh isolated git worktree. */
export type QaapComposerWorkspaceDestination = 'local' | 'worktree';

export type ComposerWorkspaceSheetOpenIntent = 'toggle' | 'switch';

export class MobileProjectsStickyComposerWorkspaceUi {
    private workspaceSheetAnchor: HTMLElement | undefined;
    private workspacePopoverCleanup: (() => void) | undefined;
    private workspacePopoverAlign: StickyComposerPopoverAlign = 'start';
    /** Session-only "Run in" choice per project — resets to Local on reload. */
    private readonly workspaceDestinationByProjectId = new Map<string, QaapComposerWorkspaceDestination>();
    /** Prevents duplicate delete requests while an optimistic removal is in flight. */
    private readonly deletingComposerWorkspaceBranches = new Set<string>();
    /** Branches removed in this tab session — filtered out of subsequent sheet loads. */
    private readonly deletedComposerWorkspaceBranchesByProjectId = new Map<string, Set<string>>();

    constructor(protected readonly host: MobileProjectsStickyComposerWorkspaceHost) { }

    resolveComposerWorkspaceDestination(project: MobileProjectEntry): QaapComposerWorkspaceDestination {
        return this.workspaceDestinationByProjectId.get(project.id) ?? 'local';
    }

    resolveComposerWorkspaceDestinationLabel(project: MobileProjectEntry): string {
        return this.resolveComposerWorkspaceDestination(project) === 'worktree'
            ? nls.localize('qaap/composerWorkspace/destinationWorktree', 'New Worktree')
            : nls.localize('qaap/composerWorkspace/destinationLocal', 'Local');
    }

    resolveComposerWorkspaceDestinationIconClass(project: MobileProjectEntry): string {
        return this.resolveComposerWorkspaceDestination(project) === 'worktree'
            ? 'codicon-repo-forked'
            : 'codicon-device-desktop';
    }

    closeComposerWorkspaceSheet(): void {
        closeComposerBranchSheetMenu();
        this.workspacePopoverCleanup?.();
        this.workspacePopoverCleanup = undefined;
        if (this.workspaceSheetAnchor) {
            markStickyComposerPopoverAnchor(this.workspaceSheetAnchor, false);
            this.workspaceSheetAnchor = undefined;
        }
        if (this.host.stickyComposerWorkspaceSheet) {
            this.host.stickyComposerWorkspaceSheet.remove();
            this.host.stickyComposerWorkspaceSheet = undefined;
        }
    }

    protected shouldUseWorkspacePopover(anchor?: HTMLElement): anchor is HTMLElement {
        return shouldUseStickyComposerPopover(anchor);
    }

    protected resolveWorkspacePopoverAlign(anchor?: HTMLElement): StickyComposerPopoverAlign {
        return isWorkHubHeaderProjectPopoverAnchor(anchor) ? 'center' : 'start';
    }

    protected shouldToggleCloseComposerWorkspaceSheet(
        anchor: HTMLElement | undefined,
        intent: ComposerWorkspaceSheetOpenIntent,
    ): boolean {
        return intent === 'toggle'
            && this.shouldUseWorkspacePopover(anchor)
            && this.workspaceSheetAnchor === anchor
            && !!this.host.stickyComposerWorkspaceSheet;
    }

    protected appendComposerWorkspaceSheetNavIfHeader(
        panel: HTMLElement,
        project: MobileProjectEntry,
        active: ComposerWorkspaceSheetNavKind,
        transcriptOverlay: boolean,
        anchor?: HTMLElement,
    ): void {
        if (!isWorkHubHeaderProjectPopoverAnchor(anchor)) {
            return;
        }
        const header = panel.querySelector('.theia-mobile-sticky-composer-sheet-header');
        const nav = createComposerWorkspaceSheetNavGroup({
            active,
            destinationIconClass: this.resolveComposerWorkspaceDestinationIconClass(project),
            onSelect: kind => {
                if (kind === active) {
                    return;
                }
                const intent: ComposerWorkspaceSheetOpenIntent = 'switch';
                switch (kind) {
                    case 'project':
                        this.openComposerWorkspaceProjectSheet(project, transcriptOverlay, anchor, intent);
                        break;
                    case 'branch':
                        this.openComposerWorkspaceBranchSheet(project, transcriptOverlay, anchor, intent);
                        break;
                    case 'destination':
                        this.openComposerWorkspaceDestinationSheet(project, transcriptOverlay, anchor, intent);
                        break;
                }
            },
        });
        if (header) {
            header.after(nav);
        } else {
            panel.prepend(nav);
        }
    }

    protected syncWorkspacePopoverPosition(): void {
        const root = this.host.stickyComposerWorkspaceSheet;
        const anchor = this.workspaceSheetAnchor;
        if (!root?.classList.contains('qaap-sticky-composer-sheet-popover') || !anchor) {
            return;
        }
        scheduleStickyComposerPopoverPosition(root, anchor, this.workspacePopoverAlign);
    }

    protected mountComposerWorkspaceSheetPresentation(
        panel: HTMLElement,
        options: {
            readonly transcriptOverlay: boolean;
            readonly anchor?: HTMLElement;
            readonly align?: StickyComposerPopoverAlign;
            readonly variant?: 'project' | 'branch';
        },
    ): void {
        const onClose = (): void => { this.host.stickyComposerSheetsUi.closeStickyComposerSheets(); };
        this.workspacePopoverAlign = options.align ?? 'start';
        if (this.shouldUseWorkspacePopover(options.anchor)) {
            const modifierClasses = options.variant === 'branch'
                ? ['theia-mod-branch-sheet']
                : ['theia-mod-project-sheet'];
            const mounted = mountStickyComposerSheetPopover(panel, {
                anchor: options.anchor,
                onClose,
                align: this.workspacePopoverAlign,
                transcriptOverlay: options.transcriptOverlay,
                modifierClasses,
            });
            document.body.append(mounted.root);
            this.host.stickyComposerWorkspaceSheet = mounted.root;
            this.workspaceSheetAnchor = options.anchor;
            this.workspacePopoverCleanup = mounted.cleanup;
            scheduleStickyComposerPopoverPosition(mounted.root, options.anchor, this.workspacePopoverAlign);
            return;
        }
        const sheet = mountStickyComposerBottomSheet(panel, {
            sheetClassName: options.transcriptOverlay
                ? 'theia-mobile-sticky-composer-sheet theia-mod-workspace theia-mod-transcript-overlay'
                : 'theia-mobile-sticky-composer-sheet theia-mod-workspace',
            onClose,
        });
        document.body.append(sheet);
        this.host.stickyComposerWorkspaceSheet = sheet;
    }

    protected createComposerWorkspaceSheetHeader(
        titleText: string,
        onClose: () => void,
        valueText?: string,
    ): HTMLElement {
        const header = document.createElement('header');
        header.className = 'theia-mobile-sticky-composer-sheet-header';
        const title = document.createElement('h2');
        const label = document.createElement('span');
        label.className = 'theia-mobile-sticky-composer-sheet-header-label';
        label.textContent = titleText;
        title.append(label);
        const trimmedValue = valueText?.trim();
        if (trimmedValue) {
            const value = document.createElement('span');
            value.className = 'theia-mobile-sticky-composer-sheet-header-value';
            value.textContent = trimmedValue;
            title.append(value);
            title.setAttribute('aria-label', `${titleText} ${trimmedValue}`);
        }
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'theia-mobile-sticky-composer-sheet-close codicon codicon-close';
        close.title = nls.localize('qaap/mobileAgentComposer/close', 'Close');
        close.setAttribute('aria-label', close.title);
        close.addEventListener('click', onClose);
        header.append(title, close);
        return header;
    }

    resolveComposerWorkspaceBranch(project: MobileProjectEntry): string {
        return this.host.composerWorkspaceBranchByProjectId.get(project.id)
            ?? project.branch
            ?? this.host.projectsService.getCurrentWorkspaceBranch()
            ?? 'main';
    }
    async refreshComposerWorkspaceBranch(project: MobileProjectEntry): Promise<string> {
        const cwd = this.host.projectsService.getProjectCwd(project) ?? this.host.preparedCwdByProjectId.get(project.id);
        if (!cwd) {
            return this.resolveComposerWorkspaceBranch(project);
        }
        try {
            const params = new URLSearchParams({ root: cwd });
            const response = await fetch(`${QAAP_GIT_REVIEW_API_PATH}/changes?${params.toString()}`, {
                credentials: 'include',
                cache: 'no-store',
            });
            if (!response.ok) {
                return this.resolveComposerWorkspaceBranch(project);
            }
            const payload = await response.json() as { branch?: string };
            if (payload.branch) {
                this.host.composerWorkspaceBranchByProjectId.set(project.id, payload.branch);
                return payload.branch;
            }
        } catch {
            /* optional */
        }
        return this.resolveComposerWorkspaceBranch(project);
    }
    resolveComposerWorkspaceBarView(project: MobileProjectEntry): StickyComposerWorkspaceBarView {
        return {
            projectName: project.name,
            branchName: this.resolveComposerWorkspaceBranch(project),
        };
    }
    remountComposerWithWorkspaceBar(project: MobileProjectEntry): void {
        if (this.host.transcriptComposerHost?.isConnected && this.host.transcriptComposerProject && this.host.transcriptComposerSummary) {
            this.host.transcriptStickyComposerUi.remountTranscriptStickyComposer();
            return;
        }
        this.host.stickyComposerRenderUi.renderStickyComposer();
        void this.refreshComposerWorkspaceBranch(project).then(() => {
            if (this.host.transcriptComposerHost?.isConnected) {
                this.host.transcriptStickyComposerUi.remountTranscriptStickyComposer();
            } else {
                this.host.stickyComposerRenderUi.renderStickyComposer();
            }
        });
    }

    protected resolveComposerWorkspaceOpenConversation(
        project: MobileProjectEntry,
    ): QaapAgentConversationSummaryDTO | undefined {
        return this.host.conversationIndexUi.conversationsForProject(project)
            .find(summary => !isAgentsHubIdleConversationSummary(summary));
    }

    async selectComposerWorkspaceProject(
        entry: MobileProjectEntry,
        contextProject: MobileProjectEntry,
    ): Promise<void> {
        if (entry.id === contextProject.id) {
            return;
        }
        this.host.agentsHubSelectedProjectId = entry.id;
        const cwd = await this.host.projectsService.prepareProjectCwd(entry);
        if (cwd) {
            this.host.preparedCwdByProjectId.set(entry.id, cwd);
        }
        if (this.host.agentsHubInlineActive || this.host.agentsHubShellActive) {
            const summary = this.resolveComposerWorkspaceOpenConversation(entry);
            if (summary) {
                await this.host.openAgentsHubInlineTranscript(entry, summary);
            } else {
                await this.host.activateAgentsHubProject(entry);
            }
            this.remountComposerWithWorkspaceBar(entry);
            return;
        }
        if (entry.isCurrent) {
            this.remountComposerWithWorkspaceBar(entry);
            return;
        }
        await this.host.openProject(entry);
    }
    openComposerWorkspaceProjectSheet(
        project: MobileProjectEntry,
        transcriptOverlay = false,
        anchor?: HTMLElement,
        intent: ComposerWorkspaceSheetOpenIntent = 'toggle',
    ): void {
        if (this.shouldToggleCloseComposerWorkspaceSheet(anchor, intent)) {
            this.host.stickyComposerSheetsUi.closeStickyComposerSheets();
            return;
        }
        this.host.stickyComposerSheetsUi.closeStickyComposerSheets();
        this.host.transcriptComposerUi.closeTranscriptComposerSheets();

        const panel = document.createElement('section');
        panel.className = 'theia-mobile-sticky-composer-sheet-panel';
        const onClose = (): void => { this.host.stickyComposerSheetsUi.closeStickyComposerSheets(); };
        panel.append(this.createComposerWorkspaceSheetHeader(
            nls.localize('qaap/composerWorkspace/projectSheetTitle', 'Project'),
            onClose,
            project.name,
        ));
        this.appendComposerWorkspaceSheetNavIfHeader(panel, project, 'project', transcriptOverlay, anchor);

        const list = document.createElement('div');
        list.className = 'theia-mobile-sticky-composer-sheet-list';

        const actionsLabel = document.createElement('div');
        actionsLabel.className = 'theia-mobile-sticky-composer-sheet-section-label';
        actionsLabel.textContent = nls.localize('qaap/composerWorkspace/projectSheetActions', 'Add');
        list.append(actionsLabel);
        list.append(this.createComposerProjectSheetAction({
            iconClass: 'codicon-repo',
            label: nls.localize('qaap/mobileOpenRepo/startNewProject', 'Start new project'),
            onSelect: () => {
                this.host.stickyComposerSheetsUi.closeStickyComposerSheets();
                void this.onCreateNewProjectFromSheet();
            },
        }));
        list.append(this.createComposerProjectSheetAction({
            iconClass: 'codicon-repo-clone',
            label: nls.localize('qaap/mobileProjects/newRepository', 'Add repository'),
            onSelect: () => {
                this.host.stickyComposerSheetsUi.closeStickyComposerSheets();
                void this.host.onNewClick();
            },
        }));

        const label = document.createElement('div');
        label.className = 'theia-mobile-sticky-composer-sheet-section-label';
        label.textContent = nls.localize('qaap/composerWorkspace/projectSheetSection', 'Repository');
        list.append(label);

        for (const entry of this.host.projects) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'theia-mobile-sticky-composer-sheet-option';
            if (entry.id === project.id) {
                btn.classList.add('theia-mod-selected');
            }
            const content = document.createElement('span');
            content.className = 'theia-mobile-sticky-composer-sheet-option-content';
            const name = document.createElement('span');
            name.className = 'theia-mobile-sticky-composer-sheet-option-label';
            name.textContent = entry.name;
            content.append(name);
            if (entry.id === project.id) {
                const check = document.createElement('span');
                check.className = 'codicon codicon-check theia-mobile-sticky-composer-sheet-option-check';
                check.setAttribute('aria-hidden', 'true');
                content.append(check);
            }
            btn.append(content);
            btn.addEventListener('click', () => {
                this.host.stickyComposerSheetsUi.closeStickyComposerSheets();
                void this.selectComposerWorkspaceProject(entry, project);
            });
            list.append(btn);
        }

        panel.append(list);
        this.mountComposerWorkspaceSheetPresentation(panel, {
            transcriptOverlay,
            anchor,
            align: this.resolveWorkspacePopoverAlign(anchor),
            variant: 'project',
        });
        window.requestAnimationFrame(() => this.syncWorkspacePopoverPosition());
    }
    openComposerWorkspaceDestinationSheet(
        project: MobileProjectEntry,
        transcriptOverlay = false,
        anchor?: HTMLElement,
        intent: ComposerWorkspaceSheetOpenIntent = 'toggle',
    ): void {
        if (this.shouldToggleCloseComposerWorkspaceSheet(anchor, intent)) {
            this.host.stickyComposerSheetsUi.closeStickyComposerSheets();
            return;
        }
        this.host.stickyComposerSheetsUi.closeStickyComposerSheets();
        this.host.transcriptComposerUi.closeTranscriptComposerSheets();

        const panel = document.createElement('section');
        panel.className = 'theia-mobile-sticky-composer-sheet-panel';
        const onClose = (): void => { this.host.stickyComposerSheetsUi.closeStickyComposerSheets(); };
        panel.append(this.createComposerWorkspaceSheetHeader(
            nls.localize('qaap/composerWorkspace/destinationSheetTitle', 'Run in'),
            onClose,
            this.resolveComposerWorkspaceDestinationLabel(project),
        ));
        this.appendComposerWorkspaceSheetNavIfHeader(panel, project, 'destination', transcriptOverlay, anchor);

        const list = document.createElement('div');
        list.className = 'theia-mobile-sticky-composer-sheet-list';
        const current = this.resolveComposerWorkspaceDestination(project);
        const destinations: ReadonlyArray<{
            readonly id: QaapComposerWorkspaceDestination;
            readonly iconClass: string;
            readonly label: string;
        }> = [
            {
                id: 'local',
                iconClass: 'codicon-device-desktop',
                label: nls.localize('qaap/composerWorkspace/destinationLocal', 'Local'),
            },
            {
                id: 'worktree',
                iconClass: 'codicon-repo-forked',
                label: nls.localize('qaap/composerWorkspace/destinationWorktree', 'New Worktree'),
            },
        ];
        for (const destination of destinations) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'theia-mobile-sticky-composer-sheet-option';
            if (destination.id === current) {
                btn.classList.add('theia-mod-selected');
            }
            const content = document.createElement('span');
            content.className = 'theia-mobile-sticky-composer-sheet-option-content';
            const icon = document.createElement('span');
            icon.className = `codicon ${destination.iconClass} theia-mobile-sticky-composer-sheet-option-icon`;
            icon.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.className = 'theia-mobile-sticky-composer-sheet-option-label';
            label.textContent = destination.label;
            content.append(icon, label);
            if (destination.id === current) {
                const check = document.createElement('span');
                check.className = 'codicon codicon-check theia-mobile-sticky-composer-sheet-option-check';
                check.setAttribute('aria-hidden', 'true');
                content.append(check);
            }
            btn.append(content);
            btn.addEventListener('click', () => {
                this.workspaceDestinationByProjectId.set(project.id, destination.id);
                this.host.stickyComposerSheetsUi.closeStickyComposerSheets();
                this.remountComposerWithWorkspaceBar(project);
            });
            list.append(btn);
        }

        panel.append(list);
        this.mountComposerWorkspaceSheetPresentation(panel, {
            transcriptOverlay,
            anchor,
            align: this.resolveWorkspacePopoverAlign(anchor),
            variant: 'branch',
        });
        window.requestAnimationFrame(() => this.syncWorkspacePopoverPosition());
    }
    createComposerProjectSheetAction(options: {
        readonly iconClass: string;
        readonly label: string;
        readonly onSelect: () => void;
    }): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theia-mobile-sticky-composer-sheet-option theia-mod-action';
        const content = document.createElement('span');
        content.className = 'theia-mobile-sticky-composer-sheet-option-content';
        const icon = document.createElement('span');
        icon.className = `codicon ${options.iconClass} theia-mobile-sticky-composer-sheet-option-icon`;
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'theia-mobile-sticky-composer-sheet-option-label';
        label.textContent = options.label;
        content.append(icon, label);
        btn.append(content);
        btn.addEventListener('click', () => options.onSelect());
        return btn;
    }
    async onCreateNewProjectFromSheet(): Promise<void> {
        const previousIds = new Set(this.host.projects.map(entry => entry.id));
        const nextProjects = await this.host.projectsService.createGithubProject();
        if (!nextProjects) {
            return;
        }
        this.host.projects = nextProjects;
        const created = this.resolveNewlyCreatedProject(previousIds, nextProjects);
        if (created) {
            await this.host.activateAgentsHubProject(created);
        } else {
            this.host.render();
        }
        this.host.delegate.onProjectsChanged?.();
    }

    protected resolveNewlyCreatedProject(
        previousIds: ReadonlySet<string>,
        projects: MobileProjectEntry[],
    ): MobileProjectEntry | undefined {
        const fresh = projects.filter(entry => !previousIds.has(entry.id));
        if (fresh.length === 1) {
            return fresh[0];
        }
        if (fresh.length === 0) {
            return undefined;
        }
        return [...fresh].sort((left, right) =>
            (right.lastActiveAt ?? '').localeCompare(left.lastActiveAt ?? ''),
        )[0];
    }
    openComposerWorkspaceBranchSheet(
        project: MobileProjectEntry,
        transcriptOverlay = false,
        anchor?: HTMLElement,
        intent: ComposerWorkspaceSheetOpenIntent = 'toggle',
    ): void {
        if (this.shouldToggleCloseComposerWorkspaceSheet(anchor, intent)) {
            this.host.stickyComposerSheetsUi.closeStickyComposerSheets();
            return;
        }
        this.host.stickyComposerSheetsUi.closeStickyComposerSheets();
        this.host.transcriptComposerUi.closeTranscriptComposerSheets();

        const panel = document.createElement('section');
        panel.className = 'theia-mobile-sticky-composer-sheet-panel';
        const onClose = (): void => { this.host.stickyComposerSheetsUi.closeStickyComposerSheets(); };
        panel.append(this.createComposerWorkspaceSheetHeader(
            nls.localize('qaap/composerWorkspace/branchSheetTitle', 'Branch'),
            onClose,
            this.resolveComposerWorkspaceBranch(project),
        ));
        this.appendComposerWorkspaceSheetNavIfHeader(panel, project, 'branch', transcriptOverlay, anchor);

        const list = document.createElement('div');
        list.className = 'theia-mobile-sticky-composer-sheet-list';
        const loading = document.createElement('p');
        loading.className = 'theia-mobile-sticky-composer-sheet-loading';
        loading.textContent = nls.localize('qaap/composerWorkspace/branchLoading', 'Loading branches…');
        list.append(loading);

        panel.append(list);
        this.mountComposerWorkspaceSheetPresentation(panel, {
            transcriptOverlay,
            anchor,
            align: this.resolveWorkspacePopoverAlign(anchor),
            variant: 'branch',
        });

        void this.loadComposerWorkspaceBranchSheet(project, list);
    }
    protected finishComposerWorkspaceBranchSheetList(list: HTMLElement): void {
        window.requestAnimationFrame(() => this.syncWorkspacePopoverPosition());
    }

    protected composerWorkspaceBranchDeleteKey(projectId: string, branch: string): string {
        return `${projectId}::${branch}`;
    }

    protected markComposerWorkspaceBranchDeleted(projectId: string, branch: string): void {
        let deleted = this.deletedComposerWorkspaceBranchesByProjectId.get(projectId);
        if (!deleted) {
            deleted = new Set();
            this.deletedComposerWorkspaceBranchesByProjectId.set(projectId, deleted);
        }
        deleted.add(branch);
    }

    protected filterComposerWorkspaceBranchList(projectId: string, branches: readonly string[]): string[] {
        const deleted = this.deletedComposerWorkspaceBranchesByProjectId.get(projectId);
        if (!deleted?.size) {
            return [...branches];
        }
        return branches.filter(branch => !deleted.has(branch));
    }

    protected createComposerWorkspaceBranchRow(
        project: MobileProjectEntry,
        list: HTMLElement,
        branch: string,
        current: string | undefined,
    ): HTMLElement {
        return createComposerBranchSheetRow({
            branch,
            selected: branch === current,
            deleteDisabled: branch === current,
            onSelect: () => {
                void this.checkoutComposerWorkspaceBranch(project, branch);
            },
            onCopy: async () => {
                const copied = await copyComposerBranchName(branch);
                if (copied) {
                    MobileSnackbar.show(
                        nls.localize('qaap/composerWorkspace/branchCopied', 'Copied {0}', branch),
                        { kind: 'success', duration: 1400 },
                    );
                } else {
                    MobileSnackbar.show(
                        nls.localize('qaap/composerWorkspace/branchCopyFailed', 'Could not copy branch name'),
                        { kind: 'warning', duration: 2200 },
                    );
                }
            },
            onDelete: () => {
                void this.deleteComposerWorkspaceBranch(project, branch, list, current);
            },
        });
    }

    protected appendComposerWorkspaceBranchRow(
        project: MobileProjectEntry,
        list: HTMLElement,
        branch: string,
        current: string | undefined,
    ): void {
        list.append(this.createComposerWorkspaceBranchRow(project, list, branch, current));
    }

    protected insertComposerWorkspaceBranchRowAt(
        project: MobileProjectEntry,
        list: HTMLElement,
        branch: string,
        current: string | undefined,
        index: number,
    ): void {
        const row = this.createComposerWorkspaceBranchRow(project, list, branch, current);
        const rows = list.querySelectorAll(COMPOSER_BRANCH_SHEET_ROW_SELECTOR);
        if (index >= 0 && index < rows.length) {
            list.insertBefore(row, rows[index]);
        } else {
            list.append(row);
        }
    }

    protected clearComposerWorkspaceBranchEmptyState(list: HTMLElement): void {
        list.querySelector('p.theia-mobile-sticky-composer-sheet-loading')?.remove();
    }

    protected showComposerWorkspaceBranchEmptyState(list: HTMLElement): void {
        if (list.querySelector(COMPOSER_BRANCH_SHEET_ROW_SELECTOR)) {
            return;
        }
        list.replaceChildren();
        const empty = document.createElement('p');
        empty.className = 'theia-mobile-sticky-composer-sheet-loading';
        empty.textContent = nls.localize('qaap/composerWorkspace/branchEmpty', 'No local branches found.');
        list.append(empty);
    }
    protected resolveComposerWorkspaceBranchCwd(project: MobileProjectEntry): string | undefined {
        return this.host.projectsService.getProjectCwd(project) ?? this.host.preparedCwdByProjectId.get(project.id);
    }

    protected async ensureComposerWorkspaceBranchCwd(project: MobileProjectEntry): Promise<string | undefined> {
        const existing = this.resolveComposerWorkspaceBranchCwd(project);
        if (existing) {
            return existing;
        }
        const prepared = await this.host.projectsService.prepareProjectCwd(project);
        if (prepared) {
            this.host.preparedCwdByProjectId.set(project.id, prepared);
        }
        return prepared;
    }

    protected clearStaleComposerWorkspaceBranchCwd(project: MobileProjectEntry): void {
        this.host.preparedCwdByProjectId.delete(project.id);
    }

    protected formatComposerWorkspaceBranchApiError(raw: string): string {
        const message = readQaapGitReviewErrorBody(raw) ?? raw.trim();
        if (isQaapGitReviewMissingRootError(message)) {
            return nls.localize(
                'qaap/composerWorkspace/branchUnavailable',
                'Open this project in the workspace to switch branches.',
            );
        }
        if (isQaapGitReviewNotRepoError(message)) {
            return nls.localize(
                'qaap/composerWorkspace/branchNotGitRepo',
                'This project folder is not a git repository yet.',
            );
        }
        if (!message || message.startsWith('{')) {
            return nls.localize(
                'qaap/composerWorkspace/branchLoadFailed',
                'Could not load branches. Try opening the project again.',
            );
        }
        return message;
    }

    protected showComposerWorkspaceBranchSheetMessage(list: HTMLElement, text: string): void {
        list.replaceChildren();
        const message = document.createElement('p');
        message.className = 'theia-mobile-sticky-composer-sheet-loading';
        message.textContent = text;
        list.append(message);
        this.finishComposerWorkspaceBranchSheetList(list);
    }

    async loadComposerWorkspaceBranchSheet(
        project: MobileProjectEntry,
        list: HTMLElement,
    ): Promise<void> {
        const cwd = await this.ensureComposerWorkspaceBranchCwd(project);
        if (!cwd) {
            this.showComposerWorkspaceBranchSheetMessage(
                list,
                nls.localize(
                    'qaap/composerWorkspace/branchUnavailable',
                    'Open this project in the workspace to switch branches.',
                ),
            );
            return;
        }
        try {
            const params = new URLSearchParams({ root: cwd });
            const response = await fetch(`${QAAP_GIT_REVIEW_API_PATH}/branches?${params.toString()}`, {
                credentials: 'include',
                cache: 'no-store',
            });
            if (!response.ok) {
                const raw = await response.text();
                const parsed = readQaapGitReviewErrorBody(raw);
                if (isQaapGitReviewMissingRootError(parsed)) {
                    this.clearStaleComposerWorkspaceBranchCwd(project);
                }
                throw new Error(this.formatComposerWorkspaceBranchApiError(raw));
            }
            const payload = await response.json() as QaapGitBranchesResponse;
            if (this.host.stickyComposerWorkspaceSheet === undefined || !list.isConnected) {
                return;
            }
            const current = payload.current ?? this.resolveComposerWorkspaceBranch(project);
            list.replaceChildren();
            if (payload.branches.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'theia-mobile-sticky-composer-sheet-loading';
                empty.textContent = nls.localize('qaap/composerWorkspace/branchEmpty', 'No local branches found.');
                list.append(empty);
                this.finishComposerWorkspaceBranchSheetList(list);
                return;
            }
            for (const branch of this.filterComposerWorkspaceBranchList(project.id, payload.branches)) {
                this.appendComposerWorkspaceBranchRow(project, list, branch, current);
            }
            this.finishComposerWorkspaceBranchSheetList(list);
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            this.showComposerWorkspaceBranchSheetMessage(
                list,
                this.formatComposerWorkspaceBranchApiError(text),
            );
        }
    }
    async checkoutComposerWorkspaceBranch(
        project: MobileProjectEntry,
        branch: string,
    ): Promise<void> {
        const cwd = this.host.projectsService.getProjectCwd(project) ?? this.host.preparedCwdByProjectId.get(project.id);
        if (!cwd) {
            return;
        }
        try {
            const response = await fetch(`${QAAP_GIT_REVIEW_API_PATH}/checkout`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ root: cwd, branch }),
            });
            if (!response.ok) {
                throw new Error(this.formatComposerWorkspaceBranchApiError(await response.text()));
            }
            const payload = await response.json() as { branch?: string };
            if (payload.branch) {
                this.host.composerWorkspaceBranchByProjectId.set(project.id, payload.branch);
            }
            this.host.stickyComposerSheetsUi.closeStickyComposerSheets();
            this.remountComposerWithWorkspaceBar(project);
            MobileSnackbar.show(
                nls.localize('qaap/composerWorkspace/branchSwitched', 'Switched to {0}', payload.branch ?? branch),
                { kind: 'success', duration: 1600 },
            );
        } catch (error) {
            const raw = error instanceof Error ? error.message : String(error);
            const detail = this.formatComposerWorkspaceBranchApiError(raw);
            MobileSnackbar.show(
                nls.localize('qaap/composerWorkspace/branchSwitchFailed', 'Could not switch branch: {0}', detail),
                { kind: 'warning', duration: 2600 },
            );
        }
    }
    async deleteComposerWorkspaceBranch(
        project: MobileProjectEntry,
        branch: string,
        list: HTMLElement,
        currentBranch?: string,
    ): Promise<void> {
        const deleteKey = this.composerWorkspaceBranchDeleteKey(project.id, branch);
        if (this.deletingComposerWorkspaceBranches.has(deleteKey)) {
            return;
        }
        const current = currentBranch ?? this.resolveComposerWorkspaceBranch(project);
        if (branch === current) {
            MobileSnackbar.show(
                nls.localize(
                    'qaap/composerWorkspace/branchDeleteCurrent',
                    'Switch to another branch before deleting {0}',
                    branch,
                ),
                { kind: 'warning', duration: 2800 },
            );
            return;
        }
        const row = findComposerBranchSheetRow(list, branch);
        if (!row) {
            return;
        }
        const rowIndex = indexComposerBranchSheetRow(list, branch);
        this.deletingComposerWorkspaceBranches.add(deleteKey);
        closeComposerBranchSheetMenu();
        row.remove();
        this.clearComposerWorkspaceBranchEmptyState(list);
        this.showComposerWorkspaceBranchEmptyState(list);
        this.finishComposerWorkspaceBranchSheetList(list);

        const cwd = this.host.projectsService.getProjectCwd(project) ?? this.host.preparedCwdByProjectId.get(project.id);
        if (!cwd) {
            this.deletingComposerWorkspaceBranches.delete(deleteKey);
            this.insertComposerWorkspaceBranchRowAt(project, list, branch, current, rowIndex);
            this.clearComposerWorkspaceBranchEmptyState(list);
            this.finishComposerWorkspaceBranchSheetList(list);
            MobileSnackbar.show(
                nls.localize(
                    'qaap/composerWorkspace/branchDeleteFailed',
                    'Could not delete branch: {0}',
                    nls.localize(
                        'qaap/composerWorkspace/branchUnavailable',
                        'Open this project in the workspace to switch branches.',
                    ),
                ),
                { kind: 'warning', duration: 2800 },
            );
            return;
        }
        try {
            const response = await fetch(`${QAAP_GIT_REVIEW_API_PATH}/delete-branch`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ root: cwd, branch }),
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({})) as { error?: string };
                throw new Error(payload.error ?? await response.text());
            }
            if (this.host.composerWorkspaceBranchByProjectId.get(project.id) === branch) {
                this.host.composerWorkspaceBranchByProjectId.delete(project.id);
            }
            this.markComposerWorkspaceBranchDeleted(project.id, branch);
            MobileSnackbar.show(
                nls.localize('qaap/composerWorkspace/branchDeleted', 'Deleted {0}', branch),
                { kind: 'success', duration: 1600 },
            );
            this.finishComposerWorkspaceBranchSheetList(list);
        } catch (error) {
            if (list.isConnected) {
                this.clearComposerWorkspaceBranchEmptyState(list);
                this.insertComposerWorkspaceBranchRowAt(project, list, branch, current, rowIndex);
                this.finishComposerWorkspaceBranchSheetList(list);
            }
            const detail = error instanceof Error ? error.message : String(error);
            MobileSnackbar.show(
                nls.localize('qaap/composerWorkspace/branchDeleteFailed', 'Could not delete branch: {0}', detail),
                { kind: 'warning', duration: 2800 },
            );
        } finally {
            this.deletingComposerWorkspaceBranches.delete(deleteKey);
        }
    }
}
