// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapAgentConversationEndpoint } from './qaap-agent-conversation-endpoint';
import { localGitRead } from './qaap-agent-conversation-store-git';

interface FakeRes {
    statusCode: number;
    body: unknown;
    status(code: number): FakeRes;
    json(payload: unknown): FakeRes;
}

const fakeRes = (): FakeRes => ({
    statusCode: 200,
    body: undefined,
    status(code: number): FakeRes { this.statusCode = code; return this; },
    json(payload: unknown): FakeRes { this.body = payload; return this; },
});

/**
 * Create requests against a real temporary git repository whose uncommitted edit stands in for the
 * user's own changes. The store is a stub; the worktree seam runs real `git worktree add`.
 */
describe('QaapAgentConversationEndpoint create on a dirty shared workspace', function (): void {
    this.timeout(20_000);

    let repo: string;
    let worktreeRoot: string;
    let savedMode: string | undefined;
    let created: number;
    let worktreeCreates: number;

    const git = (args: string[], cwd: string = repo): string => execFileSync(
        'git', ['-c', 'core.autocrlf=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' },
    ).trim();

    function build(options: { failGit?: boolean } = {}): QaapAgentConversationEndpoint {
        const conversations = new Map<string, Record<string, unknown>>();
        const endpoint = Object.create(QaapAgentConversationEndpoint.prototype) as QaapAgentConversationEndpoint;
        Object.assign(endpoint, {
            clientRequestDedup: new Map<string, { conversationId: string; at: number }>(),
            recentTextCreates: new Map(),
            clientRequestInFlight: new Set<string>(),
            repoClaims: new Map<string, number>(),
            store: {
                taskRunner: { defaultAgentFresh: async () => 'opencode', defaultAgent: () => 'opencode' },
                conversations,
                get: (id: string) => conversations.get(id),
                getActiveTaskIdsForConversation: () => [],
                readGit: (cwd: string, args: readonly string[]) => options.failGit
                    ? Promise.resolve({ status: null, stdout: '', stderr: 'simulated failure', timedOut: true })
                    : localGitRead(cwd, args),
                create: (req: { cwd: string; message?: string }, ownerLogin?: string) => {
                    created += 1;
                    const conv = { ...req, id: `conv-${created}`, ownerLogin };
                    conversations.set(conv.id, conv);
                    return conv;
                },
            },
            worktrees: {
                create: async (cwd: string) => {
                    worktreeCreates += 1;
                    const worktreePath = path.join(worktreeRoot, `wt-${worktreeCreates}`);
                    const branch = `qaap/worktree/${worktreeCreates}`;
                    git(['worktree', 'add', '-q', '-b', branch, worktreePath], cwd);
                    return { worktreePath, branch };
                },
            },
            auth: {
                authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }),
                resolveUserLogin: () => 'alice',
                resolveOwnedRepositoryCwd: (_ctx: unknown, cwd: string) => ({ kind: 'ok', cwd }),
                ownsWorkspacePath: () => true,
                denyForbidden: () => false,
            },
            requireAuth: () => ({ kind: 'authenticated', userLogin: 'alice' }),
        });
        return endpoint;
    }

    let uniqueSeq = 0;
    async function create(endpoint: QaapAgentConversationEndpoint, body: Record<string, unknown>): Promise<FakeRes> {
        const res = fakeRes();
        uniqueSeq += 1;
        await (endpoint as unknown as { handleCreate(req: unknown, res: unknown): Promise<void> })
            .handleCreate({ body: { cwd: repo, message: `dirty case ${uniqueSeq}`, ...body } }, res);
        return res;
    }

    beforeEach(() => {
        savedMode = process.env.QAAP_TASK_ISOLATION;
        delete process.env.QAAP_TASK_ISOLATION;
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-dirty-create-'));
        worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-dirty-wt-'));
        git(['init', '-q']);
        git(['config', 'user.email', 'spec@qaap.test']);
        git(['config', 'user.name', 'qaap spec']);
        fs.writeFileSync(path.join(repo, 'README.md'), 'base\n');
        git(['add', '-A']);
        git(['commit', '-qm', 'init']);
        created = 0;
        worktreeCreates = 0;
    });

    afterEach(() => {
        if (savedMode === undefined) {
            delete process.env.QAAP_TASK_ISOLATION;
        } else {
            process.env.QAAP_TASK_ISOLATION = savedMode;
        }
        fs.rmSync(repo, { recursive: true, force: true });
        fs.rmSync(worktreeRoot, { recursive: true, force: true });
    });

    it('answers 409 dirty_workspace and creates nothing when an auto task would share the dirty tree', async () => {
        fs.writeFileSync(path.join(repo, 'README.md'), 'user edit\n');
        const res = await create(build(), { isolation: 'auto' });
        expect(res.statusCode).to.equal(409);
        expect(res.body).to.deep.include({ code: 'dirty_workspace', total: 1 });
        expect((res.body as { files: string[] }).files).to.deep.equal(['README.md']);
        expect(created).to.equal(0);
        expect(worktreeCreates).to.equal(0);
    });

    it('creates the task in the shared tree when the client accepts the dirt', async () => {
        fs.writeFileSync(path.join(repo, 'README.md'), 'user edit\n');
        const res = await create(build(), { isolation: 'auto', acceptDirty: true });
        expect(res.statusCode).to.equal(201);
        expect(created).to.equal(1);
    });

    it('creates the task when the dirty check cannot run (unknown is not treated as dirty)', async () => {
        fs.writeFileSync(path.join(repo, 'README.md'), 'user edit\n');
        const res = await create(build({ failGit: true }), { isolation: 'auto' });
        expect(res.statusCode).to.equal(201);
        expect(created).to.equal(1);
    });

    it('creates the task in the shared tree without asking when the workspace is clean', async () => {
        const res = await create(build(), { isolation: 'auto' });
        expect(res.statusCode).to.equal(201);
        expect(worktreeCreates).to.equal(0);
    });

    it('isolates in a worktree and leaves the base checkout byte-identical', async () => {
        fs.writeFileSync(path.join(repo, 'README.md'), 'user edit\n');
        const before = fs.readFileSync(path.join(repo, 'README.md'));
        const res = await create(build(), { isolation: 'worktree' });
        expect(res.statusCode).to.equal(201);
        expect(worktreeCreates).to.equal(1);
        expect(fs.readFileSync(path.join(repo, 'README.md')).equals(before)).to.equal(true);
    });

    it('keeps the dirty check out of follow-up messages (guard: only the create path can answer 409 dirty_workspace)', () => {
        // Follow-ups post through handlePostMessage, never through handleCreate. A behavioural test
        // would need the full message pipeline; this guard fails if the check moves into that path.
        const proto = QaapAgentConversationEndpoint.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
        expect(proto.handlePostMessage.toString()).to.not.contain('readDirtyWorkspace');
        expect(proto.handleCreate.toString()).to.contain('readDirtyWorkspace');
    });

    it('isolates an auto task silently when QAAP_TASK_ISOLATION=dirty', async () => {
        process.env.QAAP_TASK_ISOLATION = 'dirty';
        fs.writeFileSync(path.join(repo, 'README.md'), 'user edit\n');
        const res = await create(build(), { isolation: 'auto' });
        expect(res.statusCode).to.equal(201);
        expect(worktreeCreates).to.equal(1);
    });
});
