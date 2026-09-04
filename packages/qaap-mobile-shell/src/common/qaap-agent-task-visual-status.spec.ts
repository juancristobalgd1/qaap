// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    listQaapAgentTaskVisualStatusLegendEntries,
    resolveQaapAgentTaskVisualStatus,
    resolveQaapGitPrVisualStatus,
} from './qaap-agent-task-visual-status';

describe('resolveQaapAgentTaskVisualStatus', () => {
    it('keeps failures above every other signal', () => {
        const status = resolveQaapAgentTaskVisualStatus(
            { state: 'failed' },
            { status: 'streaming', linkedPullRequest: { owner: 'acme', repo: 'app', number: 4 }, messageCount: 2 },
            true,
        );
        expect(status.id).to.equal('failed');
    });

    it('classifies running backend or streaming conversation state as running', () => {
        expect(resolveQaapAgentTaskVisualStatus({ state: 'running' }).id).to.equal('running');
        expect(resolveQaapAgentTaskVisualStatus({ state: 'idle' }, { status: 'streaming', messageCount: 1 }).id).to.equal('running');
    });

    it('classifies explicit input waits and unread agent replies as needs-you', () => {
        expect(resolveQaapAgentTaskVisualStatus({ state: 'needs-input' }).id).to.equal('needs-you');
        expect(resolveQaapAgentTaskVisualStatus(
            { state: 'idle' },
            { status: 'idle', lastMessageRole: 'agent', messageCount: 3 },
            true,
        ).id).to.equal('needs-you');
    });

    it('classifies linked pull requests as PR ready after attention states', () => {
        expect(resolveQaapAgentTaskVisualStatus(
            { state: 'completed' },
            { status: 'idle', linkedPullRequest: { owner: 'acme', repo: 'app', number: 9, state: 'open' }, messageCount: 4 },
        ).id).to.equal('pr-ready');
    });

    it('maps every GitHub PR lifecycle state to an explicit semantic status', () => {
        const pull = { owner: 'acme', repo: 'app', number: 9 } as const;
        expect(resolveQaapGitPrVisualStatus({ linkedPullRequest: { ...pull, state: 'open' } })).to.include({
            id: 'pr-ready',
            iconClass: 'codicon-git-pull-request',
        });
        expect(resolveQaapGitPrVisualStatus({ linkedPullRequest: { ...pull, state: 'open', draft: true } })).to.include({
            id: 'pr-draft',
            iconClass: 'codicon-git-pull-request-draft',
        });
        expect(resolveQaapGitPrVisualStatus({ linkedPullRequest: { ...pull, state: 'merged' } })).to.include({
            id: 'pr-merged',
            iconClass: 'codicon-git-merge',
        });
        expect(resolveQaapGitPrVisualStatus({ linkedPullRequest: { ...pull, state: 'closed' } })).to.include({
            id: 'pr-closed',
            iconClass: 'codicon-git-pull-request-closed',
        });
    });

    it('maps actionable open-PR conditions before generic ready', () => {
        const pull = { owner: 'acme', repo: 'app', number: 9, state: 'open' as const };
        expect(resolveQaapGitPrVisualStatus({ linkedPullRequest: { ...pull, mergeable: false } })?.id).to.equal('pr-conflicts');
        expect(resolveQaapGitPrVisualStatus({ linkedPullRequest: { ...pull, tests: 'failing' } })?.id).to.equal('checks-failed');
        expect(resolveQaapGitPrVisualStatus({ linkedPullRequest: { ...pull, tests: 'pending' } })?.id).to.equal('checks-pending');
    });

    it('uses distinct glyphs for branch / commit / push / local changes (not only PR)', () => {
        expect(resolveQaapGitPrVisualStatus({
            linkedPullRequest: { owner: 'acme', repo: 'app', branch: 'agent/work' },
        })).to.include({
            id: 'branch',
            iconClass: 'codicon-git-branch',
        });
        expect(resolveQaapGitPrVisualStatus({ worktreeBranch: 'feat/x' })).to.include({
            id: 'branch',
            iconClass: 'codicon-git-branch',
        });
        expect(resolveQaapGitPrVisualStatus({ lastGitActionKind: 'commit' })).to.include({
            id: 'committed',
            iconClass: 'codicon-git-commit',
        });
        expect(resolveQaapGitPrVisualStatus({ lastGitActionKind: 'push' })).to.include({
            id: 'pushed',
            iconClass: 'codicon-repo-push',
        });
        expect(resolveQaapGitPrVisualStatus({ linesAdded: 2 })?.id).to.equal('changes');
        expect(resolveQaapGitPrVisualStatus({ hasGitOperation: true })).to.include({
            id: 'branch',
            iconClass: 'codicon-git-branch',
        });
    });

    it('keeps legacy linked PRs neutral instead of guessing open or merged', () => {
        expect(resolveQaapGitPrVisualStatus({
            linkedPullRequest: { owner: 'acme', repo: 'app', number: 9 },
        })).to.include({
            id: 'pr-unknown',
            iconClass: 'codicon-git-pull-request',
        });
    });

    it('returns no Git/PR badge when no Git state is available', () => {
        expect(resolveQaapGitPrVisualStatus({})).to.equal(undefined);
    });

    it('classifies completed work as verified', () => {
        expect(resolveQaapAgentTaskVisualStatus({ state: 'completed' }).id).to.equal('verified');
    });

    it('falls back to idle for quiet tasks', () => {
        expect(resolveQaapAgentTaskVisualStatus({ state: 'idle' }).id).to.equal('idle');
    });

    it('classifies failed conversations even when task state was derived as completed', () => {
        expect(resolveQaapAgentTaskVisualStatus(
            { state: 'completed' },
            { status: 'failed', messageCount: 2 },
        ).id).to.equal('failed');
    });

    it('classifies a self-reported agent stop/failure as failed, not needs-you, even though status settled to idle', () => {
        const status = resolveQaapAgentTaskVisualStatus(
            { state: 'completed' },
            {
                status: 'idle',
                lastMessageRole: 'agent',
                messageCount: 3,
                lastMessagePreview: 'Stopped: repeated tool failures detected',
            },
            true,
        );
        expect(status.id).to.equal('failed');
    });

    it('does not mistake a plain unread agent reply for a failed run', () => {
        const status = resolveQaapAgentTaskVisualStatus(
            { state: 'completed' },
            {
                status: 'idle',
                lastMessageRole: 'agent',
                messageCount: 3,
                lastMessagePreview: 'Stopped the dev server as requested.',
            },
            true,
        );
        expect(status.id).to.equal('needs-you');
    });
});

describe('listQaapAgentTaskVisualStatusLegendEntries', () => {
    it('returns core agent statuses plus branch/commit/push/PR glyphs', () => {
        const entries = listQaapAgentTaskVisualStatusLegendEntries();
        expect(entries.map(entry => entry.id)).to.deep.equal([
            'idle',
            'queued',
            'running',
            'needs-you',
            'failed',
            'background',
            'verified',
            'warnings',
            'branch',
            'changes',
            'committed',
            'pushed',
            'pr-ready',
            'pr-merged',
            'pr-closed',
            'pr-draft',
        ]);
        expect(entries.every(entry => entry.labelKey.startsWith('qaap/mobileProjects/'))).to.equal(true);
        expect(entries.find(entry => entry.id === 'branch')?.iconClass).to.equal('codicon-git-branch');
        expect(entries.find(entry => entry.id === 'committed')?.iconClass).to.equal('codicon-git-commit');
        expect(entries.find(entry => entry.id === 'pushed')?.iconClass).to.equal('codicon-repo-push');
        expect(entries.find(entry => entry.id === 'pr-merged')?.iconClass).to.equal('codicon-git-merge');
    });
});

