// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { codicon, LabelProvider, Message, open, OpenerService, ReactWidget } from '@theia/core/lib/browser';
import { QuickInputService } from '@theia/core/lib/common/quick-pick-service';
import { CommandService } from '@theia/core/lib/common/command';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import URI from '@theia/core/lib/common/uri';
import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { ScmService } from '@theia/scm/lib/browser/scm-service';
import {
    QAAP_GIT_REVIEW_API_PATH,
    type QaapGitChangedFile,
    type QaapGitCommitWorkflowAction,
    type QaapGitFileDiffResponse,
    type QaapGitHunkLine,
    type QaapGitPrReadiness,
} from '../common/qaap-git-review';
import { leadingTruncatePath, splitRepoRelativePath } from './qaap-diff-review-path';
import { isCurrentAgentDiffRequest } from './qaap-diff-review-request-state';
import { reconcileExpandedReviewFiles, selectFileAfterRefresh } from './qaap-diff-review-select';
import { QaapCommitMessageAi } from './qaap-commit-message-ai';
import { QaapAsyncConcurrencyLimiter } from './qaap-async-concurrency-limiter';
import {
    evaluateVerifyCommitReadiness,
    localizeVerifyCommitReadiness,
    type EvaluateVerifyCommitReadinessInput,
    type VerifyCommitReadiness,
} from '../common/qaap-verify-commit-readiness';
import { confirmVerifyCommitReadiness } from './qaap-verify-commit-confirm';
import {
    highlightTranscriptCodeInto,
    resolveTranscriptCodeLanguage,
    type TranscriptCodeLanguage,
} from './qaap-transcript-code-view';

/** Git extension commands used by the bulk review actions. */
const GIT_STAGE_ALL = 'git.stageAll';
const GIT_CLEAN_ALL = 'git.cleanAll';
const GIT_COMMIT = 'git.commit';
const PR_CREATE = 'pr.create';
const PR_PUSH_AND_CREATE = 'pr.pushAndCreate';

interface QaapGitCommitMenuOption {
    action: QaapGitCommitWorkflowAction;
    label: string;
}

const GIT_COMMIT_MENU_OPTIONS: QaapGitCommitMenuOption[] = [
    {
        action: 'create-branch-commit',
        label: nls.localize('qaap/mobileProjects/createBranchAndCommit', 'Create Branch & Commit'),
    },
    {
        action: 'create-branch-commit-push',
        label: nls.localize('qaap/mobileProjects/createBranchCommitPush', 'Create Branch, Commit & Push'),
    },
    {
        action: 'commit-push',
        label: nls.localize('qaap/mobileProjects/commitPush', 'Commit & Push'),
    },
    {
        action: 'commit-create-pr',
        label: nls.localize('qaap/mobileProjects/commitCreatePr', 'Commit & Create PR'),
    },
];

/** Context lines above this count collapse into an expandable bar (Cursor agent diff style). */
const CONTEXT_COLLAPSE_THRESHOLD = 4;
/** Keep browser/network pressure bounded when several review sections are expanded. */
const AGENT_DIFF_CONCURRENCY = 3;

export interface QaapDiffReviewRepositoryContext {
    rootUri: string;
    rootFsPath: string;
    /** When false, accept/reject actions are disabled (workspace must be open for git commands). */
    isActiveWorkspace: boolean;
}

/**
 * Review surface: lists working-tree changes, shows each file's diff inline, and offers a per-file
 * shortcut to the full editor. Embedded in Work Hub or opened as a standalone widget.
 */
@injectable()
export class QaapDiffReviewWidget extends ReactWidget {

    static readonly ID = 'qaap-diff-review';
    static readonly LABEL = nls.localize('qaap/diff/reviewLabel', 'Working changes');

    @inject(ScmService)
    protected readonly scmService!: ScmService;

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(LabelProvider)
    protected readonly labelProvider!: LabelProvider;

    @inject(OpenerService)
    protected readonly openerService!: OpenerService;

    @inject(CommandService)
    protected readonly commands!: CommandService;

    @inject(QuickInputService)
    protected readonly quickInputService!: QuickInputService;

    /** Generates commit messages automatically from the diff (Cursor-agents style). */
    @inject(QaapCommitMessageAi) @optional()
    protected readonly commitMessageAi?: QaapCommitMessageAi;

    protected readonly toDisposeOnRepository = new DisposableCollection();

    /** When set (Work Hub embed), overrides the SCM-selected repository. */
    protected repositoryContext: QaapDiffReviewRepositoryContext | undefined;

    protected commitReadinessProvider: (() => EvaluateVerifyCommitReadinessInput) | undefined;
    protected commitReadinessOnCommitted: (() => void) | undefined;

    protected rootUri: string | undefined;
    protected rootFsPath: string | undefined;
    protected bulkActionsEnabled = true;

    protected files: QaapGitChangedFile[] = [];
    /** Avoid showing a false clean-state claim while the authoritative git snapshot is loading. */
    protected loadingChanges = false;
    protected selectedPath: string | undefined;
    protected diff: QaapGitFileDiffResponse | undefined;
    protected loadingDiff = false;
    protected runningBulkAction = false;
    protected error: string | undefined;
    protected filesPanelCollapsed = false;
    /** Embedded in Work Hub: denser layout, file list collapsed by default. */
    protected workHubEmbed = false;
    /** Embedded in the execution-view Review tab (transcript sheet). */
    protected transcriptEmbed = false;
    /** Changes tab: checks + composer live in the panel below the diff widget. */
    protected transcriptExternalChrome = false;
    protected reviewComposerDraft = '';
    protected runningFileAction = false;
    protected branchName: string | undefined;
    protected prReadiness: QaapGitPrReadiness | undefined;
    protected commitMenuOpen = false;
    protected readonly agentFileDiffs = new Map<string, QaapGitFileDiffResponse>();
    /** Per-file /diff failure detail (server error body or transport error), keyed by path. */
    protected readonly agentFileDiffErrors = new Map<string, string>();
    protected readonly loadingAgentDiffPaths = new Set<string>();
    protected readonly agentDiffLoadLimiter = new QaapAsyncConcurrencyLimiter(AGENT_DIFF_CONCURRENCY);
    protected agentDiffGeneration = 0;
    protected agentDiffRequestSerial = 0;
    protected readonly latestAgentDiffRequest = new Map<string, number>();
    protected refreshRequestSerial = 0;
    protected selectRequestSerial = 0;
    /** Agent Changes tab: per-file diff sections expanded in the accordion. */
    protected readonly expandedAgentFiles = new Set<string>();
    protected readonly expandedContextBlocks = new Set<string>();
    protected onTranscriptAgentFeedback: ((message: string) => void | Promise<void>) | undefined;
    protected onTranscriptClose: (() => void) | undefined;
    protected onReviewStatsChange: ((stats: { fileCount: number; adds: number; dels: number; pending: number }) => void) | undefined;

    /** Called when the widget is mounted inside {@link MobileProjectsPanel} Work Hub diff. */
    enableWorkHubEmbed(): void {
        if (this.workHubEmbed && !this.transcriptEmbed) {
            return;
        }
        this.transcriptEmbed = false;
        this.workHubEmbed = true;
        this.filesPanelCollapsed = true;
        this.removeClass('qaap-diff-review--transcript');
        this.removeClass('qaap-diff-review--transcript-agent');
        this.addClass('qaap-diff-review--work-hub');
        this.update();
    }

