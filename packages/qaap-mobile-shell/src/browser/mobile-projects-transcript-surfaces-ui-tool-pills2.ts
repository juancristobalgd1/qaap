// @ts-nocheck
// Extracted from mobile-projects-transcript-surfaces-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { invalidateVerifyWorkspaceSnapshots } from '../common/qaap-verify-commit-readiness';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import {
    mountEmbeddedAgentPreviewChrome,
    type EmbeddedAgentPreviewChrome,
} from '@theia/qaap-adapters/lib/browser/qaap-agent-preview-chrome';
import { normalizePreviewUrlForSameOrigin } from '@theia/qaap-adapters/lib/browser/qaap-preview-url-utils';
import type { QaapPreviewSurfaceRegistry } from '@theia/qaap-adapters/lib/browser/qaap-preview-surface-registry';
import type { QaapPreviewInspectorDeps } from '@theia/qaap-adapters/lib/browser/qaap-preview-inline-inspector';
import type { AnnotationComposerSessionControls } from '@theia/qaap-adapters/lib/browser/qaap-preview-annotation-popover';
import {
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
    type QaapAgentMessageSegmentDTO,
} from '../common/qaap-agent-conversation-client';
import { reconcileAgentApprovalPolicyId, type QaapAgentApprovalPolicyId } from '../common/qaap-sticky-composer-approval-policy';
import { isAgentsHubIdleConversationSummary } from '../common/qaap-agents-hub-landing';
import { resolveTranscriptWorkspaceCwd, isTranscriptWorkspaceFilesystemPath } from '../common/qaap-transcript-workspace-cwd';
import { isQaapWorkspaceContainerPath } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import type { ExecutionSurfaceTabId } from '../common/qaap-execution-surface-tabs';
import {
    conversationShouldWatchDevPreview,
    findTranscriptPreviewUrlFromConversation,
    previewPageTitleMatchesProjectName,
    resolveReadyTranscriptPreviewUrlFromProbe,
} from '../common/qaap-transcript-preview-offer';
import { fetchQaapCurrentDevPreview, probeQaapDevPreviewPort, probeQaapIdentityPreview, waitForQaapDevPreviewPort } from './qaap-dev-preview-client';
import {
    findQaapIdentityPreviewUrl,
    isLocalQaapPreviewOrigin,
    parseQaapIdentityPreviewRequestPath,
    resolveDevPreviewPublicOrigin,
} from '../common/qaap-dev-preview';
import { ensureTranscriptDevPreview, extractDevPreviewPortFromUrl } from './qaap-transcript-preview-bootstrap';
import { ensureTranscriptSurfaceCss } from './ensure-transcript-surface-css';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import type { QaapMonorepoAppCandidate } from './qaap-project-bootstrap-types';
import { isTerminalDoesNotExistError } from './qaap-project-bootstrap-dev-errors';
import {
    buildQaapPreviewId,
    normalizeQaapPreviewConversationId,
    qaapPreviewProjectIdMatches,
    type QaapPreviewIdentity,
} from '../common/qaap-preview-identity';
import type { QaapDiffReviewWidget } from './qaap-diff-review-widget';
import { MobileSnackbar } from './mobile-snackbar';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsService } from './mobile-projects-service';
import {
    mountTranscriptFilesView,
    readPendingTranscriptFilesViewMode,
    clearPendingTranscriptFilesViewMode,
    type TranscriptFilesViewServices,
} from './qaap-transcript-files-view';
import {
    createTranscriptTerminalStagingHost,
    createTranscriptTerminalSurface,
    markTranscriptTerminalRestorable,
    scheduleTranscriptTerminalResize,
    type TranscriptTerminalPersistedWorkspace,
    type TranscriptTerminalSurface,
    type TranscriptTerminalViewServices,
} from './qaap-transcript-terminal-view';
import { resolveInteractiveAgentCliBin, resolveInteractiveAgentLoginCommand } from '../common/qaap-agent-tui-command';
import { resolveAgentDisplayLabel } from './qaap-agent-ui';
import {
    TranscriptWorkspaceSurfacesCache,
    type TranscriptWorkspaceSurfaceKey,
} from './qaap-transcript-workspace-surfaces-cache';
import type { MobileProjectsTranscriptHistoryUi } from './mobile-projects-transcript-history-ui';
import type { MobileProjectsTranscriptComposerUi } from './mobile-projects-transcript-composer-ui';
import type { MobileProjectsTranscriptHeaderUi } from './mobile-projects-transcript-header-ui';
import type { MobileProjectsExecutionSurfaceTabsUi } from './mobile-projects-execution-surface-tabs-ui';
import type { MobileProjectsTranscriptMessagesUi } from './mobile-projects-transcript-messages-ui';
import { createTranscriptReviewChrome } from './qaap-transcript-review-chrome';
import {
    pathsEqual as pathsEqualHelper,
    transcriptConversationMeta as transcriptConversationMetaHelper,
    resolveProjectScopedWorkspaceKey as resolveProjectScopedWorkspaceKeyHelper,
    resolveTranscriptTerminalTabTitle as resolveTranscriptTerminalTabTitleHelper,
    toPersistedTerminalWorkspace as toPersistedTerminalWorkspaceHelper,
} from './mobile-projects-transcript-surfaces-helpers';

export function cancelPreviewAgentTurnExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): void {
    const openProject = ctx.host.transcriptOpenProject ?? project;
    const openSummary = ctx.host.transcriptOpenSummary ?? summary;
    const hasRealConversation = !!openSummary && !isAgentsHubIdleConversationSummary(openSummary);
    if (hasRealConversation && ctx.host.onCancelConversation) {
        ctx.host.onCancelConversation(openProject, openSummary);
    } else {
        ctx.host.cancelOpenTranscriptStream?.();
    }
    ctx.host.transcriptComposerSendRefresh?.();
}

export function recoverTranscriptPreviewUrlExtracted(ctx: any, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void {
    if (ctx.host.transcriptPreviewRecoveryRequests.has(summary.id)) {
        return;
    }
    ctx.host.transcriptPreviewRecoveryRequests.add(summary.id);
    void ctx.refreshTranscriptPreviewProject(project, summary).then(latestProject => {
        const conv = ctx.host.transcriptLastConv;
        const previewUrl = latestProject.previewUrl ?? ctx.resolveTranscriptPreviewUrl(latestProject, conv);
        if (previewUrl) {
            void ctx.ensureTranscriptPreviewServing(latestProject, summary, previewUrl);
        }
        if (!previewUrl || !ctx.matchesActivePreviewSummary(summary) || ctx.host.executionSurfaceTabsUi.activeExecutionTab(project) !== 'preview') {
            return;
        }
        ctx.host.projects = ctx.host.projects.map(candidate => candidate.id === latestProject.id
            ? { ...latestProject, previewUrl }
            : candidate);
        ctx.renderPreviewTab(latestProject, summary);
    }).finally(() => {
        ctx.host.transcriptPreviewRecoveryRequests.delete(summary.id);
    });
}

export function ensureTranscriptPreviewServingExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    previewUrl: string,
    options: { readonly allowBootstrap?: boolean } = {},): void {
    const bootstrap = ctx.host.projectBootstrap;
    if (!bootstrap) {
        return;
    }
    const allowBootstrap = options.allowBootstrap === true;
    const requestKey = `${summary.id}:${previewUrl}:${allowBootstrap ? 'bootstrap' : 'wait'}`;
    if (ctx.transcriptPreviewEnsureRequests.has(requestKey)) {
        return;
    }
    const port = extractDevPreviewPortFromUrl(previewUrl);
    ctx.transcriptPreviewEnsureRequests.add(requestKey);
    void (async () => {
        if (port !== undefined) {
            const probe = await probeQaapDevPreviewPort(port);
            if (probe.ready) {
                return;
            }
            if (!allowBootstrap) {
                await waitForQaapDevPreviewPort(port, {
                    maxAttempts: 60,
                    intervalMs: 500,
                });
                return;
            }
        }
        if (!allowBootstrap) {
            return;
        }
        const readyUrl = await ensureTranscriptDevPreview(bootstrap, {
            previewUrlHint: previewUrl,
            portHint: port,
            conversation: ctx.host.transcriptLastConv?.id === summary.id
                ? ctx.host.transcriptLastConv
                : undefined,
            conversationId: summary.id,
            projectId: project.id,
            workspaceRoot: ctx.host.projectsService.getProjectCwd(project) ?? summary.cwd,
        });
        if (!readyUrl || !ctx.matchesActivePreviewSummary(summary)) {
            return;
        }
        if (ctx.host.executionSurfaceTabsUi.activeExecutionTab(project) !== 'preview') {
            return;
        }
        const latestProject = ctx.host.projects.find(candidate => candidate.id === project.id) ?? project;
        ctx.host.projects = ctx.host.projects.map(candidate => candidate.id === latestProject.id
            ? { ...candidate, previewUrl: readyUrl }
            : candidate);
        void ctx.host.projectsService.recordProjectPreviewUrl({ ...latestProject, previewUrl: readyUrl }, readyUrl);
        ctx.host.transcriptPreviewRequestPending = false;
        ctx.host.transcriptPreviewRequestRunning = false;
        ctx.renderPreviewTab({ ...latestProject, previewUrl: readyUrl }, summary);
    })().finally(() => {
        ctx.transcriptPreviewEnsureRequests.delete(requestKey);
    });
}

