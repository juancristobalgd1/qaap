import type { MobileProjectsTranscriptSurfacesUiContext } from './mobile-projects-transcript-surfaces-ui-context';
// Extracted from mobile-projects-transcript-surfaces-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { invalidateVerifyWorkspaceSnapshots } from '@theia/qaap-diff-review/lib/common/qaap-verify-commit-readiness';
import { FileUri } from '@theia/core/lib/common/file-uri';
import {
    mountEmbeddedAgentPreviewChrome,
} from '@theia/qaap-adapters/lib/browser/qaap-agent-preview-chrome';
import { normalizePreviewUrlForSameOrigin } from '@theia/qaap-adapters/lib/browser/qaap-preview-url-utils';
import { resolveTranscriptPreviewOpenUrl } from '@theia/qaap-transcript/lib/browser/qaap-transcript-preview-effective-url';
import {
    type QaapAgentConversationSummaryDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { reconcileAgentApprovalPolicyId } from '@theia/qaap-shared-core/lib/common/qaap-sticky-composer-approval-policy';
import {
    buildQaapPreviewId,
    type QaapPreviewIdentity,
} from '@theia/qaap-shared-core/lib/common/qaap-preview-identity';
import { MobileSnackbar } from '@theia/qaap-mobile-mechanics/lib/browser/mobile-snackbar';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { createTranscriptReviewChrome } from '@theia/qaap-transcript/lib/browser/qaap-transcript-review-chrome';

export async function mountTranscriptReviewWidgetExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        const host = ctx.host.transcriptReviewHost;
        if (!host || !ctx.host.createDiffReviewWidget) {
            return;
        }
        const cwd = summary.cwd ?? ctx.host.projectsService.getProjectCwd(project);
        if (!cwd) {
            host.replaceChildren();
            const note = document.createElement('div');
            note.className = 'theia-mobile-transcript-review-note';
            note.textContent = nls.localize(
                'qaap/mobileProjects/reviewUnavailable',
                'Review is unavailable for this conversation (no workspace path).',
            );
            host.append(note);
            return;
        }
        const chrome = createTranscriptReviewChrome(
            host,
            ctx.host.transcriptHistoryPanelOpen,
            ctx.host.transcriptHistoryPanelHeightPx,
        );
        const { diffHost, historyToggleHost, historyResizeHandle, historyPanel } = chrome;
        ctx.host.transcriptReviewDiffHost = diffHost;
        ctx.host.transcriptHistoryRoot = cwd;
        ctx.transcriptHistoryUi.installTranscriptHistoryResize(historyResizeHandle, historyPanel, host);

        // A VPS task's summary.cwd is authoritative and can point at an isolated worktree.
        const rootUri = FileUri.create(cwd).toString();
        if (!ctx.host.diffReviewWidget) {
            ctx.host.diffReviewWidget = await ctx.host.createDiffReviewWidget();
        }
        if (ctx.host.transcriptReviewHost !== host || !diffHost.isConnected) {
            return;
        }
        ctx.host.diffReviewWidget.enableTranscriptEmbed({ externalChrome: true });
        ctx.host.diffReviewWidget.node.classList.add('theia-mobile-transcript-diff-embed');
        ctx.host.diffReviewWidget.setTranscriptAgentFeedbackHandler(async message => {
            await ctx.submitTranscriptReviewFeedback(project, summary, message);
        });
        ctx.host.diffReviewWidget.setTranscriptCloseHandler(() => {
            ctx.host.executionSurfaceTabsUi.selectTranscriptTab('messages', project, summary);
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
            },
        );
        ctx.transcriptHistoryUi.renderTranscriptHistoryToggle(historyToggleHost, historyPanel, historyResizeHandle, cwd);
        ctx.transcriptHistoryUi.renderTranscriptHistoryPanel(historyPanel, cwd);
}

export async function submitTranscriptReviewFeedbackExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        message: string,): Promise<void> {
        const chatHost = ctx.host.transcriptChatHost;
        if (!chatHost) {
            return;
        }
        try {
            await ctx.host.submitTranscriptViaBackendConversation(project, summary, message, {
                selectedAgentId: ctx.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary),
                modeId: ctx.host.transcriptComposerModeId,
                approvalPolicyId: reconcileAgentApprovalPolicyId(
                    ctx.host.transcriptComposerApprovalPolicyId,
                    summary.cwd,
                ),
            });
            ctx.host.executionSurfaceTabsUi.selectTranscriptTab('messages', project, summary);
        } catch (error) {
            ctx.host.messageService?.error(error instanceof Error ? error.message : String(error));
        }
}

export function detachTranscriptReviewWidgetExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext): void {
        const diffHost = ctx.host.transcriptReviewDiffHost;
        if (ctx.host.diffReviewWidget?.isAttached && diffHost?.contains(ctx.host.diffReviewWidget.node)) {
            ctx.host.detachDiffReviewWidgetFromHost();
            ctx.host.diffReviewWidget.node.classList.remove('theia-mobile-transcript-diff-embed');
        }
        ctx.host.diffReviewWidget?.setTranscriptAgentFeedbackHandler(undefined);
        ctx.host.diffReviewWidget?.setTranscriptCloseHandler(undefined);
        ctx.host.diffReviewWidget?.setReviewStatsChangeHandler(undefined);
        ctx.host.transcriptReviewDiffHost = undefined;
        ctx.host.transcriptReviewChecksHost = undefined;
        ctx.host.transcriptHistoryRoot = undefined;
        ctx.host.transcriptHistoryLoading = false;
}

export function getOrCreateOffscreenPreviewHostExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext): HTMLElement {
        if (!ctx.offscreenPreviewHostElement) {
            const host = document.createElement('div');
            host.id = 'qaap-preview-offscreen-host';
            host.style.display = 'none';
            document.body.appendChild(host);
            ctx.offscreenPreviewHostElement = host;
        }
        return ctx.offscreenPreviewHostElement;
}

export function disposeTranscriptEmbeddedPreviewExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, conversationScopeId?: string): void {
        const targetScopeId = conversationScopeId ?? ctx.transcriptPreviewConversationScopeId;
        ctx.stopTranscriptPreviewIdentityWatch();
        if (targetScopeId) {
            const cached = ctx.embeddedPreviewByConversationScopeId.get(targetScopeId);
            if (cached) {
                cached.dispose();
                ctx.embeddedPreviewByConversationScopeId.delete(targetScopeId);
            }
            if (ctx.host.transcriptEmbeddedPreview === cached) {
                ctx.host.transcriptEmbeddedPreview = undefined;
            }
            ctx.setMountedPreviewUrl(targetScopeId, undefined);
        } else if (ctx.host.transcriptEmbeddedPreview) {
            ctx.host.transcriptEmbeddedPreview.dispose();
            ctx.host.transcriptEmbeddedPreview = undefined;
        }
}

export function disposePreviewForConversationExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, summary: Pick<QaapAgentConversationSummaryDTO, 'id'>): void {
        const scopeId = ctx.previewScopeId(summary);
        if (!scopeId) {
            return;
        }
        ctx.disposeTranscriptEmbeddedPreview(scopeId);
        ctx.clearPreviewRuntimeForConversation(scopeId);
}

export function disposeTranscriptTerminalSlidesForConversationExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,): void {
        const workspaceKey = ctx.resolveTranscriptWorkspaceKey(project, summary);
        if (workspaceKey) {
            ctx.disposeTranscriptTerminalSlides(workspaceKey);
        }
}

export function suspendTranscriptPreviewIframeExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext): void {
        ctx.stopTranscriptPreviewIdentityWatch();
        const chrome = ctx.host.transcriptEmbeddedPreview;
        if (!chrome) {
            return;
        }
        const conversationScopeId = ctx.transcriptPreviewConversationScopeId;
        const isEmptyPlaceholder = chrome.root.classList.contains('theia-mod-empty-preview');
        const stagedUrl = (conversationScopeId ? ctx.mountedPreviewUrl(conversationScopeId) : undefined)
            ?? ctx.getTranscriptEmbeddedPreviewUrl();

        if (conversationScopeId && !isEmptyPlaceholder) {
            const offscreen = ctx.getOrCreateOffscreenPreviewHost();
            offscreen.appendChild(chrome.root);
            if (stagedUrl) {
                ctx.setProbeReadyPreviewUrl(conversationScopeId, stagedUrl);
            }
        } else {
            chrome.dispose();
            if (conversationScopeId) {
                ctx.embeddedPreviewByConversationScopeId.delete(conversationScopeId);
                ctx.setMountedPreviewUrl(conversationScopeId, undefined);
            }
        }
        ctx.host.transcriptEmbeddedPreview = undefined;
        ctx.executionPreviewHost()?.replaceChildren();
}

export function clearTranscriptEmptyPreviewChromeExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext): void {
        const root = ctx.host.transcriptEmbeddedPreview?.root;
        if (!root?.classList.contains('theia-mod-empty-preview')) {
            return;
        }
        root.classList.remove('theia-mod-empty-preview');
        root.querySelector('.theia-mobile-transcript-preview-empty-overlay')?.remove();
}

export function getTranscriptEmbeddedPreviewUrlExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext): string | undefined {
        const chrome = ctx.host.transcriptEmbeddedPreview;
        if (!chrome) {
            return undefined;
        }
        const input = chrome.root.querySelector<HTMLInputElement>('.theia-mini-browser-url-field input');
        const raw = input?.value?.trim();
        return raw ? normalizePreviewUrlForSameOrigin(raw) : undefined;
}

export function mountTranscriptEmbeddedPreviewExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, host: HTMLElement,
        previewUrl: string,
        project: MobileProjectEntry,
        summary?: QaapAgentConversationSummaryDTO,): void {
        const normalized = resolveTranscriptPreviewOpenUrl({
            candidateUrl: previewUrl,
            project,
            bootstrap: ctx.host.projectBootstrap,
            appliesToProject: ctx.bootstrapAppliesToProject(project),
        });
        const conversationScopeId = ctx.previewScopeId(summary);

        if (ctx.transcriptPreviewConversationScopeId && ctx.transcriptPreviewConversationScopeId !== conversationScopeId) {
            ctx.suspendTranscriptPreviewIframe();
        }

        ctx.transcriptPreviewProjectId = project.id;
        ctx.transcriptPreviewConversationScopeId = conversationScopeId;
        ctx.scheduleTranscriptPreviewIdentityWatch(project);

        let chrome = ctx.embeddedPreviewByConversationScopeId.get(conversationScopeId);
        if (chrome) {
            ctx.host.transcriptEmbeddedPreview = chrome;
            ctx.clearTranscriptEmptyPreviewChrome();
            const root = chrome.root;
            const current = ctx.getTranscriptEmbeddedPreviewUrl();
            if (!host.contains(root)) {
                host.replaceChildren(root);
            }
            if (current !== normalized) {
                chrome.setUrl(normalized);
            }
            ctx.wireTranscriptPreviewAnnotationScope(project, normalized);
            ctx.setMountedPreviewUrl(conversationScopeId, normalized);
            ctx.syncHeaderPreviewRunButton(project, summary);
            return;
        }

        chrome = mountEmbeddedAgentPreviewChrome(host, {
            url: normalized,
            historyScope: project.id,
            messageService: ctx.host.messageService,
            clipboard: ctx.host.previewClipboard,
            previewSurfaces: ctx.host.previewSurfaceRegistry,
            inspectorDeps: ctx.host.previewInspectorDeps,
            notify: (message, kind) => {
                MobileSnackbar.show(message, { kind: kind === 'warn' ? 'warning' : 'success' });
            },
            openExternal: target => {
                window.open(target, '_blank', 'noopener,noreferrer');
            },
            getAnnotationScope: () => ctx.resolvePreviewAnnotationScope(project, normalized),
            composerSession: ctx.host.resolveAnnotationComposerSession(),
        });
        ctx.embeddedPreviewByConversationScopeId.set(conversationScopeId, chrome);
        ctx.host.transcriptEmbeddedPreview = chrome;
        ctx.wireTranscriptPreviewAnnotationScope(project, normalized);
        ctx.setMountedPreviewUrl(conversationScopeId, normalized);
        ctx.syncHeaderPreviewRunButton(project, summary);
}

