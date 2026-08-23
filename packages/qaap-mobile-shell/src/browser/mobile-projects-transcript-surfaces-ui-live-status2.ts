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
    getTranscriptTerminalContext,
    markTranscriptTerminalRestorable,
    parkTranscriptTerminalSurface,
    scheduleTranscriptTerminalResize,
    type TranscriptTerminalPersistedWorkspace,
    type TranscriptTerminalSurface,
    type TranscriptTerminalViewServices,
} from './qaap-transcript-terminal-view';
import { registerQaapWorkHubTerminalContext } from '@theia/qaap-adapters/lib/browser/qaap-work-hub-terminal-context';
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

export async function ensureTranscriptTerminalTabExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    const host = ctx.executionTerminalHost();
    if (!host) {
        return;
    }
    const workspaceKey = ctx.resolveTranscriptWorkspaceKey(project, summary);
    if (!workspaceKey && project.github && ctx.host.projectsService) {
        void ctx.host.projectsService.prepareProjectCwd(project).then(prepared => {
            if (!prepared || !ctx.executionTerminalHost()?.isConnected || ctx.host.executionSurfaceTabsUi.activeExecutionTab(project) !== 'terminal') {
                return;
            }
            ctx.host.preparedCwdByProjectId.set(project.id, prepared);
            void ctx.ensureTranscriptTerminalTab(project, summary);
        });
    }
    if (!workspaceKey) {
        ctx.detachTranscriptTerminalFromHost();
        host.replaceChildren();
        const note = document.createElement('div');
        note.className = 'theia-mobile-transcript-terminal-note';
        note.textContent = nls.localize(
            'qaap/mobileProjects/terminalUnavailable',
            'Terminal is unavailable for this conversation (no workspace path).',
        );
        host.append(note);
        return;
    }
    const cwd = ctx.resolveTranscriptProjectCwd(project, summary);
    const services = ctx.host.createTranscriptTerminalViewServices?.();
    if (!cwd || !services) {
        return;
    }
    if (!host.isConnected) {
        return;
    }

    ctx.ensureTranscriptTerminalChrome(host, workspaceKey, cwd, services, project, summary);
    let state = ctx.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey);
    if (!state) {
        state = { surfaces: [], activeIndex: 0 };
        ctx.host.transcriptTerminalSlidesByWorkspace.set(workspaceKey, state);
        await ctx.restoreTranscriptTerminalSlides(workspaceKey, cwd, services);
        state = ctx.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey);
    }
    if (!state) {
        state = { surfaces: [], activeIndex: 0 };
        ctx.host.transcriptTerminalSlidesByWorkspace.set(workspaceKey, state);
    }
    if (state.surfaces.length === 0 && !state.suppressAutoCreate) {
        await ctx.createTranscriptTerminalSlide(workspaceKey, cwd, services, project, summary);
        state = ctx.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey);
    }
    if (state && state.surfaces.length > 0) {
        ctx.renderTranscriptTerminalSlides(workspaceKey);
    }
}

export function ensureTranscriptTerminalChromeExtracted(ctx: any, host: HTMLElement,
    workspaceKey: TranscriptWorkspaceSurfaceKey,
    cwd: string,
    services: TranscriptTerminalViewServices,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): void {
    if (ctx.host.transcriptTerminalSlider?.parentElement === host
        && ctx.host.transcriptTerminalToolbar?.parentElement === host
        && ctx.host.transcriptTerminalDots?.parentElement === ctx.host.transcriptTerminalToolbar) {
        return;
    }
    for (const state of ctx.host.transcriptTerminalSlidesByWorkspace.values()) {
        for (const surface of state.surfaces) {
            parkTranscriptTerminalSurface(surface);
        }
    }
    host.classList.add('theia-mobile-transcript-terminal');
    host.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'theia-mobile-transcript-terminal-toolbar';
    const switcher = document.createElement('div');
    switcher.className = 'theia-mobile-transcript-terminal-switcher';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'theia-mobile-transcript-terminal-add codicon codicon-add';
    addBtn.title = services.localize('qaap/mobileProjects/transcriptTerminalNew', 'New terminal');
    addBtn.setAttribute('aria-label', addBtn.title);
    addBtn.addEventListener('click', () => {
        void ctx.createTranscriptTerminalSlide(workspaceKey, cwd, services, project, summary, true);
    });
    toolbar.append(addBtn, switcher);

    // Agent TUI selector — lives in the terminal toolbar, right-aligned after the switcher.
    const tuiSelect = ctx.host.executionSurfaceTabsUi.createTerminalAgentTuiSelect();
    tuiSelect.classList.add('theia-mobile-transcript-terminal-agent-tui-toolbar-host');
    toolbar.append(tuiSelect);

    const slider = document.createElement('div');
    slider.className = 'theia-mobile-transcript-terminal-slider';
    host.append(toolbar, slider);
    ctx.host.transcriptTerminalToolbar = toolbar;
    ctx.host.transcriptTerminalSlider = slider;
    ctx.host.transcriptTerminalDots = switcher;
}

