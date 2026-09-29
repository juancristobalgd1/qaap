// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { ConfirmDialog, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { resolveWorkspaceHostFsPath } from '@theia/qaap-shared-core/lib/browser/qaap-project-bootstrap-shell';
import { isQaapWorkspaceContainerPath } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import {
    QAAP_AGENT_HOOKS_API_PATH,
    QAAP_WORKSPACE_HOOKS_RELATIVE_PATH,
    type QaapAgentHooksStatusResponse,
    type QaapAgentHookSummaryEntry,
    type QaapAgentHookTrustResponse,
} from '../common/qaap-agent-hooks';
import { QaapDeferredStartup } from './qaap-deferred-startup';

const FOCUS_RECHECK_INTERVAL_MS = 60_000;

/**
 * Workspace hook trust review. When the open project declares `.qaap/hooks.json` hooks that were
 * never reviewed (or changed since), shows a notice with Review / Ignore; Review opens a dialog with
 * every command in full, where the user can trust them. Nothing in that file runs until the user
 * trusts that exact declaration.
 */
@injectable()
export class QaapAgentHooksTrustContribution implements FrontendApplicationContribution {

    @inject(WorkspaceService)
    protected readonly workspace: WorkspaceService;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    @inject(QaapDeferredStartup)
    protected readonly deferredStartup: QaapDeferredStartup;

    /** Digests already offered in this window, so a dismissed notice does not nag on every focus. */
    protected readonly offeredDigests = new Set<string>();
    protected lastCheckAt = 0;

    onStart(): void {
        // Non-critical: the trust notice must not compete with first paint / Work Hub restore.
        this.deferredStartup.whenReadyAndIdle(() => {
            void this.workspace.ready.then(() => this.checkCurrentWorkspace());
        });
        this.workspace.onWorkspaceLocationChanged(() => {
            void this.checkCurrentWorkspace();
        });
        window.addEventListener('focus', () => {
            if (Date.now() - this.lastCheckAt >= FOCUS_RECHECK_INTERVAL_MS) {
                void this.checkCurrentWorkspace();
            }
        });
    }

    protected async checkCurrentWorkspace(): Promise<void> {
        this.lastCheckAt = Date.now();
        const cwd = await this.resolveCwd();
        if (!cwd) {
            return;
        }
        const status = await this.fetchStatus(cwd);
        const workspace = status?.workspace;
        if (!workspace || workspace.state !== 'pending' || !workspace.digest || this.offeredDigests.has(workspace.digest)) {
            return;
        }
        this.offeredDigests.add(workspace.digest);
        // The notice only offers a review: trusting happens in a dialog that lists every command in
        // full, so nothing can hide past a truncated summary.
        const review = nls.localize('qaap/agentHooks/review', 'Review');
        const ignore = nls.localize('qaap/agentHooks/ignore', 'Ignore');
        const notice = nls.localize(
            'qaap/agentHooks/reviewNotice',
            'This project declares {0} agent hook command(s) in {1} that run shell commands around agent turns. They will not run until you review and trust them.',
            workspace.hooks.length,
            QAAP_WORKSPACE_HOOKS_RELATIVE_PATH,
        );
        const choice = await this.messageService.warn(notice, review, ignore);
        let decision: 'trust' | 'ignore' | undefined;
        if (choice === ignore) {
            decision = 'ignore';
        } else if (choice === review) {
            decision = await this.openReviewDialog(workspace.hooks) ? 'trust' : undefined;
        }
        if (!decision) {
            return;
        }
        const result = await this.postDecision(decision, cwd, workspace.digest);
        if (!result?.ok) {
            // The file may have changed since the listing; allow a fresh review of the new digest.
            this.offeredDigests.delete(workspace.digest);
            this.messageService.error(result?.error ?? nls.localize('qaap/agentHooks/decisionFailed', 'Could not save the hooks review.'));
            return;
        }
        if (decision === 'trust') {
            this.messageService.info(nls.localize('qaap/agentHooks/trusted', 'Workspace agent hooks trusted. Any change to {0} requires a new review.', QAAP_WORKSPACE_HOOKS_RELATIVE_PATH));
        }
    }

    protected async resolveCwd(): Promise<string | undefined> {
        await this.workspace.ready;
        if (!this.workspace.opened) {
            return undefined;
        }
        const roots = await this.workspace.roots;
        const root = roots[0]?.resource;
        const cwd = root ? resolveWorkspaceHostFsPath(root) : undefined;
        return cwd && !isQaapWorkspaceContainerPath(cwd) ? cwd : undefined;
    }

    protected async fetchStatus(cwd: string): Promise<QaapAgentHooksStatusResponse | undefined> {
        try {
            const response = await fetch(`${QAAP_AGENT_HOOKS_API_PATH}?cwd=${encodeURIComponent(cwd)}`, { credentials: 'include', cache: 'no-store' });
            return response.ok ? await response.json() as QaapAgentHooksStatusResponse : undefined;
        } catch {
            return undefined;
        }
    }

    protected async postDecision(action: 'trust' | 'ignore', cwd: string, digest: string): Promise<QaapAgentHookTrustResponse | undefined> {
        try {
            const response = await fetch(`${QAAP_AGENT_HOOKS_API_PATH}/${action}`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cwd, digest }),
            });
            return await response.json() as QaapAgentHookTrustResponse;
        } catch {
            return undefined;
        }
    }

    /** Lists every declared command verbatim (no truncation); resolves `true` only on "Trust". */
    protected async openReviewDialog(hooks: readonly QaapAgentHookSummaryEntry[]): Promise<boolean> {
        const dialog = new ConfirmDialog({
            title: nls.localize('qaap/agentHooks/reviewTitle', 'Review agent hooks'),
            msg: this.renderReview(hooks),
            ok: nls.localize('qaap/agentHooks/trust', 'Trust'),
            cancel: nls.localizeByDefault('Cancel'),
        });
        return await dialog.open() === true;
    }

    protected renderReview(hooks: readonly QaapAgentHookSummaryEntry[]): HTMLElement {
        const root = document.createElement('div');
        root.className = 'qaap-agent-hooks-review';
        const intro = document.createElement('p');
        intro.textContent = nls.localize(
            'qaap/agentHooks/reviewIntro',
            'Trusting runs these commands in this project around every agent turn. Any change to {0} asks again, '
            + 'but scripts or programs these commands call are not part of the review: only trust a project you control.',
            QAAP_WORKSPACE_HOOKS_RELATIVE_PATH,
        );
        root.appendChild(intro);
        const list = document.createElement('ol');
        list.className = 'qaap-agent-hooks-review-list';
        for (const hook of hooks) {
            const item = document.createElement('li');
            const label = document.createElement('div');
            label.className = 'qaap-agent-hooks-review-event';
            label.textContent = `${hook.event}${hook.matcher ? ` (${hook.matcher})` : ''} · ${hook.timeoutSec}s`;
            const command = document.createElement('pre');
            command.className = 'qaap-agent-hooks-review-command';
            // textContent: the command is untrusted repository content and must never be parsed as HTML.
            command.textContent = hook.command;
            item.append(label, command);
            list.appendChild(item);
        }
        root.appendChild(list);
        return root;
    }
}
