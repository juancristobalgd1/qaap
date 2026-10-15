// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { ConfirmDialog } from '@theia/core/lib/browser';
import { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { MobileProjectsActiveTasks } from '@theia/qaap-shared-core/lib/browser/mobile-projects-active-tasks';
import {
    applyConversationWorktree,
    type QaapAgentConversationSummaryDTO,
    type QaapApplyConversationWorktreeResultDTO,
    type QaapWorktreeApplyAction,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { filterUiSelectableVpsAgents, type QaapAgentTaskAgentOption } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { createDiffStatsLine } from '@theia/qaap-agents-ui/lib/browser/qaap-agent-ui';
import { MobileSnackbar } from '@theia/qaap-mobile-shell/lib/browser/mobile-snackbar';

export interface MobileProjectsParallelUiDeps {
    getAgents(): QaapAgentTaskAgentOption[];
    onRunsChanged(): void;
    onOpenSessionsSidebar?(): void;
    buildVariantTaskRow(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        activeInfo: ReturnType<MobileProjectsActiveTasks['getForCwd']>,
        parentIds: ReadonlySet<string>,
        options?: { compact?: boolean; onActivate?: () => void },
    ): HTMLElement;
}

/** Isolated Parallel fork groups in Chats and the Keep / Merge / Discard sheet for worktree threads. */
export class MobileProjectsParallelUi {
    protected sheetRoot: HTMLElement | undefined;
    protected busy = false;

    constructor(protected readonly deps: MobileProjectsParallelUiDeps) { }

    closeSheet(): void {
        this.sheetRoot?.remove();
        this.sheetRoot = undefined;
        this.busy = false;
    }

    dispose(): void {
        this.closeSheet();
    }

    appendTranscriptHeaderActions(
        header: HTMLElement,
        title: HTMLElement,
    ): HTMLButtonElement {
        const titleRow = document.createElement('div');
        titleRow.className = 'theia-mobile-agent-log-title-row';
        const leading: HTMLElement[] = [];
        if (this.deps.onOpenSessionsSidebar) {
            const menuBtn = document.createElement('button');
            menuBtn.type = 'button';
            menuBtn.className = 'theia-mobile-agent-log-title-menu theia-mobile-projects-header-back';
            menuBtn.title = nls.localize('qaap/sessionsSidebar/open', 'Open session history');
            menuBtn.setAttribute('aria-label', menuBtn.title);
            menuBtn.innerHTML = '<span class="codicon codicon-menu" aria-hidden="true"></span>';
            menuBtn.addEventListener('click', ev => {
                ev.stopPropagation();
                this.deps.onOpenSessionsSidebar?.();
            });
            leading.push(menuBtn);
        }
        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'theia-mobile-agent-log-title-back theia-mobile-projects-header-back';
        backBtn.title = nls.localize('qaap/mobileProjects/backFromTranscript', 'Back');
        backBtn.setAttribute('aria-label', backBtn.title);
        backBtn.innerHTML = '<span class="codicon codicon-chevron-left" aria-hidden="true"></span>';
        const titleWrap = document.createElement('div');
        titleWrap.className = 'theia-mobile-agent-log-title-wrap';
        titleWrap.append(title);
        titleRow.append(...leading, backBtn, titleWrap);
        header.append(titleRow);
        return backBtn;
    }

    /** Group of isolated Parallel worktree forks nested under their parent conversation. */
    createVariantRunSection(
        project: MobileProjectEntry,
        parentId: string,
        summaries: QaapAgentConversationSummaryDTO[],
        activeInfo: ReturnType<MobileProjectsActiveTasks['getForCwd']>,
        parentIds: ReadonlySet<string>,
        options?: {
            compact?: boolean;
            onActivate?: (summary: QaapAgentConversationSummaryDTO) => void;
        },
    ): HTMLElement {
        const wrap = document.createElement('section');
        wrap.className = 'theia-mobile-projects-variant-group theia-mod-isolated-forks';
        wrap.dataset.isolatedForkParentId = parentId;
        if (options?.compact) {
            wrap.classList.add('theia-mod-compact');
        }

        const head = document.createElement('div');
        head.className = 'theia-mobile-projects-variant-head';
        const label = document.createElement('span');
        label.className = 'theia-mobile-projects-variant-label';
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-repo-forked';
        icon.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.textContent = nls.localize('qaap/mobileProjects/isolatedForkGroup', 'Parallel · {0}', String(summaries.length));
        label.append(icon, text);
        const discard = document.createElement('button');
        discard.type = 'button';
        discard.className = 'theia-mobile-projects-variant-discard';
        discard.textContent = nls.localize('qaap/mobileProjects/parallelDiscard', 'Discard');
        discard.disabled = summaries.some(summary => summary.status === 'streaming');
        discard.addEventListener('click', ev => {
            ev.stopPropagation();
            void this.discardIsolatedForks(summaries);
        });
        head.append(label, discard);
        wrap.append(head);

        const list = document.createElement('div');
        list.className = 'theia-mobile-projects-chats-list';
        for (const summary of summaries) {
            const row = document.createElement('div');
            row.className = 'theia-mobile-projects-variant-row';
            row.append(this.deps.buildVariantTaskRow(project, summary, activeInfo, parentIds, {
                compact: options?.compact,
                onActivate: options?.onActivate ? () => options.onActivate?.(summary) : undefined,
            }));
            const side = document.createElement('div');
            side.className = 'theia-mobile-projects-variant-side';
            const meta = document.createElement('div');
            meta.className = 'theia-mobile-projects-variant-meta';
            meta.dataset.parallelConversationId = summary.id;
            meta.append(createDiffStatsLine({
                added: summary.linesAdded,
                removed: summary.linesRemoved,
            }));
            const choose = document.createElement('button');
            choose.type = 'button';
            choose.className = 'theia-mobile-projects-variant-choose';
            choose.textContent = nls.localize('qaap/mobileProjects/parallelChoose', 'Choose');
            choose.disabled = summary.status === 'streaming';
            choose.addEventListener('click', ev => {
                ev.stopPropagation();
                this.openVariantChooseSheet(summary);
            });
            side.append(meta, choose);
            row.append(side);
            list.append(row);
        }
        wrap.append(list);
        return wrap;
    }

    protected availableAgents(): QaapAgentTaskAgentOption[] {
        const agents = this.deps.getAgents();
        const selectable = filterUiSelectableVpsAgents(agents);
        return selectable.length > 0 ? selectable : agents;
    }

    protected parallelAgentLabel(agentId: string): string {
        return this.availableAgents().find(agent => agent.id === agentId)?.label ?? `@${agentId}`;
    }

    openVariantChooseSheet(summary: QaapAgentConversationSummaryDTO): void {
        this.closeSheet();
        const root = document.createElement('div');
        root.className = 'theia-mobile-agent-log theia-mobile-parallel-root theia-mod-visible';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        const backdrop = document.createElement('div');
        backdrop.className = 'theia-mobile-agent-log-backdrop';
        backdrop.addEventListener('click', () => this.closeSheet());
        const sheet = document.createElement('section');
        sheet.className = 'theia-mobile-agent-log-sheet theia-mod-parallel';
        const header = document.createElement('header');
        header.className = 'theia-mobile-agent-log-header';
        const title = document.createElement('h2');
        title.textContent = nls.localize('qaap/mobileProjects/parallelChooseAction', 'Keep {0}?', this.parallelAgentLabel(summary.agentId));
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'theia-mobile-agent-log-close codicon codicon-close';
        close.addEventListener('click', () => this.closeSheet());
        header.append(title, close);
        const body = document.createElement('div');
        body.className = 'theia-mobile-parallel-body';
        const actions: Array<{ id: QaapWorktreeApplyAction; label: string }> = [
            { id: 'keep-branch', label: nls.localize('qaap/mobileProjects/parallelKeepBranch', 'Keep its branch (safe)') },
            { id: 'merge', label: nls.localize('qaap/mobileProjects/parallelMerge', 'Merge into current branch') },
            { id: 'none', label: nls.localize('qaap/mobileProjects/parallelNoGit', 'Just close (no git change)') },
        ];
        for (const action of actions) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'theia-mobile-parallel-action';
            btn.textContent = action.label;
            btn.addEventListener('click', () => { void this.performParallelChoose(summary.id, action.id); });
            body.append(btn);
        }
        sheet.append(header, body);
        root.append(backdrop, sheet);
        document.body.append(root);
        this.sheetRoot = root;
    }

    protected async performParallelChoose(conversationId: string, action: QaapWorktreeApplyAction): Promise<void> {
        if (this.busy) {
            return;
        }
        this.busy = true;
        try {
            const result = await applyConversationWorktree(conversationId, action);
            if (!result.ok) {
                MobileSnackbar.show(this.mergeRefusalMessage(result), { kind: 'warning', duration: result.reason ? 6000 : undefined });
                return;
            }
            const msg = action === 'merge'
                ? nls.localize('qaap/mobileProjects/parallelMerged', 'Merged {0}', result.branch ?? '')
                : action === 'keep-branch'
                    ? nls.localize('qaap/mobileProjects/parallelKept', 'Kept branch {0}', result.branch ?? '')
                    : nls.localize('qaap/mobileProjects/parallelClosed', 'Done');
            MobileSnackbar.show(msg, { kind: 'success', duration: 2200 });
            this.closeSheet();
            this.deps.onRunsChanged();
        } catch (error) {
            MobileSnackbar.show(error instanceof Error ? error.message : String(error), { kind: 'warning' });
        } finally {
            this.busy = false;
        }
    }

    /** Explain a refused merge-back; the server guarantees nothing was changed. */
    protected mergeRefusalMessage(result: QaapApplyConversationWorktreeResultDTO): string {
        switch (result.reason) {
            case 'busy':
                return nls.localize('qaap/mobileProjects/mergeBusy', 'Another thread is running in this repository; merge when it finishes.');
            case 'conflict':
                return nls.localize('qaap/mobileProjects/mergeConflicts', 'Merge conflicts in {0}. Nothing was changed; resolve them in the thread and merge again.',
                    (result.conflicts ?? []).join(', '));
            case 'target-moved':
                return nls.localize('qaap/mobileProjects/mergeTargetMoved', 'The branch changed while merging. Nothing was changed; merge again.');
            case 'local-changes':
                return nls.localize('qaap/mobileProjects/mergeLocalChanges', 'Your uncommitted changes would be overwritten. Commit or stash them, then merge again.');
            case 'detached':
                return nls.localize('qaap/mobileProjects/mergeDetached', 'The repository is not on a branch. Check out a branch, then merge again.');
            default:
                return result.error ?? nls.localize('qaap/mobileProjects/parallelChooseFailed', 'Could not apply that action');
        }
    }

    protected async discardIsolatedForks(summaries: readonly QaapAgentConversationSummaryDTO[]): Promise<void> {
        const confirmed = await new ConfirmDialog({
            title: nls.localize('qaap/mobileProjects/isolatedForkDiscardTitle', 'Discard parallel forks'),
            msg: nls.localize(
                'qaap/mobileProjects/isolatedForkDiscardConfirm',
                'Discard these parallel worktrees? Branches and chats will be removed. The original session stays.',
            ),
            ok: nls.localize('qaap/mobileProjects/parallelDiscard', 'Discard'),
            cancel: nls.localize('qaap/mobileProjects/parallelCancel', 'Back'),
        }).open();
        if (!confirmed) {
            return;
        }
        const errors: string[] = [];
        for (const summary of summaries) {
            try {
                const result = await applyConversationWorktree(summary.id, 'none');
                if (!result.ok) {
                    errors.push(result.error ?? summary.title);
                }
            } catch (error) {
                errors.push(error instanceof Error ? error.message : String(error));
            }
        }
        if (errors.length > 0) {
            MobileSnackbar.show(errors[0]!, { kind: 'warning' });
        } else {
            MobileSnackbar.show(nls.localize('qaap/mobileProjects/isolatedForkDiscarded', 'Parallel forks discarded'), { kind: 'success', duration: 1800 });
        }
        this.deps.onRunsChanged();
    }
}
