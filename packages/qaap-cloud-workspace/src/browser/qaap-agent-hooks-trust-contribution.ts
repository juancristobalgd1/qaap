// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { resolveWorkspaceHostFsPath } from '@theia/qaap-shared-core/lib/browser/qaap-project-bootstrap-shell';
import { isQaapWorkspaceContainerPath } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import {
    QAAP_AGENT_HOOKS_API_PATH,
    QAAP_WORKSPACE_HOOKS_RELATIVE_PATH,
    type QaapAgentHooksStatusResponse,
    type QaapAgentHookTrustResponse,
} from '../common/qaap-agent-hooks';
import { QaapDeferredStartup } from './qaap-deferred-startup';

const MAX_LISTED_COMMANDS = 5;
const MAX_COMMAND_CHARS = 120;
const FOCUS_RECHECK_INTERVAL_MS = 60_000;

/**
 * Workspace hook trust review. When the open project declares `.qaap/hooks.json` hooks that were
 * never reviewed (or changed since), shows a notice listing the commands with Trust / Ignore.
 * Nothing in that file runs until the user trusts that exact declaration.
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
        const trust = nls.localize('qaap/agentHooks/trust', 'Trust');
        const ignore = nls.localize('qaap/agentHooks/ignore', 'Ignore');
        const listed = workspace.hooks.slice(0, MAX_LISTED_COMMANDS)
            .map(hook => `${hook.event}${hook.matcher ? ` (${hook.matcher})` : ''}: ${this.truncate(hook.command)}`)
            .join(' · ');
        const more = workspace.hooks.length > MAX_LISTED_COMMANDS
            ? ' ' + nls.localize('qaap/agentHooks/moreCommands', '(+{0} more)', workspace.hooks.length - MAX_LISTED_COMMANDS)
            : '';
        const message = nls.localize(
            'qaap/agentHooks/reviewPrompt',
            'This project declares agent hooks in {0} that run shell commands around agent turns. They will not run until you trust them: {1}{2}',
            QAAP_WORKSPACE_HOOKS_RELATIVE_PATH,
            listed,
            more,
        );
        const choice = await this.messageService.warn(message, trust, ignore);
        if (choice !== trust && choice !== ignore) {
            return;
        }
        const result = await this.postDecision(choice === trust ? 'trust' : 'ignore', cwd, workspace.digest);
        if (!result?.ok) {
            // The file may have changed since the listing; allow a fresh review of the new digest.
            this.offeredDigests.delete(workspace.digest);
            this.messageService.error(result?.error ?? nls.localize('qaap/agentHooks/decisionFailed', 'Could not save the hooks review.'));
            return;
        }
        if (choice === trust) {
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

    protected truncate(command: string): string {
        const oneLine = command.replace(/\s+/g, ' ');
        return oneLine.length > MAX_COMMAND_CHARS ? `${oneLine.slice(0, MAX_COMMAND_CHARS - 1)}…` : oneLine;
    }
}
