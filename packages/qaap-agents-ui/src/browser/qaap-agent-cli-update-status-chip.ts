// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { nls } from '@theia/core/lib/common/nls';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { QaapAgentCliUpdateTracker, type QaapAgentCliUpdateJob } from './qaap-agent-cli-update-tracker';

/**
 * Compact status chips for harness updates, stacked in the top-right corner (the same edge the
 * update notice and outcome snackbars use, because the composer owns the bottom). Each chip is a
 * `role="status"` live region; hover or focus (or a click) opens its details. A failed chip stays
 * until the user dismisses it; a successful one removes itself through the tracker.
 */
@injectable()
export class QaapAgentCliUpdateStatusChip implements FrontendApplicationContribution {

    @inject(QaapAgentCliUpdateTracker)
    protected readonly tracker: QaapAgentCliUpdateTracker;

    protected root: HTMLElement | undefined;
    protected readonly expandedIds = new Set<string>();
    protected elapsedTimer: ReturnType<typeof setInterval> | undefined;
    protected unsubscribe: { dispose(): void } | undefined;

    onStart(): void {
        this.root = document.createElement('div');
        this.root.className = 'qaap-agent-cli-update-status-stack';
        this.root.setAttribute('aria-live', 'polite');
        this.root.hidden = true;
        document.body.append(this.root);
        this.unsubscribe = this.tracker.onDidChange(() => this.render());
        this.render();
    }

    onStop(): void {
        this.unsubscribe?.dispose();
        this.unsubscribe = undefined;
        this.stopElapsedTimer();
        this.root?.remove();
        this.root = undefined;
    }

    protected render(): void {
        const root = this.root;
        if (!root) {
            return;
        }
        const jobs = this.tracker.getJobs();
        root.replaceChildren(...jobs.map(job => this.renderChip(job)));
        root.hidden = jobs.length === 0;
        this.updateElapsedTimer(jobs);
    }

    protected renderChip(job: QaapAgentCliUpdateJob): HTMLElement {
        const label = job.info.label;
        const chip = document.createElement('div');
        chip.className = `qaap-agent-cli-update-status qaap-mod-${job.status}`;
        chip.dataset.agentId = job.info.id;
        if (this.expandedIds.has(job.info.id)) {
            chip.classList.add('qaap-mod-open');
        }

        const row = document.createElement('div');
        row.className = 'qaap-agent-cli-update-status-row';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'qaap-agent-cli-update-status-toggle';
        toggle.setAttribute('aria-expanded', String(this.expandedIds.has(job.info.id)));
        toggle.addEventListener('click', () => this.toggleExpanded(job.info.id));

        const icon = document.createElement('span');
        icon.className = 'qaap-agent-cli-update-status-icon';
        icon.setAttribute('aria-hidden', 'true');
        if (job.status === 'updating') {
            icon.classList.add('codicon', 'codicon-loading', 'codicon-modifier-spin');
        } else if (job.status === 'succeeded') {
            icon.classList.add('codicon', 'codicon-check');
        } else {
            icon.classList.add('codicon', 'codicon-error');
        }
        toggle.append(icon);

        const text = document.createElement('span');
        text.className = 'qaap-agent-cli-update-status-label';
        text.textContent = job.status === 'updating'
            ? nls.localize('qaap/agentCliUpdate/status/updating', 'Updating {0}…', label)
            : job.status === 'succeeded'
                ? nls.localize('qaap/agentCliUpdate/status/updated', '{0} updated to {1}', label, job.installedVersion ?? job.info.latestVersion)
                : nls.localize('qaap/agentCliUpdate/status/failed', '{0} update failed', label);
        toggle.append(text);
        row.append(toggle);

        if (job.status === 'failed') {
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'qaap-agent-cli-update-status-action qaap-mod-retry';
            retry.textContent = nls.localize('qaap/agentCliUpdate/retry', 'Retry');
            retry.addEventListener('click', () => { void this.tracker.start(job.info); });
            row.append(retry);
        }

        if (job.status !== 'updating') {
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'qaap-agent-cli-update-status-close';
            close.title = nls.localize('qaap/agentCliUpdate/dismiss', 'Dismiss');
            close.setAttribute('aria-label', close.title);
            const closeIcon = document.createElement('span');
            closeIcon.className = 'codicon codicon-close';
            closeIcon.setAttribute('aria-hidden', 'true');
            close.append(closeIcon);
            close.addEventListener('click', () => this.tracker.dismiss(job.info.id));
            row.append(close);
        }
        chip.append(row);

        chip.append(this.renderDetails(job));
        return chip;
    }