    /** Execution-view Changes tab: Cursor-style unified diff scroll. */
    enableTranscriptEmbed(options?: { externalChrome?: boolean }): void {
        this.workHubEmbed = false;
        this.transcriptEmbed = true;
        this.transcriptExternalChrome = options?.externalChrome ?? false;
        this.agentFileDiffs.clear();
        this.agentFileDiffErrors.clear();
        this.loadingAgentDiffPaths.clear();
        this.latestAgentDiffRequest.clear();
        this.agentDiffGeneration++;
        this.expandedAgentFiles.clear();
        this.expandedContextBlocks.clear();
        this.branchName = undefined;
        this.removeClass('qaap-diff-review--work-hub');
        this.addClass('qaap-diff-review--transcript');
        this.addClass('qaap-diff-review--transcript-agent');
        this.node.classList.toggle('qaap-mod-external-chrome', this.transcriptExternalChrome);
        this.applyTranscriptAgentLayoutStyles();
        this.update();
    }

    protected applyTranscriptAgentLayoutStyles(): void {
        const node = this.node;
        node.style.display = 'flex';
        node.style.flexDirection = 'column';
        node.style.flex = '1 1 auto';
        node.style.minHeight = '0';
        node.style.height = '100%';
        node.style.overflow = 'hidden';
    }

    setTranscriptAgentFeedbackHandler(
        handler: ((message: string) => void | Promise<void>) | undefined,
    ): void {
        this.onTranscriptAgentFeedback = handler;
    }

    setTranscriptCloseHandler(handler: (() => void) | undefined): void {
        this.onTranscriptClose = handler;
    }

    setReviewStatsChangeHandler(
        handler: ((stats: { fileCount: number; adds: number; dels: number; pending: number }) => void) | undefined,
    ): void {
        this.onReviewStatsChange = handler;
    }

    @postConstruct()
    protected init(): void {
        this.id = QaapDiffReviewWidget.ID;
        this.title.label = QaapDiffReviewWidget.LABEL;
        this.title.caption = QaapDiffReviewWidget.LABEL;
        this.title.iconClass = codicon('diff-multiple');
        this.title.closable = true;
        this.addClass('qaap-diff-review');

        this.toDispose.push(this.scmService.onDidChangeSelectedRepository(() => this.trackRepository()));
        this.toDispose.push(this.toDisposeOnRepository);
        this.toDispose.push(Disposable.create(() => this.detachCommitMenuListener()));
        this.toDispose.push(Disposable.create(() => this.cancelScheduledRefresh()));
        this.trackRepository();
    }

    /** Work Hub: point the widget at a specific project repository. */
    setRepositoryContext(context: QaapDiffReviewRepositoryContext | undefined): void {
        this.repositoryContext = context;
        this.trackRepository();
    }

    setCommitReadinessProvider(
        provider?: () => EvaluateVerifyCommitReadinessInput,
        onCommitted?: () => void,
    ): void {
        this.commitReadinessProvider = provider;
        this.commitReadinessOnCommitted = onCommitted;
        this.update();
    }

    protected readCommitReadiness(): VerifyCommitReadiness | undefined {
        if (!this.commitReadinessProvider) {
            return undefined;
        }
        return evaluateVerifyCommitReadiness(this.commitReadinessProvider());
    }

    protected trackRepository(): void {
        this.toDisposeOnRepository.dispose();
        this.refreshRequestSerial++;
        this.selectRequestSerial++;
        this.invalidateAgentDiffs();
        if (this.repositoryContext) {
            this.rootUri = this.repositoryContext.rootUri;
            this.rootFsPath = this.repositoryContext.rootFsPath;
            this.bulkActionsEnabled = this.repositoryContext.isActiveWorkspace;
            const repository = this.scmService.repositories.find(candidate =>
                candidate.provider.rootUri === this.repositoryContext?.rootUri);
            if (repository) {
                this.toDisposeOnRepository.push(repository.provider.onDidChange(() => this.scheduleRefresh()));
            }
            void this.refresh();
            return;
        }
        const repository = this.scmService.selectedRepository;
        this.rootUri = repository?.provider.rootUri;
        this.bulkActionsEnabled = true;
        if (repository) {
            this.toDisposeOnRepository.push(repository.provider.onDidChange(() => this.scheduleRefresh()));
        }
        void this.refresh();
    }

    protected refreshScheduleTimer?: number;

    /**
     * Coalesce rapid SCM change events into one refresh. Each refresh fetches `/git-review/changes`,
     * which shells out to `git status` + `git diff --numstat` on the backend; during an agent turn
     * that writes many files the provider fires onDidChange in bursts, so debounce to avoid a git
     * subprocess storm.
     */
    protected scheduleRefresh(): void {
        this.cancelScheduledRefresh();
        this.refreshScheduleTimer = window.setTimeout(() => {
            this.refreshScheduleTimer = undefined;
            if (!this.isDisposed) {
                void this.refresh();
            }
        }, 250);
    }

    protected cancelScheduledRefresh(): void {
        if (this.refreshScheduleTimer !== undefined) {
            window.clearTimeout(this.refreshScheduleTimer);
            this.refreshScheduleTimer = undefined;
        }
    }

    protected override onActivateRequest(message: Message): void {
        super.onActivateRequest(message);
        this.trackRepository();
        this.node.focus();
    }

    protected async refresh(): Promise<void> {
        const requestSerial = ++this.refreshRequestSerial;
        if (!this.repositoryContext) {
            this.rootFsPath = this.rootUri ? await this.fileService.fsPath(new URI(this.rootUri)) : undefined;
        }
        const requestRoot = this.rootFsPath;
        if (requestSerial !== this.refreshRequestSerial) {
            return;
        }
        if (!requestRoot) {
            this.files = [];
            this.selectedPath = undefined;
            this.diff = undefined;
            this.error = undefined;
            this.loadingChanges = false;
            this.update();
            return;
        }
        this.loadingChanges = true;
        this.update();
        try {
            const response = await fetch(
                `${QAAP_GIT_REVIEW_API_PATH}/changes?root=${encodeURIComponent(requestRoot)}`,
                { credentials: 'include' },
            );
            if (!response.ok) {
                throw new Error(`changes request failed (${response.status})`);
            }
            const body = await response.json() as { files?: QaapGitChangedFile[]; branch?: string; prReadiness?: QaapGitPrReadiness };
            if (requestSerial !== this.refreshRequestSerial || requestRoot !== this.rootFsPath) {
                return;
            }
            this.files = body.files ?? [];
            this.branchName = body.branch;
            this.prReadiness = body.prReadiness;
            this.error = undefined;
            this.loadingChanges = false;
            this.notifyReviewStats();
            if (this.transcriptEmbed && this.transcriptExternalChrome) {
                this.invalidateAgentDiffs();
                this.seedAgentFileAccordionDefaults();
                this.update();
                await this.loadAgentFileDiffs([...this.expandedAgentFiles]);
                return;
            }
            const next = selectFileAfterRefresh(this.files, this.selectedPath);
            if (next) {
                await this.selectFile(next);
                return;
            }
        } catch (error) {
            if (requestSerial === this.refreshRequestSerial && requestRoot === this.rootFsPath) {
                this.error = error instanceof Error ? error.message : String(error);
                this.loadingChanges = false;
            }
        }
        if (requestSerial === this.refreshRequestSerial && requestRoot === this.rootFsPath) {
            this.update();
        }
    }

    protected async fetchFileDiff(path: string): Promise<QaapGitFileDiffResponse | undefined> {
        if (!this.rootFsPath) {
            return undefined;
        }
        const response = await fetch(
            `${QAAP_GIT_REVIEW_API_PATH}/diff?root=${encodeURIComponent(this.rootFsPath)}&file=${encodeURIComponent(path)}`,
            { credentials: 'include' },
        );
        if (!response.ok) {
            // Surface the server's error body — a blind status code hides the actual git failure.
            let detail = '';
            try {
                const body = await response.json() as { error?: string };
                detail = body.error?.trim() ?? '';
            } catch {
                /* non-JSON body (proxy error page) — keep the status-only message */
            }
            throw new Error(detail
                ? `diff request failed (${response.status}): ${detail}`
                : `diff request failed (${response.status})`);
        }
        return await response.json() as QaapGitFileDiffResponse;
    }

