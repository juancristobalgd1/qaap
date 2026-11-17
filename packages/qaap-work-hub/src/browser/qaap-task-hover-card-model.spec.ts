// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import {
    resolveQaapTaskHoverCardAgentIds,
    buildQaapTaskHoverCardModel,
    computeQaapTaskHoverCardPosition,
    formatQaapTaskHoverCardActivity,
    type QaapTaskHoverCardInput,
} from './qaap-task-hover-card-model';

const NOW = 1_800_000_000_000;

function summary(overrides: Partial<QaapAgentConversationSummaryDTO> = {}): QaapAgentConversationSummaryDTO {
    return {
        id: 'c1',
        cwd: '/repos/qaap',
        agentId: 'opencode',
        title: 'añade un formulario de contacto con validación',
        status: 'settled',
        createdAt: NOW - 3_600_000,
        updatedAt: NOW - 120_000,
        messageCount: 4,
        ...overrides,
    };
}

function build(overrides: Partial<QaapTaskHoverCardInput> = {}): ReturnType<typeof buildQaapTaskHoverCardModel> {
    return buildQaapTaskHoverCardModel({
        title: 'row title',
        projectName: 'qaap',
        now: NOW,
        ...overrides,
    });
}

describe('buildQaapTaskHoverCardModel', () => {

    it('uses the summary title in full, and the task title without a summary', () => {
        expect(build({ summary: summary() }).title).to.equal('añade un formulario de contacto con validación');
        expect(build().title).to.equal('row title');
    });

    it('lists project, agent · model, status, last activity, diff and pull request lines', () => {
        const model = build({
            projectBranch: 'main',
            summary: summary({
                lastTurnAgentModel: { provider: 'openai', vendor: 'opencode', modelId: 'opencode/beam-free' },
                linesAdded: 12,
                linesRemoved: 3,
                linkedPullRequest: { owner: 'acme', repo: 'qaap', number: 42, title: 'Contact form', state: 'merged' },
            }),
            status: { id: 'failed', label: 'failed', className: 'theia-mod-failed', iconClass: 'codicon-error' },
            failureReason: 'Rate limited',
        });
        expect(model.lines.map(line => line.kind)).to.deep.equal([
            'project', 'branch', 'agent', 'status', 'failure', 'activity', 'diff', 'pull-request',
        ]);
        const byKind = new Map(model.lines.map(line => [line.kind, line]));
        expect(byKind.get('project')?.text).to.equal('qaap');
        expect(byKind.get('branch')?.text).to.equal('main');
        expect(byKind.get('agent')?.text).to.equal('OpenCode · beam-free');
        expect(byKind.get('status')).to.include({ text: 'Failed', iconClass: 'codicon-error', modifierClass: 'theia-mod-failed' });
        expect(byKind.get('failure')?.text).to.equal('Rate limited');
        expect(byKind.get('activity')?.text).to.equal('Last activity 2 min ago');
        expect(byKind.get('diff')).to.include({ added: 12, removed: 3 });
        expect(byKind.get('pull-request')).to.include({
            text: '#42 Contact form',
            iconClass: 'codicon-git-merge',
            modifierClass: 'theia-mod-pr-merged',
        });
    });

    it('omits lines whose data is missing', () => {
        const model = buildQaapTaskHoverCardModel({ title: 'Only a title', now: NOW });
        expect(model).to.deep.equal({ title: 'Only a title', lines: [] });
        const idle = build({
            summary: summary({ agentId: '', updatedAt: 0, linesAdded: 0, linesRemoved: 0 }),
            status: { id: 'idle', label: 'idle', className: 'theia-mod-idle' },
        });
        expect(idle.lines.map(line => line.kind)).to.deep.equal(['project']);
    });

    it('shows a spinner for a running task', () => {
        const model = build({ status: { id: 'running', label: 'running', className: 'theia-mod-running' } });
        expect(model.lines.find(line => line.kind === 'status')).to.include({
            text: 'Running',
            iconClass: 'codicon-loading codicon-modifier-spin',
        });
    });

    it('names the worktree and its branch, never the project checkout branch', () => {
        const model = build({
            projectBranch: 'main',
            summary: summary({
                cwd: '/home/u/.qaap/worktrees/abc123',
                parallelBaseCwd: '/repos/claude-of-duty',
                worktreeOrdinal: 2,
                worktreeBranch: 'qaap/task/c1',
            }),
        });
        const byKind = new Map(model.lines.map(line => [line.kind, line]));
        expect(byKind.get('worktree')?.text).to.equal('Worktree claude-of-duty_2');
        expect(byKind.get('branch')?.text).to.equal('qaap/task/c1');
        const noBranch = build({
            projectBranch: 'main',
            summary: summary({ cwd: '/wt/x', parallelBaseCwd: '/repos/qaap' }),
        });
        expect(noBranch.lines.find(line => line.kind === 'branch')).to.equal(undefined);
        expect(noBranch.lines.find(line => line.kind === 'worktree')?.text).to.equal('Worktree x');
    });

    it('lists the task pull request once, as a draft when it needs attention', () => {
        const taskPullRequest = {
            owner: 'acme', repo: 'qaap', number: 7, branch: 'qaap/task/c1', state: 'draft-needs-attention' as const, updatedAt: NOW,
        };
        const model = build({ summary: summary({ taskPullRequest }) });
        const prs = model.lines.filter(line => line.kind === 'pull-request');
        expect(prs).to.have.length(1);
        expect(prs[0]).to.include({ text: 'acme/qaap#7', iconClass: 'codicon-git-pull-request-draft' });
        const branch = model.lines.find(line => line.kind === 'branch');
        expect(branch?.text).to.equal('qaap/task/c1');
        const deduped = build({
            summary: summary({
                taskPullRequest,
                linkedPullRequest: { owner: 'acme', repo: 'qaap', number: 7, title: 'Same PR', state: 'open' },
            }),
        });
        expect(deduped.lines.filter(line => line.kind === 'pull-request').map(line => line.text)).to.deep.equal(['#7 Same PR']);
    });

    it('formats the last activity relative to now', () => {
        expect(formatQaapTaskHoverCardActivity(NOW - 10_000, NOW)).to.equal('Last activity just now');
        expect(formatQaapTaskHoverCardActivity(NOW - 3 * 3_600_000, NOW)).to.equal('Last activity 3 h ago');
        expect(formatQaapTaskHoverCardActivity(NOW - 2 * 86_400_000, NOW)).to.equal('Last activity 2 d ago');
    });
});

