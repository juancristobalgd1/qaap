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
import {
    classifyTranscriptPreviewLoss,
    decideTranscriptPreviewLiveness,
    TRANSCRIPT_PREVIEW_LIVENESS_MAX_PROBES,
    TRANSCRIPT_PREVIEW_LIVENESS_PROBE_SPACING_MS,
    TRANSCRIPT_PREVIEW_SHOWING_PAGE_FAILURES_TO_DEAD,
    type TranscriptPreviewLivenessVerdict,
} from './transcript-preview-liveness';
import type { QaapDevPreviewClaimState } from '@theia/qaap-shared-core/lib/common/qaap-dev-preview';

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

/** How long an idle-probe discovery miss (claim lookup + localhost port scan) is reused per project. */
export const TRANSCRIPT_PREVIEW_IDLE_DISCOVERY_TTL_MS = 15_000;

/**
 * Idle probe ticks come back every few seconds for as long as the Preview tab stays empty; share one
 * in-flight discovery and reuse a miss for {@link TRANSCRIPT_PREVIEW_IDLE_DISCOVERY_TTL_MS} instead of
 * re-running the claim lookup and port scan each tick. Hits are never cached (they get mounted).
 */
function discoverProjectDevPreviewUrlForIdleProbe(ctx: MobileProjectsTranscriptSurfacesUiContext,
        project: MobileProjectEntry): Promise<string | undefined> {
        const cache = ctx.transcriptPreviewIdleDiscovery;
        const cached = cache.get(project.id);
        if (cached && Date.now() - cached.at < TRANSCRIPT_PREVIEW_IDLE_DISCOVERY_TTL_MS) {
            return cached.result;
        }
        const entry = {
            at: Date.now(),
            result: ctx.discoverProjectDevPreviewUrl(project).catch(() => undefined),
        };
        cache.set(project.id, entry);
        void entry.result.then(url => {
            if (url && cache.get(project.id) === entry) {
                cache.delete(project.id);
            }
        });
        return entry.result;
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
        const waiting = ctx.isTranscriptPreviewWaiting(conv, project);
        if (!waiting && !isTranscriptPreviewDevServerExpectedExtracted(ctx, project, conv)) {
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
        const discovered = waiting
            ? await ctx.discoverProjectDevPreviewUrl(latestProject)
            : await discoverProjectDevPreviewUrlForIdleProbe(ctx, latestProject);
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
        return (await fetchCurrentProjectClaimStateExtracted(ctx, project)).url;
}

/** What `/api/current` says about this project's claim for the open section. */
export interface TranscriptCurrentProjectClaimState {
        /** Open URL of the current ready claim. */
        readonly url?: string;
        /** Open URL of a claim that exists but whose dev server is still within its start grace. */
        readonly bootingUrl?: string;
}

export async function fetchCurrentProjectClaimStateExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext,
        project: MobileProjectEntry): Promise<TranscriptCurrentProjectClaimState> {
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
            // A claim within its start grace answers `ready: false` with its URL; scope it like a ready one.
            const booting = current && !current.ready && current.readiness !== 'failed'
                ? pickScopedPreviewClaim({ ...current, ready: true }, ctx.previewScopeId())
                : undefined;
            return booting?.previewUrl ? { bootingUrl: normalizePreviewUrlForSameOrigin(booting.previewUrl) } : {};
        }
        if (ctx.bootstrapAppliesToProject(project)) {
            ctx.host.projectBootstrap?.adoptSupersedingPreviewClaim(claim);
        }
        return {
            url: resolveTranscriptPreviewOpenUrl({
                candidateUrl: claim.previewUrl,
                project,
                bootstrap: ctx.host.projectBootstrap,
                appliesToProject: ctx.bootstrapAppliesToProject(project),
            }),
        };
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
        ctx.transcriptPreviewIdentityVisibilityCleanup?.();
        ctx.transcriptPreviewIdentityVisibilityCleanup = undefined;
}

/** Ceiling for the identity watch once the mounted preview keeps answering healthy. */
export const TRANSCRIPT_PREVIEW_IDENTITY_WATCH_MAX_MS = 30_000;

