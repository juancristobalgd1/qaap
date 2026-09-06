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

export function stopTranscriptPreviewTabProbeExtracted(ctx: any): void {
    if (ctx.transcriptPreviewProbeTimer !== undefined) {
        window.clearTimeout(ctx.transcriptPreviewProbeTimer);
        ctx.transcriptPreviewProbeTimer = undefined;
    }
}

export function scheduleTranscriptPreviewTabProbeExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    conv: QaapAgentConversationDTO | undefined,): void {
    ctx.stopTranscriptPreviewTabProbe();
    if (!conv || !ctx.shouldKeepTranscriptPreviewTabProbe(project, summary, conv)) {
        return;
    }
    ctx.transcriptPreviewProbeTimer = window.setTimeout(() => {
        ctx.transcriptPreviewProbeTimer = undefined;
        void ctx.refreshTranscriptPreviewTabProbe(project, summary);
    }, 900);
}

export async function refreshTranscriptPreviewTabProbeExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    const conv = ctx.host.transcriptLastConv;
    if (!conv || !ctx.matchesActivePreviewSummary(summary)) {
        return;
    }
    try {
        const conversationScopeId = ctx.previewScopeId(summary);
        const readyUrl = await resolveReadyTranscriptPreviewUrlFromProbe(
            conv,
            port => probeQaapDevPreviewPort(port),
            window.location.origin,
        );
        const normalized = readyUrl ? normalizePreviewUrlForSameOrigin(readyUrl) : undefined;
        if (normalized && await ctx.previewUrlMatchesProject(normalized, project)) {
            ctx.setProbeReadyPreviewUrl(conversationScopeId, normalized);
            const latestProject = ctx.host.projects.find(candidate => candidate.id === project.id) ?? project;
            const updatedProject = { ...latestProject, previewUrl: normalized };
            ctx.host.projects = ctx.host.projects.map(candidate => candidate.id === updatedProject.id
                ? updatedProject
                : candidate);
            ctx.host.transcriptOpenProject = ctx.host.transcriptOpenProject?.id === updatedProject.id
                ? updatedProject
                : ctx.host.transcriptOpenProject;
            void ctx.host.projectsService.recordProjectPreviewUrl(updatedProject, normalized).catch(() => undefined);
            // Never auto-switch to Preview. If the user is already on that tab, mount the
            // iframe in place; otherwise only stage the Open-preview pill / ready offer.
            if (ctx.host.executionSurfaceTabsUi.activeExecutionTab(project) === 'preview') {
                const host = ctx.executionPreviewHost();
                if (host) {
                    void ctx.tryMountProjectScopedPreview(host, project, summary, updatedProject, normalized);
                }
            } else {
                ctx.stageTranscriptPreviewReadyUrl(conversationScopeId, normalized);
            }
        } else if (ctx.host.executionSurfaceTabsUi.activeExecutionTab(project) === 'preview') {
            ctx.updateTranscriptPreviewRunButtonState(conv);
            void ctx.discoverAndMountTranscriptPreviewIfReady(project, summary);
        }
    } catch {
        /* best-effort */
    } finally {
        if (ctx.shouldKeepTranscriptPreviewTabProbe(project, summary, conv)) {
            ctx.scheduleTranscriptPreviewTabProbe(project, summary, conv);
        }
    }
}