    protected invalidateAgentDiffs(): void {
        this.agentDiffGeneration++;
        this.agentFileDiffs.clear();
        this.agentFileDiffErrors.clear();
        this.loadingAgentDiffPaths.clear();
        this.latestAgentDiffRequest.clear();
    }

    /** Fetch one file's diff for the agent accordion, recording the failure detail on error. */
    protected async loadAgentFileDiff(path: string): Promise<void> {
        const root = this.rootFsPath;
        if (!root || !this.files.some(file => file.path === path) || this.loadingAgentDiffPaths.has(path)) {
            return;
        }
        const generation = this.agentDiffGeneration;
        const serial = ++this.agentDiffRequestSerial;
        this.latestAgentDiffRequest.set(path, serial);
        this.loadingAgentDiffPaths.add(path);
        this.agentFileDiffErrors.delete(path);
        this.update();
        try {
            await this.agentDiffLoadLimiter.run(async () => {
                if (!this.isCurrentAgentDiffRequest(path, root, generation, serial)) {
                    return;
                }
                const diff = await this.fetchFileDiff(path);
                if (diff && this.isCurrentAgentDiffRequest(path, root, generation, serial)) {
                    this.agentFileDiffs.set(path, diff);
                    this.agentFileDiffErrors.delete(path);
                }
            });
        } catch (error) {
            if (this.isCurrentAgentDiffRequest(path, root, generation, serial)) {
                this.agentFileDiffErrors.set(path, error instanceof Error ? error.message : String(error));
            }
        } finally {
            if (this.isCurrentAgentDiffRequest(path, root, generation, serial)) {
                this.loadingAgentDiffPaths.delete(path);
                this.update();
            }
        }
    }

    protected async loadAgentFileDiffs(paths: readonly string[]): Promise<void> {
        const pending = [...paths];
        const workerCount = Math.min(AGENT_DIFF_CONCURRENCY, pending.length);
        await Promise.all(Array.from({ length: workerCount }, async () => {
            let path: string | undefined;
            while ((path = pending.shift()) !== undefined) {
                await this.loadAgentFileDiff(path);
            }
        }));
    }

    protected isCurrentAgentDiffRequest(path: string, root: string, generation: number, serial: number): boolean {
        return isCurrentAgentDiffRequest({
            disposed: this.isDisposed,
            requestPath: path,
            requestRoot: root,
            requestGeneration: generation,
            requestSerial: serial,
            currentRoot: this.rootFsPath,
            currentGeneration: this.agentDiffGeneration,
            latestSerial: this.latestAgentDiffRequest.get(path),
            currentPaths: this.files.map(file => file.path),
        });
    }

    /** Retry a single failed file diff from the accordion error note. */
    protected async retryAgentFileDiff(path: string): Promise<void> {
        await this.loadAgentFileDiff(path);
    }

    protected seedAgentFileAccordionDefaults(): void {
        reconcileExpandedReviewFiles(this.expandedAgentFiles, this.files);
    }

    protected isAgentFileExpanded(path: string): boolean {
        return this.expandedAgentFiles.has(path);
    }

