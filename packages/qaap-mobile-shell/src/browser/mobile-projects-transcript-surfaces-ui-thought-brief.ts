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
import { resolveTranscriptPreviewOpenUrl } from './qaap-transcript-preview-effective-url';
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
    parseQaapDevPreviewRequestPath,
    parseQaapIdentityPreviewRequestPath,
    resolveDevPreviewPublicOrigin,
} from '../common/qaap-dev-preview';
import { ensureTranscriptDevPreview, extractDevPreviewPortFromUrl } from './qaap-transcript-preview-bootstrap';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import type { QaapMonorepoAppCandidate } from './qaap-project-bootstrap-types';
import { isTerminalDoesNotExistError } from './qaap-project-bootstrap-dev-errors';
import {
    buildQaapPreviewId,
    claimedPreviewCoordinatesMatchProject,
    normalizeQaapPreviewConversationId,
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

export function disposeTranscriptTerminalSlidesExtracted(ctx: any, workspaceKey?: TranscriptWorkspaceSurfaceKey): void {
        if (workspaceKey) {
            const state = ctx.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey);
            if (state) {
                for (const surface of [...state.surfaces]) {
                    surface.dispose.dispose();
                }
            }
            ctx.host.transcriptTerminalSlidesByWorkspace.delete(workspaceKey);
            return;
        }
        for (const state of ctx.host.transcriptTerminalSlidesByWorkspace.values()) {
            for (const surface of [...state.surfaces]) {
                surface.dispose.dispose();
            }
        }
        ctx.host.transcriptTerminalSlidesByWorkspace.clear();
}

export function prepareTranscriptTerminalsForPageUnloadExtracted(ctx: any): void {
        for (const [workspaceKey, state] of ctx.host.transcriptTerminalSlidesByWorkspace) {
            for (const surface of state.surfaces) {
                if (!surface.terminal.isDisposed) {
                    markTranscriptTerminalRestorable(surface.terminal);
                }
            }
            void ctx.persistTranscriptTerminalWorkspace(workspaceKey);
        }
}