export function updateTranscriptPreviewReadyOverlayExtracted(ctx: any, previewUrl: string): void {
    const host = ctx.host.transcriptEmbeddedPreview?.root;
    const overlay = host?.querySelector('.theia-mobile-transcript-preview-empty-overlay');
    if (!overlay || !host?.classList.contains('theia-mod-empty-preview')) {
        return;
    }
    let ready = overlay.querySelector('.theia-mobile-transcript-preview-ready') as HTMLElement | null;
    if (!ready) {
        ready = document.createElement('div');
        ready.className = 'theia-mobile-transcript-preview-ready';
        const title = document.createElement('div');
        title.className = 'theia-mobile-transcript-preview-ready-title';
        title.textContent = nls.localize('qaap/projectBootstrap/previewTransportReady', 'Dev server reachable');
        const hint = document.createElement('p');
        hint.className = 'theia-mobile-transcript-preview-ready-hint';
        hint.textContent = nls.localize(
            'qaap/mobileProjects/previewReadyHint',
            'The HTTP transport is responding. Open the preview to render and verify the app.',
        );
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'theia-mobile-transcript-preview-ready-open';
        open.textContent = nls.localize('qaap/mobileProjects/openPreview', 'Open preview');
        open.addEventListener('click', () => {
            void ctx.host.transcriptMessagesUi.openTranscriptPreviewUrlFromLink(previewUrl);
        });
        ready.append(title, hint, open);
        overlay.append(ready);
    }
    const openButton = ready.querySelector('.theia-mobile-transcript-preview-ready-open');
    if (openButton instanceof HTMLButtonElement) {
        openButton.onclick = () => {
            void ctx.host.transcriptMessagesUi.openTranscriptPreviewUrlFromLink(previewUrl);
        };
    }
}

export function isTranscriptPreviewWaitingExtracted(ctx: any, conv: QaapAgentConversationDTO | undefined,
    project: MobileProjectEntry | undefined,): boolean {
    if (ctx.host.transcriptPreviewSuppressedByUser) {
        return false;
    }
    if (ctx.host.transcriptPreviewRequestRunning || ctx.host.transcriptPreviewRequestPending) {
        return true;
    }
    // A bootstrap install/dev run outlives the agent turn; keep waiting (and probing) until
    // its preview is actually mounted instead of falling back to the idle play button.
    if (ctx.isProjectBootstrapPreviewActive()
        && project
        && !ctx.mountedPreviewUrl(ctx.previewScopeId())) {
        return true;
    }
    return conv?.status === 'streaming'
        && conversationShouldWatchDevPreview(conv, window.location.origin);
}

export function findTranscriptPreviewRunButtonExtracted(ctx: any): HTMLButtonElement | undefined {
    const headerButton = ctx.host.headerPreviewRunHost.querySelector('.theia-mobile-transcript-preview-run');
    if (headerButton instanceof HTMLButtonElement) {
        return headerButton;
    }
    const overlayButton = ctx.host.transcriptEmbeddedPreview?.root.querySelector('.theia-mobile-transcript-preview-run');
    return overlayButton instanceof HTMLButtonElement ? overlayButton : undefined;
}

export function syncHeaderPreviewRunButtonExtracted(ctx: any, project: MobileProjectEntry | undefined,
    summary: QaapAgentConversationSummaryDTO | undefined,
    conv: QaapAgentConversationDTO | undefined,): void {
    const host = ctx.host.headerPreviewRunHost;
    const openProject = project ?? ctx.host.transcriptOpenProject;
    const openSummary = summary ?? ctx.host.transcriptOpenSummary;
    if (!openProject || !openSummary) {
        return;
    }
    const onPreviewTab = ctx.host.executionSurfaceTabsUi.executionSurfaceTabForProject(openProject) === 'preview';
    // Never auto-switch to Preview because a prompt matched "run the app" / pending bootstrap.
    // Staging + the composer Open preview pill stay on Chat; the header play control only
    // belongs on the Preview tab after an explicit user navigation (pill / link / tab).
    if (!onPreviewTab) {
        return;
    }
    let button = host.querySelector<HTMLButtonElement>('.theia-mobile-transcript-preview-run');
    if (!button) {
        button = ctx.createTranscriptPreviewRunButton(openProject, openSummary);
        host.replaceChildren(button);
    }
    host.hidden = false;
    ctx.applyTranscriptPreviewRunButtonState(button, openProject, openSummary, conv);
    ctx.syncHeaderPreviewAppSwitchButton(host, openProject, openSummary);
}