    /** Transcript Review tab: expand and scroll to a changed file by workspace-relative path. */
    focusTranscriptReviewFile(filePath: string): boolean {
        const trimmed = filePath.trim();
        if (!trimmed) {
            return false;
        }
        const normalized = trimmed.replace(/^\.?\//, '');
        const match = this.files.find(file => file.path === normalized
            || file.path === trimmed
            || file.path.endsWith(`/${normalized}`)
            || normalized.endsWith(file.path));
        if (!match) {
            return false;
        }
        this.expandedAgentFiles.add(match.path);
        this.update();
        if (!this.agentFileDiffs.has(match.path) && !this.loadingAgentDiffPaths.has(match.path)) {
            void this.loadAgentFileDiff(match.path);
        }
        const path = match.path;
        window.requestAnimationFrame(() => {
            const section = this.node.querySelector<HTMLElement>(`[data-qaap-review-path="${CSS.escape(path)}"]`);
            section?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
        return true;
    }

    protected async selectFile(path: string | undefined): Promise<void> {
        const requestSerial = ++this.selectRequestSerial;
        this.selectedPath = path;
        this.diff = undefined;
        this.loadingDiff = false;
        if (!path || !this.rootFsPath) {
            this.update();
            return;
        }
        this.loadingDiff = true;
        this.update();
        try {
            const diff = await this.fetchFileDiff(path);
            if (requestSerial === this.selectRequestSerial && path === this.selectedPath) {
                this.diff = diff;
            }
        } catch (error) {
            if (requestSerial === this.selectRequestSerial && path === this.selectedPath) {
                this.error = error instanceof Error ? error.message : String(error);
            }
        } finally {
            if (requestSerial === this.selectRequestSerial && path === this.selectedPath) {
                this.loadingDiff = false;
                this.update();
            }
        }
    }

    protected fileUri(path: string): URI | undefined {
        return this.rootUri ? new URI(this.rootUri).resolve(path) : undefined;
    }

    protected notifyReviewStats(): void {
        if (!this.onReviewStatsChange) {
            return;
        }
        const totals = this.files.reduce(
            (acc, file) => ({ adds: acc.adds + file.adds, dels: acc.dels + file.dels }),
            { adds: 0, dels: 0 },
        );
        this.onReviewStatsChange({
            fileCount: this.files.length,
            adds: totals.adds,
            dels: totals.dels,
            pending: this.files.filter(file => !file.staged).length,
        });
    }

    protected render(): React.ReactNode {
        const totals = this.files.reduce(
            (acc, file) => ({ adds: acc.adds + file.adds, dels: acc.dels + file.dels }),
            { adds: 0, dels: 0 },
        );
        return (
            <div className='qaap-diff-review-body' aria-live='polite'>
                {this.error && <div className='qaap-diff-review-error' role='alert'>{this.error}</div>}
                {!this.bulkActionsEnabled && this.files.length > 0 && !this.transcriptEmbed && (
                    <div className='qaap-diff-review-note qaap-diff-review-readonly-hint'>
                        {nls.localize(
                            'qaap/diff/openProjectToApply',
                            'Open this project in the workspace to accept or discard changes.',
                        )}
                    </div>
                )}
                {this.files.length === 0 ? this.renderEmpty() : this.transcriptEmbed && this.transcriptExternalChrome
                    ? this.renderAgentChangesContent(totals)
                    : this.renderContent(totals)}
            </div>
        );
    }

    protected renderEmpty(): React.ReactNode {
        const agent = this.transcriptEmbed && this.transcriptExternalChrome;
        if (this.loadingChanges) {
            return (
                <div className={`qaap-diff-review-empty${agent ? ' qaap-diff-review-empty--agent' : ''}`} aria-busy='true'>
                    <i className={codicon('sync')} aria-hidden='true' />
                    <p>{nls.localize('qaap/diff/checkingChanges', 'Checking workspace changes…')}</p>
                </div>
            );
        }
        if (!this.rootFsPath) {
            return (
                <div className={`qaap-diff-review-empty${agent ? ' qaap-diff-review-empty--agent' : ''}`}>
                    <i className={codicon('folder-opened')} aria-hidden='true' />
                    <p>{nls.localize('qaap/diff/noWorkspace', 'Open a project to view its changes.')}</p>
                </div>
            );
        }
        return (
            <div className={`qaap-diff-review-empty${agent ? ' qaap-diff-review-empty--agent' : ''}`}>
                <i className={codicon(agent ? 'diff' : 'check-all')} aria-hidden='true' />
                <p>{nls.localize('qaap/diff/noChanges', 'No changes to review.')}</p>
                <span>
                    {agent
                        ? nls.localize(
                            'qaap/mobileProjects/changesEmptyHint',
                            'When the agent edits files in this workspace, diffs will appear here.',
                        )
                        : nls.localize('qaap/diff/noChangesHint', 'Edits made by you or an agent will show up here.')}
                </span>
            </div>
        );
    }

    protected renderAgentChangesContent(totals: { adds: number; dels: number }): React.ReactNode {
        const count = this.files.length;
        return (
            <div className='qaap-agent-changes'>
                {this.renderAgentToolbar(totals, count)}
                <div className='qaap-agent-changes-scroll'>
                    {this.loadingAgentDiffPaths.size > 0 && this.agentFileDiffs.size === 0 && (
                        <div className='qaap-agent-changes-loading' aria-busy='true'>
                            <div className='qaap-agent-changes-loading-bar' />
                            <div className='qaap-agent-changes-loading-bar qaap-mod-short' />
                            <div className='qaap-agent-changes-loading-bar qaap-mod-shorter' />
                        </div>
                    )}
                    {this.files.map(file => this.renderAgentFileSection(file))}
                </div>
            </div>
        );
    }

    protected renderAgentToolbar(totals: { adds: number; dels: number }, count: number): React.ReactNode {
        const branch = this.branchName ?? '…';
        const summaryLabel = count === 1
            ? nls.localize('qaap/mobileProjects/uncommittedChangeOne', '1 Uncommitted Change')
            : nls.localize('qaap/mobileProjects/uncommittedChangeMany', '{0} Uncommitted Changes', String(count));
        const readiness = this.readCommitReadiness();
        const checksBlockCommit = readiness?.blocksCommit === true;
        const bulkDisabled = !this.bulkActionsEnabled || this.runningBulkAction || count === 0 || checksBlockCommit;
        return (
            <header className='qaap-agent-changes-toolbar'>
                <div className='qaap-agent-changes-toolbar-primary'>
                    <span className='qaap-agent-changes-scope'>
                        <i className={codicon('device-desktop')} aria-hidden='true' />
                        {nls.localize('qaap/mobileProjects/changesScopeLocal', 'Local')}
                    </span>
                    <span className='qaap-agent-changes-branch' title={branch}>
                        <i className={codicon('git-branch')} aria-hidden='true' />
                        <span>{branch}</span>
                    </span>
                    <span className='qaap-agent-changes-toolbar-spacer' />
                    {this.bulkActionsEnabled && this.renderAgentCommitControls(bulkDisabled)}
                </div>
                <div className='qaap-agent-changes-toolbar-secondary'>
                    <div className='qaap-agent-changes-summary'>
                        <span className='qaap-agent-changes-summary-label'>{summaryLabel}</span>
                        <span className='qaap-agent-changes-summary-label'>
                            {nls.localize('qaap/diff/stagingSummary', '{0} staged · {1} unstaged',
                                String(this.files.filter(file => file.staged).length),
                                String(this.files.filter(file => !file.staged).length))}
                        </span>
                        {readiness && readiness.level !== 'not_configured' && (
                            <span
                                className={`qaap-agent-changes-verify-status qaap-mod-${readiness.level}`}
                                title={localizeVerifyCommitReadiness(readiness.level)}
                            >
                                {localizeVerifyCommitReadiness(readiness.level)}
                            </span>
                        )}
                        <span className='qaap-agent-changes-summary-stats'>
                            <span className='qaap-diff-add'>+{totals.adds}</span>
                            <span className='qaap-diff-del'>-{totals.dels}</span>
                        </span>
                    </div>
                    {this.renderAgentBulkActions(bulkDisabled)}
                </div>
            </header>
        );
    }

    protected renderAgentCommitControls(disabled: boolean): React.ReactNode {
        return (
            <div className='qaap-agent-changes-commit-group'>
                <button
                    type='button'
                    className='qaap-agent-changes-commit-btn'
                    disabled={disabled}
                    onClick={() => { void this.runCommitAction('commit'); }}
                >
                    {nls.localize('qaap/mobileProjects/commit', 'Commit')}
                </button>
                <div className='qaap-agent-changes-commit-menu-wrap'>
                    <button
                        type='button'
                        className={`qaap-agent-changes-commit-menu${this.commitMenuOpen ? ' qaap-mod-open' : ''}`}
                        disabled={disabled}
                        title={nls.localize('qaap/mobileProjects/commitOptions', 'Commit options')}
                        aria-label={nls.localize('qaap/mobileProjects/commitOptions', 'Commit options')}
                        aria-expanded={this.commitMenuOpen}
                        aria-haspopup='menu'
                        onClick={this.onToggleCommitMenu}
                    >
                        <i className={codicon('chevron-down')} aria-hidden='true' />
                    </button>
                    {this.commitMenuOpen && (
                        <div className='qaap-agent-changes-commit-dropdown' role='menu'>
                            {GIT_COMMIT_MENU_OPTIONS.map(option => (
                                <button
                                    key={option.action}
                                    type='button'
                                    role='menuitem'
                                    className='qaap-agent-changes-commit-dropdown-item'
                                    onClick={() => { void this.runCommitAction(option.action); }}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    protected readonly onToggleCommitMenu = (event: React.MouseEvent): void => {
        event.stopPropagation();
        if (this.commitMenuOpen) {
            this.closeCommitMenu();
        } else {
            this.openCommitMenu();
        }
    };

    protected openCommitMenu(): void {
        this.commitMenuOpen = true;
        this.attachCommitMenuListener();
        this.update();
    }

    protected closeCommitMenu(): void {
        if (!this.commitMenuOpen) {
            return;
        }
        this.commitMenuOpen = false;
        this.detachCommitMenuListener();
        this.update();
    }

    protected commitMenuListener: ((event: MouseEvent) => void) | undefined;

    protected attachCommitMenuListener(): void {
        this.detachCommitMenuListener();
        this.commitMenuListener = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) {
                return;
            }
            if (this.node.contains(target)) {
                return;
            }
            this.closeCommitMenu();
        };
        window.setTimeout(() => {
            if (this.commitMenuListener) {
                document.addEventListener('mousedown', this.commitMenuListener);
            }
        }, 0);
    }

    protected detachCommitMenuListener(): void {
        if (this.commitMenuListener) {
            document.removeEventListener('mousedown', this.commitMenuListener);
            this.commitMenuListener = undefined;
        }
    }

    protected async runCommitAction(action: QaapGitCommitWorkflowAction): Promise<void> {
        this.closeCommitMenu();
        if (this.runningBulkAction || !this.bulkActionsEnabled || this.files.length === 0 || !this.rootFsPath) {
            return;
        }
        const readiness = this.readCommitReadiness();
        if (readiness) {
            const allowed = await confirmVerifyCommitReadiness(readiness, {
                onBlocked: message => {
                    this.error = message;
                    this.update();
                },
            });
            if (!allowed) {
                return;
            }
        }
        this.runningBulkAction = true;
        this.error = undefined;
        this.update();
        try {
            // The AI writes the commit message automatically from the diff (Cursor-agents style).
            const generated = await this.commitMessageAi?.generate(this.rootFsPath);
            let message = generated?.message;
            if (!message && action !== 'commit') {
                message = (await this.quickInputService.input({
                    title: nls.localize('qaap/mobileProjects/commitMessageTitle', 'Commit message'),
                    placeHolder: nls.localize('qaap/mobileProjects/commitMessagePlaceholder', 'Describe your changes'),
                    prompt: nls.localize('qaap/mobileProjects/commitMessagePrompt', 'Message for this commit'),
                }))?.trim();
                if (!message) {
                    return;
                }
            }
            const needsBranch = action === 'create-branch-commit' || action === 'create-branch-commit-push';
            let branchName: string | undefined;
            if (needsBranch) {
                branchName = (await this.quickInputService.input({
                    title: nls.localize('qaap/mobileProjects/newBranchTitle', 'Create branch'),
                    value: generated?.branchName,
                    placeHolder: nls.localize('qaap/mobileProjects/newBranchPlaceholder', 'feature/my-change'),
                    prompt: nls.localize('qaap/mobileProjects/newBranchPrompt', 'Name for the new branch'),
                }))?.trim();
                if (!branchName) {
                    return;
                }
            }
            if (action === 'commit' && !message) {
                await this.commands.executeCommand(GIT_STAGE_ALL);
                await this.commands.executeCommand(GIT_COMMIT);
            } else {
                const response = await fetch(`${QAAP_GIT_REVIEW_API_PATH}/commit-workflow`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        root: this.rootFsPath,
                        action,
                        branchName,
                        message,
                    }),
                });
                if (!response.ok) {
                    const body = await response.json().catch(() => ({})) as { error?: string };
                    throw new Error(body.error ?? `commit workflow failed (${response.status})`);
                }
                if (action === 'commit-create-pr') {
                    await this.openCreatePullRequest();
                }
            }
            this.commitReadinessOnCommitted?.();
            await this.refresh();
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
            this.update();
        } finally {
            this.runningBulkAction = false;
            this.update();
        }
    }

    protected async openCreatePullRequest(): Promise<void> {
        const repoPath = this.rootFsPath;
        if (!repoPath) {
            return;
        }
        try {
            await this.commands.executeCommand(PR_PUSH_AND_CREATE, { repoPath });
        } catch {
            await this.commands.executeCommand(PR_CREATE, { repoPath });
        }
    }

    protected renderAgentBulkActions(disabled: boolean): React.ReactNode {
        if (!this.bulkActionsEnabled) {
            return undefined;
        }
        return (
            <span className='qaap-agent-changes-bulk-actions'>
                <button
                    type='button'
                    className='qaap-diff-review-icon-btn'
                    title={nls.localize('qaap/diff/discardAll', 'Discard all')}
                    aria-label={nls.localize('qaap/diff/discardAll', 'Discard all')}
                    disabled={disabled}
                    onClick={this.onDiscardAll}
                >
                    <i className={codicon('discard')} />
                </button>
                <button
                    type='button'
                    className='qaap-diff-review-icon-btn'
                    title={nls.localize('qaap/diff/stageAll', 'Stage all')}
                    aria-label={nls.localize('qaap/diff/stageAll', 'Stage all')}
                    disabled={disabled}
                    onClick={this.onAcceptAll}
                >
                    <i className={codicon('diff')} />
                </button>
            </span>
        );
    }

    protected renderAgentFileSection(file: QaapGitChangedFile): React.ReactNode {
        const diff = this.agentFileDiffs.get(file.path);
        const displayPath = leadingTruncatePath(file.path);
        const isNew = isUntrackedFile(file);
        const expanded = this.isAgentFileExpanded(file.path);
        const fileClass = [
            'qaap-agent-changes-file',
            isNew ? 'qaap-agent-changes-file--new' : '',
            expanded ? '' : 'qaap-agent-changes-file--collapsed',
        ].filter(Boolean).join(' ');
        return (
            <section key={file.path} className={fileClass} data-qaap-review-path={file.path}>
                <div className='qaap-agent-changes-filehdr'>
                    <button
                        type='button'
                        className='qaap-agent-changes-filehdr-toggle'
                        title={file.path}
                        aria-expanded={expanded}
                        aria-controls={`qaap-agent-changes-hunks-${encodeURIComponent(file.path)}`}
                        onClick={() => this.onToggleAgentFile(file.path)}
                    >
                        <i
                            className={`${codicon('chevron-right')} qaap-agent-changes-filehdr-chevron`}
                            aria-hidden='true'
                        />
                        <i className={this.iconFor(file.path)} aria-hidden='true' />
                        <span className='qaap-agent-changes-path'>{displayPath}</span>
                        {isNew && (
                            <span className='qaap-agent-changes-new-badge'>
                                {nls.localize('qaap/diff/newFile', 'New')}
                            </span>
                        )}
                        <span className='qaap-agent-changes-filehdr-stats'>
                            <span className='qaap-diff-add'>+{file.adds}</span>
                            <span className='qaap-diff-del'>-{file.dels}</span>
                        </span>
                    </button>
                    {this.bulkActionsEnabled && (
                        <span className='qaap-agent-changes-filehdr-actions'>
                            <button
                                type='button'
                                className='qaap-diff-review-icon-btn'
                                title={nls.localize('qaap/diff/discardFile', 'Discard file changes')}
                                aria-label={nls.localize('qaap/diff/discardFile', 'Discard file changes')}
                                disabled={this.runningFileAction}
                                onClick={event => {
                                    event.stopPropagation();
                                    void this.rejectFile(file.path);
                                }}
                            >
                                <i className={codicon('discard')} />
                            </button>
                            <button
                                type='button'
                                className='qaap-diff-review-icon-btn'
                                title={nls.localize('qaap/diff/stageFile', 'Stage file')}
                                aria-label={nls.localize('qaap/diff/stageFile', 'Stage file')}
                                disabled={this.runningFileAction}
                                onClick={event => {
                                    event.stopPropagation();
                                    void this.acceptFile(file.path);
                                }}
                            >
                                <i className={codicon('diff')} />
                            </button>
                        </span>
                    )}
                </div>
                <div
                    id={`qaap-agent-changes-hunks-${encodeURIComponent(file.path)}`}
                    className='qaap-agent-changes-hunks'
                    hidden={!expanded}
                >
                    {diff ? this.renderAgentFileDiff(file.path, diff) : this.renderAgentFileDiffFallback(file.path)}
                </div>
            </section>
        );
    }

    /** Loading note, or the recorded per-file failure with its server detail and a retry action. */
    protected renderAgentFileDiffFallback(path: string): React.ReactNode {
        if (this.loadingAgentDiffPaths.has(path)) {
            return (
                <div className='qaap-diff-review-note qaap-mod-compact'>
                    {nls.localize('qaap/diff/loading', 'Loading diff…')}
                </div>
            );
        }
        const detail = this.agentFileDiffErrors.get(path);
        return (
            <div className='qaap-diff-review-note qaap-mod-compact'>
                <span>
                    {nls.localize('qaap/diff/loadFailed', 'Could not load diff for this file.')}
                    {detail ? ` (${detail})` : ''}
                </span>
                <button
                    type='button'
                    className='qaap-diff-review-inline-btn'
                    onClick={() => { void this.retryAgentFileDiff(path); }}
                >
                    {nls.localize('qaap/diff/retry', 'Retry')}
                </button>
            </div>
        );
    }

    protected renderAgentFileDiff(path: string, diff: QaapGitFileDiffResponse): React.ReactNode {
        if (diff.binary) {
            return <div className='qaap-diff-review-note'>{nls.localize('qaap/diff/binary', 'Binary file — open in the editor to inspect.')}</div>;
        }
        if (diff.hunks.length === 0) {
            return <div className='qaap-diff-review-note'>{nls.localize('qaap/diff/noHunks', 'No textual changes.')}</div>;
        }
        return diff.hunks.map((hunk, hunkIndex) => (
            <div key={hunkIndex} className='qaap-diff-review-hunk qaap-diff-review-hunk--agent'>
                {this.renderCollapsedHunkLines(path, hunkIndex, hunk.lines)}
            </div>
        ));
    }

    protected renderCollapsedHunkLines(path: string, hunkIndex: number, lines: QaapGitHunkLine[]): React.ReactNode {
        const language = resolveTranscriptCodeLanguage(path);
        const onStageHunk = this.bulkActionsEnabled
            ? () => { void this.runHunkAction(`${QAAP_GIT_REVIEW_API_PATH}/stage-hunk`, path, hunkIndex); }
            : undefined;
        const segments = buildContextSegments(lines);
        return segments.map((segment, segmentIndex) => {
            if (segment.kind === 'lines') {
                return (
                    <React.Fragment key={`lines-${hunkIndex}-${segmentIndex}`}>
                        {segment.lines.map((line, lineIndex) => (
                            <DiffLine
                                key={lineIndex}
                                line={line}
                                agentStyle={true}
                                language={language}
                                onStageLine={onStageHunk}
                            />
                        ))}
                    </React.Fragment>
                );
            }
            const blockId = `${path}:${hunkIndex}:${segmentIndex}`;
            const expanded = this.expandedContextBlocks.has(blockId);
            if (expanded) {
                return (
                    <React.Fragment key={blockId}>
                        <CollapsedContextBar
                            count={segment.lines.length}
                            expanded={true}
                            onToggle={() => this.onToggleContextBlock(blockId)}
                        />
                        {segment.lines.map((line, lineIndex) => (
                            <DiffLine
                                key={lineIndex}
                                line={line}
                                agentStyle={true}
                                language={language}
                                onStageLine={onStageHunk}
                            />
                        ))}
                    </React.Fragment>
                );
            }
            return (
                <CollapsedContextBar
                    key={blockId}
                    count={segment.lines.length}
                    expanded={false}
                    onToggle={() => this.onToggleContextBlock(blockId)}
                />
            );
        });
    }

    protected renderContent(totals: { adds: number; dels: number }): React.ReactNode {
        const collapsed = this.filesPanelCollapsed;
        return (
            <div className={`qaap-diff-review-layout${collapsed ? ' qaap-diff-review-layout--files-collapsed' : ''}`}>
                <div className='qaap-diff-review-main'>
                    {this.renderDiffToolbar(totals)}
                    {this.renderDiff()}
                </div>
                <aside
                    className='qaap-diff-review-sidebar'
                    aria-label={nls.localize('qaap/diff/changesSidebar', 'Changed files')}
                    aria-hidden={collapsed}
                >
                    {!this.workHubEmbed && this.renderSidebarHeader()}
                    <div className='qaap-diff-review-files'>
                        {this.files.map(file => (
                            <FileRow
                                key={file.path}
                                file={file}
                                selected={file.path === this.selectedPath}
                                iconClass={this.iconFor(file.path)}
                                compact={this.workHubEmbed}
                                onSelect={this.onSelectFile}
                                onOpenEditor={this.onOpenInEditor}
                            />
                        ))}
                    </div>
                </aside>
                {this.renderFooter()}
            </div>
        );
    }

    protected renderSidebarHeader(): React.ReactNode {
        const count = this.files.length;
        return (
            <header className='qaap-diff-review-sidebar-head'>
                <div className='qaap-diff-review-sidebar-titles'>
                    <span className='qaap-diff-review-title'>
                        {nls.localize('qaap/diff/changes', 'Changes')}
                    </span>
                    <span className='qaap-diff-review-sub'>
                        {count === 1
                            ? nls.localize('qaap/diff/oneFile', '1 file')
                            : nls.localize('qaap/diff/nFiles', '{0} files', count)}
                    </span>
                </div>
                <span className='qaap-diff-review-spacer' />
                <button
                    type='button'
                    className='qaap-diff-review-icon-btn'
                    title={nls.localize('qaap/diff/refresh', 'Refresh')}
                    aria-label={nls.localize('qaap/diff/refresh', 'Refresh')}
                    onClick={this.onRefresh}
                >
                    <i className={codicon('refresh')} />
                </button>
                {count > 0 && this.bulkActionsEnabled && (
                    <button
                        type='button'
                        className='qaap-diff-review-icon-btn'
                        title={nls.localize('qaap/diff/discardAll', 'Discard all')}
                        onClick={this.onDiscardAll}
                    >
                        <i className={codicon('discard')} />
                    </button>
                )}
            </header>
        );
    }

    protected renderDiffToolbar(totals: { adds: number; dels: number }): React.ReactNode {
        const count = this.files.length;
        const index = this.files.findIndex(f => f.path === this.selectedPath);
        const canPrev = index > 0;
        const canNext = index >= 0 && index < this.files.length - 1;
        const selected = index >= 0 ? this.files[index] : undefined;
        const selectedParts = selected ? splitRepoRelativePath(selected.path) : undefined;
        const toolbarClass = this.workHubEmbed
            ? 'qaap-diff-review-toolbar qaap-diff-review-toolbar--work-hub'
            : 'qaap-diff-review-toolbar';
        return (
            <header className={toolbarClass}>
                <div className='qaap-diff-review-toolbar-row'>
                    <button
                        type='button'
                        className='qaap-diff-review-icon-btn qaap-diff-review-files-toggle'
                        title={this.filesPanelCollapsed
                            ? nls.localize('qaap/diff/showFiles', 'Show changed files')
                            : nls.localize('qaap/diff/hideFiles', 'Hide changed files')}
                        aria-expanded={!this.filesPanelCollapsed}
                        onClick={this.onToggleFilesPanel}
                    >
                        <i className={codicon(this.filesPanelCollapsed ? 'list-tree' : 'chevron-down')} />
                    </button>
                    <span className='qaap-diff-review-toolbar-summary'>
                        {count === 1
                            ? nls.localize('qaap/diff/oneFile', '1 file')
                            : nls.localize('qaap/diff/nFiles', '{0} files', count)}
                        {' · '}
                        <span className='qaap-diff-add'>+{totals.adds}</span>
                        {' '}
                        <span className='qaap-diff-del'>−{totals.dels}</span>
                    </span>
                    <span className='qaap-diff-review-spacer' />
                    {this.workHubEmbed && this.renderToolbarActions(count)}
                    {!this.workHubEmbed && (
                        <span className='qaap-diff-review-view-label' aria-hidden='true'>
                            {nls.localize('qaap/diff/unifiedView', 'Unified')}
                        </span>
                    )}
                    <button
                        type='button'
                        className='qaap-diff-review-icon-btn'
                        title={nls.localize('qaap/diff/previousFile', 'Previous file')}
                        disabled={!canPrev}
                        onClick={this.onPreviousFile}
                    >
                        <i className={codicon('chevron-up')} />
                    </button>
                    <button
                        type='button'
                        className='qaap-diff-review-icon-btn'
                        title={nls.localize('qaap/diff/nextFile', 'Next file')}
                        disabled={!canNext}
                        onClick={this.onNextFile}
                    >
                        <i className={codicon('chevron-down')} />
                    </button>
                </div>
                {this.workHubEmbed && this.filesPanelCollapsed && selected && selectedParts && (
                    <div className='qaap-diff-review-toolbar-file'>
                        <i className={this.iconFor(selected.path)} />
                        <span className='qaap-diff-review-toolbar-file-ident'>
                            <span className='qaap-diff-review-toolbar-file-base'>{selectedParts.base}</span>
                            {selectedParts.dir && (
                                <span className='qaap-diff-review-toolbar-file-dir'>{selectedParts.dir}</span>
                            )}
                        </span>
                        <span className='qaap-diff-review-stats'>
                            <span className='qaap-diff-add'>+{selected.adds}</span>
                            <span className='qaap-diff-del'>−{selected.dels}</span>
                        </span>
                        <button
                            type='button'
                            className='qaap-diff-review-icon-btn'
                            title={nls.localize('qaap/diff/openInEditor', 'Open in editor')}
                            onClick={() => this.onOpenInEditor(selected.path)}
                        >
                            <i className={codicon('go-to-file')} />
                        </button>
                    </div>
                )}
            </header>
        );
    }

    protected renderToolbarActions(fileCount: number): React.ReactNode {
        return (
            <>
                <button
                    type='button'
                    className='qaap-diff-review-icon-btn'
                    title={nls.localize('qaap/diff/refresh', 'Refresh')}
                    aria-label={nls.localize('qaap/diff/refresh', 'Refresh')}
                    onClick={this.onRefresh}
                >
                    <i className={codicon('refresh')} />
                </button>
                {fileCount > 0 && this.bulkActionsEnabled && (
                    <button
                        type='button'
                        className='qaap-diff-review-icon-btn'
                        title={nls.localize('qaap/diff/discardAll', 'Discard all')}
                        aria-label={nls.localize('qaap/diff/discardAll', 'Discard all')}
                        onClick={this.onDiscardAll}
                    >
                        <i className={codicon('discard')} />
                    </button>
                )}
            </>
        );
    }

    protected renderDiff(): React.ReactNode {
        const file = this.files.find(f => f.path === this.selectedPath);
        const parts = file ? splitRepoRelativePath(file.path) : undefined;
        const showPaneHead = file && parts && (!this.workHubEmbed || !this.filesPanelCollapsed);
        return (
            <div className='qaap-diff-review-pane'>
                {showPaneHead && (
                    <div className='qaap-diff-review-pane-head'>
                        <i className={this.iconFor(file.path)} />
                        <div className='qaap-diff-review-pane-ident'>
                            <span className='qaap-diff-review-pane-base'>{parts.base}</span>
                            {parts.dir && (
                                <span className='qaap-diff-review-pane-dir'>{parts.dir}</span>
                            )}
                        </div>
                        <span className='qaap-diff-review-spacer' />
                        <span className='qaap-diff-review-stats'>
                            <span className='qaap-diff-add'>+{file.adds}</span>
                            <span className='qaap-diff-del'>−{file.dels}</span>
                        </span>
                        <button
                            type='button'
                            className='qaap-diff-review-icon-btn'
                            title={nls.localize('qaap/diff/openInEditor', 'Open in editor')}
                            onClick={() => this.onOpenInEditor(file.path)}
                        >
                            <i className={codicon('go-to-file')} />
                        </button>
                    </div>
                )}
                <div className='qaap-diff-review-hunks'>
                    {this.renderHunkBody()}
                </div>
            </div>
        );
    }

    protected renderHunkBody(): React.ReactNode {
        if (this.loadingDiff) {
            return <div className='qaap-diff-review-note'>{nls.localize('qaap/diff/loading', 'Loading diff…')}</div>;
        }
        if (!this.diff) {
            return undefined;
        }
        if (this.diff.binary) {
            return <div className='qaap-diff-review-note'>{nls.localize('qaap/diff/binary', 'Binary file — open in the editor to inspect.')}</div>;
        }
        if (this.diff.hunks.length === 0) {
            return <div className='qaap-diff-review-note'>{nls.localize('qaap/diff/noHunks', 'No textual changes.')}</div>;
        }
        const selectedFile = this.selectedPath;
        const hunkActionsEnabled = this.bulkActionsEnabled && !!selectedFile && !this.runningFileAction;
        return this.diff.hunks.map((hunk, hunkIndex) => (
            <div key={hunkIndex} className='qaap-diff-review-hunk'>
                <div className='qaap-diff-review-hunk-header'>
                    <span className='qaap-diff-review-hunk-header-text'>{hunk.header}</span>
                    {hunkActionsEnabled && (
                        <span className='qaap-diff-review-hunk-actions'>
                            <button
                                type='button'
                                className='qaap-diff-review-hunk-btn qaap-mod-stage'
                                title={nls.localize('qaap/diff/stageHunk', 'Stage this hunk')}
                                aria-label={nls.localize('qaap/diff/stageHunk', 'Stage this hunk')}
                                onClick={() => void this.runHunkAction(`${QAAP_GIT_REVIEW_API_PATH}/stage-hunk`, selectedFile!, hunkIndex)}
                            >
                                <i className={codicon('add')} aria-hidden='true' />
                            </button>
                            <button
                                type='button'
                                className='qaap-diff-review-hunk-btn qaap-mod-discard'
                                title={nls.localize('qaap/diff/discardHunk', 'Discard this hunk')}
                                aria-label={nls.localize('qaap/diff/discardHunk', 'Discard this hunk')}
                                onClick={() => void this.runHunkAction(`${QAAP_GIT_REVIEW_API_PATH}/discard-hunk`, selectedFile!, hunkIndex)}
                            >
                                <i className={codicon('discard')} aria-hidden='true' />
                            </button>
                        </span>
                    )}
                </div>
                {hunk.lines.map((line, lineIndex) => (
                    <DiffLine key={lineIndex} line={line} />
                ))}
            </div>
        ));
    }

    protected renderFooter(): React.ReactNode {
        if (!this.bulkActionsEnabled) {
            return undefined;
        }
        const disabled = this.runningBulkAction || this.files.length === 0;
        return (
            <div className='qaap-diff-review-footer'>
                <button
                    type='button'
                    className='qaap-diff-review-btn qaap-diff-review-btn--reject'
                    onClick={this.onDiscardAll}
                    disabled={disabled}
                >
                    {nls.localize('qaap/diff/reject', 'Reject')}
                </button>
                <button
                    type='button'
                    className='qaap-diff-review-btn qaap-diff-review-btn--accept'
                    onClick={this.onAcceptAll}
                    disabled={disabled}
                >
                    {nls.localize('qaap/diff/acceptAll', 'Accept all hunks')}
                </button>
            </div>
        );
    }

    protected iconFor(path: string): string {
        const uri = this.fileUri(path);
        return uri ? this.labelProvider.getIcon(uri) + ' qaap-diff-review-glyph' : codicon('file');
    }

    protected readonly onSelectFile = (path: string): void => {
        if (path !== this.selectedPath) {
            if (this.workHubEmbed && !this.transcriptEmbed) {
                this.filesPanelCollapsed = true;
            }
            void this.selectFile(path);
        }
    };

    protected readonly onOpenInEditor = (path: string): void => {
        const uri = this.fileUri(path);
        if (uri) {
            void open(this.openerService, uri);
        }
    };

    protected readonly onRefresh = (): void => {
        void this.refresh();
    };

    protected readonly onToggleFilesPanel = (): void => {
        this.filesPanelCollapsed = !this.filesPanelCollapsed;
        this.update();
    };

    protected readonly onPreviousFile = (): void => {
        this.navigateFile(-1);
    };

    protected readonly onNextFile = (): void => {
        this.navigateFile(1);
    };

    protected navigateFile(delta: number): void {
        const index = this.files.findIndex(f => f.path === this.selectedPath);
        if (index < 0) {
            return;
        }
        const next = this.files[index + delta];
        if (next) {
            void this.selectFile(next.path);
        }
    }

    protected readonly onToggleContextBlock = (blockId: string): void => {
        if (this.expandedContextBlocks.has(blockId)) {
            this.expandedContextBlocks.delete(blockId);
        } else {
            this.expandedContextBlocks.add(blockId);
        }
        this.update();
    };

    protected readonly onToggleAgentFile = (path: string): void => {
        if (this.expandedAgentFiles.has(path)) {
            this.expandedAgentFiles.delete(path);
        } else {
            this.expandedAgentFiles.add(path);
            if (!this.agentFileDiffs.has(path) && !this.loadingAgentDiffPaths.has(path)) {
                void this.loadAgentFileDiff(path);
            }
        }
        this.update();
    };

    protected readonly onReviewComposerDraftChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
        this.reviewComposerDraft = event.target.value;
        this.update();
    };

    protected readonly onReviewComposerSubmit = (event: React.FormEvent): void => {
        event.preventDefault();
        const message = this.reviewComposerDraft.trim();
        if (!message || !this.onTranscriptAgentFeedback) {
            return;
        }
        this.reviewComposerDraft = '';
        this.update();
        void Promise.resolve(this.onTranscriptAgentFeedback(message));
    };

    protected async acceptFile(path: string): Promise<void> {
        await this.runFileAction(`${QAAP_GIT_REVIEW_API_PATH}/stage`, path);
    }

    protected async rejectFile(path: string): Promise<void> {
        await this.runFileAction(`${QAAP_GIT_REVIEW_API_PATH}/discard`, path);
    }

    protected async runHunkAction(endpoint: string, file: string, hunkIndex: number): Promise<void> {
        if (this.runningFileAction || !this.rootFsPath || !this.bulkActionsEnabled) {
            return;
        }
        this.runningFileAction = true;
        this.error = undefined;
        this.update();
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ root: this.rootFsPath, file, hunkIndex }),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({})) as { error?: string };
                throw new Error(body.error ?? `request failed (${response.status})`);
            }
            await this.refresh();
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
            this.update();
        } finally {
            this.runningFileAction = false;
            this.update();
        }
    }

    protected async runFileAction(endpoint: string, file: string): Promise<void> {
        if (this.runningFileAction || !this.rootFsPath || !this.bulkActionsEnabled) {
            return;
        }
        this.runningFileAction = true;
        this.error = undefined;
        this.update();
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ root: this.rootFsPath, file }),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({})) as { error?: string };
                throw new Error(body.error ?? `request failed (${response.status})`);
            }
            await this.refresh();
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
            this.update();
        } finally {
            this.runningFileAction = false;
            this.update();
        }
    }

    protected readonly onAcceptAll = (): void => {
        void this.runBulkAction(GIT_STAGE_ALL);
    };

    protected readonly onDiscardAll = (): void => {
        void this.runBulkAction(GIT_CLEAN_ALL);
    };

    protected async runBulkAction(commandId: string): Promise<void> {
        if (this.runningBulkAction || !this.bulkActionsEnabled) {
            return;
        }
        this.runningBulkAction = true;
        this.error = undefined;
        this.update();
        try {
            await this.commands.executeCommand(commandId);
            await this.refresh();
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        } finally {
            this.runningBulkAction = false;
            this.update();
        }
    }
}

