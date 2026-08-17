// @ts-nocheck
// Extracted from mobile-projects-transcript-surfaces-ui.ts

import { nls } from '@theia/core/lib/common/nls';
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
import {
    pathsEqual as pathsEqualHelper,
    transcriptConversationMeta as transcriptConversationMetaHelper,
    resolveProjectScopedWorkspaceKey as resolveProjectScopedWorkspaceKeyHelper,
    resolveTranscriptTerminalTabTitle as resolveTranscriptTerminalTabTitleHelper,
    toPersistedTerminalWorkspace as toPersistedTerminalWorkspaceHelper,
} from './mobile-projects-transcript-surfaces-helpers';
import { TRANSCRIPT_PREVIEW_IDENTITY_WATCH_MS } from './mobile-projects-transcript-surfaces-ui';

export async function tryMountVerifiedTranscriptPreviewExtracted(ctx: any, host: HTMLElement,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        latestProject: MobileProjectEntry,
        candidateUrl: string,): Promise<void> {
        const port = extractDevPreviewPortFromUrl(candidateUrl);
        if (port === undefined) {
            const previewTabActive = ctx.host.executionSurfaceTabsUi.activeExecutionTab(project) === 'preview';
            if ((!ctx.matchesActivePreviewSummary(summary) && !previewTabActive) || !host.isConnected
                || !await ctx.previewUrlMatchesProject(candidateUrl, latestProject)) {
                return;
            }
            ctx.mountTranscriptEmbeddedPreview(host, candidateUrl, latestProject, summary);
            return;
        }
        const probe = await probeQaapDevPreviewPort(port);
        if (!ctx.matchesActivePreviewSummary(summary)
            || !host.isConnected
            || ctx.transcriptPreviewProjectId !== project.id) {
            return;
        }
        if (!probe.ready) {
            const conv = ctx.host.transcriptLastConv;
            const canKeepEmptyPreview = ctx.host.transcriptEmbeddedPreview?.root.isConnected === true
                && host.contains(ctx.host.transcriptEmbeddedPreview.root)
                && ctx.host.transcriptEmbeddedPreview.root.classList.contains('theia-mod-empty-preview');
            if (!canKeepEmptyPreview) {
                ctx.disposeTranscriptEmbeddedPreview();
                host.replaceChildren();
                ctx.mountTranscriptEmptyPreview(host, project, summary);
            } else {
                ctx.updateTranscriptPreviewRunButtonState(conv);
            }
            ctx.scheduleTranscriptPreviewTabProbe(project, summary, conv);
            return;
        }

        ctx.stopTranscriptPreviewTabProbe();
        const readyUrl = normalizePreviewUrlForSameOrigin(probe.previewUrl);
        if (!await ctx.previewUrlMatchesProject(readyUrl, latestProject)) {
            const reconciled = await ctx.reconcileSupersededProjectPreviewUrl(latestProject, readyUrl);
            if (reconciled && ctx.transcriptPreviewProjectId === project.id && host.isConnected) {
                const adopted = ctx.adoptReconciledProjectPreviewUrl(latestProject, reconciled);
                void ctx.tryMountProjectScopedPreview(host, project, summary, adopted, reconciled);
                return;
            }
            const cleared = ctx.clearMismatchedProjectPreviewUrl(latestProject, readyUrl);
            if (ctx.transcriptPreviewProjectId === project.id && host.isConnected) {
                ctx.disposeTranscriptEmbeddedPreview();
                host.replaceChildren();
                ctx.mountTranscriptEmptyPreview(host, cleared, summary);
                void ctx.discoverAndMountTranscriptPreviewIfReady(cleared, summary);
            }
            return;
        }
        const conversationScopeId = ctx.previewScopeId(summary);
        const executionUrl = await ctx.claimTranscriptPreviewExecution(project, summary, port, readyUrl);
        if (!executionUrl) {
            ctx.host.messageService?.warn(nls.localize(
                'qaap/mobileProjects/previewIdentityConflict',
                'This preview execution could not reserve its own process and port.',
            ));
            return;
        }
        if (ctx.host.executionSurfaceTabsUi.activeExecutionTab(project) !== 'preview') {
            ctx.stageTranscriptPreviewReadyUrl(conversationScopeId, executionUrl);
            if (latestProject.previewUrl !== executionUrl) {
                const updatedProject = { ...latestProject, previewUrl: executionUrl };
                ctx.host.projects = ctx.host.projects.map(candidate => candidate.id === updatedProject.id
                    ? updatedProject
                    : candidate);
                if (ctx.host.transcriptOpenProject?.id === updatedProject.id) {
                    ctx.host.transcriptOpenProject = updatedProject;
                }
                void ctx.host.projectsService.recordProjectPreviewUrl(updatedProject, executionUrl).catch(() => undefined);
            }
            return;
        }
        if (ctx.mountedPreviewUrl(conversationScopeId) === executionUrl
            && ctx.transcriptPreviewProjectId === project.id
            && ctx.host.transcriptEmbeddedPreview?.root.isConnected === true
            && host.contains(ctx.host.transcriptEmbeddedPreview.root)
            && !ctx.host.transcriptEmbeddedPreview.root.classList.contains('theia-mod-empty-preview')) {
            return;
        }

        ctx.setMountedPreviewUrl(conversationScopeId, executionUrl);
        ctx.setProbeReadyPreviewUrl(conversationScopeId, executionUrl);
        const allowBootstrap = ctx.host.transcriptPreviewRequestPending;
        ctx.host.transcriptPreviewRequestPending = false;
        ctx.host.transcriptPreviewRequestRunning = false;
        if (allowBootstrap) {
            void ctx.ensureTranscriptPreviewServing(project, summary, executionUrl, { allowBootstrap: true });
        }
        if (latestProject.previewUrl !== executionUrl) {
            const updatedProject = { ...latestProject, previewUrl: executionUrl };
            ctx.host.projects = ctx.host.projects.map(candidate => candidate.id === updatedProject.id
                ? updatedProject
                : candidate);
            if (ctx.host.transcriptOpenProject?.id === updatedProject.id) {
                ctx.host.transcriptOpenProject = updatedProject;
            }
            void ctx.host.projectsService.recordProjectPreviewUrl(updatedProject, executionUrl).catch(() => undefined);
        }
        const hadEmptyPreview = ctx.host.transcriptEmbeddedPreview?.root.classList.contains('theia-mod-empty-preview') === true;
        if (hadEmptyPreview
            || !ctx.host.transcriptEmbeddedPreview?.root.isConnected
            || !host.contains(ctx.host.transcriptEmbeddedPreview.root)) {
            ctx.disposeTranscriptEmbeddedPreview();
            host.replaceChildren();
        }
        ctx.mountTranscriptEmbeddedPreview(host, executionUrl, latestProject, summary);
}