export function mountTranscriptEmptyPreviewExtracted(ctx: any, host: HTMLElement,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): void {
    // Probe churn (identity mismatch, run restarts) can decide to fall back to the empty state
    // while the user is typing a URL into the live chrome — never tear the field out from
    // under their cursor; the next probe tick re-evaluates after blur.
    if (ctx.isTranscriptPreviewUrlFieldActive()) {
        return;
    }
    const removeEmptyState = (): void => {
        ctx.host.transcriptEmbeddedPreview?.root.classList.remove('theia-mod-empty-preview');
        ctx.host.transcriptEmbeddedPreview?.root.querySelector('.theia-mobile-transcript-preview-empty-overlay')?.remove();
    };
    ctx.host.transcriptEmbeddedPreview = mountEmbeddedAgentPreviewChrome(host, {
        url: 'about:blank',
        historyScope: project.id,
        messageService: ctx.host.messageService,
        clipboard: ctx.host.previewClipboard,
        previewSurfaces: ctx.host.previewSurfaceRegistry,
        inspectorDeps: ctx.host.previewInspectorDeps,
        onNavigate: removeEmptyState,
        notify: (message, kind) => {
            MobileSnackbar.show(message, { kind: kind === 'warn' ? 'warning' : 'success' });
        },
        openExternal: target => {
            window.open(target, '_blank', 'noopener,noreferrer');
        },
        getAnnotationScope: () => ctx.resolvePreviewAnnotationScope(project, 'about:blank'),
        composerSession: ctx.host.resolveAnnotationComposerSession(),
    });
    ctx.wireTranscriptPreviewAnnotationScope(project, 'about:blank');
    ctx.host.transcriptEmbeddedPreview.root.classList.add('theia-mod-empty-preview');
    const input = ctx.host.transcriptEmbeddedPreview.root.querySelector<HTMLInputElement>('.theia-mini-browser-url-field input');
    if (input) {
        input.value = '';
        input.placeholder = nls.localize('qaap/mobileProjects/previewUrlPlaceholder', 'Enter a URL');
    }
    // Play control lives in the Work Hub header (left of Change view). Keep the empty frame
    // chrome clear so the iframe URL field stays the only content affordance here.
    ctx.host.transcriptEmbeddedPreview.root.querySelector('.theia-mobile-transcript-preview-empty-overlay')?.remove();
    ctx.syncHeaderPreviewRunButton(project, summary);
    ctx.annotateEmptyPreviewWhenNotRunnable(project, summary);
}