    protected renderDetails(job: QaapAgentCliUpdateJob): HTMLElement {
        const details = document.createElement('div');
        details.className = 'qaap-agent-cli-update-status-details';
        const addLine = (text: string, className?: string): void => {
            const line = document.createElement('div');
            line.className = className ?? 'qaap-agent-cli-update-status-line';
            line.textContent = text;
            details.append(line);
        };
        addLine(nls.localize('qaap/agentCliUpdate/status/harness', 'Harness: {0}', job.info.label));
        addLine(nls.localize('qaap/agentCliUpdate/status/target', 'Target version: {0}', job.info.latestVersion));
        if (job.status === 'updating') {
            const elapsed = document.createElement('div');
            elapsed.className = 'qaap-agent-cli-update-status-line';
            elapsed.dataset.elapsed = 'true';
            elapsed.textContent = this.formatElapsed(job);
            details.append(elapsed);
        } else {
            const total = job.finishedAt !== undefined ? job.finishedAt - job.startedAt : 0;
            addLine(nls.localize('qaap/agentCliUpdate/status/took', 'Took {0} s', Math.max(1, Math.round(total / 1000))));
        }
        if (job.status === 'failed') {
            addLine(
                job.detail ?? nls.localize(
                    'qaap/agentCliUpdate/updateFailedRetry',
                    'Could not update {0}. Try again in a moment.',
                    job.info.label,
                ),
                'qaap-agent-cli-update-status-error',
            );
        }
        return details;
    }

    /** Flip the details in place so the focused toggle keeps keyboard focus (no re-render). */
    protected toggleExpanded(agentId: string): void {
        const open = !this.expandedIds.has(agentId);
        if (open) {
            this.expandedIds.add(agentId);
        } else {
            this.expandedIds.delete(agentId);
        }
        const chip = this.root?.querySelector<HTMLElement>(`.qaap-agent-cli-update-status[data-agent-id="${agentId}"]`);
        chip?.classList.toggle('qaap-mod-open', open);
        chip?.querySelector('.qaap-agent-cli-update-status-toggle')?.setAttribute('aria-expanded', String(open));
    }

    protected formatElapsed(job: QaapAgentCliUpdateJob): string {
        const seconds = Math.max(0, Math.floor((Date.now() - job.startedAt) / 1000));
        return nls.localize('qaap/agentCliUpdate/status/elapsed', 'Elapsed: {0} s', seconds);
    }

    /** Refresh only the elapsed counter (no re-render, so buttons keep focus) while a job runs. */
    protected updateElapsedTimer(jobs: readonly QaapAgentCliUpdateJob[]): void {
        const running = jobs.filter(job => job.status === 'updating');
        if (running.length === 0) {
            this.stopElapsedTimer();
            return;
        }
        if (this.elapsedTimer !== undefined) {
            return;
        }
        this.elapsedTimer = setInterval(() => {
            for (const job of this.tracker.getJobs()) {
                if (job.status !== 'updating') {
                    continue;
                }
                const node = this.root?.querySelector<HTMLElement>(`[data-agent-id="${job.info.id}"] [data-elapsed]`);
                if (node) {
                    node.textContent = this.formatElapsed(job);
                }
            }
        }, 1000);
    }

    protected stopElapsedTimer(): void {
        if (this.elapsedTimer !== undefined) {
            clearInterval(this.elapsedTimer);
            this.elapsedTimer = undefined;
        }
    }
}