export function shouldKeepTranscriptPreviewTabProbeExtracted(ctx: any, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        conv: QaapAgentConversationDTO,): boolean {
        if (!ctx.matchesActivePreviewSummary(summary)) {
            return false;
        }
        if (ctx.host.executionSurfaceTabsUi.activeExecutionTab(project) === 'preview'
            && ctx.isTranscriptPreviewWaiting(conv, project)) {
            return true;
        }
        return conv.status === 'streaming'
            && (conversationShouldWatchDevPreview(conv, window.location.origin)
                || ctx.host.transcriptPreviewRequestPending);
}

export async function discoverAndMountTranscriptPreviewIfReadyExtracted(ctx: any, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        const conv = ctx.host.transcriptLastConv;
        const host = ctx.executionPreviewHost();
        if (!conv || !host?.isConnected || !ctx.matchesActivePreviewSummary(summary)) {
            return;
        }
        if (ctx.host.executionSurfaceTabsUi.activeExecutionTab(project) !== 'preview') {
            return;
        }
        if (!ctx.isTranscriptPreviewWaiting(conv, project)) {
            return;
        }
        const latestProject = ctx.host.projects.find(candidate => candidate.id === project.id) ?? project;
        const existing = ctx.resolveTranscriptPreviewUrl(latestProject, conv);
        if (existing) {
            void ctx.tryMountProjectScopedPreview(host, project, summary, latestProject, existing);
            return;
        }
        const bootstrapUrl = ctx.host.projectBootstrap?.phase === 'running'
            ? ctx.bootstrapPreviewUrlForProject(latestProject)
            : undefined;
        if (bootstrapUrl) {
            void ctx.tryMountProjectScopedPreview(
                host,
                project,
                summary,
                latestProject,
                normalizePreviewUrlForSameOrigin(bootstrapUrl),
            );
            return;
        }
        const discovered = await ctx.discoverProjectDevPreviewUrl(latestProject);
        if (!discovered || !host.isConnected || !ctx.matchesActivePreviewSummary(summary)) {
            return;
        }
        const updatedProject = { ...latestProject, previewUrl: discovered };
        ctx.host.projects = ctx.host.projects.map(candidate => candidate.id === updatedProject.id
            ? updatedProject
            : candidate);
        void ctx.tryMountProjectScopedPreview(host, project, summary, updatedProject, discovered);
}