/**
 * `healthy` grows the interval (8 s → 16 s → 30 s) after a check that found the mount alive (or a
 * hidden page that was not checked); any other call — a new mount, a dead claim — resets it to 8 s.
 */
export function scheduleTranscriptPreviewIdentityWatchExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry,
        healthy: boolean = false): void {
        ctx.stopTranscriptPreviewIdentityWatch();
        ctx.transcriptPreviewIdentityHealthyChecks = healthy ? ctx.transcriptPreviewIdentityHealthyChecks + 1 : 0;
        const delay = Math.min(
            TRANSCRIPT_PREVIEW_IDENTITY_WATCH_MS * 2 ** ctx.transcriptPreviewIdentityHealthyChecks,
            TRANSCRIPT_PREVIEW_IDENTITY_WATCH_MAX_MS,
        );
        ctx.transcriptPreviewIdentityWatchTimer = window.setTimeout(() => {
            ctx.stopTranscriptPreviewIdentityWatch();
            void ctx.verifyMountedTranscriptPreviewIdentity(project);
        }, delay);
        // Back in the tab after a while: the backed-off timer may be ~30 s out, and the run could
        // have been superseded meanwhile — check now and restart the backoff from 8 s.
        const doc = document;
        const onVisibilityChange = (): void => {
            if (doc.visibilityState !== 'visible') {
                return;
            }
            ctx.stopTranscriptPreviewIdentityWatch();
            ctx.transcriptPreviewIdentityHealthyChecks = 0;
            void ctx.verifyMountedTranscriptPreviewIdentity(project);
        };
        doc.addEventListener('visibilitychange', onVisibilityChange);
        ctx.transcriptPreviewIdentityVisibilityCleanup = () => doc.removeEventListener('visibilitychange', onVisibilityChange);
}

export async function verifyMountedTranscriptPreviewIdentityExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry): Promise<void> {
        const chrome = ctx.host.transcriptEmbeddedPreview;
        if (!chrome || !chrome.root.isConnected
            || ctx.transcriptPreviewProjectId !== project.id
            || chrome.root.classList.contains('theia-mod-empty-preview')) {
            return;
        }
        if (document.hidden) {
            ctx.scheduleTranscriptPreviewIdentityWatch(project, true);
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
            identityWatchFailures.delete(chrome.root);
            ctx.scheduleTranscriptPreviewIdentityWatch(project, true);
            return;
        }
        const state: QaapDevPreviewClaimState = probe.state ?? 'stopped';
        const states = [...identityWatchFailures.get(chrome.root) ?? [], state];
        identityWatchFailures.set(chrome.root, states);
        const verdict = decideTranscriptPreviewLiveness(states, {
            failuresToDead: TRANSCRIPT_PREVIEW_SHOWING_PAGE_FAILURES_TO_DEAD,
            maxProbes: Number.POSITIVE_INFINITY,
        });
        const latestProject = ctx.host.projects.find(candidate => candidate.id === project.id) ?? project;
        const hostElement = ctx.executionPreviewHost();
        const summary = ctx.host.transcriptOpenSummary;
        if (verdict === 'dead' && summary && hostElement?.isConnected) {
            identityWatchFailures.delete(chrome.root);
            await handleUnavailableTranscriptPreviewExtracted(ctx, hostElement, project, summary, latestProject, mountedUrl, 'dead');
            return;
        }
        if (state === 'stopped' || state === 'gone') {
            // Swap right away when a newer claim already serves the project; never blank on one probe.
            const reconciled = await ctx.reconcileSupersededProjectPreviewUrl(latestProject, mountedUrl);
            if (reconciled && stillMounted() && hostElement?.isConnected) {
                identityWatchFailures.delete(chrome.root);
                const adopted = ctx.adoptReconciledProjectPreviewUrl(latestProject, reconciled);
                ctx.mountTranscriptEmbeddedPreview(hostElement, reconciled, adopted);
                return;
            }
        }
        // Transient failure, a claim still booting, or not enough consecutive failures: keep watching.
        ctx.scheduleTranscriptPreviewIdentityWatch(project);
}

/** Identity-probe states since the mounted page last answered, per mounted preview chrome. */
const identityWatchFailures = new WeakMap<HTMLElement, QaapDevPreviewClaimState[]>();

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