function FileRow(props: {
    file: QaapGitChangedFile;
    selected: boolean;
    iconClass: string;
    compact?: boolean;
    onSelect: (path: string) => void;
    onOpenEditor: (path: string) => void;
}): React.ReactElement {
    const { file } = props;
    const { base, dir } = splitRepoRelativePath(file.path);
    const onSelect = React.useCallback(() => props.onSelect(file.path), [props, file.path]);
    const onOpen = React.useCallback((event: React.MouseEvent) => {
        event.stopPropagation();
        props.onOpenEditor(file.path);
    }, [props, file.path]);
    const rowClass = [
        'qaap-diff-review-row',
        props.selected ? 'qaap-diff-review-row--selected' : '',
        props.compact ? 'qaap-diff-review-row--compact' : '',
    ].filter(Boolean).join(' ');
    return (
        <div
            className={rowClass}
            onClick={onSelect}
            role='button'
            tabIndex={0}
            title={file.path}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect();
                }
            }}
        >
            <i className={props.iconClass} />
            <span className='qaap-diff-review-name'>
                <span className='qaap-diff-review-name-base'>{base}</span>
                {dir && <span className='qaap-diff-review-name-dir'>{dir}</span>}
            </span>
            <span className='qaap-diff-review-stats'>
                <span className='qaap-diff-add'>+{file.adds}</span>
                <span className='qaap-diff-del'>−{file.dels}</span>
            </span>
            {file.staged && (
                <span className='qaap-diff-review-approved' title='Staged'>
                    <i className={codicon('check')} />
                </span>
            )}
            <button
                type='button'
                className='qaap-diff-review-open'
                title={nls.localize('qaap/diff/openInEditor', 'Open in editor')}
                onClick={onOpen}
            >
                <i className={codicon('go-to-file')} />
            </button>
        </div>
    );
}