export async function fetchCurrentProjectClaimUrlExtracted(ctx: any, project: MobileProjectEntry): Promise<string | undefined> {
        const cwd = ctx.host.projectsService.getProjectCwd(project)
            ?? ctx.host.preparedCwdByProjectId.get(project.id);
        let cwdUri: string | undefined;
        try {
            cwdUri = cwd ? FileUri.create(cwd).toString() : undefined;
        } catch {
            cwdUri = undefined;
        }
        // Scope to the open section so this surface never adopts another section's live claim.
        const current = await fetchQaapCurrentDevPreview([
            cwdUri,
            project.uri?.toString(),
            project.id,
        ], ctx.previewScopeId());
        const fallback = (!current?.ready || !current.previewUrl)
            ? await fetchQaapCurrentDevPreview([
                cwdUri,
                project.uri?.toString(),
                project.id,
            ])
            : undefined;
        const claim = current?.ready && current.previewUrl ? current : fallback;
        if (!claim?.ready || !claim.previewUrl) {
            return undefined;
        }
        if (ctx.bootstrapAppliesToProject(project)) {
            ctx.host.projectBootstrap?.adoptSupersedingPreviewClaim(claim);
        }
        return normalizePreviewUrlForSameOrigin(claim.previewUrl);
}

export async function reconcileSupersededProjectPreviewUrlExtracted(ctx: any, project: MobileProjectEntry,
        staleUrl: string,): Promise<string | undefined> {
        const currentUrl = await ctx.fetchCurrentProjectClaimUrl(project);
        if (!currentUrl || currentUrl === normalizePreviewUrlForSameOrigin(staleUrl)) {
            return undefined;
        }
        return currentUrl;
}

export function adoptReconciledProjectPreviewUrlExtracted(ctx: any, project: MobileProjectEntry, previewUrl: string): MobileProjectEntry {
        const updated = { ...project, previewUrl };
        ctx.host.projects = ctx.host.projects.map(candidate => candidate.id === updated.id
            ? updated
            : candidate);
        if (ctx.host.transcriptOpenProject?.id === updated.id) {
            ctx.host.transcriptOpenProject = updated;
        }
        ctx.setProbeReadyPreviewUrl(ctx.previewScopeId(), previewUrl);
        void ctx.host.projectsService.recordProjectPreviewUrl(updated, previewUrl).catch(() => undefined);
        return updated;
}

export function stopTranscriptPreviewIdentityWatchExtracted(ctx: any): void {
        if (ctx.transcriptPreviewIdentityWatchTimer !== undefined) {
            window.clearTimeout(ctx.transcriptPreviewIdentityWatchTimer);
            ctx.transcriptPreviewIdentityWatchTimer = undefined;
        }
}

export function scheduleTranscriptPreviewIdentityWatchExtracted(ctx: any, project: MobileProjectEntry): void {
        ctx.stopTranscriptPreviewIdentityWatch();
        ctx.transcriptPreviewIdentityWatchTimer = window.setTimeout(() => {
            ctx.transcriptPreviewIdentityWatchTimer = undefined;
            void ctx.verifyMountedTranscriptPreviewIdentity(project);
        }, TRANSCRIPT_PREVIEW_IDENTITY_WATCH_MS);
}