export function wireTranscriptPreviewAnnotationScopeExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry, previewUrl: string): void {
        const frame = ctx.host.transcriptEmbeddedPreview?.frame;
        const surface = ctx.host.previewSurfaceRegistry?.getSurfaceForFrame(frame);
        surface?.picker.setAnnotationScopeProvider(() => ctx.resolvePreviewAnnotationScope(project, previewUrl));
        surface?.picker.setComposerSession(ctx.host.resolveAnnotationComposerSession());
}

export function resolvePreviewAnnotationScopeExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry, previewUrl: string): {
        previewId: string;
        workspaceId: string;
        threadId: string;
        previewUrl: string;
        route: string;
        viewportMode: 'desktop' | 'mobile';
        viewportWidth: number;
        viewportHeight: number;
    } {
        const live = ctx.getTranscriptEmbeddedPreviewUrl() || previewUrl;
        let stablePreviewUrl = previewUrl;
        let route = '/';
        try {
            const parsed = new URL(live, window.location.href);
            stablePreviewUrl = parsed.origin;
            route = `${parsed.pathname || '/'}${parsed.search || ''}${parsed.hash || ''}`;
        } catch {
            route = '/';
        }
        const narrow = typeof matchMedia === 'function'
            && matchMedia('(max-width: 767px), (pointer: coarse)').matches;
        const frame = ctx.host.transcriptEmbeddedPreview?.frame;
        const identity = ctx.resolveTranscriptPreviewIdentity(project, ctx.host.transcriptOpenSummary);
        return {
            previewId: buildQaapPreviewId(identity),
            workspaceId: project.id,
            threadId: ctx.host.transcriptOpenSummaryId
                ?? ctx.host.transcriptLastConv?.id
                ?? 'default',
            previewUrl: stablePreviewUrl,
            route,
            viewportMode: narrow ? 'mobile' : 'desktop',
            viewportWidth: frame?.clientWidth || window.innerWidth,
            viewportHeight: frame?.clientHeight || window.innerHeight,
        };
}

export function resolveTranscriptPreviewIdentityExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO | undefined,): QaapPreviewIdentity {
        const conversationId = summary?.id
            ?? ctx.host.transcriptOpenSummaryId
            ?? ctx.host.transcriptLastConv?.id
            ?? 'default';
        const conversation = ctx.host.transcriptLastConv?.id === conversationId
            ? ctx.host.transcriptLastConv
            : undefined;
        const runId = ctx.bootstrapAppliesToProject(project)
            ? ctx.host.projectBootstrap?.getStateSnapshot().previewRunId
            : undefined;
        const fallbackRunId = [...(conversation?.messages ?? [])].reverse()
            .find(message => message.role === 'user' && !!message.taskId)?.taskId
            ?? `turn-${summary?.turnStartedAt ?? summary?.updatedAt ?? conversation?.updatedAt ?? 0}`;
        return { projectId: project.id, conversationId, runId: runId ?? fallbackRunId };
}

export async function claimTranscriptPreviewExecutionExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, _project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        port: number,
        fallbackUrl: string,): Promise<string | undefined> {
        const bootstrap = ctx.host.projectBootstrap;
        if (!bootstrap) {
            return undefined;
        }
        // claimPreviewExecution allocates a per-conversation processId; do not require the
        // previous section's global process UUID or section B would never reserve its own preview.
        const claim = await bootstrap.claimPreviewExecution(port, summary.id);
        return claim.kind === 'claimed' ? claim.previewUrl ?? fallbackUrl : undefined;
}