export function annotateEmptyPreviewWhenNotRunnableExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): void {
    const rootPath = ctx.resolveRunnableTranscriptProjectRoot(project, summary);
    const bootstrap = ctx.host.projectBootstrap;
    const frameSlot = ctx.host.transcriptEmbeddedPreview?.root.querySelector<HTMLElement>('.qaap-preview-frame-slot')
        ?? ctx.host.transcriptEmbeddedPreview?.root.querySelector<HTMLElement>('.qaap-preview-content-area');
    if (!frameSlot || !rootPath || typeof bootstrap?.describeRunnableApp !== 'function') {
        return;
    }
    void bootstrap.describeRunnableApp(FileUri.create(rootPath)).then(result => {
        if (result.runnable || !frameSlot.isConnected) {
            return;
        }
        if (ctx.host.transcriptOpenProject && ctx.host.transcriptOpenProject.id !== project.id) {
            return;
        }
        frameSlot.querySelector('.theia-mobile-transcript-preview-empty-overlay')?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'theia-mobile-transcript-preview-empty-overlay';
        const wrap = document.createElement('div');
        wrap.className = 'theia-mobile-transcript-preview-empty';
        const note = document.createElement('div');
        note.className = 'theia-mobile-transcript-preview-ready';
        const title = document.createElement('div');
        title.className = 'theia-mobile-transcript-preview-ready-title';
        title.textContent = nls.localize('qaap/mobileProjects/previewNoApp', 'This repository does not have a runnable app yet');
        const detail = document.createElement('p');
        detail.className = 'theia-mobile-transcript-preview-ready-hint';
        detail.textContent = result.hint
            ?? nls.localize(
                'qaap/mobileProjects/previewNoAppHint',
                'No package.json or index.html was found. Ask the agent to generate the app, or upload the project code to this repository.',
            );
        note.append(title, detail);
        wrap.append(note);
        overlay.append(wrap);
        frameSlot.append(overlay);
        ctx.syncHeaderPreviewRunButton(project, summary);
    }).catch(() => undefined);
}

export function resolveRunnableTranscriptProjectRootExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): string | undefined {
    const projectCwd = ctx.host.projectsService.getProjectCwd(project);
    if (projectCwd && !isQaapWorkspaceContainerPath(projectCwd)) {
        return projectCwd;
    }
    const sessionCwd = summary.cwd;
    if (sessionCwd
        && isTranscriptWorkspaceFilesystemPath(sessionCwd)
        && !isQaapWorkspaceContainerPath(sessionCwd)) {
        return sessionCwd;
    }
    return undefined;
}

export function resolveTranscriptProjectCwdExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): string | undefined {
    const resolved = resolveTranscriptWorkspaceCwd({
        summary,
        projectCwd: ctx.host.projectsService.getProjectCwd(project),
        preparedCwd: ctx.host.preparedCwdByProjectId.get(project.id),
    });
    if (resolved) {
        return resolved;
    }
    const workspaceCwd = ctx.host.projectsService.getCurrentWorkspaceCwd();
    if (
        workspaceCwd
        && !isQaapWorkspaceContainerPath(workspaceCwd)
        && ctx.host.projectsService.projectMatchesCurrentWorkspace(project)
    ) {
        return workspaceCwd;
    }
    const fromOpenSummary = ctx.host.transcriptOpenSummary?.cwd;
    if (
        fromOpenSummary
        && isTranscriptWorkspaceFilesystemPath(fromOpenSummary)
        && !isQaapWorkspaceContainerPath(fromOpenSummary)
    ) {
        return fromOpenSummary;
    }
    return undefined;
}

export function resolveTranscriptWorkspaceKeyExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): TranscriptWorkspaceSurfaceKey | undefined {
    const cwd = ctx.resolveTranscriptProjectCwd(project, summary);
    if (!cwd) {
        return undefined;
    }
    const terminalServices = ctx.host.createTranscriptTerminalViewServices?.();
    const resolved = terminalServices ? terminalServices.resolveCwd(cwd) : cwd;
    return ctx.resolveProjectScopedWorkspaceKey(project, resolved, summary.id);
}

export function resolveProjectScopedWorkspaceKeyExtracted(ctx: any, project: MobileProjectEntry,
    resolvedPath: string,
    conversationId?: string,): TranscriptWorkspaceSurfaceKey {
    return resolveProjectScopedWorkspaceKeyHelper(project, resolvedPath, conversationId);
}

function renderTranscriptFilesUnavailableNote(ctx: any, host: HTMLElement): void {
    ctx.detachTranscriptFilesFromHost();
    host.replaceChildren();
    const note = document.createElement('div');
    note.className = 'theia-mobile-transcript-files-note';
    note.textContent = nls.localize(
        'qaap/mobileProjects/filesUnavailable',
        'Open or clone this project to browse its files.',
    );
    host.append(note);
}