export async function verifyMountedTranscriptPreviewIdentityExtracted(ctx: any, project: MobileProjectEntry): Promise<void> {
        const chrome = ctx.host.transcriptEmbeddedPreview;
        if (!chrome || !chrome.root.isConnected
            || ctx.transcriptPreviewProjectId !== project.id
            || chrome.root.classList.contains('theia-mod-empty-preview')) {
            return;
        }
        if (document.hidden) {
            ctx.scheduleTranscriptPreviewIdentityWatch(project);
            return;
        }
        const conversationScopeId = ctx.previewScopeId();
        const mountedUrl = ctx.getTranscriptEmbeddedPreviewUrl() ?? ctx.mountedPreviewUrl(conversationScopeId);
        if (!mountedUrl) {
            return;
        }
        let identity: { previewId: string } | undefined;
        try {
            identity = parseQaapIdentityPreviewRequestPath(new URL(mountedUrl, window.location.href).pathname);
        } catch {
            identity = undefined;
        }
        if (!identity) {
            // Legacy port-scoped mounts cannot be superseded-403'd; the tab probe covers them.
            return;
        }
        const probe = await probeQaapIdentityPreview(identity.previewId);
        const stillMounted = (): boolean => ctx.host.transcriptEmbeddedPreview === chrome
            && chrome.root.isConnected
            && ctx.transcriptPreviewProjectId === project.id;
        if (!stillMounted()) {
            return;
        }
        if (probe.ready) {
            ctx.scheduleTranscriptPreviewIdentityWatch(project);
            return;
        }
        const latestProject = ctx.host.projects.find(candidate => candidate.id === project.id) ?? project;
        const reconciled = await ctx.reconcileSupersededProjectPreviewUrl(latestProject, mountedUrl);
        const hostElement = ctx.executionPreviewHost();
        if (reconciled && stillMounted() && hostElement?.isConnected) {
            const adopted = ctx.adoptReconciledProjectPreviewUrl(latestProject, reconciled);
            ctx.mountTranscriptEmbeddedPreview(hostElement, reconciled, adopted);
            return;
        }
        // The successor claim may still be booting (or the run died) — keep watching.
        ctx.scheduleTranscriptPreviewIdentityWatch(project);
}

export function clearMismatchedProjectPreviewUrlExtracted(ctx: any, project: MobileProjectEntry,
        _previewUrl: string,): MobileProjectEntry {
        const cleared = { ...project, previewUrl: undefined };
        ctx.host.projects = ctx.host.projects.map(candidate => candidate.id === cleared.id
            ? cleared
            : candidate);
        if (ctx.host.transcriptOpenProject?.id === cleared.id) {
            ctx.host.transcriptOpenProject = cleared;
        }
        ctx.clearPreviewRuntimeForConversation(ctx.previewScopeId());
        return cleared;
}

export async function tryMountProjectScopedPreviewExtracted(ctx: any, host: HTMLElement,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        latestProject: MobileProjectEntry,
        candidateUrl: string,): Promise<void> {
        if (ctx.transcriptPreviewProjectId !== project.id || !host.isConnected) {
            return;
        }
        if (!await ctx.previewUrlMatchesProject(candidateUrl, latestProject)) {
            // A superseded claim probes as dead even though the project has a newer live one
            // (chained runs: retry, second tab, backend restart). Swap before falling back to
            // the destructive clear-and-rediscover path, which cannot recover on hosted origins.
            const reconciled = await ctx.reconcileSupersededProjectPreviewUrl(latestProject, candidateUrl);
            if (ctx.transcriptPreviewProjectId !== project.id || !host.isConnected) {
                return;
            }
            if (reconciled) {
                const adopted = ctx.adoptReconciledProjectPreviewUrl(latestProject, reconciled);
                void ctx.tryMountProjectScopedPreview(host, project, summary, adopted, reconciled);
                return;
            }
            const cleared = ctx.clearMismatchedProjectPreviewUrl(latestProject, candidateUrl);
            ctx.disposeTranscriptEmbeddedPreview();
            host.replaceChildren();
            ctx.mountTranscriptEmptyPreview(host, cleared, summary);
            void ctx.discoverAndMountTranscriptPreviewIfReady(cleared, summary);
            return;
        }
        let identityPath: ReturnType<typeof parseQaapIdentityPreviewRequestPath>;
        try {
            identityPath = parseQaapIdentityPreviewRequestPath(new URL(candidateUrl, window.location.href).pathname);
        } catch {
            identityPath = undefined;
        }
        const previewTabActive = ctx.host.executionSurfaceTabsUi.activeExecutionTab(project) === 'preview';
        if (identityPath || extractDevPreviewPortFromUrl(candidateUrl) === undefined) {
            if (ctx.matchesActivePreviewSummary(summary) || previewTabActive) {
                ctx.mountTranscriptEmbeddedPreview(host, candidateUrl, latestProject, summary);
            }
            return;
        }
        void ctx.tryMountVerifiedTranscriptPreview(host, project, summary, latestProject, candidateUrl);
}