/** Whether the Preview host currently shows a page (not the empty state). */
function transcriptPreviewShowsPage(ctx: MobileProjectsTranscriptSurfacesUiContext, host: HTMLElement): boolean {
        const live = ctx.host.transcriptEmbeddedPreview?.root;
        return !!live?.isConnected && host.contains(live) && !live.classList.contains('theia-mod-empty-preview');
}

/**
 * - `mismatch` — the preview answers but belongs to another project or run: rediscover.
 * - `stopped` — nothing serves the project any more: offer to restart its dev server.
 */
export type TranscriptPreviewFallbackCause = 'mismatch' | 'stopped';

/**
 * Last resort once a preview URL could not be reconciled with a live claim: forget the stale URL
 * and fall back to the empty state. The chrome goes through {@link resetTranscriptPreviewToEmptyExtracted},
 * so a URL the user is typing or navigated to by hand survives; when a live page does get blanked,
 * say why instead of leaving an unexplained empty Preview tab.
 */
export function fallBackFromSupersededTranscriptPreviewExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, host: HTMLElement,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        staleUrl: string,
        cause: TranscriptPreviewFallbackCause = 'mismatch',): void {
        const showedPage = transcriptPreviewShowsPage(ctx, host);
        const cleared = ctx.clearMismatchedProjectPreviewUrl(project, staleUrl);
        const blanked = resetTranscriptPreviewToEmptyExtracted(ctx, host, cleared, summary);
        if (cause === 'stopped') {
            if (blanked) {
                showTranscriptPreviewStatusOverlay(ctx, cleared, summary, 'stopped');
            }
            if (blanked && showedPage) {
                MobileSnackbar.show(transcriptPreviewStoppedMessage(), {
                    kind: 'warning',
                    duration: 6000,
                    actionLabel: transcriptPreviewRestartLabel(),
                    onAction: () => {
                        void ctx.requestTranscriptPreview(cleared, summary, { allowAgentFallback: false });
                    },
                });
            }
            // `/api/current` already found nothing: do not rediscover in a loop. The tab probe keeps
            // watching (with backoff) while a dev server is still expected for this project.
            ctx.scheduleTranscriptPreviewTabProbe(cleared, summary);
            return;
        }
        if (blanked && showedPage) {
            MobileSnackbar.show(nls.localize(
                'qaap/mobileProjects/previewSuperseded',
                'This preview was replaced by a newer run and is no longer available. Looking for the current one…',
            ), {
                kind: 'warning',
                duration: 6000,
                actionLabel: nls.localizeByDefault('Retry'),
                onAction: () => {
                    void retrySupersededTranscriptPreview(ctx, host, cleared, summary);
                },
            });
        }
        void ctx.discoverAndMountTranscriptPreviewIfReady(cleared, summary);
}

function transcriptPreviewStoppedMessage(): string {
        return nls.localize('qaap/mobileProjects/previewDevServerStopped', 'The dev server for this project stopped.');
}

function transcriptPreviewRestartLabel(): string {
        return nls.localize('qaap/mobileProjects/previewRestartDevServer', 'Restart dev server');
}

/**
 * Explains an empty Preview tab: `starting` while a claim boots (or the backend cold-starts),
 * `stopped` with a "Restart dev server" action once nothing serves the project.
 */
