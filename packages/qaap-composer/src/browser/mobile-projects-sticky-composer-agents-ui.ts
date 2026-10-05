// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { Disposable } from '@theia/core/lib/common/disposable';
import { ChatAgent } from '@theia/ai-chat';
import { ChatAgentService } from '@theia/ai-chat/lib/common/chat-agent-service';
import {
    agentSupportsModelPicker,
    ensureStoredAgentModel,
    fetchAgentModelsForAgent,
    filterQaapComposerAgents,
    isTheiaCoderAgent,
    pickDefaultAgentModel,
    readStoredAgent,
    readStoredAgentModel,
    reconcileStickyComposerAgent,
    listQaapComposerPickerAgents,
    SHELL_AGENT_ID,
    THEIA_CODER_AGENT_ID,
    writeStoredAgent,
    type QaapAgentTaskAgentOption,
    type QaapAgentTaskListSnapshot,
    type QaapCreateAgentTaskQaiqModel,
    type QaapQaiqModelOption,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { QAAP_DISABLED_HARNESSES_PREF, readDisabledHarnessIds } from '@theia/qaap-shared-core/lib/common/qaap-harness-preferences';
import { localizeHostedInstallCodingAgentLabel, readQaapHostedRuntime } from '@theia/qaap-shared-core/lib/common/qaap-hosted-agent-auth-policy';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { MobileProjectsService } from '@theia/qaap-shared-core/lib/browser/mobile-projects-service';
import type { MobileProjectsActiveTasks } from '@theia/qaap-shared-core/lib/browser/mobile-projects-active-tasks';
import type { ComposerAgentPickerChrome } from './mobile-projects-sticky-composer-sheets-ui';
import { renderAgentPickerLoadError, renderAgentPickerSkeleton } from '@theia/qaap-agents-ui/lib/browser/qaap-agent-picker-loading';

export interface MobileProjectsStickyComposerAgentsHost {
    stickyComposerPinnedAgentId: string | undefined;
    stickyComposerAgentModel?: QaapCreateAgentTaskQaiqModel;
    stickyComposerBackendAgents: QaapAgentTaskAgentOption[];
    stickyComposerQaiqModels: QaapQaiqModelOption[];
    preparedCwdByProjectId: Map<string, string>;
    projectsService: MobileProjectsService;
    chatAgentService?: ChatAgentService;
    activeTasks?: MobileProjectsActiveTasks;
    readPreference?: (key: string) => unknown;
    stickyComposerRenderUi: import('./mobile-projects-sticky-composer-render-ui').MobileProjectsStickyComposerRenderUi;
    loadBackendAgentSnapshot(options?: { readonly forceRefresh?: boolean }): Promise<QaapAgentTaskListSnapshot>;
    resolveConversationAgentLabel(agentId: string | undefined): string;
    projectRowsUi: import('@theia/qaap-transcript/lib/browser/qaap-transcript-host-contracts').TranscriptProjectLabelsApi;
}

export class MobileProjectsStickyComposerAgentsUi {
    /** Whether the first agent catalog refresh answered (successfully or not). */
    protected stickyComposerAgentCatalogSettled = false;

    constructor(protected readonly host: MobileProjectsStickyComposerAgentsHost) { }

    /**
     * The local Theia Coder agent runs in the browser tab and stops when the mobile app is closed,
     * so it is not agentic. It is no longer offered or defaulted to in the mobile agent pickers —
     * only VPS-backed agents (QAIQ, Codex, …) are selectable.
     */
    getOfferableCoderAgent(): ChatAgent | undefined {
        return undefined;
    }

    resolveStickyComposerPinnedAgentId(project: MobileProjectEntry): string {
        const cwd = this.host.projectsService.getProjectCwd(project) ?? this.host.preparedCwdByProjectId.get(project.id);
        const stored = readStoredAgent(cwd);
        const current = this.host.stickyComposerPinnedAgentId ?? stored;
        // An empty selection is rendered as @shell while the hosted catalog warms. Keep that
        // fallback stable for submit as well; otherwise a catalog that arrives between render
        // and click can silently turn the visible Shell action into an unauthenticated cloud CLI.
        if (!current) {
            return SHELL_AGENT_ID;
        }
        // `@shell` is a real local harness, not merely a loading placeholder. Preserve an
        // explicit shell choice even after the VPS catalog arrives; otherwise the toolbar can
        // continue displaying @shell while submit silently falls through to the first detected
        // coding agent (usually Copilot), which makes an unconfigured provider look like a dead
        // submit button on a fresh mobile session.
        if (current?.trim().replace(/^@/, '').toLowerCase() === SHELL_AGENT_ID) {
            return SHELL_AGENT_ID;
        }
        const selectable = this.filterSelectableComposerAgents(this.host.stickyComposerBackendAgents);
        const resolved = this.reconcileStickyComposerPinnedAgent(
            current,
            selectable,
            undefined,
            cwd,
        );
        // The hosted composer advertises @shell while the tenant agent catalog is warming.
        // Keep that fallback actionable: an empty id makes submit wait for the catalog and
        // roll back after 20s even though the shell runner is already available.
        return resolved ?? SHELL_AGENT_ID;
    }
    resolveStickyComposerAgentLabel(project?: MobileProjectEntry): string {
        const cwd = project
            ? this.host.projectsService.getProjectCwd(project) ?? this.host.preparedCwdByProjectId.get(project.id)
            : undefined;
        const chosen = this.host.stickyComposerPinnedAgentId ?? readStoredAgent(cwd);
        // Without a choice, submit falls back to @shell while the catalog warms, but painting that
        // fallback flashed "@shell" in the composer until the real default agent arrived.
        if (!chosen && project && !this.stickyComposerAgentCatalogSettled) {
            return nls.localize('qaap/mobileProjects/stickyComposerAgentPending', 'Agent');
        }
        const pinned = chosen ?? (project ? this.resolveStickyComposerPinnedAgentId(project) : undefined);
        if (isTheiaCoderAgent(pinned)) {
            return this.host.chatAgentService?.getAgent(THEIA_CODER_AGENT_ID)?.name ?? 'Coder';
        }
        const fromList = this.host.stickyComposerBackendAgents.find(
            a => a.id.toLowerCase() === pinned?.toLowerCase(),
        )?.label;
        if (fromList) {
            return fromList;
        }
        if (pinned) {
            return pinned.startsWith('@') ? pinned : `@${pinned}`;
        }
        if (this.filterSelectableComposerAgents(this.host.stickyComposerBackendAgents).length === 0) {
            return readQaapHostedRuntime()
                ? localizeHostedInstallCodingAgentLabel()
                : nls.localize('qaap/mobileProjects/installCodingAgent', 'Install a coding CLI');
        }
        return this.host.projectRowsUi.resolveConversationAgentLabel(undefined);
    }
    resolveStickyComposerAgentModel(
        agentId: string,
        project?: MobileProjectEntry,
        composerCwd?: string,
    ): QaapCreateAgentTaskQaiqModel | undefined {
        if (!agentSupportsModelPicker(agentId)) {
            return undefined;
        }
        const cwd = composerCwd ?? (project
            ? (this.host.projectsService.getProjectCwd(project) ?? this.host.preparedCwdByProjectId.get(project.id))
            : undefined);
        const stored = readStoredAgentModel(cwd, agentId);
        if (stored) {
            return stored;
        }
        return this.host.stickyComposerPinnedAgentId?.toLowerCase() === agentId.toLowerCase()
            ? this.host.stickyComposerAgentModel
            : undefined;
    }

    /**
     * Model-capable agents must always have a concrete model so the toolbar
     * never falls back to logo-only (user cannot tell which model will run).
     */
    async ensureStickyComposerAgentModel(
        agentId: string,
        cwd: string | undefined,
        preferredModels?: readonly QaapQaiqModelOption[],
    ): Promise<QaapCreateAgentTaskQaiqModel | undefined> {
        if (!agentSupportsModelPicker(agentId)) {
            return undefined;
        }
        const existing = readStoredAgentModel(cwd, agentId);
        if (existing) {
            return existing;
        }
        let catalog = preferredModels ?? [];
        if (catalog.length === 0) {
            try {
                catalog = await fetchAgentModelsForAgent(agentId);
            } catch {
                catalog = [];
            }
        }
        if (cwd) {
            return ensureStoredAgentModel(cwd, agentId, catalog);
        }
        const picked = pickDefaultAgentModel(catalog);
        return picked
            ? { provider: picked.provider, vendor: picked.vendor, modelId: picked.modelId }
            : undefined;
    }

    /**
     * Resolve the composer to an agent that has a concrete model. Keep the current agent when
     * possible, then fall back to the first model-capable harness in picker order. This prevents
     * the composer from showing a logo-only agent button when a different detected harness already
     * exposes a usable model catalog.
     */
    async ensureStickyComposerAgentSelection(
        currentAgentId: string | undefined,
        agents: readonly QaapAgentTaskAgentOption[],
        cwd: string | undefined,
        qaiqModels: readonly QaapQaiqModelOption[] = [],
    ): Promise<{ readonly agentId: string; readonly model: QaapCreateAgentTaskQaiqModel } | undefined> {
        const candidateIds = [
            currentAgentId,
            ...this.filterSelectableComposerAgents(agents).map(agent => agent.id),
        ];
        const seen = new Set<string>();
        for (const candidate of candidateIds) {
            const agentId = candidate?.trim();
            if (!agentId) {
                continue;
            }
            const key = agentId.toLowerCase();
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            if (!agentSupportsModelPicker(agentId)) {
                continue;
            }
            const model = await this.ensureStickyComposerAgentModel(
                agentId,
                cwd,
                key === 'qaiq' ? qaiqModels : undefined,
            );
            if (model) {
                return { agentId, model };
            }
        }
        return undefined;
    }

    reconcileStickyComposerPinnedAgent(
        current: string | undefined,
        agents: readonly QaapAgentTaskAgentOption[],
        defaultAgent: string | undefined,
        cwd: string | undefined,
    ): string | undefined {
        return reconcileStickyComposerAgent(
            current,
            agents,
            defaultAgent,
            cwd,
            !!this.getOfferableCoderAgent(),
        );
    }
    filterSelectableComposerAgents(
        agents: readonly QaapAgentTaskAgentOption[],
    ): QaapAgentTaskAgentOption[] {
        return filterQaapComposerAgents(agents);
    }
    getComposerAgentPickerAgents(
        agents: readonly QaapAgentTaskAgentOption[],
    ): QaapAgentTaskAgentOption[] {
        const disabledIds = readDisabledHarnessIds(
            this.host.readPreference?.(QAAP_DISABLED_HARNESSES_PREF),
        );
        return listQaapComposerPickerAgents(agents, disabledIds);
    }
    async refreshStickyComposerAgents(project: MobileProjectEntry, options?: { readonly forceRefresh?: boolean }): Promise<boolean> {
        this.host.activeTasks?.start();
        const cwd = this.host.projectsService.getProjectCwd(project) ?? this.host.preparedCwdByProjectId.get(project.id);
        try {
            const snapshot = await this.host.loadBackendAgentSnapshot(options);
            let pickerAgents = this.getComposerAgentPickerAgents(snapshot.agents);
            let filteredAgents = this.filterSelectableComposerAgents(pickerAgents);
            if (filteredAgents.length === 0) {
                await this.waitForSelectableActiveTaskAgents(3000);
                const liveAgents = this.filterSelectableComposerAgents(this.host.activeTasks?.getAgents() ?? []);
                if (liveAgents.length > 0) {
                    filteredAgents = liveAgents;
                    pickerAgents = this.getComposerAgentPickerAgents([...pickerAgents, ...liveAgents]);
                }
            }
            this.host.stickyComposerBackendAgents = pickerAgents;
            this.host.stickyComposerQaiqModels = snapshot.qaiqModels;
            const resolved = this.reconcileStickyComposerPinnedAgent(
                this.host.stickyComposerPinnedAgentId ?? readStoredAgent(cwd),
                filteredAgents,
                snapshot.defaultAgent,
                cwd,
            );
            const agentChanged = this.host.stickyComposerPinnedAgentId !== resolved;
            this.host.stickyComposerPinnedAgentId = resolved;
            const hadModel = resolved
                ? !!readStoredAgentModel(cwd, resolved)
                    || (this.host.stickyComposerPinnedAgentId === resolved && !!this.host.stickyComposerAgentModel)
                : false;
            const selection = await this.ensureStickyComposerAgentSelection(
                resolved,
                filteredAgents,
                cwd,
                snapshot.qaiqModels,
            );
            this.host.stickyComposerAgentModel = selection?.model;
            let modelAgentChanged = false;
            if (selection && selection.agentId !== resolved) {
                writeStoredAgent(cwd, selection.agentId);
                this.host.stickyComposerPinnedAgentId = selection.agentId;
                modelAgentChanged = true;
            }
            const effectiveAgentId = this.host.stickyComposerPinnedAgentId;
            const seededModel = !!effectiveAgentId && !hadModel && !!this.host.stickyComposerAgentModel;
            const firstSettle = this.settleStickyComposerAgentCatalog();
            if (agentChanged || modelAgentChanged || seededModel || firstSettle) {
                this.host.stickyComposerRenderUi.renderStickyComposer();
            }
            return true;
        } catch {
            await this.waitForSelectableActiveTaskAgents(1500);
            this.host.stickyComposerBackendAgents = this.getComposerAgentPickerAgents(this.host.activeTasks?.getAgents() ?? []);
            this.host.stickyComposerQaiqModels = [];
            if (this.settleStickyComposerAgentCatalog()) {
                this.host.stickyComposerRenderUi.renderStickyComposer();
            }
            return this.host.stickyComposerBackendAgents.length > 0;
        }
    }

    /** Marks the catalog as answered; true only the first time, so the pending label repaints once. */
    protected settleStickyComposerAgentCatalog(): boolean {
        if (this.stickyComposerAgentCatalogSettled) {
            return false;
        }
        this.stickyComposerAgentCatalogSettled = true;
        return true;
    }

    /**
     * Returns whether the backend catalog confirmed one harness as signed in. The login dialog
     * polls this to finish, so only an affirmative auth probe counts: `unknown` (probe still
     * running or timed out) once closed the dialog and killed the CLI before the user could
     * paste the authorization code, leaving the harness disconnected.
     */
    isAgentConnected(agentId: string | undefined): boolean {
        const normalizedAgentId = agentId?.trim().toLowerCase();
        if (!normalizedAgentId) {
            return false;
        }
        const agent = this.host.stickyComposerBackendAgents.find(
            candidate => candidate.id.trim().toLowerCase() === normalizedAgentId,
        );
        return agent?.available === true && agent.connectionState === 'connected';
    }

    showComposerAgentPickerLoading(chrome: ComposerAgentPickerChrome): void {
        renderAgentPickerSkeleton(chrome.list);
    }

    showComposerAgentPickerError(chrome: ComposerAgentPickerChrome, onRetry: () => void): void {
        renderAgentPickerLoadError(chrome.list, onRetry);
    }

    /** Catalog from the last successful sticky-composer refresh (empty until one completed). */
    getLoadedStickyComposerAgents(): readonly QaapAgentTaskAgentOption[] {
        return this.host.stickyComposerBackendAgents;
    }

    /**
     * Fill an agent picker. A previously loaded catalog is painted immediately and refreshed in the
     * background (only repainted when it changed and the user is still on the agent list); without
     * one the skeleton stays until the backend answers. Status probes on the backend can take
     * seconds, so the first paint must never wait for them when a catalog is already known.
     */
    loadComposerAgentPickerCatalog(
        chrome: ComposerAgentPickerChrome,
        options: {
            /** Last catalog this composer loaded; empty means nothing is known yet. */
            readonly cached: readonly QaapAgentTaskAgentOption[];
            readonly load: () => Promise<readonly QaapAgentTaskAgentOption[]>;
            readonly isCurrent: () => boolean;
            readonly render: (agents: readonly QaapAgentTaskAgentOption[]) => void;
            readonly onError: () => void;
        },
    ): void {
        const cached = options.cached.length > 0
            ? this.getComposerAgentPickerAgents(options.cached)
            : undefined;
        if (cached) {
            options.render(cached);
        } else {
            this.showComposerAgentPickerLoading(chrome);
        }
        void options.load().then(agents => {
            if (!options.isCurrent()) {
                return;
            }
            if (cached && (chrome.header.classList.contains('theia-mod-drilldown')
                || composerAgentCatalogSignature(agents) === composerAgentCatalogSignature(cached))) {
                return;
            }
            options.render(agents);
        }).catch(() => {
            // A stale-but-painted catalog stays usable; only an empty picker needs the retry state.
            if (options.isCurrent() && !cached) {
                options.onError();
            }
        });
    }

    async ensureStickyComposerAgentsLoaded(
        project: MobileProjectEntry,
        options?: { force?: boolean },
    ): Promise<readonly QaapAgentTaskAgentOption[]> {
        if (options?.force || this.host.stickyComposerBackendAgents.length === 0) {
            const loaded = await this.refreshStickyComposerAgents(project);
            if (!loaded) {
                throw new Error('Agent catalog unavailable');
            }
        }
        return this.getComposerAgentPickerAgents(this.host.stickyComposerBackendAgents);
    }

    async waitForSelectableActiveTaskAgents(timeoutMs: number): Promise<void> {
        const activeTasks = this.host.activeTasks;
        if (!activeTasks) {
            return;
        }
        const hasSelectable = (): boolean =>
            this.filterSelectableComposerAgents(activeTasks.getAgents()).length > 0;
        if (hasSelectable()) {
            return;
        }
        await new Promise<void>(resolve => {
            let disposable: Disposable | undefined;
            const timer = window.setTimeout(() => {
                disposable?.dispose();
                resolve();
            }, timeoutMs);
            disposable = activeTasks.onDidChange(() => {
                if (hasSelectable()) {
                    window.clearTimeout(timer);
                    disposable?.dispose();
                    resolve();
                }
            });
        });
    }
}

/** Stable identity of what an agent picker row shows, used to skip no-op background repaints. */
function composerAgentCatalogSignature(agents: readonly QaapAgentTaskAgentOption[]): string {
    return JSON.stringify(agents.map(agent => [agent.id, agent.label, agent.available, agent.connectionState]));
}