export function renderPreviewTabExtracted(ctx: any, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void {
        const host = ctx.executionPreviewHost();
        if (!host) {
            return;
        }
        if (ctx.host.transcriptPreviewSuppressedByUser) {
            ctx.disposeTranscriptEmbeddedPreview();
            host.replaceChildren();
            ctx.mountTranscriptEmptyPreview(host, project, summary);
            ctx.syncHeaderPreviewRunButton(project, summary);
            return;
        }
        ctx.ensurePreviewProjectContext(project);

        const conv = ctx.host.transcriptLastConv;
        const fromHost = ctx.host.projects.find(candidate => candidate.id === project.id);
        const latestProject = {
            ...(fromHost ?? project),
            previewUrl: project.previewUrl ?? fromHost?.previewUrl,
        };
        const candidateUrl = ctx.resolveTranscriptPreviewUrl(latestProject, conv)
            ?? ctx.bootstrapPreviewUrlForProject(latestProject);
        if (candidateUrl) {
            void ctx.tryMountProjectScopedPreview(host, project, summary, latestProject, candidateUrl);
            return;
        }

        void ctx.refreshTranscriptPreviewProject(latestProject, summary).then(refreshed => {
            if (ctx.transcriptPreviewProjectId !== project.id || !host.isConnected) {
                return;
            }
            if (ctx.host.executionSurfaceTabsUi.activeExecutionTab(refreshed) !== 'preview') {
                return;
            }
            const hydratedUrl = ctx.resolveTranscriptPreviewUrl(refreshed, ctx.host.transcriptLastConv);
            if (!hydratedUrl) {
                return;
            }
            ctx.host.projects = ctx.host.projects.map(candidate => candidate.id === refreshed.id
                ? refreshed
                : candidate);
            ctx.renderPreviewTab(refreshed, summary);
        });

        const conversationScopeId = ctx.previewScopeId(summary);
        ctx.setMountedPreviewUrl(conversationScopeId, undefined);
        ctx.setLastSyncedPreviewUrl(conversationScopeId, undefined);

        const waitingForPreview = ctx.isTranscriptPreviewWaiting(conv, project);
        if (waitingForPreview) {
            ctx.recoverTranscriptPreviewUrl(project, summary);
            void ctx.discoverAndMountTranscriptPreviewIfReady(project, summary);
        }

        const canKeepEmptyPreview = ctx.host.transcriptEmbeddedPreview?.root.isConnected === true
            && host.contains(ctx.host.transcriptEmbeddedPreview.root)
            && ctx.host.transcriptEmbeddedPreview.root.classList.contains('theia-mod-empty-preview');
        if (canKeepEmptyPreview) {
            ctx.updateTranscriptPreviewRunButtonState(conv);
            const probeReadyUrl = ctx.probeReadyPreviewUrl(conversationScopeId);
            if (probeReadyUrl) {
                ctx.updateTranscriptPreviewReadyOverlay(probeReadyUrl);
            }
            ctx.scheduleTranscriptPreviewTabProbe(project, summary);
            return;
        }

        ctx.disposeTranscriptEmbeddedPreview();
        host.replaceChildren();
        ctx.mountTranscriptEmptyPreview(host, project, summary);
        ctx.scheduleTranscriptPreviewTabProbe(project, summary);
}

