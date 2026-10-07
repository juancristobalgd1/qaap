// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapRepositoryRemoval } from '@theia/qaap-shared-core/lib/node/qaap-repository-removal-contribution';
import { QaapRemovedRepositoryCleanup } from './qaap-removed-repository-cleanup';
import { QaapTerminalSessionStore } from './qaap-terminal-session-store';

type TerminalRows = Record<string, { updatedAt: string; terminals: never[]; ownerLogin?: string }>;

class InMemoryTerminalSessionStore extends QaapTerminalSessionStore {
    rows: TerminalRows = {};
    protected override async readAll(): Promise<TerminalRows> {
        return { ...this.rows };
    }
    protected override async writeAll(data: TerminalRows): Promise<void> {
        this.rows = { ...data };
    }
}

interface FakeConversation {
    id: string;
    cwd: string;
    parallelBaseCwd?: string;
    ownerLogin?: string;
    archived?: boolean;
}

// Production (juancristobalgd1, Oct 7 2026): vyyq was removed, yet its terminal session, its conversations
// (in the clone and in task worktree 733cf503) and its recent-workspace entry kept naming it.
describe('QaapRemovedRepositoryCleanup', () => {

    const login = 'juancristobalgd1';
    const userReposRoot = '/workspace/repos/users/juancristobalgd1';
    const clone = `${userReposRoot}/juancristobalgd1/vyyq`;
    const other = `${userReposRoot}/juancristobalgd1/other`;
    const worktree = '/opt/qaap-runtime/worktrees/juancristobalgd1/733cf503';
    const removal: QaapRepositoryRemoval = {
        login,
        identity: 'github:juancristobalgd1/vyyq',
        clonePath: clone,
        userReposRoot,
        worktreePaths: [worktree],
    };

    let conversations: FakeConversation[];
    let terminals: InMemoryTerminalSessionStore;
    let recentRoots: string[];
    let cleanup: QaapRemovedRepositoryCleanup;

    beforeEach(() => {
        conversations = [
            { id: 'chat', cwd: clone, ownerLogin: login },
            { id: 'task', cwd: worktree, parallelBaseCwd: clone, ownerLogin: login },
            { id: 'task-no-base', cwd: `${worktree}/web`, ownerLogin: login },
            { id: 'other', cwd: other, ownerLogin: login },
            { id: 'someone-else', cwd: clone, ownerLogin: 'mallory' },
        ];
        terminals = new InMemoryTerminalSessionStore();
        terminals.rows = {
            [`user:${login}:ws:file://${clone}`]: { updatedAt: '', terminals: [], ownerLogin: login },
            [`user:${login}:ws:file://${other}`]: { updatedAt: '', terminals: [], ownerLogin: login },
            [`user:mallory:ws:file://${clone}`]: { updatedAt: '', terminals: [], ownerLogin: 'mallory' },
        };
        recentRoots = [`file://${clone}`, `file://${other}`];
        cleanup = new QaapRemovedRepositoryCleanup();
        Object.assign(cleanup, {
            conversations: {
                whenReady: async () => undefined,
                listAllGroupedByCwd: () => [{ cwd: '', projectName: '', streamingCount: 0, conversations: conversations.map(({ id, cwd }) => ({ id, cwd })) }],
                get: (id: string) => conversations.find(conversation => conversation.id === id),
                update: (id: string, request: { archived?: boolean }) => {
                    const conversation = conversations.find(candidate => candidate.id === id)!;
                    conversation.archived = request.archived;
                    return conversation;
                },
            },
            terminalSessions: terminals,
            workspaceServer: {
                removeRecentWorkspacesOf: async (user: string, matches: (uri: string) => boolean) => {
                    expect(user).to.equal(login);
                    recentRoots = recentRoots.filter(uri => !matches(uri));
                },
            },
        });
    });

    it('archives the conversations, deletes the terminal sessions and recent workspaces of the removed clone only', async () => {
        await cleanup.onRepositoryRemoved(removal);

        expect(conversations.filter(conversation => conversation.archived).map(conversation => conversation.id))
            .to.deep.equal(['chat', 'task', 'task-no-base']);
        expect(Object.keys(terminals.rows)).to.deep.equal([
            `user:${login}:ws:file://${other}`,
            `user:mallory:ws:file://${clone}`,
        ]);
        expect(recentRoots).to.deep.equal([`file://${other}`]);
    });

    it('is idempotent', async () => {
        await cleanup.onRepositoryRemoved(removal);
        await cleanup.onRepositoryRemoved(removal);

        expect(conversations.filter(conversation => conversation.archived)).to.have.length(3);
        expect(Object.keys(terminals.rows)).to.have.length(2);
    });
});
