// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { resolveComposerSubmitTarget } from './qaap-composer-submit-target';

function summary(id: string, source?: 'theia-chat', cwd = '/repo', parallelBaseCwd?: string): QaapAgentConversationSummaryDTO {
    return {
        id,
        cwd,
        parallelBaseCwd,
        workspacePath: cwd,
        agentId: 'task',
        title: id,
        status: 'settled',
        createdAt: 0,
        updatedAt: 0,
        messageCount: 1,
        source,
    } as QaapAgentConversationSummaryDTO;
}

describe('resolveComposerSubmitTarget', () => {
    it('keeps a follow-up on the composer task when the live target matches the closure', () => {
        // The transcript open id may not be fixed yet; the live composer target is what counts.
        expect(resolveComposerSubmitTarget(summary('task-a'), summary('task-a'))).to.equal('closure');
    });

    it('routes to the live child after an isolated parallel submit moved the composer to it', () => {
        // Parent closure still held by the composer; backend created child task-a-child and the
        // composer target was switched to it.
        expect(resolveComposerSubmitTarget(summary('task-a'), summary('task-a-child'))).to.equal('live');
    });

    it('never routes a live target from another project (other cwd) to the closure task', () => {
        expect(resolveComposerSubmitTarget(summary('task-a'), summary('task-b', undefined, '/other/project'))).to.equal('newTask');
    });

    it('routes an isolated worktree child of the same project to the child', () => {
        // The child runs in its own worktree directory; its parallelBaseCwd is the project directory.
        expect(resolveComposerSubmitTarget(summary('task-a'), summary('task-a-wt', undefined, '/repo-wt-2', '/repo'))).to.equal('live');
    });

    it('starts a new task when "New task" cleared the live target but the closure holds a task', () => {
        expect(resolveComposerSubmitTarget(summary('task-a'), undefined)).to.equal('newTask');
    });

    it('never treats pending new-chat placeholders or legacy Theia chat as a stale task', () => {
        expect(resolveComposerSubmitTarget(summary('pending-new-chat-p1-1'), undefined)).to.equal('closure');
        expect(resolveComposerSubmitTarget(summary('chat-1', 'theia-chat'), undefined)).to.equal('closure');
    });
});