export function ensureTranscriptFilesTabExtracted(ctx: any, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void {
    void ensureTranscriptSurfaceCss();
    const host = ctx.executionFilesHost();
    if (!host) {
        return;
    }
    const workspaceKey = ctx.resolveTranscriptWorkspaceKey(project, summary);
    if (!workspaceKey) {
        const workspaceCwd = ctx.host.projectsService.getCurrentWorkspaceCwd();
        if (
            workspaceCwd
            && !isQaapWorkspaceContainerPath(workspaceCwd)
            && ctx.host.projectsService.projectMatchesCurrentWorkspace(project)
        ) {
            ctx.host.preparedCwdByProjectId.set(project.id, workspaceCwd);
            ctx.ensureTranscriptFilesTab(project, summary);
            return;
        }
    }
    if (!workspaceKey && project.github && ctx.host.projectsService) {
        void ctx.host.projectsService.prepareProjectCwd(project).then(prepared => {
            if (!prepared || !ctx.executionFilesHost()?.isConnected || ctx.host.executionSurfaceTabsUi.activeExecutionTab(project) !== 'files') {
                return;
            }
            ctx.host.preparedCwdByProjectId.set(project.id, prepared);
            ctx.ensureTranscriptFilesTab(project, summary);
        });
    }
    if (!workspaceKey) {
        renderTranscriptFilesUnavailableNote(ctx, host);
        return;
    }
    if (ctx.host.transcriptFilesAttachedKey === workspaceKey && host.querySelector('.theia-mobile-transcript-files')) {
        const attached = ctx.host.transcriptWorkspaceSurfaces.peekFiles(workspaceKey);
        const pendingMode = readPendingTranscriptFilesViewMode();
        if (pendingMode) {
            clearPendingTranscriptFilesViewMode();
            attached?.setViewMode?.(pendingMode);
        }
        ctx.syncHeaderFilesMoreButton(project, summary);
        ctx.syncHeaderViewModeSwitch(project, summary);
        return;
    }
    ctx.detachTranscriptFilesFromHost();
    const cwd = ctx.resolveTranscriptProjectCwd(project, summary);
    const services = ctx.host.createTranscriptFilesViewServices?.();
    if (!cwd || !services) {
        renderTranscriptFilesUnavailableNote(ctx, host);
        return;
    }
    const wrappedServices: TranscriptFilesViewServices = {
        ...services,
        renderMarkdownPreview: services.renderMarkdownPreview
            ? (resourcePath, markdown) => services.renderMarkdownPreview!(
                resourcePath,
                ctx.host.transcriptMessagesUi.cleanTranscriptDisplayText(markdown),
            )
            : undefined,
        canShowChanges: Boolean(ctx.host.createDiffReviewWidget),
        mountChangesView: ctx.host.createDiffReviewWidget
            ? async (changesHost: HTMLElement): Promise<void> => {
                if (!changesHost.isConnected || changesHost.hidden) {
                    return;
                }
                const chrome = createTranscriptReviewChrome(
                    changesHost,
                    ctx.host.transcriptHistoryPanelOpen,
                    ctx.host.transcriptHistoryPanelHeightPx,
                );
                const { diffHost, checksHost, historyToggleHost, historyResizeHandle, historyPanel } = chrome;
                ctx.host.transcriptReviewDiffHost = diffHost;
                ctx.host.transcriptReviewChecksHost = checksHost;
                ctx.host.transcriptHistoryRoot = cwd;
                ctx.host.transcriptHistoryUi.installTranscriptHistoryResize(historyResizeHandle, historyPanel, changesHost);
                const rootUri = FileUri.create(cwd).toString();
                if (!ctx.host.diffReviewWidget) {
                    ctx.host.diffReviewWidget = await ctx.host.createDiffReviewWidget!();
                }
                if (!changesHost.isConnected || changesHost.hidden || ctx.host.transcriptReviewDiffHost !== diffHost) {
                    return;
                }
                ctx.host.diffReviewWidget.enableTranscriptEmbed({ externalChrome: true });
                ctx.host.diffReviewWidget.node.classList.add('theia-mobile-transcript-diff-embed');
                ctx.host.diffReviewWidget.setTranscriptAgentFeedbackHandler(async () => {
                    /* project-level — use composer */
                });
                ctx.host.diffReviewWidget.setTranscriptCloseHandler(() => {
                    mount.setViewMode?.('files');
                });
                ctx.host.attachDiffReviewWidget(diffHost);
                ctx.host.diffReviewWidget.setRepositoryContext({
                    rootUri,
                    rootFsPath: cwd,
                    isActiveWorkspace: project.isCurrent,
                });
                ctx.host.diffReviewWidget.setCommitReadinessProvider(
                    () => ({
                        checksLoading: ctx.host.verifyChecksLoading,
                        running: ctx.host.verifyRunning,
                        results: ctx.host.verifyResults ?? [],
                    }),
                    () => {
                        invalidateVerifyWorkspaceSnapshots(ctx.host.verifyResults ?? []);
                        ctx.host.renderChecksSection(checksHost, project, summary, { embedded: true });
                    },
                );
                ctx.host.renderChecksSection(checksHost, project, summary, { embedded: true });
                ctx.host.transcriptHistoryUi.renderTranscriptHistoryToggle(historyToggleHost, historyPanel, historyResizeHandle, cwd);
                ctx.host.transcriptHistoryUi.renderTranscriptHistoryPanel(historyPanel, cwd);
            }
            : undefined,
        unmountChangesView: ctx.host.createDiffReviewWidget
            ? (): void => {
                ctx.detachTranscriptReviewWidget();
            }
            : undefined,
    };
    let mount = ctx.host.transcriptWorkspaceSurfaces.peekFiles(workspaceKey);
    if (!mount) {
        const stash = document.createElement('div');
        stash.className = 'theia-mobile-transcript-files-staging';
        stash.hidden = true;
        stash.setAttribute('aria-hidden', 'true');
        document.body.append(stash);
        mount = mountTranscriptFilesView(stash, cwd, wrappedServices);
        ctx.host.transcriptWorkspaceSurfaces.setFiles(workspaceKey, mount);
    } else {
        // Cached mount — consume any pending view-mode flag set by a
        // 'review' → 'files' redirect so the switch updates on re-attach.
        const pendingMode = readPendingTranscriptFilesViewMode();
        if (pendingMode) {
            clearPendingTranscriptFilesViewMode();
            mount.setViewMode?.(pendingMode);
        }
    }
    host.replaceChildren();
    host.append(mount.root);
    ctx.host.transcriptFilesAttachedKey = workspaceKey;
    ctx.syncHeaderFilesMoreButton(project, summary);
    ctx.syncHeaderViewModeSwitch(project, summary);
    mount.root.querySelector<HTMLElement>('.theia-mobile-transcript-files-preview-body')
        ?.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
}

export async function revealTranscriptFileExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    filePath: string,): Promise<void> {
    const trimmed = filePath.trim();
    if (!trimmed) {
        return;
    }
    ctx.host.executionSurfaceTabsUi.selectTranscriptTab('files', project, summary);
    ctx.ensureTranscriptFilesTab(project, summary);
    const workspaceKey = ctx.resolveTranscriptWorkspaceKey(project, summary);
    if (!workspaceKey) {
        return;
    }
    const mount = ctx.host.transcriptWorkspaceSurfaces.peekFiles(workspaceKey);
    if (!mount?.revealFilePath) {
        return;
    }
    try {
        await mount.revealFilePath(trimmed);
    } catch (error) {
        console.warn('[qaap-mobile-shell] Failed to reveal transcript file in Files preview:', error);
        ctx.host.messageService?.error(
            nls.localize('qaap/mobileProjects/transcriptOpenFileFailed', 'Could not open {0}', trimmed),
        );
    }
}

export async function revealTranscriptReviewFileExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    filePath: string,): Promise<void> {
    const trimmed = filePath.trim();
    if (!trimmed) {
        return;
    }
    ctx.host.executionSurfaceTabsUi.selectTranscriptTab('review', project, summary);
    await ctx.mountTranscriptReviewWidget(project, summary);
    if (!ctx.host.diffReviewWidget?.focusTranscriptReviewFile(trimmed)) {
        console.warn('[qaap-mobile-shell] Review file not found in diff list:', trimmed);
    }
}