export function createTranscriptPreviewLoadingExtracted(ctx: any, _conv: QaapAgentConversationDTO | undefined): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'theia-mobile-transcript-preview-loading';
        wrap.setAttribute('role', 'status');
        wrap.setAttribute('aria-live', 'polite');

        const line = document.createElement('div');
        line.className = 'theia-mobile-agent-stream-line theia-mod-thinking';
        const dot = document.createElement('span');
        dot.className = 'theia-mobile-agent-stream-dot';
        dot.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'theia-mobile-agent-stream-label';
        label.textContent = nls.localize('qaap/mobileProjects/previewLoading', 'Loading…');
        line.append(dot, label);
        wrap.append(line);

        // Live dev-server output stream: show the last few lines of the dev server log so the
        // user sees compile/install progress instead of a static spinner (cold starts on the
        // VPS can take 10-30s; this feedback prevents the "is it stuck?" feeling).
        const bootstrap = ctx.host.projectBootstrap;
        if (bootstrap) {
            const log = document.createElement('pre');
            log.className = 'theia-mobile-transcript-preview-devlog';
            log.setAttribute('aria-hidden', 'true');
            const renderTail = (): void => {
                const tail = bootstrap.devOutput?.trim();
                log.textContent = tail ? tail.split('\n').slice(-6).join('\n') : '';
            };
            renderTail();
            const listener = bootstrap.onDevOutput(() => renderTail());
            wrap.append(log);
            // Auto-clean when the loading element is removed from the DOM (preview ready).
            const observer = new MutationObserver(() => {
                if (!wrap.isConnected) {
                    listener.dispose();
                    observer.disconnect();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }
        return wrap;
}

export async function syncTranscriptPreviewFromConversationExtracted(ctx: any, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        conv: QaapAgentConversationDTO,): Promise<void> {
        if (ctx.host.transcriptPreviewSuppressedByUser) {
            return;
        }
        const awaitingPreview = conversationShouldWatchDevPreview(conv, window.location.origin)
            || ctx.host.transcriptPreviewRequestPending;
        if (ctx.host.executionSurfaceTabsUi.activeExecutionTab(project) !== 'preview'
            && !ctx.host.transcriptPreviewRequestPending
            && !awaitingPreview) {
            return;
        }
        const latestProject = await ctx.refreshTranscriptPreviewProject(project, summary);
        if (ctx.resolveTranscriptPreviewUrl(latestProject, conv) || conv.status !== 'streaming') {
            ctx.host.transcriptPreviewRequestPending = false;
        }
        if (ctx.host.executionSurfaceTabsUi.activeExecutionTab(project) === 'preview'
            && (ctx.matchesActivePreviewSummary(summary) || ctx.host.projectDetailSurfaceTargets)) {
            const conversationScopeId = ctx.previewScopeId(summary);
            const candidateUrl = ctx.resolveTranscriptPreviewUrl(latestProject, conv);
            if (candidateUrl === ctx.lastSyncedPreviewUrl(conversationScopeId)
                && ctx.mountedPreviewUrl(conversationScopeId) === candidateUrl
                && conv.status === 'streaming') {
                ctx.scheduleTranscriptPreviewTabProbe(latestProject, summary, conv);
                return;
            }
            ctx.setLastSyncedPreviewUrl(conversationScopeId, candidateUrl);
            ctx.renderPreviewTab(latestProject, summary);
        } else if (awaitingPreview) {
            ctx.scheduleTranscriptPreviewTabProbe(latestProject, summary, conv);
        }
}

export async function refreshTranscriptPreviewProjectExtracted(ctx: any, project: MobileProjectEntry, summary?: QaapAgentConversationSummaryDTO): Promise<MobileProjectEntry> {
        try {
            const previousPreviewUrl = project.previewUrl
                ?? ctx.host.projects.find(candidate => candidate.id === project.id)?.previewUrl;
            ctx.host.projects = await ctx.host.projectsService.loadProjects();
            const loadedProject = ctx.host.projects.find(candidate => candidate.id === project.id) ?? project;
            const latestProject = previousPreviewUrl && !loadedProject.previewUrl
                ? { ...loadedProject, previewUrl: previousPreviewUrl }
                : loadedProject;
            if (latestProject.previewUrl) {
                if (await ctx.previewUrlMatchesProject(latestProject.previewUrl, latestProject)) {
                    return latestProject;
                }
            }
            const previewUrl = await ctx.host.projectsService.resolveProjectPreviewUrl(latestProject, summary?.cwd);
            if (previewUrl && await ctx.previewUrlMatchesProject(previewUrl, latestProject)) {
                return { ...latestProject, previewUrl };
            }
            const discoveredPreviewUrl = await ctx.discoverProjectDevPreviewUrl(latestProject);
            return discoveredPreviewUrl ? { ...latestProject, previewUrl: discoveredPreviewUrl } : latestProject;
        } catch {
            const previewUrl = await ctx.host.projectsService.resolveProjectPreviewUrl(project, summary?.cwd).catch(() => undefined);
            if (previewUrl && await ctx.previewUrlMatchesProject(previewUrl, project).catch(() => false)) {
                return { ...project, previewUrl };
            }
            const discoveredPreviewUrl = await ctx.discoverProjectDevPreviewUrl(project).catch(() => undefined);
            if (discoveredPreviewUrl) {
                return { ...project, previewUrl: discoveredPreviewUrl };
            }
            return project;
        }
}

export async function previewUrlMatchesProjectExtracted(ctx: any, previewUrl: string, project: MobileProjectEntry): Promise<boolean> {
        try {
            const normalized = normalizePreviewUrlForSameOrigin(previewUrl);
            const parsed = new URL(normalized, window.location.href);
            const cwd = ctx.host.projectsService.getProjectCwd(project)
                ?? ctx.host.preparedCwdByProjectId.get(project.id);
            let cwdUri: string | undefined;
            try {
                cwdUri = cwd ? FileUri.create(cwd).toString() : undefined;
            } catch {
                cwdUri = undefined;
            }
            const claimMatches = (probeProjectId: string | undefined): boolean => claimedPreviewCoordinatesMatchProject({
                probeProjectId,
                projectId: project.id,
                projectUri: project.uri?.toString(),
                cwdUri,
                projectName: project.name,
            });
            const identityPath = parseQaapIdentityPreviewRequestPath(parsed.pathname);
            if (identityPath) {
                const probe = await probeQaapIdentityPreview(identityPath.previewId);
                if (!probe.ready) {
                    return false;
                }
                if (probe.projectId) {
                    return claimMatches(probe.projectId);
                }
                // Legacy identity links predate project coordinates in the probe response. Keep
                // title matching only for that migration path, never as the primary identity.
            }
            const portPath = parseQaapDevPreviewRequestPath(parsed.pathname);
            if (portPath) {
                const probe = await probeQaapDevPreviewPort(portPath.port);
                if (probe.ready && probe.projectId) {
                    return claimMatches(probe.projectId);
                }
            }
            // Hosted multi-tenant origins must never accept a preview by HTML title — two Vite apps
            // both titled "Vite App" would cross-mount across projects of the same user.
            if (!isLocalQaapPreviewOrigin(resolveDevPreviewPublicOrigin())) {
                return false;
            }
            const response = await fetch(normalized, { cache: 'no-store' });
            if (!response.ok) {
                return false;
            }
            const html = await response.text();
            const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
            return previewPageTitleMatchesProjectName(title, project.name);
        } catch {
            return false;
        }
}

export async function discoverProjectDevPreviewUrlExtracted(ctx: any, project: MobileProjectEntry): Promise<string | undefined> {
        // The preview registry knows the project's live claim even on hosted origins, where the
        // legacy localhost port-scan below is unavailable. This is what recovers a surface whose
        // stored URL was cleared after its claim was superseded by a newer run.
        const currentClaimUrl = await ctx.fetchCurrentProjectClaimUrl(project);
        if (currentClaimUrl && await ctx.previewUrlMatchesProject(currentClaimUrl, project)) {
            void ctx.host.projectsService.recordProjectPreviewUrl(project, currentClaimUrl);
            return currentClaimUrl;
        }
        if (!isLocalQaapPreviewOrigin(resolveDevPreviewPublicOrigin())) {
            return undefined;
        }
        const ports = [8080, 3333, 3001, 4173, ...Array.from({ length: 18 }, (_, index) => 5173 + index)];
        const probes = await Promise.all(ports.map(async port => {
            const probe = await probeQaapDevPreviewPort(port);
            if (!probe.ready || !await ctx.previewUrlMatchesProject(probe.previewUrl, project)) {
                return undefined;
            }
            return normalizePreviewUrlForSameOrigin(probe.previewUrl);
        }));
        const previewUrl = probes.find(Boolean);
        if (previewUrl) {
            void ctx.host.projectsService.recordProjectPreviewUrl(project, previewUrl);
        }
        return previewUrl;
}

export function beginTranscriptDevPreviewRequestExtracted(ctx: any, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void {
        ctx.clearPreviewRuntimeForConversation(ctx.previewScopeId(summary));
        ctx.stopTranscriptPreviewTabProbe();
        ctx.host.transcriptPreviewSuppressedByUser = false;
        ctx.host.transcriptPreviewRequestPending = true;
        ctx.host.transcriptPreviewRequestRunning = true;
        const cleared = { ...project, previewUrl: undefined };
        ctx.host.projects = ctx.host.projects.map(candidate => candidate.id === cleared.id
            ? cleared
            : candidate);
        if (ctx.host.transcriptOpenProject?.id === cleared.id) {
            ctx.host.transcriptOpenProject = cleared;
        }
        ctx.syncHeaderPreviewRunButton(cleared, summary);
}

export function resolveTranscriptPreviewUrlExtracted(ctx: any, project: MobileProjectEntry,
        conv: QaapAgentConversationDTO | undefined,): string | undefined {
        const conversationScopeId = ctx.previewScopeId(conv ? { id: conv.id } : undefined);
        const storedUrl = project.previewUrl ? normalizePreviewUrlForSameOrigin(project.previewUrl) : undefined;
        const bootstrapUrl = ctx.bootstrapRunningPreviewUrl(project);
        // On the hosted multi-project runtime, an identity-scoped URL is authoritative. Agent
        // prose can still mention the package's hard-coded localhost/default port (for example
        // 8080) even though the allocator launched the process on 3000. Letting that hint win
        // discards a valid registry URL and can probe or display another unregistered process.
        // Keep conversation ports only as the legacy/local fallback when no stable identity is
        // available yet.
        const identityUrl = findQaapIdentityPreviewUrl(
            [storedUrl, bootstrapUrl],
            window.location.href,
        );
        if (identityUrl) {
            return resolveTranscriptPreviewOpenUrl({
                candidateUrl: identityUrl,
                project,
                bootstrap: ctx.host.projectBootstrap,
                appliesToProject: ctx.bootstrapAppliesToProject(project),
            });
        }
        if (conv) {
            const fromConversation = findTranscriptPreviewUrlFromConversation(conv, window.location.origin);
            if (fromConversation) {
                return normalizePreviewUrlForSameOrigin(fromConversation);
            }
            if (ctx.host.transcriptPreviewRequestPending && conv.status === 'streaming') {
                return ctx.probeReadyPreviewUrl(conversationScopeId) ?? ctx.bootstrapRunningPreviewUrl(project);
            }
            if (conv.status === 'streaming' && conversationShouldWatchDevPreview(conv, window.location.origin)) {
                return ctx.bootstrapRunningPreviewUrl(project)
                    ?? ctx.probeReadyPreviewUrl(conversationScopeId)
                    ?? ctx.mountedPreviewUrl(conversationScopeId)
                    ?? undefined;
            }
        }
        if (ctx.host.transcriptPreviewRequestPending && conv?.status === 'streaming') {
            return undefined;
        }
        if (storedUrl) {
            return resolveTranscriptPreviewOpenUrl({
                candidateUrl: storedUrl,
                project,
                bootstrap: ctx.host.projectBootstrap,
                appliesToProject: ctx.bootstrapAppliesToProject(project),
            });
        }
        if (bootstrapUrl) {
            return resolveTranscriptPreviewOpenUrl({
                candidateUrl: bootstrapUrl,
                project,
                bootstrap: ctx.host.projectBootstrap,
                appliesToProject: ctx.bootstrapAppliesToProject(project),
            });
        }
        return undefined;
}