export async function createTranscriptTerminalSlideExtracted(ctx: any, workspaceKey: TranscriptWorkspaceSurfaceKey,
    cwd: string,
    services: TranscriptTerminalViewServices,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    activateNewest = false,): Promise<void> {
    const host = ctx.executionTerminalHost();
    if (!host?.isConnected) {
        return;
    }
    try {
        await ctx.mountFreshTranscriptTerminalSlide(
            workspaceKey, cwd, services, project, summary, activateNewest,
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Stale Work Hub PTY ids survive VPS/backend restarts in browser storage. Clear and retry once.
        if (isTerminalDoesNotExistError(message)) {
            try {
                await services.saveWorkspaceState(workspaceKey, undefined);
                await ctx.mountFreshTranscriptTerminalSlide(
                    workspaceKey, cwd, services, project, summary, activateNewest,
                );
                return;
            } catch (retryError) {
                ctx.showTranscriptTerminalError(host, services, retryError);
                return;
            }
        }
        ctx.showTranscriptTerminalError(host, services, error);
    }
}

export async function mountFreshTranscriptTerminalSlideExtracted(ctx: any, workspaceKey: TranscriptWorkspaceSurfaceKey,
    cwd: string,
    services: TranscriptTerminalViewServices,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    activateNewest: boolean,): Promise<void> {
    const staging = createTranscriptTerminalStagingHost();
    const surface = await createTranscriptTerminalSurface(staging, cwd, services);
    registerTranscriptTerminalContext(ctx, workspaceKey, cwd, services, project, summary, surface);
    const state = ctx.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey) ?? { surfaces: [], activeIndex: 0 };
    state.suppressAutoCreate = false;
    state.surfaces.push(surface);
    state.activeIndex = activateNewest ? state.surfaces.length - 1 : Math.max(0, state.activeIndex);
    ctx.host.transcriptTerminalSlidesByWorkspace.set(workspaceKey, state);
    void ctx.persistTranscriptTerminalWorkspace(workspaceKey);
    if (ctx.host.executionSurfaceTabsUi.activeExecutionTab(project) === 'terminal'
        && ctx.resolveTranscriptWorkspaceKey(project, summary) === workspaceKey) {
        ctx.renderTranscriptTerminalSlides(workspaceKey);
    }
}

export function showTranscriptTerminalErrorExtracted(ctx: any, host: HTMLElement,
    services: TranscriptTerminalViewServices,
    error: unknown,): void {
    if (!host.isConnected) {
        return;
    }
    for (const state of ctx.host.transcriptTerminalSlidesByWorkspace.values()) {
        for (const surface of state.surfaces) {
            parkTranscriptTerminalSurface(surface);
        }
    }
    const slider = ctx.host.transcriptTerminalSlider;
    if (slider) {
        slider.replaceChildren();
    }
    const note = document.createElement('div');
    note.className = 'theia-mobile-transcript-terminal-error';
    const message = error instanceof Error ? error.message : String(error);
    note.textContent = services.localize(
        'qaap/mobileProjects/transcriptTerminalFailed',
        'Could not start the terminal: {0}',
        message,
    );
    slider?.append(note);
    console.error('[qaap-mobile-shell] transcript terminal failed', error);
}

