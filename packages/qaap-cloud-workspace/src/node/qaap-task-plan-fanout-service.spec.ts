// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Emitter } from '@theia/core/lib/common/event';
import type { QaapTaskPlan } from '@theia/qaap-shared-core/lib/common/qaap-task-plan';
import type { QaapAgentConversation, QaapAgentConversationEvent, QaapCreateAgentConversationRequest } from '../common/qaap-agent-conversation';
import { toConversationSummary } from '../common/qaap-agent-conversation';
import { runGitAsync } from './qaap-agent-conversation-store-git';
import type { PostUserMessageInternalOptions, QaapGoalLoopTurnSettlement } from './qaap-agent-conversation-store-constants';
import { QaapTaskPlanFanOutService } from './qaap-task-plan-fanout-service';

const ID = ['-c', 'user.email=t@qaap.local', '-c', 'user.name=t'];

function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', [...ID, ...args], { cwd, encoding: 'utf8' }).trim();
}

/** Just enough of the conversation store for the plan service. */
class FakeStore {
    readonly conversations = new Map<string, QaapAgentConversation>();
    readonly changes = new Emitter<QaapAgentConversationEvent>();
    readonly settles = new Emitter<QaapGoalLoopTurnSettlement>();
    readonly onDidChange = this.changes.event;
    readonly onDidSettleTurn = this.settles.event;
    readonly active = new Set<string>();
    readonly posted: { id: string; content: string; internal?: PostUserMessageInternalOptions }[] = [];
    readonly created: QaapCreateAgentConversationRequest[] = [];
    readonly cancelled: string[] = [];

    whenReady(): Promise<void> {
        return Promise.resolve();
    }
    get(id: string): QaapAgentConversation | undefined {
        return this.conversations.get(id);
    }
    listAllGroupedByCwd(): { conversations: ReturnType<typeof toConversationSummary>[] }[] {
        return [{ conversations: [...this.conversations.values()].map(conv => toConversationSummary(conv)) }];
    }
    getActiveTaskIdsForConversation(id: string): string[] {
        return this.active.has(id) ? ['task'] : [];
    }
    setTaskPlan(id: string, taskPlan: QaapTaskPlan | undefined, patch: Partial<QaapAgentConversation> = {}): QaapAgentConversation | undefined {
        const conv = this.conversations.get(id);
        if (!conv) {
            return undefined;
        }
        const next = { ...conv, ...patch, taskPlan };
        this.conversations.set(id, next);
        return next;
    }
    postUserMessage(id: string, content: string, _a?: unknown, _m?: unknown, _auto?: unknown, _mode?: string, _p?: unknown, _r?: unknown, _l?: unknown,
        internal?: PostUserMessageInternalOptions): QaapAgentConversation {
        this.posted.push({ id, content, internal });
        const conv = this.conversations.get(id)!;
        const next: QaapAgentConversation = {
            ...conv, status: 'streaming',
            messages: [...conv.messages, { id: `u${this.posted.length}`, role: 'user', content, createdAt: Date.now() }],
        };
        this.conversations.set(id, next);
        return next;
    }
    create(request: QaapCreateAgentConversationRequest): QaapAgentConversation {
        this.created.push(request);
        const id = `child-${this.created.length}`;
        const conv: QaapAgentConversation = {
            id, cwd: request.cwd, agentId: 'qaiq', title: request.title ?? '', status: 'streaming', createdAt: 0, updatedAt: 0,
            messages: [{ id: `${id}-u`, role: 'user', content: request.message ?? '', createdAt: 0 }],
            parentConversationId: request.parentConversationId, taskPlanSubtaskId: request.taskPlanSubtaskId,
        };
        this.conversations.set(id, conv);
        return conv;
    }
    rename(id: string, request: { title: string }): QaapAgentConversation | undefined {
        const conv = this.conversations.get(id);
        if (conv) {
            this.conversations.set(id, { ...conv, title: request.title });
        }
        return this.conversations.get(id);
    }
    cancel(id: string): QaapAgentConversation | undefined {
        this.cancelled.push(id);
        return this.conversations.get(id);
    }
    mutatingGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv): ReturnType<typeof runGitAsync> {
        return runGitAsync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: env ?? process.env, timeoutMs: 30_000 });
    }
    runSerializedGit<T>(_cwd: string, job: () => Promise<T>): Promise<T> {
        return job();
    }
    /** The child (or parent) finished its turn: idle, with a verdict. */
    settle(id: string, taskState: 'completed' | 'failed' | 'cancelled' = 'completed'): void {
        const conv = this.conversations.get(id)!;
        const userId = [...conv.messages].reverse().find(message => message.role === 'user')!.id;
        this.conversations.set(id, {
            ...conv,
            status: 'idle',
            messages: [
                ...conv.messages.map(message => message.id === userId ? { ...message, turnVerdict: { taskState, settledAt: Date.now() } } : message),
                { id: `${userId}-a`, role: 'agent', content: 'done', createdAt: Date.now() },
            ],
        });
    }
}

