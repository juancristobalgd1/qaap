import type { MobileProjectsTranscriptSurfacesUiContext } from './mobile-projects-transcript-surfaces-ui-context';
import { resetTranscriptPreviewToEmptyExtracted } from './mobile-projects-transcript-surfaces-ui-tool-pills';
// Extracted from mobile-projects-transcript-surfaces-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { normalizePreviewUrlForSameOrigin } from '@theia/qaap-adapters/lib/browser/qaap-preview-url-utils';
import { resolveTranscriptPreviewOpenUrl } from '@theia/qaap-transcript/lib/browser/qaap-transcript-preview-effective-url';
import {
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import {
    conversationShouldWatchDevPreview,
} from '@theia/qaap-shared-core/lib/common/qaap-transcript-preview-offer';
import { fetchQaapCurrentDevPreview, probeQaapDevPreviewPort, probeQaapIdentityPreview } from '@theia/qaap-shared-core/lib/browser/qaap-dev-preview-client';
import { pickScopedPreviewClaim } from '@theia/qaap-shared-core/lib/browser/qaap-preview-claim-scope';
import {
    parseQaapIdentityPreviewRequestPath,
} from '@theia/qaap-shared-core/lib/common/qaap-dev-preview';
import { extractDevPreviewPortFromUrl } from '@theia/qaap-shared-core/lib/browser/qaap-transcript-preview-bootstrap';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { MobileSnackbar } from '@theia/qaap-mobile-shell/lib/browser/mobile-snackbar';
import { TRANSCRIPT_PREVIEW_IDENTITY_WATCH_MS } from './mobile-projects-transcript-surfaces-ui';

export async function tryMountVerifiedTranscriptPreviewExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, host: HTMLElement,
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
                resetTranscriptPreviewToEmptyExtracted(ctx, host, project, summary);
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
            if (ctx.transcriptPreviewProjectId === project.id && host.isConnected) {
                fallBackFromSupersededTranscriptPreviewExtracted(ctx, host, latestProject, summary, readyUrl);
            } else {
                ctx.clearMismatchedProjectPreviewUrl(latestProject, readyUrl);
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

/**
 * How the Preview tab probe should run: `fast` while a turn / request is actively producing the
 * dev server, `idle` (backed off) while the Preview tab sits empty but a dev server is still
 * expected after the agent finished, `undefined` to stop.
 */
export type TranscriptPreviewTabProbeMode = 'fast' | 'idle';

export function transcriptPreviewTabProbeModeExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        conv: QaapAgentConversationDTO,): TranscriptPreviewTabProbeMode | undefined {
        if (!ctx.matchesActivePreviewSummary(summary)) {
            return undefined;
        }
        const previewTabActive = ctx.host.executionSurfaceTabsUi.activeExecutionTab(project) === 'preview';
        if (previewTabActive && ctx.isTranscriptPreviewWaiting(conv, project)) {
            return 'fast';
        }
        if (conv.status === 'streaming'
            && (conversationShouldWatchDevPreview(conv, window.location.origin)
                || ctx.host.transcriptPreviewRequestPending)) {
            return 'fast';
        }
        return previewTabActive
            && ctx.executionPreviewHost()?.isConnected === true
            && transcriptPreviewShowsEmptyChrome(ctx)
            && isTranscriptPreviewDevServerExpectedExtracted(ctx, project, conv)
            ? 'idle'
            : undefined;
}

export function shouldKeepTranscriptPreviewTabProbeExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        conv: QaapAgentConversationDTO,): boolean {
        return transcriptPreviewTabProbeModeExtracted(ctx, project, summary, conv) !== undefined;
}

/** Nothing is mounted yet: the live chrome is the empty state (not a page, not a user-typed URL). */
function transcriptPreviewShowsEmptyChrome(ctx: MobileProjectsTranscriptSurfacesUiContext): boolean {
        const root = ctx.host.transcriptEmbeddedPreview?.root;
        return !root?.isConnected || root.classList.contains('theia-mod-empty-preview');
}

/**
 * A dev server may still come up for this project after the agent turn ended: the bootstrap run is
 * in flight, a preview URL / port is already known, or the conversation asked for a dev preview.
 */
export function isTranscriptPreviewDevServerExpectedExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry,
        conv: QaapAgentConversationDTO | undefined,): boolean {
        if (ctx.host.transcriptPreviewSuppressedByUser) {
            return false;
        }
        if (ctx.isProjectBootstrapPreviewActive()) {
            return true;
        }
        const latestProject = ctx.host.projects.find(candidate => candidate.id === project.id) ?? project;
        return !!latestProject.previewUrl
            || !!ctx.bootstrapPreviewUrlForProject(latestProject)
            || (!!conv && conversationShouldWatchDevPreview(conv, window.location.origin));
}