export async function launchAgentTuiInTranscriptTerminalExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    agentId: string,
    options?: { readonly login?: boolean },): Promise<void> {
    const command = options?.login
        ? resolveInteractiveAgentLoginCommand(agentId)
        : resolveInteractiveAgentCliBin(agentId);
    if (!command) {
        return;
    }
    ctx.host.executionSurfaceTabsUi.selectTranscriptTab('terminal', project, summary);
    await ctx.ensureTranscriptTerminalTab(project, summary);
    const workspaceKey = ctx.resolveTranscriptWorkspaceKey(project, summary);
    const cwd = ctx.resolveTranscriptProjectCwd(project, summary);
    const services = ctx.host.createTranscriptTerminalViewServices?.();
    if (!workspaceKey || !cwd || !services) {
        return;
    }
    await ctx.createTranscriptTerminalSlide(workspaceKey, cwd, services, project, summary, true);
    const state = ctx.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey);
    const surface = state?.surfaces[state.activeIndex];
    if (!surface || surface.terminal.isDisposed) {
        return;
    }
    const title = resolveAgentDisplayLabel(agentId);
    try {
        surface.terminal.title.label = options?.login
            ? nls.localize('qaap/mobileProjects/terminalAgentSignInTitle', 'Sign in · {0}', title)
            : title;
    } catch {
        /* title is best-effort */
    }
    ctx.renderTranscriptTerminalSlides(workspaceKey);
    await new Promise<void>(resolve => {
        window.setTimeout(resolve, 120);
    });
    if (!surface.terminal.isDisposed) {
        surface.terminal.sendText(`${command}\n`);
    }
}

export function renderTranscriptTerminalSlidesExtracted(ctx: any, workspaceKey: TranscriptWorkspaceSurfaceKey): void {
    const slider = ctx.host.transcriptTerminalSlider;
    const state = ctx.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey);
    if (!slider || !state) {
        return;
    }
    for (const surface of state.surfaces) {
        parkTranscriptTerminalSurface(surface);
    }
    slider.replaceChildren();
    const active = state.surfaces[state.activeIndex];
    if (active) {
        const slide = document.createElement('div');
        slide.className = 'theia-mobile-transcript-terminal-slide theia-mod-active';
        slide.dataset.index = String(state.activeIndex);
        slide.append(active.mountHost);
        slider.append(slide);
        scheduleTranscriptTerminalResize(active.terminal);
        ctx.syncTranscriptTerminalResizeObserver(slider, active.terminal);
    } else {
        ctx.syncTranscriptTerminalResizeObserver(undefined, undefined);
        const empty = document.createElement('div');
        empty.className = 'theia-mobile-transcript-terminal-note';
        empty.textContent = nls.localize(
            'qaap/mobileProjects/transcriptTerminalEmpty',
            'No terminals open. Create one with +.',
        );
        slider.append(empty);
    }
    ctx.renderTranscriptTerminalDots(workspaceKey);
}

export function syncTranscriptTerminalResizeObserverExtracted(ctx: any, slider: HTMLElement | undefined,
    terminal: TerminalWidget | undefined,): void {
    ctx.host.transcriptTerminalResizeObserver?.disconnect();
    ctx.host.transcriptTerminalResizeObserver = undefined;
    if (!slider || !terminal || typeof ResizeObserver === 'undefined') {
        return;
    }
    ctx.host.transcriptTerminalResizeObserver = new ResizeObserver(() => {
        if (terminal.isAttached && !slider.hidden) {
            scheduleTranscriptTerminalResize(terminal);
        }
    });
    const resizeTargets = [
        slider.parentElement,
        slider,
        terminal.node.parentElement,
        terminal.node,
        terminal.node.querySelector<HTMLElement>('.terminal-container'),
        terminal.node.querySelector<HTMLElement>('.xterm'),
    ];
    for (const target of resizeTargets) {
        if (target) {
            ctx.host.transcriptTerminalResizeObserver.observe(target);
        }
    }
}

export function renderTranscriptTerminalDotsExtracted(ctx: any, workspaceKey: TranscriptWorkspaceSurfaceKey): void {
    const dots = ctx.host.transcriptTerminalDots;
    const state = ctx.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey);
    if (!dots || !state) {
        return;
    }
    dots.replaceChildren();
    state.surfaces.forEach((surface, index) => {
        // Keep the close control as a sibling-level interactive element. A button
        // nested in another button is invalid HTML and behaves inconsistently in
        // Safari/WebKit, especially when switching terminal surfaces by touch.
        const tab = document.createElement('div');
        tab.className = 'theia-mobile-transcript-terminal-tab';
        tab.setAttribute('role', 'tab');
        tab.tabIndex = 0;
        tab.classList.toggle('theia-mod-active', index === state.activeIndex);
        tab.setAttribute('aria-selected', String(index === state.activeIndex));
        const title = ctx.resolveTranscriptTerminalTabTitle(surface, index);
        tab.title = title;
        tab.setAttribute('aria-label', title);
        const activate = (): void => {
            state.activeIndex = index;
            void ctx.persistTranscriptTerminalWorkspace(workspaceKey);
            ctx.renderTranscriptTerminalSlides(workspaceKey);
            ctx.renderTranscriptTerminalDots(workspaceKey);
        };
        tab.addEventListener('click', activate);
        tab.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                activate();
            }
        });

        const icon = document.createElement('span');
        icon.className = 'theia-mobile-transcript-terminal-tab-icon codicon codicon-terminal';
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'theia-mobile-transcript-terminal-tab-label';
        label.textContent = title;
        tab.append(icon, label);

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'theia-mobile-transcript-terminal-tab-close codicon codicon-close';
        close.title = nls.localize('qaap/mobileProjects/transcriptTerminalClose', 'Close terminal');
        close.setAttribute('aria-label', close.title);
        close.addEventListener('click', event => {
            event.stopPropagation();
            ctx.closeTranscriptTerminalTab(workspaceKey, index);
        });
        tab.append(close);

        dots.append(tab);
    });
}

