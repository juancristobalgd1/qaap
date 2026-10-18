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
import type { QaapTaskPullRequest } from '@theia/qaap-shared-core/lib/common/qaap-task-pull-request';
import { GithubApiError, type QaapGithubPullRequestRecord } from '@theia/qaap-shared-core/lib/node/qaap-github-api';
import { QaapGithubOwnerTokenCache } from '@theia/qaap-shared-core/lib/node/qaap-github-owner-token-cache';
import type { QaapAgentConversation, QaapAgentConversationEvent, QaapConversationCheckpoint } from '../common/qaap-agent-conversation';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { QAAP_TASK_PR_ATTENTION_LABEL, QAAP_TASK_PR_EVIDENCE_START } from '../common/qaap-task-pull-request-body';
import { runGitAsync } from './qaap-agent-conversation-store-git';
import { recordTurnVerdict } from './qaap-agent-conversation-store-activity2';
import type { QaapTaskPullRequestRecordOptions } from './qaap-agent-conversation-store-task-pr';
import {
    QaapTaskPullRequestService,
    type QaapTaskPullRequestDestination,
    type QaapTaskPullRequestGithub,
} from './qaap-task-pull-request-service';

const GIT_ENV = {
    ...process.env, GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'spec', GIT_AUTHOR_EMAIL: 'spec@qaap.local', GIT_COMMITTER_NAME: 'spec', GIT_COMMITTER_EMAIL: 'spec@qaap.local',
};

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = GIT_ENV): string {
    return execFileSync('git', args, { cwd, env, encoding: 'utf8' });
}

let clock = 1_000;

/** The same snapshot the store takes: HEAD tree + `add -A` in a throwaway index, as a parentless commit. */
function snapshot(repo: string, id: string, messageId: string, kind?: 'pre-turn'): QaapConversationCheckpoint {
    const index = path.join(os.tmpdir(), `qaap-task-pr-spec-${process.pid}-${Date.now()}-${Math.random()}.index`);
    const env = { ...GIT_ENV, GIT_INDEX_FILE: index };
    try {
        git(repo, ['read-tree', 'HEAD'], env);
        git(repo, ['add', '-A'], env);
        const tree = git(repo, ['write-tree'], env).trim();
        const commit = git(repo, ['commit-tree', tree, '-m', `checkpoint ${id}`], env).trim();
        const ref = `refs/qaap/checkpoints/c1/${id}`;
        git(repo, ['update-ref', ref, commit]);
        return { id, messageId, label: id, commit, ref, capturedAt: clock++, ...(kind ? { kind } : {}) };
    } finally {
        fs.rmSync(index, { force: true });
    }
}

interface GithubCall {
    readonly method: keyof QaapTaskPullRequestGithub;
    readonly args: unknown[];
}

class FakeGithub implements QaapTaskPullRequestGithub {
    readonly calls: GithubCall[] = [];
    body = '';
    draft = false;

    async createPull(token: string, input: Parameters<QaapTaskPullRequestGithub['createPull']>[1]): Promise<QaapGithubPullRequestRecord> {
        this.calls.push({ method: 'createPull', args: [token, input] });
        this.body = input.body;
        this.draft = input.draft;
        return this.record();
    }
    async getPull(token: string, owner: string, repo: string, pullNumber: number): Promise<QaapGithubPullRequestRecord> {
        this.calls.push({ method: 'getPull', args: [token, owner, repo, pullNumber] });
        return this.record();
    }
    async updatePull(token: string, input: Parameters<QaapTaskPullRequestGithub['updatePull']>[1]): Promise<QaapGithubPullRequestRecord> {
        this.calls.push({ method: 'updatePull', args: [token, input] });
        this.body = input.body;
        return this.record();
    }
    async addLabel(token: string, owner: string, repo: string, pullNumber: number, label: string): Promise<void> {
        this.calls.push({ method: 'addLabel', args: [token, owner, repo, pullNumber, label] });
    }
    async removeLabel(token: string, owner: string, repo: string, pullNumber: number, label: string): Promise<void> {
        this.calls.push({ method: 'removeLabel', args: [token, owner, repo, pullNumber, label] });
    }
    async setDraft(token: string, nodeId: string, draft: boolean): Promise<void> {
        this.calls.push({ method: 'setDraft', args: [token, nodeId, draft] });
        this.draft = draft;
    }
    privateRepo = true;
    async isPrivate(): Promise<boolean> {
        return this.privateRepo;
    }
    protected record(): QaapGithubPullRequestRecord {
        return { number: 7, url: 'https://github.com/acme/demo/pull/7', nodeId: 'PR_node', body: this.body, draft: this.draft, state: 'open', merged: false };
    }
    methods(): string[] {
        return this.calls.map(call => call.method);
    }
}

