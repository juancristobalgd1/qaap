// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import { ChatAgent } from '@theia/ai-chat';
import { ChatAgentService } from '@theia/ai-chat/lib/common/chat-agent-service';
import {
    agentSupportsModelPicker,
    filterQaapComposerAgents,
    isTheiaCoderAgent,
    QAAP_COMPOSER_DEFAULT_AGENT_ID,
    readStoredAgent,
    readStoredAgentModel,
    reconcileStickyComposerAgent,
    THEIA_CODER_AGENT_ID,
    writeStoredAgent,
    type QaapAgentTaskAgentOption,
    type QaapAgentTaskListSnapshot,
    type QaapCreateAgentTaskQaiqModel,
    type QaapQaiqModelOption,
} from '../common/qaap-agent-task-client';
import { formatQaiqModelSelectionLabel } from '../common/qaap-qaiq-model-catalog';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsService } from './mobile-projects-service';
import type { MobileProjectsActiveTasks } from './mobile-projects-active-tasks';
import type { ComposerAgentPickerChrome } from './mobile-projects-sticky-composer-sheets-ui';
import { renderAgentPickerLoadError, renderAgentPickerSkeleton } from './qaap-agent-picker-loading';

export interface MobileProjectsStickyComposerAgentsHost {
    stickyComposerPinnedAgentId: string | undefined;
    stickyComposerBackendAgents: QaapAgentTaskAgentOption[];
    stickyComposerQaiqModels: QaapQaiqModelOption[];
    preparedCwdByProjectId: Map<string, string>;
    projectsService: MobileProjectsService;
    chatAgentService?: ChatAgentService;
    activeTasks?: MobileProjectsActiveTasks;
    stickyComposerRenderUi: import('./mobile-projects-sticky-composer-render-ui').MobileProjectsStickyComposerRenderUi;
    loadBackendAgentSnapshot(): Promise<QaapAgentTaskListSnapshot>;
    resolveConversationAgentLabel(agentId: string | undefined): string;
    projectRowsUi: import('./mobile-projects-project-rows-ui').MobileProjectsProjectRowsUi;
}

export class MobileProjectsStickyComposerAgentsUi {
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
        // Always reconcile through the product default (QAIQ) so every user lands on QAIQ
        // when nothing is pinned/stored — never the first arbitrary detected CLI.
        return this.reconcileStickyComposerPinnedAgent(
            this.host.stickyComposerPinnedAgentId ?? readStoredAgent(cwd),
            this.host.stickyComposerBackendAgents,
            QAAP_COMPOSER_DEFAULT_AGENT_ID,
            cwd,
        );
    }
    resolveStickyComposerAgentLabel(project?: MobileProjectEntry): string {
        const pinned = this.host.stickyComposerPinnedAgentId;
        if (isTheiaCoderAgent(pinned)) {
            return this.host.chatAgentService?.getAgent(THEIA_CODER_AGENT_ID)?.name ?? 'Coder';
        }
        const fromList = this.host.stickyComposerBackendAgents.find(a => a.id === pinned)?.label;
        if (fromList) {
            return fromList;
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
        return readStoredAgentModel(cwd, agentId);
    }
    resolveStickyComposerModelLabel(
        agentId: string,
        project?: MobileProjectEntry,
        composerCwd?: string,
    ): string | undefined {
        const model = this.resolveStickyComposerAgentModel(agentId, project, composerCwd);
        return model ? formatQaiqModelSelectionLabel(model) : undefined;
    }
    reconcileStickyComposerPinnedAgent(
        current: string | undefined,
        agents: readonly QaapAgentTaskAgentOption[],
        defaultAgent: string | undefined,
        cwd: string | undefined,
    ): string {
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
    async refreshStickyComposerAgents(project: MobileProjectEntry): Promise<boolean> {
        this.host.activeTasks?.start();
        const cwd = this.host.projectsService.getProjectCwd(project) ?? this.host.preparedCwdByProjectId.get(project.id);
        try {
            const snapshot = await this.host.loadBackendAgentSnapshot();
            let filteredAgents = this.filterSelectableComposerAgents(snapshot.agents);
            if (filteredAgents.length === 0) {
                await this.waitForSelectableActiveTaskAgents(3000);
                const liveAgents = this.filterSelectableComposerAgents(this.host.activeTasks?.getAgents() ?? []);
                if (liveAgents.length > 0) {
                    filteredAgents = liveAgents;
                }
            }
            this.host.stickyComposerBackendAgents = filteredAgents;
            this.host.stickyComposerQaiqModels = snapshot.qaiqModels;
            const resolved = this.reconcileStickyComposerPinnedAgent(
                this.host.stickyComposerPinnedAgentId ?? readStoredAgent(cwd),
                filteredAgents,
                // Prefer product default (QAIQ) over server defaultAgent so all users share
                // the same first-run agent when QAIQ is installed.
                QAAP_COMPOSER_DEFAULT_AGENT_ID,
                cwd,
            );
            if (this.host.stickyComposerPinnedAgentId !== resolved) {
                this.host.stickyComposerPinnedAgentId = resolved;
                this.host.stickyComposerRenderUi.renderStickyComposer();
            }
            // Persist the default so later surfaces that only read storage also see QAIQ.
            if (cwd && !readStoredAgent(cwd) && resolved) {
                writeStoredAgent(cwd, resolved);
            }
            return true;
        } catch {
            await this.waitForSelectableActiveTaskAgents(1500);
            this.host.stickyComposerBackendAgents = this.filterSelectableComposerAgents(this.host.activeTasks?.getAgents() ?? []);
            this.host.stickyComposerQaiqModels = [];
            return this.host.stickyComposerBackendAgents.length > 0;
        }
    }

    showComposerAgentPickerLoading(chrome: ComposerAgentPickerChrome): void {
        renderAgentPickerSkeleton(chrome.list);
    }

    showComposerAgentPickerError(chrome: ComposerAgentPickerChrome, onRetry: () => void): void {
        renderAgentPickerLoadError(chrome.list, onRetry);
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
        return this.filterSelectableComposerAgents(this.host.stickyComposerBackendAgents);
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