export function syncHeaderFilesMoreButtonExtracted(ctx: any, project: MobileProjectEntry | undefined,
    summary: QaapAgentConversationSummaryDTO | undefined,): void {
    const host = ctx.host.headerFilesMoreHost;
    const openProject = project ?? ctx.host.transcriptOpenProject;
    const openSummary = summary ?? ctx.host.transcriptOpenSummary;
    if (!openProject || !openSummary) {
        ctx.hideHeaderFilesMoreButton();
        return;
    }
    const onFilesTab = ctx.host.executionSurfaceTabsUi.executionSurfaceTabForProject(openProject) === 'files';
    const workspaceKey = ctx.resolveTranscriptWorkspaceKey(openProject, openSummary);
    const mount = workspaceKey
        ? ctx.host.transcriptWorkspaceSurfaces.peekFiles(workspaceKey)
        : undefined;
    if (!onFilesTab || !mount?.attachMoreActionsHost) {
        mount?.attachMoreActionsHost?.(undefined);
        host.hidden = true;
        return;
    }
    // Keep the ⋮ button inside the file view preview header (next to the tree
    // toggle) instead of relocating it to the Work Hub header.
    mount.attachMoreActionsHost(undefined);
    host.hidden = true;
}

export function hideHeaderFilesMoreButtonExtracted(ctx: any): void {
    const openProject = ctx.host.transcriptOpenProject;
    const openSummary = ctx.host.transcriptOpenSummary;
    if (openProject && openSummary) {
        const workspaceKey = ctx.resolveTranscriptWorkspaceKey(openProject, openSummary);
        const mount = workspaceKey
            ? ctx.host.transcriptWorkspaceSurfaces.peekFiles(workspaceKey)
            : undefined;
        mount?.attachMoreActionsHost?.(undefined);
    }
    ctx.host.headerFilesMoreHost.hidden = true;
}

export function syncHeaderViewModeSwitchExtracted(ctx: any, project: MobileProjectEntry | undefined,
    summary: QaapAgentConversationSummaryDTO | undefined,): void {
    const host = ctx.host.headerViewModeSwitchHost;
    const openProject = project ?? ctx.host.transcriptOpenProject;
    const openSummary = summary ?? ctx.host.transcriptOpenSummary;
    if (!openProject || !openSummary) {
        ctx.hideHeaderViewModeSwitch();
        return;
    }
    const onFilesTab = ctx.host.executionSurfaceTabsUi.executionSurfaceTabForProject(openProject) === 'files';
    const useHubHeader = !ctx.host.transcriptSheet
        && (ctx.host.agentsHubShellActive || Boolean(ctx.host.projectDetailSurfaceTargets));
    const workspaceKey = ctx.resolveTranscriptWorkspaceKey(openProject, openSummary);
    const mount = workspaceKey
        ? ctx.host.transcriptWorkspaceSurfaces.peekFiles(workspaceKey)
        : undefined;
    if (!onFilesTab || !useHubHeader || !mount?.attachViewModeSwitchHost) {
        mount?.attachViewModeSwitchHost?.(undefined);
        host.hidden = true;
        return;
    }
    mount.attachViewModeSwitchHost(host);
    host.hidden = false;
}

export function hideHeaderViewModeSwitchExtracted(ctx: any): void {
    const openProject = ctx.host.transcriptOpenProject;
    const openSummary = ctx.host.transcriptOpenSummary;
    if (openProject && openSummary) {
        const workspaceKey = ctx.resolveTranscriptWorkspaceKey(openProject, openSummary);
        const mount = workspaceKey
            ? ctx.host.transcriptWorkspaceSurfaces.peekFiles(workspaceKey)
            : undefined;
        mount?.attachViewModeSwitchHost?.(undefined);
    }
    ctx.host.headerViewModeSwitchHost.hidden = true;
}

export function createTranscriptPreviewRunButtonExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theia-mobile-transcript-preview-run theia-mobile-transcript-preview-run--header';
    const ring = document.createElement('span');
    ring.className = 'theia-mobile-transcript-preview-run-ring';
    ring.setAttribute('aria-hidden', 'true');
    const icon = document.createElement('i');
    icon.className = 'codicon codicon-play';
    icon.setAttribute('aria-hidden', 'true');
    btn.append(ring, icon);
    const label = nls.localize('qaap/mobileProjects/previewButton', 'Preview');
    btn.title = label;
    btn.setAttribute('aria-label', label);
    return btn;
}