function makeService(store: FakeStore, worktreeRoot?: string, repo?: string): QaapTaskPlanFanOutService {
    const service = new QaapTaskPlanFanOutService();
    let counter = 0;
    Object.assign(service, {
        store,
        worktrees: repo && worktreeRoot ? {
            create: async (baseCwd: string) => {
                counter++;
                const worktreePath = path.join(worktreeRoot, `wt${counter}`);
                const branch = `qaap/worktree/t${counter}`;
                execFileSync('git', ['worktree', 'add', '-q', '-b', branch, worktreePath, 'HEAD'], { cwd: baseCwd });
                return { worktreePath, branch };
            },
        } : undefined,
    });
    return service;
}

describe('QaapTaskPlanFanOutService', function (): void {
    this.timeout(30_000);
    let work: string;
    let repo: string;
    let savedEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        savedEnv = { ...process.env };
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-task-plan-'));
        repo = path.join(work, 'repo');
        fs.mkdirSync(repo);
        git(repo, 'init', '-q', '-b', 'main');
        fs.writeFileSync(path.join(repo, 'README.md'), 'readme\n');
        fs.writeFileSync(path.join(repo, 'old.txt'), 'to be removed\n');
        git(repo, 'add', '-A');
        git(repo, 'commit', '-qm', 'init');
    });

    afterEach(() => {
        process.env = savedEnv;
        fs.rmSync(work, { recursive: true, force: true });
    });

    it('plans only eligible first messages, by mode', () => {
        const service = makeService(new FakeStore());
        process.env.QAAP_TASK_FANOUT = 'off';
        expect(service.shouldPlan({ message: 'x', fanOut: true }, 'qaiq')).to.equal(false);
        process.env.QAAP_TASK_FANOUT = 'auto';
        expect(service.shouldPlan({ message: 'Fix the bug' }, 'qaiq')).to.equal(false);
        expect(service.shouldPlan({ message: 'Fix the bug', fanOut: true }, 'qaiq')).to.equal(true);
        expect(service.shouldPlan({ message: '1. a thing\n2. b thing\n3. c thing' }, 'qaiq')).to.equal(true);
        expect(service.shouldPlan({ message: 'x', fanOut: true, interactionModeId: 'plan' }, 'qaiq')).to.equal(false);
        expect(service.shouldPlan({ message: 'x', fanOut: true }, 'shell')).to.equal(false);
        process.env.QAAP_TASK_FANOUT = 'on';
        expect(service.shouldPlan({ message: 'Fix the bug' }, 'qaiq')).to.equal(true);
        expect(service.shouldPlan({ message: 'Fix the bug', fanOut: false }, 'qaiq')).to.equal(false);
    });

    it('composes subtasks onto the pre-turn snapshot and writes the tree without touching the index or dirty files', async () => {
        const store = new FakeStore();
        const service = makeService(store);
        const base = git(repo, 'rev-parse', 'HEAD');
        const branchA = path.join(work, 'a');
        const branchB = path.join(work, 'b');
        const branchC = path.join(work, 'c');
        git(repo, 'worktree', 'add', '-q', '-b', 'sa', branchA, 'HEAD');
        git(repo, 'worktree', 'add', '-q', '-b', 'sb', branchB, 'HEAD');
        git(repo, 'worktree', 'add', '-q', '-b', 'sc', branchC, 'HEAD');
        fs.writeFileSync(path.join(branchA, 'a.ts'), 'export const a = 1;\n');
        fs.rmSync(path.join(branchA, 'old.txt'));
        git(branchA, 'add', '-A');
        git(branchA, 'commit', '-qm', 'a');
        fs.writeFileSync(path.join(branchB, 'b.bin'), Buffer.from([0, 1, 2, 255]));
        git(branchB, 'add', '-A');
        git(branchB, 'commit', '-qm', 'b');
        fs.writeFileSync(path.join(branchC, 'README.md'), 'conflicting readme\n');
        git(branchC, 'add', '-A');
        git(branchC, 'commit', '-qm', 'c');
        // The user's own dirty work in the parent: a tracked edit and an untracked file.
        fs.writeFileSync(path.join(repo, 'README.md'), 'readme edited by the user\n');
        fs.writeFileSync(path.join(repo, 'notes.txt'), 'scratch\n');
        // Pre-turn snapshot of the working tree, like captureCheckpoint (parentless commit, temp index).
        const snapshotIndex = path.join(work, 'snapshot-index');
        const env = { ...process.env, GIT_INDEX_FILE: snapshotIndex };
        execFileSync('git', ['add', '-A'], { cwd: repo, env });
        const snapshotTree = execFileSync('git', ['write-tree'], { cwd: repo, env, encoding: 'utf8' }).trim();
        const pre = execFileSync('git', [...ID, 'commit-tree', snapshotTree, '-m', 'pre'], { cwd: repo, encoding: 'utf8' }).trim();

        const subtasks = [
            { id: 'a', title: 'a', prompt: 'a', state: 'done' as const, headSha: git(branchA, 'rev-parse', 'HEAD') },
            { id: 'b', title: 'b', prompt: 'b', state: 'done' as const, headSha: git(branchB, 'rev-parse', 'HEAD') },
            { id: 'c', title: 'c', prompt: 'c', state: 'done' as const, headSha: git(branchC, 'rev-parse', 'HEAD') },
            { id: 'd', title: 'd', prompt: 'd', state: 'failed' as const },
        ];
        const result = await service.composeSubtasks(repo, pre, subtasks);
        expect([...result.conflicts]).to.deep.equal(['c']);
        const indexBefore = git(repo, 'ls-files', '-s');
        await service.writeTree(repo, pre, result.tree);

        expect(fs.readFileSync(path.join(repo, 'a.ts'), 'utf8')).to.equal('export const a = 1;\n');
        expect([...fs.readFileSync(path.join(repo, 'b.bin'))]).to.deep.equal([0, 1, 2, 255]);
        expect(fs.existsSync(path.join(repo, 'old.txt'))).to.equal(false);
        expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf8')).to.equal('readme edited by the user\n');
        expect(fs.readFileSync(path.join(repo, 'notes.txt'), 'utf8')).to.equal('scratch\n');
        expect(git(repo, 'rev-parse', 'HEAD')).to.equal(base);
        expect(git(repo, 'ls-files', '-s')).to.equal(indexBefore);
        const status = git(repo, 'status', '--porcelain');
        expect(status).to.contain('a.ts').and.to.contain('b.bin').and.to.contain('old.txt');
    });

    it('drives a plan: drafting → awaiting approval → parallel children → integration turn → done', async () => {
        process.env.QAAP_TASK_FANOUT_MAX_PARALLEL = '2';
        process.env.QAAP_TASK_FANOUT_AUTORUN_MS = '600000';
        const store = new FakeStore();
        const service = makeService(store, path.join(work, 'worktrees'), repo);
        fs.mkdirSync(path.join(work, 'worktrees'));
        const plan: QaapTaskPlan = { id: 'plan', state: 'drafting', subtasks: [], autoRun: true, createdAt: 0, updatedAt: 0, sourceMessageId: 'm1' };
        const block = '```qaap-plan\n' + JSON.stringify({
            summary: 'Three modules',
            subtasks: [{ title: 'A', prompt: 'Create a.ts' }, { title: 'B', prompt: 'Create b.ts' }, { title: 'C', prompt: 'Create c.ts' }],
        }) + '\n```';
        store.conversations.set('p', {
            id: 'p', cwd: repo, agentId: 'qaiq', title: 'task', status: 'idle', createdAt: 0, updatedAt: 0, interactionModeId: 'plan',
            messages: [
                { id: 'm1', role: 'user', content: 'do it', createdAt: 0, turnVerdict: { taskState: 'completed', readOnly: true, settledAt: 1 } },
                { id: 'm1-a', role: 'agent', content: `Plan:\n${block}`, createdAt: 1 },
            ],
            taskPlan: plan,
        });
        await service.evaluate('p');
        let parent = store.get('p')!;
        expect(parent.taskPlan?.state).to.equal('awaiting-approval');
        expect(parent.interactionModeId).to.equal('agent');
        expect(parent.taskPlan?.subtasks.map(subtask => subtask.title)).to.deep.equal(['A', 'B', 'C']);
        expect(parent.taskPlan?.autoRunAt).to.be.a('number');

        // Edit: drop C, rename B; that turns the auto-run timer off.
        const [a, b] = parent.taskPlan!.subtasks;
        service.edit('p', { subtasks: [{ id: a.id, title: 'A', prompt: 'Create a.ts' }, { id: b.id, title: 'B2', prompt: 'Create b.ts' }] });
        parent = store.get('p')!;
        expect(parent.taskPlan?.autoRun).to.equal(false);
        expect(parent.taskPlan?.edited).to.equal(true);
        expect(parent.taskPlan?.subtasks.map(subtask => subtask.title)).to.deep.equal(['A', 'B2']);

        service.run('p');
        await service.evaluate('p');
        parent = store.get('p')!;
        expect(parent.taskPlan?.state).to.equal('running');
        expect(store.created).to.have.length(2);
        expect(store.created.every(request => request.taskPullRequestEnabled === false && request.parentConversationId === 'p')).to.equal(true);
        expect(new Set(store.created.map(request => request.cwd)).size).to.equal(2);
        expect(parent.taskPlan?.subtasks.every(subtask => subtask.state === 'running')).to.equal(true);
        expect(store.get('child-2')!.title).to.equal('2/2 · B2');

        // Each child writes its file in its own worktree and settles.
        fs.writeFileSync(path.join(store.created[0].cwd, 'a.ts'), 'a\n');
        fs.writeFileSync(path.join(store.created[1].cwd, 'b.ts'), 'b\n');
        store.settle('child-1');
        await service.evaluate('p');
        expect(store.get('p')!.taskPlan?.state).to.equal('running');
        store.settle('child-2');
        await service.evaluate('p');
        parent = store.get('p')!;
        expect(parent.taskPlan?.state).to.equal('integrating');
        expect(store.posted).to.have.length(1);
        expect(store.posted[0].content).to.contain('Integrate').and.to.contain('B2');
        expect(parent.taskPlan?.integrationMessageId).to.equal('u1');

        // The integration turn's workspace preparation writes both results into the parent.
        const snapshotIndex = path.join(work, 'pre-index');
        const env = { ...process.env, GIT_INDEX_FILE: snapshotIndex };
        execFileSync('git', ['add', '-A'], { cwd: repo, env });
        const tree = execFileSync('git', ['write-tree'], { cwd: repo, env, encoding: 'utf8' }).trim();
        const pre = execFileSync('git', [...ID, 'commit-tree', tree, '-m', 'pre'], { cwd: repo, encoding: 'utf8' }).trim();
        await store.posted[0].internal!.prepareWorkspace!(repo, { id: 'c', ref: 'r', commit: pre, label: 'pre', createdAt: 0, messageId: 'u1' } as never);
        expect(fs.readFileSync(path.join(repo, 'a.ts'), 'utf8')).to.equal('a\n');
        expect(fs.readFileSync(path.join(repo, 'b.ts'), 'utf8')).to.equal('b\n');

        store.settle('p');
        await service.evaluate('p');
        expect(store.get('p')!.taskPlan?.state).to.equal('done');
    });

    it('continues as a single turn when the plan has one subtask', async () => {
        const store = new FakeStore();
        const service = makeService(store);
        store.conversations.set('p', {
            id: 'p', cwd: repo, agentId: 'qaiq', title: 'task', status: 'idle', createdAt: 0, updatedAt: 0, interactionModeId: 'plan',
            messages: [
                { id: 'm1', role: 'user', content: 'Fix the typo', createdAt: 0, turnVerdict: { taskState: 'completed', readOnly: true, settledAt: 1 } },
                { id: 'm1-a', role: 'agent', content: '```qaap-plan\n{"subtasks":[{"title":"Typo","prompt":"Fix it"}]}\n```', createdAt: 1 },
            ],
            taskPlan: { id: 'plan', state: 'drafting', subtasks: [], autoRun: true, createdAt: 0, updatedAt: 0, sourceMessageId: 'm1' },
        });
        await service.evaluate('p');
        expect(store.get('p')!.taskPlan?.state).to.equal('single');
        expect(store.posted).to.have.length(1);
        expect(store.posted[0].content).to.contain('Fix the typo');
    });

    it('auto-runs a plan nobody touched once its timer fires', async () => {
        process.env.QAAP_TASK_FANOUT_AUTORUN_MS = '50';
        const store = new FakeStore();
        const service = makeService(store, path.join(work, 'worktrees'), repo);
        fs.mkdirSync(path.join(work, 'worktrees'));
        store.conversations.set('p', {
            id: 'p', cwd: repo, agentId: 'qaiq', title: 'task', status: 'idle', createdAt: 0, updatedAt: 0, interactionModeId: 'plan',
            messages: [
                { id: 'm1', role: 'user', content: 'do it', createdAt: 0, turnVerdict: { taskState: 'completed', readOnly: true, settledAt: 1 } },
                { id: 'm1-a', role: 'agent', content: '1. **A** — make a\n2. **B** — make b', createdAt: 1 },
            ],
            taskPlan: { id: 'plan', state: 'drafting', subtasks: [], autoRun: true, createdAt: 0, updatedAt: 0, sourceMessageId: 'm1' },
        });
        await service.evaluate('p');
        expect(store.get('p')!.taskPlan?.state).to.equal('awaiting-approval');
        await new Promise(done => setTimeout(done, 120));
        expect(store.get('p')!.taskPlan?.state).to.equal('running');
    });

    it('cancel stops running children and the plan', async () => {
        const store = new FakeStore();
        const service = makeService(store);
        store.conversations.set('p', {
            id: 'p', cwd: repo, agentId: 'qaiq', title: 'task', status: 'idle', createdAt: 0, updatedAt: 0, messages: [],
            taskPlan: {
                id: 'plan', state: 'running', autoRun: false, createdAt: 0, updatedAt: 0, subtasks: [
                    { id: 'a', title: 'a', prompt: 'a', state: 'running', conversationId: 'child-a' },
                    { id: 'b', title: 'b', prompt: 'b', state: 'done' },
                ],
            },
        });
        service.cancel('p');
        expect(store.cancelled).to.deep.equal(['child-a']);
        expect(store.get('p')!.taskPlan?.state).to.equal('cancelled');
        expect(store.get('p')!.taskPlan?.subtasks.map(subtask => subtask.state)).to.deep.equal(['cancelled', 'done']);
    });
});