interface FakeStore {
    conv: QaapAgentConversation;
    tasks: QaapAgentTask[];
    readonly records: { pr: QaapTaskPullRequest; options?: QaapTaskPullRequestRecordOptions }[];
    readonly emitter: Emitter<QaapAgentConversationEvent>;
}

class FakeConsents {
    readonly allowed = new Set<string>(['octo:acme/demo']);
    isAllowed(login: string, owner: string, repo: string): boolean {
        return this.allowed.has(`${login}:${owner}/${repo}`);
    }
    allow(login: string, owner: string, repo: string): void {
        this.allowed.add(`${login}:${owner}/${repo}`);
    }
}

class SpecTaskPullRequestService extends QaapTaskPullRequestService {
    token: string | undefined = 'gho_spec';
    readonly fakeConsents = new FakeConsents();
    readonly tokenCache = new QaapGithubOwnerTokenCache();
    constructor(readonly fake: FakeStore, readonly fakeGithub: FakeGithub, readonly remote: string) {
        super();
        this.github = fakeGithub;
        Object.assign(this, {
            consents: this.fakeConsents,
            ownerTokens: this.tokenCache,
            store: {
                update: (id: string, patch: { taskPullRequestEnabled?: boolean }) => {
                    fake.conv = { ...fake.conv, taskPullRequestEnabled: patch.taskPullRequestEnabled ? undefined : false };
                    return fake.conv;
                },
                get: (id: string) => id === fake.conv.id ? fake.conv : undefined,
                onDidChange: fake.emitter.event,
                getActiveTaskIdsForConversation: () => [],
                taskRunner: { list: () => fake.tasks },
                runSerializedGit: <T>(_cwd: string, job: () => Promise<T>) => job(),
                mutatingGit: (cwd: string, args: string[], env?: NodeJS.ProcessEnv) => runGitAsync('git', args, { cwd, env: { ...GIT_ENV, ...env }, timeoutMs: 30_000 }),
                recordTaskPullRequest: (id: string, pr: QaapTaskPullRequest, options?: QaapTaskPullRequestRecordOptions) => {
                    fake.records.push({ pr, options });
                    fake.conv = { ...fake.conv, taskPullRequest: pr };
                    return fake.conv;
                },
            },
        });
    }
    initForTest(): void {
        this.init();
    }
    protected override resolveToken(): string | undefined {
        return this.token;
    }
    protected override async resolveDestination(): Promise<QaapTaskPullRequestDestination | undefined> {
        return { owner: 'acme', repo: 'demo', localRemote: this.remote };
    }
}