function showTranscriptPreviewStatusOverlay(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        kind: 'starting' | 'stopped',): void {
        const root = ctx.host.transcriptEmbeddedPreview?.root;
        if (!root?.isConnected || !root.classList.contains('theia-mod-empty-preview')) {
            return;
        }
        const frameSlot = root.querySelector<HTMLElement>('.qaap-preview-frame-slot')
            ?? root.querySelector<HTMLElement>('.qaap-preview-content-area')
            ?? root;
        frameSlot.querySelector('.theia-mobile-transcript-preview-empty-overlay')?.remove();
        const overlay = document.createElement('div');
        overlay.className = `theia-mobile-transcript-preview-empty-overlay theia-mod-preview-${kind}`;
        const wrap = document.createElement('div');
        wrap.className = 'theia-mobile-transcript-preview-empty';
        const note = document.createElement('div');
        note.className = 'theia-mobile-transcript-preview-ready';
        const title = document.createElement('div');
        title.className = 'theia-mobile-transcript-preview-ready-title';
        const hint = document.createElement('p');
        hint.className = 'theia-mobile-transcript-preview-ready-hint';
        note.append(title, hint);
        if (kind === 'starting') {
            title.textContent = nls.localize('qaap/mobileProjects/previewStarting', 'Starting preview…');
            hint.textContent = nls.localize(
                'qaap/mobileProjects/previewStartingHint',
                'The dev server is starting. The preview opens here as soon as it responds.',
            );
        } else {
            title.textContent = transcriptPreviewStoppedMessage();
            hint.textContent = nls.localize(
                'qaap/mobileProjects/previewDevServerStoppedHint',
                'It may have crashed, been restarted, or stopped while the workspace was idle.',
            );
            const restart = document.createElement('button');
            restart.type = 'button';
            restart.className = 'theia-mobile-transcript-preview-ready-open';
            restart.textContent = transcriptPreviewRestartLabel();
            restart.addEventListener('click', () => {
                restart.disabled = true;
                void ctx.requestTranscriptPreview(project, summary, { allowAgentFallback: false });
            });
            note.append(restart);
        }
        wrap.append(note);
        overlay.append(wrap);
        frameSlot.append(overlay);
}

/**
 * Probes an identity claim until {@link decideTranscriptPreviewLiveness} has a verdict: a page that
 * is showing needs consecutive definitive failures before it counts as dead, and transient failures
 * never do. `undefined` when `isCurrent` turned false meanwhile.
 */
async function assessTranscriptPreviewLiveness(previewId: string,
        showsPage: boolean,
        isCurrent: () => boolean,): Promise<Exclude<TranscriptPreviewLivenessVerdict, 'probe-again'> | undefined> {
        const states: QaapDevPreviewClaimState[] = [];
        for (;;) {
            const probe = await probeQaapIdentityPreview(previewId);
            if (!isCurrent()) {
                return undefined;
            }
            states.push(probe.ready ? 'ready' : probe.state ?? 'stopped');
            const verdict = decideTranscriptPreviewLiveness(states, {
                failuresToDead: showsPage ? TRANSCRIPT_PREVIEW_SHOWING_PAGE_FAILURES_TO_DEAD : 1,
                maxProbes: TRANSCRIPT_PREVIEW_LIVENESS_MAX_PROBES,
            });
            if (verdict !== 'probe-again') {
                return verdict;
            }
            await new Promise(resolve => window.setTimeout(resolve, TRANSCRIPT_PREVIEW_LIVENESS_PROBE_SPACING_MS));
            if (!isCurrent()) {
                return undefined;
            }
        }
}

/**
 * The stored preview did not answer. Ask `/api/current` what serves the project now and act on the
 * cause: swap silently to a newer claim, show "Starting preview…" while a claim boots, or explain
 * that the dev server stopped and offer to restart it. A page that is showing is only blanked once
 * its claim is dead and nothing replaces it.
 */
export async function handleUnavailableTranscriptPreviewExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, host: HTMLElement,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        latestProject: MobileProjectEntry,
        staleUrl: string,
        verdict: Exclude<TranscriptPreviewLivenessVerdict, 'ready' | 'probe-again'>,): Promise<void> {
        const claim: TranscriptCurrentProjectClaimState = await fetchCurrentProjectClaimStateExtracted(ctx, latestProject)
            .catch(() => ({}));
        if (ctx.transcriptPreviewProjectId !== project.id || !host.isConnected) {
            return;
        }
        const cause = classifyTranscriptPreviewLoss({
            verdict,
            staleUrl: normalizePreviewUrlForSameOrigin(staleUrl),
            currentClaimUrl: claim.url ? normalizePreviewUrlForSameOrigin(claim.url) : undefined,
            currentClaimBooting: !!claim.bootingUrl,
        });
        if (cause === 'superseded' && claim.url) {
            const adopted = ctx.adoptReconciledProjectPreviewUrl(latestProject, claim.url);
            void ctx.tryMountProjectScopedPreview(host, project, summary, adopted, claim.url);
            return;
        }
        if (cause === 'stopped') {
            fallBackFromSupersededTranscriptPreviewExtracted(ctx, host, latestProject, summary, staleUrl, 'stopped');
            return;
        }
        // Starting. A successor claim that is still booting replaces the dead one, so the tab probe
        // (which remounts the stored URL once it answers) follows the successor.
        let pending = latestProject;
        if (verdict === 'dead' && claim.bootingUrl) {
            pending = { ...latestProject, previewUrl: claim.bootingUrl };
            const updated = pending;
            ctx.host.projects = ctx.host.projects.map(candidate => candidate.id === updated.id ? updated : candidate);
            if (ctx.host.transcriptOpenProject?.id === updated.id) {
                ctx.host.transcriptOpenProject = updated;
            }
        }
        if (transcriptPreviewShowsPage(ctx, host)) {
            // Keep the page the user is looking at; the identity watch escalates if it stays down.
            ctx.scheduleTranscriptPreviewIdentityWatch(project);
            return;
        }
        if (resetTranscriptPreviewToEmptyExtracted(ctx, host, pending, summary)) {
            showTranscriptPreviewStatusOverlay(ctx, pending, summary, 'starting');
        }
        ctx.scheduleTranscriptPreviewTabProbe(pending, summary);
}

/** Snackbar "Retry": look the project's live preview up again and mount it, bypassing the idle-probe cache. */
async function retrySupersededTranscriptPreview(ctx: MobileProjectsTranscriptSurfacesUiContext, host: HTMLElement,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        ctx.transcriptPreviewIdleDiscovery.delete(project.id);
        // A newer tap supersedes the scan an earlier one started.
        ctx.transcriptPreviewRetryScan?.abort();
        const scan = new AbortController();
        ctx.transcriptPreviewRetryScan = scan;
        const latestProject = ctx.host.projects.find(candidate => candidate.id === project.id) ?? project;
        const url = await ctx.discoverProjectDevPreviewUrl(latestProject, scan.signal).catch(() => undefined);
        if (scan.signal.aborted) {
            return;
        }
        ctx.transcriptPreviewRetryScan = undefined;
        if (!host.isConnected || ctx.transcriptPreviewProjectId !== project.id) {
            return;
        }
        if (!url) {
            // Nothing is serving this project any more: offer to start its dev server again
            // (bootstrap only — never hand the request to the agent from a snackbar tap).
            MobileSnackbar.show(nls.localize(
                'qaap/mobileProjects/previewSupersededRetryMissing',
                'No running preview was found for this project.',
            ), {
                kind: 'warning',
                duration: 6000,
                actionLabel: transcriptPreviewRestartLabel(),
                onAction: () => {
                    void ctx.requestTranscriptPreview(latestProject, summary, { allowAgentFallback: false });
                },
            });
            return;
        }
        const adopted = ctx.adoptReconciledProjectPreviewUrl(latestProject, url);
        void ctx.tryMountProjectScopedPreview(host, project, summary, adopted, url);
}

export async function tryMountProjectScopedPreviewExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, host: HTMLElement,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        latestProject: MobileProjectEntry,
        candidateUrl: string,): Promise<void> {
        if (ctx.transcriptPreviewProjectId !== project.id || !host.isConnected) {
            return;
        }
        let candidateIdentity: ReturnType<typeof parseQaapIdentityPreviewRequestPath>;
        try {
            candidateIdentity = parseQaapIdentityPreviewRequestPath(new URL(candidateUrl, window.location.href).pathname);
        } catch {
            candidateIdentity = undefined;
        }
        if (candidateIdentity) {
            // A claim that does not answer is not necessarily superseded: its dev server may be
            // booting, stopped (idle tenant, redeploy, crash) or the backend briefly unreachable.
            const verdict = await assessTranscriptPreviewLiveness(
                candidateIdentity.previewId,
                transcriptPreviewShowsPage(ctx, host),
                () => ctx.transcriptPreviewProjectId === project.id && host.isConnected,
            );
            if (verdict === undefined) {
                return;
            }
            if (verdict !== 'ready') {
                await handleUnavailableTranscriptPreviewExtracted(ctx, host, project, summary, latestProject, candidateUrl, verdict);
                return;
            }
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

