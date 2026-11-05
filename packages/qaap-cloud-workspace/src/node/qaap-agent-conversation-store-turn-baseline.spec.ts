// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { QaapAgentConversation, QaapConversationCheckpoint } from '../common/qaap-agent-conversation';
import { captureTurnGitState } from './qaap-agent-conversation-store-activity2';
import { computeGitDiffStats, localGitRead } from './qaap-agent-conversation-store-git';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';

function git(cwd: string, args: readonly string[], env?: NodeJS.ProcessEnv): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.autocrlf=false', ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, ...env, GIT_CONFIG_NOSYSTEM: '1' },
    });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Context stub: real git for the seams the settle path uses, recording checkpoint captures. */
function buildContext(conv: QaapAgentConversation): { ctx: QaapAgentConversationStoreContext; captures: unknown[] } {
    const conversations = new Map<string, QaapAgentConversation>([[conv.id, conv]]);
    const captures: unknown[] = [];
    const ctx = {
        conversations,
        checkpointLabel: (content: string) => content,
        runSerializedGit: <T>(_cwd: string, job: () => Promise<T>): Promise<T> => job(),
        mutatingGit: async (cwd: string, args: string[], env?: NodeJS.ProcessEnv) => git(cwd, args, env),
        readGit: (cwd: string, args: readonly string[]) => localGitRead(cwd, args),
        computeGitDiffStats: (cwd: string, startSha?: string) => computeGitDiffStats(cwd, startSha),
        captureCheckpoint: async (cwd: string, conversationId: string, messageId: string, label: string, stats?: unknown): Promise<QaapConversationCheckpoint> => {
            captures.push({ messageId, label, stats });
            return { id: 'post', messageId, label, commit: 'f'.repeat(40), ref: 'refs/qaap/checkpoints/x', capturedAt: 1 };
        },
    } as unknown as QaapAgentConversationStoreContext;
    return { ctx, captures };
}

describe('captureTurnGitState baseline', function (): void {
    this.timeout(20_000);

    let repo: string;

    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-turn-baseline-'));
        git(repo, ['init', '-q']);
        git(repo, ['config', 'user.email', 'spec@qaap.test']);
        git(repo, ['config', 'user.name', 'qaap spec']);
        fs.writeFileSync(path.join(repo, 'README.md'), 'base\n');
        fs.writeFileSync(path.join(repo, 'a.ts'), 'one\n');
        git(repo, ['add', '-A']);
        git(repo, ['commit', '-qm', 'init']);
    });

    afterEach(() => {
        fs.rmSync(repo, { recursive: true, force: true });
    });

    function conversation(checkpoints: QaapConversationCheckpoint[]): QaapAgentConversation {
        return {
            id: 'c1', cwd: repo, messages: [{ id: 'u1', role: 'user', content: 'fix it', createdAt: 1 }],
            checkpoints, createdAt: 1, updatedAt: 1, status: 'idle', title: 't', agentId: 'a',
        } as unknown as QaapAgentConversation;
    }

    it('measures the turn against the pre-turn tree snapshot, excluding dirt that existed before it', async () => {
        fs.writeFileSync(path.join(repo, 'README.md'), 'user edit before the turn\n');
        const indexFile = path.join(repo, '.git', 'turn-pre.index');
        git(repo, ['add', '-A'], { GIT_INDEX_FILE: indexFile });
        const tree = git(repo, ['write-tree'], { GIT_INDEX_FILE: indexFile }).stdout.trim();
        const commit = git(repo, ['-c', 'user.email=spec@qaap.test', '-c', 'user.name=qaap', 'commit-tree', tree, '-m', 'pre']).stdout.trim();
        const pre: QaapConversationCheckpoint = { id: 'pre', messageId: 'u1', label: 'Before', commit, ref: 'refs/qaap/checkpoints/c1/u1-1', capturedAt: 1, kind: 'pre-turn' };
        const { ctx } = buildContext(conversation([pre]));

        fs.writeFileSync(path.join(repo, 'hello.txt'), 'hi\n');
        fs.writeFileSync(path.join(repo, 'a.ts'), 'one\ntwo\n');
        const state = await captureTurnGitState(ctx, 'c1', 'u1', git(repo, ['rev-parse', 'HEAD']).stdout.trim());

        expect(state?.gitStats).to.deep.equal({ added: 2, removed: 0, files: 2 });
        expect(state?.baselineApproximate).to.equal(undefined);
        expect(state?.checkpoint).to.not.equal(undefined);
    });

    it('measures the task against its first pre-turn snapshot, so a later turn still counts the earlier turn', async () => {
        const snapshot = (kind: 'pre-turn', messageId: string, label: string): QaapConversationCheckpoint => {
            const indexFile = path.join(repo, '.git', `turn-${messageId}.index`);
            git(repo, ['add', '-A'], { GIT_INDEX_FILE: indexFile });
            const tree = git(repo, ['write-tree'], { GIT_INDEX_FILE: indexFile }).stdout.trim();
            const commit = git(repo, ['-c', 'user.email=spec@qaap.test', '-c', 'user.name=qaap', 'commit-tree', tree, '-m', label]).stdout.trim();
            return { id: messageId, messageId, label, commit, ref: `refs/qaap/checkpoints/c1/${messageId}-1`, capturedAt: 1, kind };
        };
        // Turn 1 starts from the clean repository and edits hello.txt; turn 2 starts after that edit.
        const first = snapshot('pre-turn', 'u1', 'Before turn 1');
        fs.writeFileSync(path.join(repo, 'hello.txt'), 'hi\n');
        const second = snapshot('pre-turn', 'u2', 'Before turn 2');
        fs.writeFileSync(path.join(repo, 'a.ts'), 'one\ntwo\n');
        const conv = {
            id: 'c1', cwd: repo,
            messages: [
                { id: 'u1', role: 'user', content: 'first', createdAt: 1 },
                { id: 'u2', role: 'user', content: 'second', createdAt: 2 },
            ],
            checkpoints: [first, second], createdAt: 1, updatedAt: 1, status: 'idle', title: 't', agentId: 'a',
        } as unknown as QaapAgentConversation;
        const { ctx } = buildContext(conv);

        const state = await captureTurnGitState(ctx, 'c1', 'u2', git(repo, ['rev-parse', 'HEAD']).stdout.trim());

        // The task (pill, Changes list) counts hello.txt from turn 1 as well; the turn counts only a.ts.
        expect(state?.gitStats).to.deep.equal({ added: 2, removed: 0, files: 2 });
        expect(state?.turnStats).to.deep.equal({ added: 1, removed: 0, files: 1 });
        expect(state?.baselineApproximate).to.equal(undefined);
    });

    it('falls back to the legacy diff and flags baselineApproximate when no pre-turn checkpoint exists', async () => {
        fs.writeFileSync(path.join(repo, 'README.md'), 'user edit before the turn\n');
        const { ctx } = buildContext(conversation([]));
        fs.writeFileSync(path.join(repo, 'hello.txt'), 'hi\n');
        const state = await captureTurnGitState(ctx, 'c1', 'u1', git(repo, ['rev-parse', 'HEAD']).stdout.trim());

        // The legacy diff counts the pre-existing README edit too, which is why it is approximate.
        expect(state?.gitStats?.added).to.equal(1);
        expect(state?.gitStats?.removed).to.equal(1);
        expect(state?.baselineApproximate).to.equal(true);
    });
});