describe('QaapTaskPullRequestService', function (): void {
    // Real git per test: generous for loaded CI hosts.
    this.timeout(90_000);

    let work: string;
    let remote: string;
    let repo: string;
    let fake: FakeStore;
    let github: FakeGithub;
    let service: SpecTaskPullRequestService;

    function turn(userId: string, taskId: string, edit: () => void): void {
        const pre = snapshot(repo, `${userId}-pre`, userId, 'pre-turn');
        edit();
        const post = snapshot(repo, `${userId}-post`, userId);
        fake.conv = {
            ...fake.conv,
            messages: [
                ...fake.conv.messages,
                { id: userId, role: 'user', content: `do ${userId}`, createdAt: Date.now(), taskId },
                { id: `${userId}-reply`, role: 'agent', content: `finished ${userId}`, createdAt: Date.now(), runUserMessageId: userId },
            ],
            checkpoints: [...(fake.conv.checkpoints ?? []), pre, post],
        };
    }

    function task(id: string, overrides: Partial<QaapAgentTask> = {}): QaapAgentTask {
        return {
            id, cwd: repo, command: 'qaiq', state: 'completed', createdAt: 0, agentId: 'qaiq',
            verification: { status: 'passed', command: 'npm test', attempts: 0 },
            review: { status: 'passed', reason: 'ok', agentId: 'claude' },
            ...overrides,
        } as QaapAgentTask;
    }

    function branchFiles(): string[] {
        return git(remote, ['ls-tree', '-r', '--name-only', 'refs/heads/qaap/task/c1']).trim().split('\n');
    }

    let savedRetryDelays: string | undefined;

    function headCommit(ref = 'refs/heads/qaap/task/c1'): string {
        return git(remote, ['rev-parse', ref]).trim();
    }

    before(() => {
        savedRetryDelays = process.env.QAAP_TASK_PR_RETRY_DELAYS_MS;
        process.env.QAAP_TASK_PR_RETRY_DELAYS_MS = '0,0,0';
    });

    after(() => {
        if (savedRetryDelays === undefined) {
            delete process.env.QAAP_TASK_PR_RETRY_DELAYS_MS;
        } else {
            process.env.QAAP_TASK_PR_RETRY_DELAYS_MS = savedRetryDelays;
        }
    });

    beforeEach(() => {
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-task-pr-spec-'));
        remote = path.join(work, 'acme', 'demo.git');
        fs.mkdirSync(remote, { recursive: true });
        git(remote, ['init', '--bare', '-q', '-b', 'main']);
        const seed = path.join(work, 'seed');
        fs.mkdirSync(seed);
        git(seed, ['init', '-q', '-b', 'main']);
        fs.writeFileSync(path.join(seed, 'README.md'), 'hello\n');
        git(seed, ['add', '-A']);
        git(seed, ['commit', '-qm', 'init']);
        git(seed, ['push', '-q', remote, 'main']);
        repo = path.join(work, 'repo');
        git(work, ['clone', '-q', remote, repo]);
        fake = {
            conv: { id: 'c1', cwd: repo, agentId: 'qaiq', title: 'Add feature', status: 'idle', createdAt: 0, updatedAt: 0, messages: [], ownerLogin: 'octo' },
            tasks: [],
            records: [],
            emitter: new Emitter<QaapAgentConversationEvent>(),
        };
        github = new FakeGithub();
        service = new SpecTaskPullRequestService(fake, github, remote);
    });

    afterEach(() => {
        fs.rmSync(work, { recursive: true, force: true });
    });

    it('opens a ready PR from the turn checkpoints, leaving pre-existing dirty files out', async () => {
        // The user's own uncommitted work, there before the agent turn started.
        fs.writeFileSync(path.join(repo, 'README.md'), 'hello\nlocal edit\n');
        fs.writeFileSync(path.join(repo, 'scratch.txt'), 'mine\n');
        turn('u1', 't1', () => fs.writeFileSync(path.join(repo, 'feature.ts'), 'export const x = 1;\n'));
        fake.tasks = [task('t1')];

        await service.sync('c1');

        expect(branchFiles()).to.deep.equal(['README.md', 'feature.ts']);
        expect(git(remote, ['show', 'refs/heads/qaap/task/c1:README.md'])).to.equal('hello\n');
        expect(github.methods()).to.deep.equal(['createPull']);
        const input = github.calls[0].args[1] as { draft: boolean; head: string; base: string; title: string; body: string };
        expect(input).to.include({ draft: false, head: 'qaap/task/c1', base: 'main', title: 'Add feature' });
        expect(input.body).to.contain(QAAP_TASK_PR_EVIDENCE_START);
        expect(input.body).to.contain('### Checks');
        expect(input.body).to.contain('### Reviewer verdict');
        expect(input.body).to.contain('feature.ts');
        const recorded = fake.records.at(-1)!;
        expect(recorded.pr).to.include({ number: 7, state: 'open', branch: 'qaap/task/c1', lastUserMessageId: 'u1' });
        expect(recorded.options?.linkedPullRequest).to.include({ owner: 'acme', repo: 'demo', number: 7 });

        // Quiet again with nothing new: no GitHub traffic, no write.
        await service.sync('c1');
        expect(github.methods()).to.deep.equal(['createPull']);
        expect(fake.records).to.have.length(1);
    });

    it('opens a red turn as a labelled draft with the attention prefix', async () => {
        turn('u1', 't1', () => fs.writeFileSync(path.join(repo, 'feature.ts'), 'broken(\n'));
        fake.tasks = [task('t1', {
            state: 'completed_with_warnings',
            verification: { status: 'failed', command: 'npm run build', attempts: 2, summary: 'error TS1005' },
        })];

        await service.sync('c1');

        expect(github.methods()).to.deep.equal(['createPull', 'addLabel']);
        const input = github.calls[0].args[1] as { draft: boolean; title: string; body: string };
        expect(input.draft).to.equal(true);
        expect(input.title).to.equal('[needs attention] Add feature');
        expect(input.body).to.contain('error TS1005');
        expect(github.calls[1].args[4]).to.equal(QAAP_TASK_PR_ATTENTION_LABEL);
        expect(fake.records.at(-1)!.pr.state).to.equal('draft-needs-attention');
    });

    it('pushes the next turn to the same branch and patches the body, keeping human text', async () => {
        turn('u1', 't1', () => fs.writeFileSync(path.join(repo, 'feature.ts'), 'export const x = 1;\n'));
        fake.tasks = [task('t1')];
        await service.sync('c1');
        const firstHead = fake.conv.taskPullRequest!.headSha!;
        github.body = `Human intro\n\n${github.body}`;

        turn('u2', 't2', () => fs.writeFileSync(path.join(repo, 'feature.ts'), 'export const x = 2;\n'));
        fake.tasks = [task('t1'), task('t2')];
        await service.sync('c1');

        expect(github.methods()).to.deep.equal(['createPull', 'getPull', 'updatePull']);
        const head = git(remote, ['rev-parse', 'refs/heads/qaap/task/c1']).trim();
        expect(git(remote, ['rev-parse', `${head}^`]).trim()).to.equal(firstHead);
        expect(git(remote, ['show', `${head}:feature.ts`])).to.equal('export const x = 2;\n');
        const patch = github.calls[2].args[1] as { number: number; body: string };
        expect(patch.number).to.equal(7);
        expect(patch.body.startsWith('Human intro')).to.equal(true);
        expect(patch.body.split(QAAP_TASK_PR_EVIDENCE_START)).to.have.length(2);
        expect(fake.records.at(-1)!.pr).to.include({ headSha: head, lastUserMessageId: 'u2' });
    });

    it('asks the owner to sign in again when there is no token, once, without pushing', async () => {
        service.token = undefined;
        turn('u1', 't1', () => fs.writeFileSync(path.join(repo, 'feature.ts'), 'export const x = 1;\n'));
        fake.tasks = [task('t1')];

        await service.sync('c1');
        await service.sync('c1');

        expect(github.calls).to.deep.equal([]);
        expect(git(remote, ['for-each-ref', 'refs/heads/qaap'])).to.equal('');
        expect(fake.records).to.have.length(1);
        expect(fake.records[0].pr).to.include({ state: 'needs-sign-in', lastError: 'no GitHub token: sign in again' });
        expect(fake.records[0].options?.traceNote).to.equal('no GitHub token: sign in again');
    });

    it('does nothing while the conversation is still busy or in plan mode', async () => {
        turn('u1', 't1', () => fs.writeFileSync(path.join(repo, 'feature.ts'), 'export const x = 1;\n'));
        fake.tasks = [task('t1')];
        fake.conv = { ...fake.conv, status: 'streaming' };
        await service.sync('c1');
        fake.conv = { ...fake.conv, status: 'idle', interactionModeId: 'plan' };
        await service.sync('c1');
        expect(github.calls).to.deep.equal([]);
    });

    it('records a failure on the conversation instead of swallowing it', async () => {
        turn('u1', 't1', () => fs.writeFileSync(path.join(repo, 'feature.ts'), 'export const x = 1;\n'));
        fake.tasks = [task('t1')];
        github.createPull = async () => {
            throw new Error('Bad credentials');
        };
        await service.sync('c1');
        const recorded = fake.records.at(-1)!;
        expect(recorded.pr.lastError).to.equal('Bad credentials');
        expect(recorded.options?.traceNote).to.contain('Bad credentials');
        // The same failure again is not re-announced.
        await service.sync('c1');
        expect(fake.records).to.have.length(1);
    });

    it('stays off when QAAP_TASK_PR is 0', () => {
        expect(service.isEnabled({ QAAP_TASK_PR: '0' })).to.equal(false);
        expect(service.isEnabled({ QAAP_TASK_PR: 'off' })).to.equal(false);
        expect(service.isEnabled({})).to.equal(true);
        const previous = process.env.QAAP_TASK_PR;
        process.env.QAAP_TASK_PR = '0';
        try {
            const scheduled: string[] = [];
            service.schedule = id => {
                scheduled.push(id);
            };
            service.initForTest();
            fake.emitter.fire({ type: 'updated', conversation: { id: 'c1' } as never });
            expect(scheduled).to.deep.equal([]);
        } finally {
            if (previous === undefined) {
                delete process.env.QAAP_TASK_PR;
            } else {
                process.env.QAAP_TASK_PR = previous;
            }
        }
    });

    it('only honours the test token in local skip-auth mode', () => {
        expect(service.isTestMode({ QAAP_SKIP_AUTH: 'true', QAAP_CLOUD_MODE: 'local', QAAP_TASK_PR_TEST_TOKEN: 't' })).to.equal(true);
        expect(service.isTestMode({ QAAP_SKIP_AUTH: 'true', QAAP_CLOUD_MODE: 'docker', QAAP_TASK_PR_TEST_TOKEN: 't' })).to.equal(false);
        expect(service.isTestMode({ QAAP_CLOUD_MODE: 'local', QAAP_TASK_PR_TEST_TOKEN: 't' })).to.equal(false);
        expect(service.isTestMode({ QAAP_SKIP_AUTH: 'true', QAAP_CLOUD_MODE: 'local', QAAP_TASK_PR_TEST_TOKEN: 't', NODE_ENV: 'production' })).to.equal(false);
        expect(service.isTestMode({ QAAP_SKIP_AUTH: 'true', QAAP_CLOUD_MODE: 'local' })).to.equal(false);
    });

    it('waits for the one-time consent per user and repository, then opens the PR on Allow', async () => {
        service.fakeConsents.allowed.clear();
        turn('u1', 't1', () => fs.writeFileSync(path.join(repo, 'feature.ts'), 'export const x = 1;\n'));
        fake.tasks = [task('t1')];

        await service.sync('c1');
        await service.sync('c1');
        expect(github.calls).to.deep.equal([]);
        expect(git(remote, ['for-each-ref', 'refs/heads/qaap'])).to.equal('');
        expect(fake.records).to.have.length(1);
        expect(fake.records[0].pr.state).to.equal('awaiting-consent');
        expect(fake.records[0].options?.traceNote).to.equal('PR ready: allow Qaap to open PRs on acme/demo?');

        await service.respondToConsent('c1', true);
        await service.sync('c1');
        expect(service.fakeConsents.isAllowed('octo', 'acme', 'demo')).to.equal(true);
        expect(github.methods()).to.deep.equal(['createPull']);
        expect(fake.records.at(-1)!.pr).to.include({ state: 'open', number: 7 });
    });

    it('"Not now" turns "Create PR when done" off for the conversation', async () => {
        service.fakeConsents.allowed.clear();
        turn('u1', 't1', () => fs.writeFileSync(path.join(repo, 'feature.ts'), 'export const x = 1;\n'));
        await service.sync('c1');
        await service.respondToConsent('c1', false);
        expect(fake.conv.taskPullRequestEnabled).to.equal(false);
        service.fakeConsents.allow('octo', 'acme', 'demo');
        await service.sync('c1');
        expect(github.calls).to.deep.equal([]);
    });

    it('skips read-only (exploratory) turns', async () => {
        turn('u1', 't1', () => fs.writeFileSync(path.join(repo, 'notes.md'), 'exploration notes\n'));
        fake.conv = {
            ...fake.conv,
            messages: fake.conv.messages.map(message => message.id === 'u1'
                ? { ...message, turnVerdict: { taskState: 'completed', readOnly: true, settledAt: 1 } }
                : message),
        };
        await service.sync('c1');
        expect(github.calls).to.deep.equal([]);
        expect(fake.records).to.deep.equal([]);
    });

    it('uses a neutral commit subject: a user-set title or the changed files, never the prompt', async () => {
        turn('u1', 't1', () => fs.writeFileSync(path.join(repo, 'feature.ts'), 'export const x = 1;\n'));
        fake.tasks = [task('t1')];
        await service.sync('c1');
        const message = git(remote, ['log', '-1', '--format=%B', 'refs/heads/qaap/task/c1']);
        expect(message.split('\n')[0]).to.equal('Qaap task: Add feature');
        expect(message).not.to.contain('do u1');
        // A title that is just the first prompt is not used: the subject names the changed files.
        fake.conv = { ...fake.conv, title: 'do u2' };
        turn('u2', 't2', () => fs.writeFileSync(path.join(repo, 'more.ts'), 'more\n'));
        fake.tasks = [task('t1'), task('t2')];
        fake.conv = { ...fake.conv, messages: [{ id: 'u0', role: 'user', content: 'do u2 please', createdAt: 0 }, ...fake.conv.messages] };
        await service.sync('c1');
        const second = git(remote, ['log', '-1', '--format=%s', 'refs/heads/qaap/task/c1']).trim();
        expect(second).to.equal('Qaap task: update more.ts');
    });

    it('keeps the agent reply out of a public repository\'s PR body', async () => {
        github.privateRepo = false;
        turn('u1', 't1', () => fs.writeFileSync(path.join(repo, 'feature.ts'), 'export const x = 1;\n'));
        fake.tasks = [task('t1')];
        await service.sync('c1');
        const body = (github.calls[0].args[1] as { body: string }).body;
        expect(body).not.to.contain('finished u1');
        expect(body).to.contain('Qaap task: Add feature.');
        expect(body).to.contain('feature.ts');
    });

    it('reads the red/green verdict persisted on the turn when the task runner forgot the task', async () => {
        turn('u1', 't1', () => fs.writeFileSync(path.join(repo, 'feature.ts'), 'broken(\n'));
        fake.conv = recordTurnVerdict(fake.conv, 'u1', {
            state: 'completed_with_warnings',
            verification: { status: 'failed', command: 'npm run build', attempts: 2, summary: 'error TS1005' },
        }, undefined, 5);
        fake.tasks = [];
        await service.sync('c1');
        const input = github.calls[0].args[1] as { draft: boolean; body: string };
        expect(input.draft).to.equal(true);
        expect(input.body).to.contain('error TS1005');
        expect(fake.conv.messages.find(message => message.id === 'u1')?.turnVerdict).to.include({ taskState: 'completed_with_warnings', settledAt: 5 });
    });

    it('records a blocked turn as blocked in the persisted verdict', () => {
        const conv = recordTurnVerdict(fake.conv.messages.length ? fake.conv : {
            ...fake.conv, messages: [{ id: 'u9', role: 'user', content: 'x', createdAt: 1 }],
        }, 'u9', { state: 'completed' }, 'the API key', 7);
        expect(conv.messages[0].turnVerdict).to.deep.equal({ taskState: 'blocked', blockedNeed: 'the API key', settledAt: 7 });
    });

    it('retries transient GitHub failures (5xx, secondary rate limits) and not 422', async () => {
        turn('u1', 't1', () => fs.writeFileSync(path.join(repo, 'feature.ts'), 'export const x = 1;\n'));
        fake.tasks = [task('t1')];
        const create = github.createPull.bind(github);
        let attempts = 0;
        github.createPull = async (token, input) => {
            attempts++;
            if (attempts === 1) {
                throw new GithubApiError('Bad gateway', 502);
            }
            if (attempts === 2) {
                throw new GithubApiError('secondary rate limit', 403, true);
            }
            return create(token, input);
        };
        await service.sync('c1');
        expect(attempts).to.equal(3);
        expect(fake.records.at(-1)!.pr).to.include({ number: 7, state: 'open' });

        expect(service.isRetryable(new GithubApiError('Validation Failed', 422))).to.equal(false);
        expect(service.isRetryable(new GithubApiError('Bad credentials', 401))).to.equal(false);
        expect(service.isRetryable(new GithubApiError('Forbidden', 403))).to.equal(false);
        expect(service.isRetryable(new GithubApiError('Too many', 429))).to.equal(true);
        expect(service.isRetryable(new TypeError('fetch failed'))).to.equal(true);
    });

    it('does not retry a 422 and records it', async () => {
        turn('u1', 't1', () => fs.writeFileSync(path.join(repo, 'feature.ts'), 'export const x = 1;\n'));
        fake.tasks = [task('t1')];
        let attempts = 0;
        github.createPull = async () => {
            attempts++;
            throw new GithubApiError('Validation Failed', 422);
        };
        await service.sync('c1');
        expect(attempts).to.equal(1);
        expect(fake.records.at(-1)!.pr.lastError).to.equal('Validation Failed');
    });

    it('turns a 401 into "sign in again" and drops the cached token', async () => {
        service.tokenCache.remember('octo', 'gho_spec');
        turn('u1', 't1', () => fs.writeFileSync(path.join(repo, 'feature.ts'), 'export const x = 1;\n'));
        fake.tasks = [task('t1')];
        github.createPull = async () => {
            throw new GithubApiError('Bad credentials', 401);
        };
        await service.sync('c1');
        expect(fake.records.at(-1)!.pr.state).to.equal('needs-sign-in');
        expect(service.tokenCache.get('octo')).to.equal(undefined);
    });

    it('builds on a commit someone else pushed to the task branch', async () => {
        turn('u1', 't1', () => fs.writeFileSync(path.join(repo, 'feature.ts'), 'export const x = 1;\n'));
        fake.tasks = [task('t1')];
        await service.sync('c1');
        // A reviewer pushes a fix on top of our branch.
        const other = path.join(work, 'other');
        git(work, ['clone', '-q', '--branch', 'qaap/task/c1', remote, other]);
        fs.writeFileSync(path.join(other, 'review.txt'), 'reviewer fix\n');
        git(other, ['add', '-A']);
        git(other, ['commit', '-qm', 'reviewer fix']);
        git(other, ['push', '-q', 'origin', 'qaap/task/c1']);
        const foreign = git(other, ['rev-parse', 'HEAD']).trim();

        turn('u2', 't2', () => fs.writeFileSync(path.join(repo, 'feature.ts'), 'export const x = 2;\n'));
        fake.tasks = [task('t1'), task('t2')];
        await service.sync('c1');

        const head = headCommit();
        expect(git(remote, ['rev-parse', `${head}^`]).trim()).to.equal(foreign);
        expect(branchFiles()).to.include('review.txt');
        expect(github.methods()).to.deep.equal(['createPull', 'getPull', 'updatePull']);
        expect(fake.records.at(-1)!.pr.divergence).to.include({ resolution: 'built-on-remote', remoteSha: foreign });
        expect((github.calls[2].args[1] as { body: string }).body).to.contain('on top of theirs');
    });

    it('moves to a new branch when the remote branch was replaced by unrelated history', async () => {
        turn('u1', 't1', () => fs.writeFileSync(path.join(repo, 'feature.ts'), 'export const x = 1;\n'));
        fake.tasks = [task('t1')];
        await service.sync('c1');
        const other = path.join(work, 'other');
        fs.mkdirSync(other);
        git(other, ['init', '-q', '-b', 'x']);
        fs.writeFileSync(path.join(other, 'unrelated.txt'), 'x\n');
        git(other, ['add', '-A']);
        git(other, ['commit', '-qm', 'unrelated']);
        git(other, ['push', '-q', '--force', remote, 'x:refs/heads/qaap/task/c1']);

        turn('u2', 't2', () => fs.writeFileSync(path.join(repo, 'feature.ts'), 'export const x = 2;\n'));
        fake.tasks = [task('t1'), task('t2')];
        await service.sync('c1');

        const recorded = fake.records.at(-1)!.pr;
        expect(recorded.branch).to.equal('qaap/task/c1-2');
        expect(recorded.divergence).to.include({ resolution: 'new-branch', previousBranch: 'qaap/task/c1', previousNumber: 7 });
        expect(git(remote, ['show', 'refs/heads/qaap/task/c1-2:feature.ts'])).to.equal('export const x = 2;\n');
        const create = github.calls.filter(call => call.method === 'createPull').at(-1)!.args[1] as { head: string; body: string };
        expect(create.head).to.equal('qaap/task/c1-2');
        expect(create.body).to.contain('Supersedes #7');
    });

    it('rebuilds the branch from its base and force-pushes it after a rewind', async () => {
        turn('u1', 't1', () => fs.writeFileSync(path.join(repo, 'a.ts'), 'a\n'));
        turn('u2', 't2', () => fs.writeFileSync(path.join(repo, 'b.ts'), 'b\n'));
        fake.tasks = [task('t1'), task('t2')];
        await service.sync('c1');
        expect(branchFiles()).to.deep.equal(['README.md', 'a.ts', 'b.ts']);

        // Rewind to before u2: its messages and checkpoints are gone, the tree is restored.
        fake.conv = {
            ...fake.conv,
            messages: fake.conv.messages.filter(message => !message.id.startsWith('u2')),
            checkpoints: (fake.conv.checkpoints ?? []).filter(checkpoint => checkpoint.messageId !== 'u2'),
        };
        await service.sync('c1');

        expect(branchFiles()).to.deep.equal(['README.md', 'a.ts']);
        const recorded = fake.records.at(-1)!.pr;
        expect(recorded.rebuiltAt).to.be.a('number');
        expect(recorded.lastUserMessageId).to.equal('u1');
        expect((github.calls.at(-1)!.args[1] as { body?: string }).body ?? (github.calls.find(call => call.method === 'updatePull')!.args[1] as { body: string }).body)
            .to.contain('rebuilt from its base');
    });

    it('drops the turns a checkpoint restore undid', async () => {
        turn('u1', 't1', () => fs.writeFileSync(path.join(repo, 'a.ts'), 'a\n'));
        turn('u2', 't2', () => fs.writeFileSync(path.join(repo, 'b.ts'), 'b\n'));
        fake.tasks = [task('t1'), task('t2')];
        await service.sync('c1');
        const u1Post = fake.conv.checkpoints!.find(checkpoint => checkpoint.id === 'u1-post')!;
        // Restore to u1's snapshot: the undo snapshot records what was written back.
        fs.rmSync(path.join(repo, 'b.ts'));
        const undo = { ...snapshot(repo, 'undo', 'u2'), restoredFrom: u1Post.commit };
        fake.conv = { ...fake.conv, checkpoints: [...fake.conv.checkpoints!, undo] };
        await service.sync('c1');
        expect(branchFiles()).to.deep.equal(['README.md', 'a.ts']);
        expect(fake.records.at(-1)!.pr.restoreSeenAt).to.equal(undo.capturedAt);
    });
});