type ContextSegment =
    | { kind: 'lines'; lines: QaapGitHunkLine[] }
    | { kind: 'collapsed'; lines: QaapGitHunkLine[] };

function buildContextSegments(lines: QaapGitHunkLine[]): ContextSegment[] {
    const segments: ContextSegment[] = [];
    let ctxRun: QaapGitHunkLine[] = [];

    const flushCtx = (): void => {
        if (ctxRun.length === 0) {
            return;
        }
        if (ctxRun.length >= CONTEXT_COLLAPSE_THRESHOLD) {
            segments.push({ kind: 'collapsed', lines: ctxRun });
        } else {
            segments.push({ kind: 'lines', lines: ctxRun });
        }
        ctxRun = [];
    };

    for (const line of lines) {
        if (line.type === 'ctx') {
            ctxRun.push(line);
        } else {
            flushCtx();
            segments.push({ kind: 'lines', lines: [line] });
        }
    }
    flushCtx();
    return segments;
}

function CollapsedContextBar(props: { count: number; expanded: boolean; onToggle: () => void }): React.ReactElement {
    const label = props.count === 1
        ? nls.localize('qaap/diff/oneUnmodifiedLine', '1 unmodified line')
        : nls.localize('qaap/diff/nUnmodifiedLines', '{0} unmodified lines', String(props.count));
    const icon = props.expanded ? codicon('chevron-up') : codicon('chevron-down');
    return (
        <button
            type='button'
            className={`qaap-diff-review-collapsed${props.expanded ? ' qaap-mod-expanded' : ''}`}
            onClick={props.onToggle}
            aria-expanded={props.expanded}
        >
            <i className={`${icon} qaap-diff-review-collapsed-chevron`} aria-hidden='true' />
            <span>{label}</span>
        </button>
    );
}