export function syncHeaderPreviewAppSwitchButtonExtracted(ctx: any, host: HTMLElement,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): void {
    const bootstrap = ctx.host.projectBootstrap;
    const snapshot = bootstrap?.getStateSnapshot();
    const apps = snapshot?.descriptor?.apps ?? [];
    const selectedApp = snapshot?.selectedApp;
    let button = host.querySelector<HTMLButtonElement>('.theia-mobile-transcript-preview-app-switch');
    if (!bootstrap || apps.length <= 1 || !selectedApp) {
        button?.remove();
        return;
    }
    if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-mobile-transcript-preview-app-switch';
        const icon = document.createElement('i');
        icon.className = 'codicon codicon-list-selection';
        icon.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.className = 'theia-mobile-transcript-preview-app-switch-name';
        const chevron = document.createElement('i');
        chevron.className = 'codicon codicon-chevron-down';
        chevron.setAttribute('aria-hidden', 'true');
        button.append(icon, name, chevron);
        host.prepend(button);
    }
    const label = nls.localize(
        'qaap/mobileProjects/switchPreviewApp',
        'Switch preview app (current: {0})',
        selectedApp.name,
    );
    button.title = label;
    button.setAttribute('aria-label', label);
    const name = button.querySelector<HTMLElement>('.theia-mobile-transcript-preview-app-switch-name');
    if (name) {
        name.textContent = selectedApp.name;
    }
    button.disabled = ctx.host.transcriptPreviewRequestRunning || ctx.host.transcriptPreviewRequestPending;
    button.onclick = () => {
        void ctx.switchTranscriptPreviewApp(project, summary);
    };
}

export async function switchTranscriptPreviewAppExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    const bootstrap = ctx.host.projectBootstrap;
    const snapshot = bootstrap?.getStateSnapshot();
    const apps = snapshot?.descriptor?.apps ?? [];
    const currentApp = snapshot?.selectedApp;
    if (!bootstrap || apps.length <= 1 || !currentApp) {
        return;
    }
    const selectedApp = await ctx.pickTranscriptPreviewApp(apps);
    if (!selectedApp || selectedApp.relativePath === currentApp.relativePath) {
        return;
    }

    const launchGeneration = ++ctx.previewLaunchGeneration;
    ctx.host.transcriptPreviewSuppressedByUser = false;
    ctx.host.transcriptPreviewRequestRunning = true;
    ctx.host.transcriptPreviewRequestPending = true;
    ctx.syncHeaderPreviewRunButton(project, summary);
    MobileSnackbar.show(
        nls.localize('qaap/mobileProjects/switchingPreviewApp', 'Switching preview to {0}…', selectedApp.name),
        { duration: 2200 },
    );
    try {
        await bootstrap.selectMonorepoApp(selectedApp, { conversationId: summary.id });
        const readyUrl = await ensureTranscriptDevPreview(bootstrap, {
            conversationId: summary.id,
            projectId: project.id,
            skipConversationPortProbe: true,
        });
        if (launchGeneration !== ctx.previewLaunchGeneration || ctx.host.transcriptPreviewSuppressedByUser) {
            return;
        }
        if (readyUrl) {
            ctx.adoptReadyTranscriptPreview(project, summary, readyUrl);
            return;
        }
        const failure = bootstrap.getBootstrapFailureDetail()?.terminalFailure
            ?? nls.localize('qaap/mobileProjects/previewSwitchFailed', 'The selected app did not become ready.');
        MobileSnackbar.show(failure, { kind: 'warning' });
    } finally {
        if (launchGeneration === ctx.previewLaunchGeneration) {
            ctx.host.transcriptPreviewRequestRunning = false;
            ctx.host.transcriptPreviewRequestPending = false;
            const latestProject = ctx.host.projects.find(candidate => candidate.id === project.id) ?? project;
            ctx.syncHeaderPreviewRunButton(latestProject, summary);
        }
    }
}