describe('computeQaapTaskHoverCardPosition', () => {

    const viewport = { width: 1200, height: 800 };
    const card = { width: 300, height: 160 };

    it('places the card to the right of the row, top-aligned', () => {
        const anchor = { left: 0, top: 100, right: 280, bottom: 128 };
        expect(computeQaapTaskHoverCardPosition(anchor, card, viewport)).to.deep.equal({ left: 288, top: 100, side: 'right' });
    });

    it('clamps the card inside the bottom edge', () => {
        const anchor = { left: 0, top: 760, right: 280, bottom: 788 };
        expect(computeQaapTaskHoverCardPosition(anchor, card, viewport).top).to.equal(800 - 8 - 160);
    });

    it('clamps above the top edge', () => {
        const anchor = { left: 0, top: -20, right: 280, bottom: 8 };
        expect(computeQaapTaskHoverCardPosition(anchor, card, viewport).top).to.equal(8);
    });

    it('flips to the left when the right side has no room', () => {
        const anchor = { left: 900, top: 100, right: 1180, bottom: 128 };
        expect(computeQaapTaskHoverCardPosition(anchor, card, viewport)).to.deep.equal({ left: 592, top: 100, side: 'left' });
    });

    it('stays inside the viewport when neither side fits', () => {
        const anchor = { left: 100, top: 100, right: 380, bottom: 128 };
        const narrow = { width: 500, height: 600 };
        const position = computeQaapTaskHoverCardPosition(anchor, card, narrow);
        expect(position.left).to.equal(500 - 8 - 300);
        expect(position.left + card.width).to.be.at.most(narrow.width - 8);
    });
});

describe('qaap-task-hover-card-model harness logos', () => {
    const summary = (fields: Partial<QaapAgentConversationSummaryDTO>): QaapAgentConversationSummaryDTO =>
        ({ id: 'c1', agentId: 'claude', title: 't', cwd: '/w', status: 'idle', updatedAt: 1, messageCount: 1, ...fields }) as QaapAgentConversationSummaryDTO;

    it('lists every harness that worked on the task once, conversation agent first', () => {
        expect(resolveQaapTaskHoverCardAgentIds(summary({ agentId: 'claude', lastTurnAgentId: 'opencode' }))).to.deep.equal(['claude', 'opencode']);
        expect(resolveQaapTaskHoverCardAgentIds(summary({ agentId: 'claude', lastTurnAgentId: 'Claude' }))).to.deep.equal(['claude']);
        expect(resolveQaapTaskHoverCardAgentIds(summary({ agentId: ' ', lastTurnAgentId: undefined }))).to.deep.equal([]);
    });
});