export function closeTranscriptTerminalTabExtracted(ctx: any, workspaceKey: TranscriptWorkspaceSurfaceKey, index: number): void {
    const state = ctx.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey);
    if (!state) {
        return;
    }
    const [removed] = state.surfaces.splice(index, 1);
    removed?.dispose.dispose();
    if (state.surfaces.length === 0) {
        state.activeIndex = 0;
        state.suppressAutoCreate = true;
    } else if (state.activeIndex >= state.surfaces.length) {
        state.activeIndex = state.surfaces.length - 1;
    }
    ctx.host.transcriptTerminalSlidesByWorkspace.set(workspaceKey, state);
    void ctx.persistTranscriptTerminalWorkspace(workspaceKey);
    ctx.renderTranscriptTerminalSlides(workspaceKey);
}

export async function restoreTranscriptTerminalSlidesExtracted(ctx: any, workspaceKey: TranscriptWorkspaceSurfaceKey,
    cwd: string,
    services: TranscriptTerminalViewServices,): Promise<void> {
    const persisted = await services.loadWorkspaceState(workspaceKey);
    if (!persisted || persisted.terminals.length === 0) {
        return;
    }
    const state = ctx.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey) ?? { surfaces: [], activeIndex: 0 };
    if (state.surfaces.length > 0) {
        return;
    }
    for (const terminalState of persisted.terminals) {
        try {
            const staging = createTranscriptTerminalStagingHost();
            const surface = await createTranscriptTerminalSurface(staging, cwd, services, terminalState);
            const project = ctx.host.transcriptOpenProject;
            const summary = ctx.host.transcriptOpenSummary;
            if (project && summary) {
                registerTranscriptTerminalContext(ctx, workspaceKey, cwd, services, project, summary, surface);
            }
            state.surfaces.push(surface);
        } catch (error) {
            console.warn('[qaap-mobile-shell] failed to restore WorkHub terminal', error);
        }
    }
    state.activeIndex = Math.min(
        Math.max(0, persisted.activeIndex),
        Math.max(0, state.surfaces.length - 1),
    );
    ctx.host.transcriptTerminalSlidesByWorkspace.set(workspaceKey, state);
    void ctx.persistTranscriptTerminalWorkspace(workspaceKey);
}

function registerTranscriptTerminalContext(ctx: any, workspaceKey: TranscriptWorkspaceSurfaceKey,
    cwd: string,
    services: TranscriptTerminalViewServices,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    surface: TranscriptTerminalSurface,): void {
    registerQaapWorkHubTerminalContext(surface.terminal, {
        createNewTerminal: async () => {
            await ctx.createTranscriptTerminalSlide(workspaceKey, cwd, services, project, summary, true);
        },
        closeTerminal: async () => {
            const state = ctx.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey);
            const index = state?.surfaces.indexOf(surface) ?? -1;
            if (index >= 0) {
                ctx.closeTranscriptTerminalTab(workspaceKey, index);
            }
        },
        askAi: async (question: string) => {
            await focusWorkHubChatInput(
                ctx,
                project,
                summary,
                getTranscriptTerminalContext(surface.terminal),
                question,
                true,
            );
        },
    });
    surface.terminal.onTerminalDidClose(() => {
        const state = ctx.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey);
        const index = state?.surfaces.indexOf(surface) ?? -1;
        if (!state || index < 0) {
            return;
        }
        state.surfaces.splice(index, 1);
        state.activeIndex = state.surfaces.length === 0
            ? 0
            : Math.min(state.activeIndex, state.surfaces.length - 1);
        state.suppressAutoCreate = state.surfaces.length === 0;
        ctx.host.transcriptTerminalSlidesByWorkspace.set(workspaceKey, state);
        void ctx.persistTranscriptTerminalWorkspace(workspaceKey);
        const openProject = ctx.host.transcriptOpenProject;
        const openSummary = ctx.host.transcriptOpenSummary;
        if (openProject && openSummary
            && ctx.resolveTranscriptWorkspaceKey(openProject, openSummary) === workspaceKey) {
            ctx.renderTranscriptTerminalSlides(workspaceKey);
        }
    });
}