export function isTranscriptPreviewStoppableExtracted(ctx: any, conv: QaapAgentConversationDTO | undefined,
    project: MobileProjectEntry | undefined,): boolean {
    if (ctx.host.transcriptPreviewSuppressedByUser) {
        return false;
    }
    if (ctx.isTranscriptPreviewWaiting(conv, project)) {
        return true;
    }
    const root = ctx.host.transcriptEmbeddedPreview?.root;
    if (root?.isConnected && !root.classList.contains('theia-mod-empty-preview')) {
        return true;
    }
    return !!ctx.mountedPreviewUrl(ctx.previewScopeId());
}

export function applyTranscriptPreviewRunButtonStateExtracted(ctx: any, button: HTMLButtonElement,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    conv: QaapAgentConversationDTO | undefined,): void {
    const stoppable = ctx.isTranscriptPreviewStoppable(conv, project);
    const waiting = ctx.isTranscriptPreviewWaiting(conv, project);
    button.disabled = false;
    button.classList.toggle('theia-mod-loading', waiting);
    button.classList.toggle('theia-mod-stop', stoppable);
    const icon = button.querySelector<HTMLElement>('.codicon');
    if (icon) {
        icon.classList.toggle('codicon-play', !stoppable);
        icon.classList.toggle('codicon-debug-stop', stoppable);
    }
    const label = stoppable
        ? nls.localize('qaap/mobileProjects/previewStop', 'Stop preview')
        : nls.localize('qaap/mobileProjects/previewButton', 'Preview');
    button.title = label;
    button.setAttribute('aria-label', label);
    if (waiting) {
        button.setAttribute('aria-busy', 'true');
    } else {
        button.removeAttribute('aria-busy');
    }
    button.onclick = () => {
        if (ctx.isTranscriptPreviewStoppable(ctx.host.transcriptLastConv, project)) {
            ctx.stopTranscriptPreview(project, summary);
            return;
        }
        void ctx.requestTranscriptPreview(project, summary);
    };
}

export function stopTranscriptPreviewExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): void {
    // Invalidate every in-flight ensure/probe/submit callback first.
    ctx.previewLaunchGeneration += 1;
    ctx.host.transcriptPreviewSuppressedByUser = true;
    ctx.host.transcriptPreviewRequestRunning = false;
    ctx.host.transcriptPreviewRequestPending = false;
    ctx.closeTranscriptPreviewAppPicker();
    ctx.transcriptPreviewEnsureRequests.clear();
    ctx.stopTranscriptPreviewTabProbe();
    ctx.stopTranscriptPreviewIdentityWatch();
    ctx.clearPreviewRuntimeForConversation(ctx.previewScopeId(summary));
    ctx.host.projectBootstrap?.cancelActivePreviewLaunch();
    const cleared = { ...project, previewUrl: undefined };
    ctx.host.projects = ctx.host.projects.map(candidate => candidate.id === cleared.id ? cleared : candidate);
    if (ctx.host.transcriptOpenProject?.id === cleared.id) {
        ctx.host.transcriptOpenProject = cleared;
    }
    ctx.disposeTranscriptEmbeddedPreview(ctx.previewScopeId(summary));
    // Paint Play immediately — sync before remount so the icon never waits on empty chrome.
    ctx.syncHeaderPreviewRunButton(cleared, summary);
    const host = ctx.executionPreviewHost();
    if (host && ctx.host.executionSurfaceTabsUi.executionSurfaceTabForProject(project) === 'preview') {
        ctx.mountTranscriptEmptyPreview(host, cleared, summary);
        ctx.syncHeaderPreviewRunButton(cleared, summary);
    }
    // Also stop the agent turn that was asked to prepare the preview (composer Stop).
    ctx.cancelPreviewAgentTurn(project, summary);
    MobileSnackbar.dismiss();
    MobileSnackbar.show(
        nls.localize('qaap/mobileProjects/previewStopped', 'Preview stopped'),
        { duration: 1400 },
    );
}

