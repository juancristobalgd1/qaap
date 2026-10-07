// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as path from 'path';
import { inject, injectable } from '@theia/core/shared/inversify';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { qaapProjectRemovalIdentity } from '@theia/qaap-shared-core/lib/common/qaap-project-removal-identity';
import { normalizeQaapPreviewProjectId } from '@theia/qaap-shared-core/lib/common/qaap-preview-identity';
import type {
    QaapRepositoryRemoval,
    QaapRepositoryRemovalContribution,
} from '@theia/qaap-shared-core/lib/node/qaap-repository-removal-contribution';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import { QaapHostedWorkspaceServer } from './qaap-hosted-workspace-server';
import { QaapTerminalSessionStore } from './qaap-terminal-session-store';

/**
 * Forgets what still points at a clone the user removed: its conversations (cwd in the clone or in one
 * of its task worktrees) are archived, its terminal sessions and recent-workspace entries deleted.
 * Otherwise any of them lists the project in the hub again (production, Oct 2026).
 */
@injectable()
export class QaapRemovedRepositoryCleanup implements QaapRepositoryRemovalContribution {

    @inject(QaapAgentConversationStore)
    protected readonly conversations: QaapAgentConversationStore;

    @inject(QaapTerminalSessionStore)
    protected readonly terminalSessions: QaapTerminalSessionStore;

    @inject(QaapHostedWorkspaceServer)
    protected readonly workspaceServer: QaapHostedWorkspaceServer;

    /**
     * Each kind of state is forgotten on its own: archiving waits until the conversation store restored
     * (task recovery, turn auto-resume: minutes after a restart), and the terminal sessions and recent
     * workspaces it gated stayed behind (production, Oct 2026). Rejects when any of them failed.
     */
    async onRepositoryRemoved(removal: QaapRepositoryRemoval): Promise<void> {
        const inRepository = (location: string | undefined): boolean => this.isInRemovedRepository(removal, location);
        const results = await Promise.allSettled([
            this.terminalSessions.deleteWorkspaces(removal.login, inRepository),
            this.workspaceServer.removeRecentWorkspacesOf(removal.login, inRepository),
            this.archiveConversations(removal, inRepository),
        ]);
        const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failure) {
            throw failure.reason;
        }
    }

    /** Archived, not deleted: the transcripts stay recoverable, the hub just stops listing them. */
    protected async archiveConversations(removal: QaapRepositoryRemoval, inRepository: (location: string | undefined) => boolean): Promise<void> {
        await this.conversations.whenReady();
        const login = removal.login.toLowerCase();
        for (const group of this.conversations.listAllGroupedByCwd()) {
            for (const summary of group.conversations) {
                const conversation = this.conversations.get(summary.id);
                if (!conversation || conversation.archived
                    || (conversation.ownerLogin && conversation.ownerLogin.toLowerCase() !== login)) {
                    continue;
                }
                if (inRepository(conversation.cwd) || inRepository(conversation.parallelBaseCwd)) {
                    this.conversations.update(conversation.id, { archived: true });
                }
            }
        }
    }

    /** `location` is a path, a `file:` URI or a `ws:`/`recent:` hub key, in the clone or one of its task worktrees. */
    protected isInRemovedRepository(removal: QaapRepositoryRemoval, location: string | undefined): boolean {
        if (!location) {
            return false;
        }
        if (qaapProjectRemovalIdentity(location, removal.userReposRoot) === removal.identity) {
            return true;
        }
        if (removal.worktreePaths.length === 0) {
            return false;
        }
        const target = normalizeQaapPreviewProjectId(location);
        // Resolve both sides: on Windows a cwd may mix `/` and `\\` and differ in case from the registered worktree.
        const comparable = (value: string): string => {
            const resolved = path.resolve(value);
            return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
        };
        const fsPath = comparable(/^file:\/\//i.test(target) ? FileUri.fsPath(target) : target);
        return removal.worktreePaths.map(comparable).some(worktree => fsPath === worktree || fsPath.startsWith(`${worktree}${path.sep}`));
    }
}