function isUntrackedFile(file: QaapGitChangedFile): boolean {
    return file.status === 'U' || file.status === '?';
}

function HighlightedDiffCode(props: {
    text: string;
    language: TranscriptCodeLanguage;
}): React.ReactElement {
    const hostRef = React.useRef<HTMLSpanElement>(null);
    React.useLayoutEffect(() => {
        const host = hostRef.current;
        if (!host) {
            return;
        }
        highlightTranscriptCodeInto(host, props.text, props.language);
    }, [props.text, props.language]);
    return <span ref={hostRef} className='qaap-diff-review-code theia-mobile-agent-code-text' />;
}

function DiffLine(props: {
    line: QaapGitHunkLine;
    agentStyle?: boolean;
    language?: TranscriptCodeLanguage;
    onStageLine?: () => void;
}): React.ReactElement {
    const { line, agentStyle, language, onStageLine } = props;
    const sign = line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ';
    const number = line.type === 'del' ? line.oldNumber : line.newNumber;
    const canStage = !!agentStyle && !!onStageLine && (line.type === 'add' || line.type === 'del');
    const lineClass = [
        'qaap-diff-review-line',
        `qaap-diff-review-line--${line.type}`,
        agentStyle ? 'qaap-diff-review-line--agent' : '',
    ].filter(Boolean).join(' ');
    return (
        <div className={lineClass}>
            {canStage && (
                <button
                    type='button'
                    className='qaap-agent-changes-line-stage'
                    title={nls.localize('qaap/diff/stageLine', 'Stage this change')}
                    aria-label={nls.localize('qaap/diff/stageLine', 'Stage this change')}
                    onClick={event => {
                        event.stopPropagation();
                        onStageLine();
                    }}
                >
                    <span aria-hidden='true'>+</span>
                </button>
            )}
            <span className='qaap-diff-review-gutter'>{number ?? ''}</span>
            {!agentStyle && <span className='qaap-diff-review-sign'>{sign}</span>}
            {agentStyle && language
                ? <HighlightedDiffCode text={line.text} language={language} />
                : <span className='qaap-diff-review-code'>{line.text}</span>}
        </div>
    );
}
