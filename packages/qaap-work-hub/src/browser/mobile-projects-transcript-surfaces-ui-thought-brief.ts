import type { MobileProjectsTranscriptSurfacesUiContext } from './mobile-projects-transcript-surfaces-ui-context';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { normalizePreviewUrlForSameOrigin } from '@theia/qaap-adapters/lib/browser/qaap-preview-url-utils';
import { resolveTranscriptPreviewOpenUrl } from '@theia/qaap-transcript/lib/browser/qaap-transcript-preview-effective-url';
import {
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import {
    conversationShouldWatchDevPreview,
    findTranscriptPreviewUrlFromConversation,
    previewPageTitleMatchesProjectName,
} from '@theia/qaap-shared-core/lib/common/qaap-transcript-preview-offer';
import { probeQaapDevPreviewPort, probeQaapIdentityPreview } from '@theia/qaap-shared-core/lib/browser/qaap-dev-preview-client';
import {
    findQaapIdentityPreviewUrl,
    isLocalQaapPreviewOrigin,
    parseQaapDevPreviewRequestPath,
    parseQaapIdentityPreviewRequestPath,
    resolveDevPreviewPublicOrigin,
} from '@theia/qaap-shared-core/lib/common/qaap-dev-preview';
import {
    claimedPreviewCoordinatesMatchProject,
} from '@theia/qaap-shared-core/lib/common/qaap-preview-identity';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import {
    markTranscriptTerminalRestorable,
} from '@theia/qaap-transcript/lib/browser/qaap-transcript-terminal-view';
import {
    type TranscriptWorkspaceSurfaceKey,
} from '@theia/qaap-transcript-overlay/lib/browser/qaap-transcript-workspace-surfaces-cache';

export function disposeTranscriptTerminalSlidesExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, workspaceKey?: TranscriptWorkspaceSurfaceKey): void {
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

export function prepareTranscriptTerminalsForPageUnloadExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext): void {
        for (const [workspaceKey, state] of ctx.host.transcriptTerminalSlidesByWorkspace) {
            for (const surface of state.surfaces) {
                if (!surface.terminal.isDisposed) {
                    markTranscriptTerminalRestorable(surface.terminal);
                }
            }
            void ctx.persistTranscriptTerminalWorkspace(workspaceKey);
        }
}

export async function syncTranscriptPreviewFromConversationExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry,
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

export async function refreshTranscriptPreviewProjectExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry, summary?: QaapAgentConversationSummaryDTO): Promise<MobileProjectEntry> {
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

export async function previewUrlMatchesProjectExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, previewUrl: string, project: MobileProjectEntry): Promise<boolean> {
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

/** Parallel probes during the localhost dev-port scan; enough to stay fast without a request burst. */
export const DEV_PREVIEW_PORT_SCAN_CONCURRENCY = 4;

/**
 * Runs `probe` over `items` with at most `concurrency` in flight and resolves with the result of the
 * earliest item (in list order) that produced one — the same answer as probing everything and taking
 * the first hit — without starting items once a higher-priority hit is settled.
 */
export async function firstInPriorityOrder<T, R>(
    items: readonly T[],
    concurrency: number,
    probe: (item: T) => Promise<R | undefined>,
): Promise<R | undefined> {
    const results: Array<Promise<R | undefined>> = [];
    let settled = false;
    const launch = (): void => {
        const index = results.length;
        results.push(probe(items[index]).catch(() => undefined).then(result => {
            // Each finished probe frees a slot for the next item until the answer is known.
            if (!settled && results.length < items.length) {
                launch();
            }
            return result;
        }));
    };
    for (let i = 0; i < Math.min(concurrency, items.length); i++) {
        launch();
    }
    for (let index = 0; index < items.length; index++) {
        const result = await results[index];
        if (result !== undefined) {
            settled = true;
            return result;
        }
    }
    return undefined;
}

export async function discoverProjectDevPreviewUrlExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry): Promise<string | undefined> {
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
        const previewUrl = await firstInPriorityOrder(ports, DEV_PREVIEW_PORT_SCAN_CONCURRENCY, async port => {
            const probe = await probeQaapDevPreviewPort(port);
            if (!probe.ready || !await ctx.previewUrlMatchesProject(probe.previewUrl, project)) {
                return undefined;
            }
            return normalizePreviewUrlForSameOrigin(probe.previewUrl);
        });
        if (previewUrl) {
            void ctx.host.projectsService.recordProjectPreviewUrl(project, previewUrl);
        }
        return previewUrl;
}

export function beginTranscriptDevPreviewRequestExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void {
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
        ctx.host.transcriptStickyComposerUi?.refreshComposerActivityStack?.();
}

export function resolveTranscriptPreviewUrlExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry,
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
