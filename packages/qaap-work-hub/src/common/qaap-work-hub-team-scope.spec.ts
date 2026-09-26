// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    collectAgentMembers,
    scopeTeamMembersToConversation,
    type WorkHubTeamConversationInput,
    type WorkHubTeamMember,
} from '@theia/qaap-shared-core/lib/common/qaap-work-hub-team';

function conversation(id: string, cwd: string, forkedFromId?: string): WorkHubTeamConversationInput {
    return {
        projectId: 'p1',
        projectName: 'shop',
        cwd,
        id,
        agentId: 'claude',
        title: id,
        status: 'streaming',
        forkedFromId,
        createdAt: 1,
        updatedAt: 2,
    };
}

function ids(members: readonly WorkHubTeamMember[]): string[] {
    return members.map(member => member.id).sort();
}

describe('scopeTeamMembersToConversation', () => {
    it('returns nothing when no conversation is open', () => {
        const members = collectAgentMembers({ conversations: [conversation('a', '/srv/a')], tasks: [] });
        expect(scopeTeamMembersToConversation(members, undefined)).to.deep.equal([]);
        expect(scopeTeamMembersToConversation(members, '  ')).to.deep.equal([]);
    });

    it('excludes agents running in other conversations, even in the same project', () => {
        const members = collectAgentMembers({
            conversations: [conversation('a', '/srv/shop'), conversation('b', '/srv/shop-b'), conversation('c', '/srv/shop-c')],
            tasks: [],
        });
        expect(members).to.have.length(3);
        expect(ids(scopeTeamMembersToConversation(members, 'a'))).to.deep.equal(['a']);
    });

    it('includes isolated worktree forks / subagents of the open conversation at any depth', () => {
        const members = collectAgentMembers({
            conversations: [
                conversation('root', '/srv/shop'),
                conversation('fork-1', '/srv/shop/.worktrees/shop_1', 'root'),
                conversation('fork-1-1', '/srv/shop/.worktrees/shop_2', 'fork-1'),
                conversation('other', '/srv/other'),
                conversation('other-fork', '/srv/other/.worktrees/other_1', 'other'),
            ],
            tasks: [],
        });
        expect(ids(scopeTeamMembersToConversation(members, 'root'))).to.deep.equal(['fork-1', 'fork-1-1', 'root']);
    });

    it('does not pull in the parent or siblings when a fork itself is open', () => {
        const members = collectAgentMembers({
            conversations: [
                conversation('root', '/srv/shop'),
                conversation('fork-1', '/srv/shop/.worktrees/shop_1', 'root'),
                conversation('fork-2', '/srv/shop/.worktrees/shop_2', 'root'),
            ],
            tasks: [],
        });
        expect(ids(scopeTeamMembersToConversation(members, 'fork-1'))).to.deep.equal(['fork-1']);
    });

    it('includes VPS subtasks remapped onto the streaming conversation and their nested subtasks', () => {
        const members = collectAgentMembers({
            conversations: [conversation('conv', '/srv/shop'), conversation('elsewhere', '/srv/else')],
            tasks: [
                { id: 'leader', title: 'Leader', command: 'claude', cwd: '/srv/shop', state: 'running', createdAt: 1 },
                { id: 'sub-1', title: 'CSS', command: 'codex', cwd: '/srv/shop', state: 'running', createdAt: 2, parentId: 'leader' },
                { id: 'sub-1-1', title: 'Lint', command: 'codex', cwd: '/srv/shop', state: 'running', createdAt: 3, parentId: 'sub-1' },
                { id: 'foreign', title: 'Other', command: 'codex', cwd: '/srv/else', state: 'running', createdAt: 4, parentId: 'x-leader' },
            ],
        });
        expect(ids(scopeTeamMembersToConversation(members, 'conv'))).to.deep.equal(['conv', 'sub-1', 'sub-1-1']);
    });

    it('scopes a VPS task conversation (task id is the conversation id) to its own subtasks', () => {
        const members = collectAgentMembers({
            conversations: [],
            tasks: [
                { id: 'task-a', title: 'A', command: 'claude', cwd: '/srv/a', state: 'running', createdAt: 1 },
                { id: 'task-a-sub', title: 'A sub', command: 'codex', cwd: '/srv/a', state: 'queued', createdAt: 2, parentId: 'task-a' },
                { id: 'task-b', title: 'B', command: 'claude', cwd: '/srv/b', state: 'running', createdAt: 3 },
            ],
        });
        expect(ids(scopeTeamMembersToConversation(members, 'task-a'))).to.deep.equal(['task-a', 'task-a-sub']);
        expect(ids(scopeTeamMembersToConversation(members, 'task-b'))).to.deep.equal(['task-b']);
    });

    it('re-scopes when the open conversation changes', () => {
        const members = collectAgentMembers({
            conversations: [conversation('a', '/srv/a'), conversation('a-fork', '/srv/a/.worktrees/a_1', 'a'), conversation('b', '/srv/b')],
            tasks: [],
        });
        expect(ids(scopeTeamMembersToConversation(members, 'a'))).to.deep.equal(['a', 'a-fork']);
        expect(ids(scopeTeamMembersToConversation(members, 'b'))).to.deep.equal(['b']);
    });
});