export async function discoverAndMountTranscriptPreviewIfReadyExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        const conv = ctx.host.transcriptLastConv;
        const host = ctx.executionPreviewHost();
        if (!conv || !host?.isConnected || !ctx.matchesActivePreviewSummary(summary)) {
            return;
        }
        if (ctx.host.executionSurfaceTabsUi.activeExecutionTab(project) !== 'preview') {
            return;
        }
        if (!ctx.isTranscriptPreviewWaiting(conv, project)
            && !isTranscriptPreviewDevServerExpectedExtracted(ctx, project, conv)) {
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

export async function fetchCurrentProjectClaimUrlExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry): Promise<string | undefined> {
        const cwd = ctx.host.projectsService.getProjectCwd(project)
            ?? ctx.host.preparedCwdByProjectId.get(project.id);
        let cwdUri: string | undefined;
        try {
            cwdUri = cwd ? FileUri.create(cwd).toString() : undefined;
        } catch {
            cwdUri = undefined;
        }
        // Scope to the open section so this surface never adopts another section's live claim.
        // Do not fall back to unscoped `/api/current`: that returns the newest project claim,
        // which can belong to a sibling section of the same project.
        const current = await fetchQaapCurrentDevPreview([
            cwdUri,
            project.uri?.toString(),
            project.id,
        ], ctx.previewScopeId());
        const claim = pickScopedPreviewClaim(current, ctx.previewScopeId());
        if (!claim?.ready || !claim.previewUrl) {
            return undefined;
        }
        if (ctx.bootstrapAppliesToProject(project)) {
            ctx.host.projectBootstrap?.adoptSupersedingPreviewClaim(claim);
        }
        return resolveTranscriptPreviewOpenUrl({
            candidateUrl: claim.previewUrl,
            project,
            bootstrap: ctx.host.projectBootstrap,
            appliesToProject: ctx.bootstrapAppliesToProject(project),
        });
}

export async function reconcileSupersededProjectPreviewUrlExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry,
        staleUrl: string,): Promise<string | undefined> {
        const currentUrl = await ctx.fetchCurrentProjectClaimUrl(project);
        if (!currentUrl || currentUrl === normalizePreviewUrlForSameOrigin(staleUrl)) {
            return undefined;
        }
        return currentUrl;
}

export function adoptReconciledProjectPreviewUrlExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry, previewUrl: string): MobileProjectEntry {
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

export function stopTranscriptPreviewIdentityWatchExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext): void {
        if (ctx.transcriptPreviewIdentityWatchTimer !== undefined) {
            window.clearTimeout(ctx.transcriptPreviewIdentityWatchTimer);
            ctx.transcriptPreviewIdentityWatchTimer = undefined;
        }
}

export function scheduleTranscriptPreviewIdentityWatchExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry): void {
        ctx.stopTranscriptPreviewIdentityWatch();
        ctx.transcriptPreviewIdentityWatchTimer = window.setTimeout(() => {
            ctx.transcriptPreviewIdentityWatchTimer = undefined;
            void ctx.verifyMountedTranscriptPreviewIdentity(project);
        }, TRANSCRIPT_PREVIEW_IDENTITY_WATCH_MS);
}

export async function verifyMountedTranscriptPreviewIdentityExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry): Promise<void> {
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
        const mountedUrl = ctx.mountedPreviewUrl(conversationScopeId) ?? ctx.getTranscriptEmbeddedPreviewUrl();
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

export function clearMismatchedProjectPreviewUrlExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry,
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

/**
 * Last resort once a superseded preview URL could not be reconciled with a live claim: forget the
 * stale URL and rediscover. The chrome goes through {@link resetTranscriptPreviewToEmptyExtracted},
 * so a URL the user is typing or navigated to by hand survives; when a live page does get blanked,
 * say so instead of leaving an unexplained empty Preview tab.
 */
export function fallBackFromSupersededTranscriptPreviewExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, host: HTMLElement,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        staleUrl: string,): void {
        const live = ctx.host.transcriptEmbeddedPreview?.root;
        const showedPage = !!live?.isConnected && host.contains(live) && !live.classList.contains('theia-mod-empty-preview');
        const cleared = ctx.clearMismatchedProjectPreviewUrl(project, staleUrl);
        const blanked = resetTranscriptPreviewToEmptyExtracted(ctx, host, cleared, summary);
        if (blanked && showedPage) {
            MobileSnackbar.show(nls.localize(
                'qaap/mobileProjects/previewSuperseded',
                'This preview was replaced by a newer run and is no longer available. Looking for the current one…',
            ), { kind: 'warning' });
        }
        void ctx.discoverAndMountTranscriptPreviewIfReady(cleared, summary);
}

export async function tryMountProjectScopedPreviewExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, host: HTMLElement,
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
            fallBackFromSupersededTranscriptPreviewExtracted(ctx, host, latestProject, summary, candidateUrl);
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

export function renderPreviewTabExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void {
        const host = ctx.executionPreviewHost();
        if (!host) {
            return;
        }
        if (ctx.host.transcriptPreviewSuppressedByUser) {
            resetTranscriptPreviewToEmptyExtracted(ctx, host, project, summary);
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

        resetTranscriptPreviewToEmptyExtracted(ctx, host, project, summary);
        ctx.scheduleTranscriptPreviewTabProbe(project, summary);
}