async function focusWorkHubChatInput(ctx: any,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    terminalContext?: string,
    question?: string,
    submit = false,): Promise<void> {
    const activeProject = ctx.host.transcriptOpenProject ?? project;
    const activeSummary = ctx.host.transcriptOpenSummary ?? summary;
    ctx.host.executionSurfaceTabsUi.selectTranscriptTab('messages', activeProject, activeSummary);

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
        const input = ctx.host.transcriptComposerHost?.querySelector<HTMLTextAreaElement>(
            '.theia-mobile-projects-sticky-composer-input',
        );
        if (input?.isConnected && !input.disabled) {
            if (terminalContext?.trim() || question?.trim()) {
                const contextMarker = nls.localize(
                    'qaap/mobileProjects/terminalContextHeader',
                    '### Terminal context',
                );
                const questionMarker = nls.localize(
                    'qaap/mobileProjects/terminalContextQuestion',
                    'Question:',
                );
                const nextDraft = terminalContext?.trim()
                    ? [
                        contextMarker,
                        '',
                        '```text',
                        terminalContext.trim(),
                        '```',
                        '',
                        questionMarker,
                        ` ${question?.trim() ?? ''}`,
                    ].join('\n')
                    : question?.trim() ?? '';
                ctx.host.transcriptComposerDraft = nextDraft;
                input.value = nextDraft;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            input.focus({ preventScroll: true });
            input.setSelectionRange(input.value.length, input.value.length);
            if (submit) {
                await submitWorkHubChat(ctx.host.transcriptComposerHost);
            }
            return;
        }
        await new Promise<void>(resolve => window.setTimeout(resolve, 50));
    }
    throw new Error('The Work Hub chat composer did not become available.');
}

async function submitWorkHubChat(host: HTMLElement | undefined): Promise<void> {
    if (!host) {
        return;
    }
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
        const sendButton = host.querySelector<HTMLButtonElement>(
            '.theia-mobile-projects-sticky-composer-send',
        );
        if (sendButton?.isConnected && !sendButton.disabled) {
            sendButton.click();
            return;
        }
        await new Promise<void>(resolve => window.setTimeout(resolve, 50));
    }
}

export async function persistTranscriptTerminalWorkspaceExtracted(ctx: any, workspaceKey: TranscriptWorkspaceSurfaceKey): Promise<void> {
    const services = ctx.host.createTranscriptTerminalViewServices?.();
    if (!services) {
        return;
    }
    const state = ctx.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey);
    const persisted = ctx.toPersistedTerminalWorkspace(state);
    await services.saveWorkspaceState(workspaceKey, persisted);
}

export function toPersistedTerminalWorkspaceExtracted(ctx: any, state: TranscriptTerminalSliderState | undefined,): TranscriptTerminalPersistedWorkspace | undefined {
    return toPersistedTerminalWorkspaceHelper(state);
}

export function detachTranscriptFilesFromHostExtracted(ctx: any): void {
    ctx.hideHeaderFilesMoreButton();
    ctx.hideHeaderViewModeSwitch();
    const host = ctx.executionFilesHost();
    if (host) {
        host.querySelector('.theia-mobile-transcript-files')?.remove();
        host.querySelector('.theia-mobile-transcript-files-note')?.remove();
    }
    ctx.host.transcriptFilesAttachedKey = undefined;
}

export function detachTranscriptTerminalFromHostExtracted(ctx: any): void {
    ctx.syncTranscriptTerminalResizeObserver(undefined, undefined);
    for (const state of ctx.host.transcriptTerminalSlidesByWorkspace.values()) {
        for (const surface of state.surfaces) {
            parkTranscriptTerminalSurface(surface);
        }
    }
    const host = ctx.executionTerminalHost();
    if (host) {
        host.replaceChildren();
        host.classList.remove('theia-mobile-transcript-terminal');
    }
    ctx.host.transcriptTerminalToolbar = undefined;
    ctx.host.transcriptTerminalSlider = undefined;
    ctx.host.transcriptTerminalDots = undefined;
}
