// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    computeGitDiffStats,
    QAAP_GIT_ADD_ALL_TIMEOUT_MS,
    QAAP_GIT_DEFAULT_TIMEOUT_MS,
    QaapGitCwdSerializer,
    QaapGitRunResult,
    runGitAsync,
} from './qaap-agent-conversation-store-git';
import { captureCheckpointExtracted } from './qaap-agent-conversation-store-thought-brief2';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';

interface RecordedGitCall {
    readonly args: string[];
    readonly indexFile?: string;
    readonly timeoutMs?: number;
}

function fakeCheckpointCtx(respond: (args: string[]) => QaapGitRunResult, calls: RecordedGitCall[]): QaapAgentConversationStoreContext {
    return {
        mutatingGit: async (_cwd: string, args: string[], env?: NodeJS.ProcessEnv, timeoutMs?: number): Promise<QaapGitRunResult> => {
            calls.push({ args, indexFile: env?.GIT_INDEX_FILE, timeoutMs });
            // Yield so a synchronous implementation could not pass by accident.
            await new Promise(resolve => setImmediate(resolve));
            return respond(args);
        },
    } as unknown as QaapAgentConversationStoreContext;
}

const ok = (stdout = ''): QaapGitRunResult => ({ status: 0, stdout, stderr: '' });

describe('runGitAsync', () => {

    it('resolves status 0 with stdout for a successful process', async () => {
        const result = await runGitAsync(process.execPath, ['-e', 'process.stdout.write("hi")'], { cwd: os.tmpdir(), timeoutMs: 10_000 });
        expect(result.status).to.equal(0);
        expect(result.stdout).to.equal('hi');
    });

    it('resolves (never rejects) with the exit code of a failing process', async () => {
        const result = await runGitAsync(process.execPath, ['-e', 'process.stderr.write("boom"); process.exit(3)'], { cwd: os.tmpdir(), timeoutMs: 10_000 });
        expect(result.status).to.equal(3);
        expect(result.stderr).to.contain('boom');
    });

    it('resolves status null when the executable cannot be spawned', async () => {
        const result = await runGitAsync(path.join(os.tmpdir(), 'qaap-no-such-binary-xyz'), [], { cwd: os.tmpdir(), timeoutMs: 10_000 });
        expect(result.status).to.equal(null);
    });

    it('kills a hung process at the timeout and reports status null', async () => {
        const started = Date.now();
        const result = await runGitAsync(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { cwd: os.tmpdir(), timeoutMs: 200 });
        expect(result.status).to.equal(null);
        expect(result.timedOut).to.equal(true);
        expect(Date.now() - started).to.be.lessThan(10_000);
    });
});

describe('QaapGitCwdSerializer', () => {

    it('runs jobs on the same repository one at a time, in submission order', async () => {
        const serializer = new QaapGitCwdSerializer();
        const events: string[] = [];
        const job = (name: string, delayMs: number) => async (): Promise<string> => {
            events.push(`start:${name}`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            events.push(`end:${name}`);
            return name;
        };
        const cwd = path.join(os.tmpdir(), 'qaap-serial-repo');
        const results = await Promise.all([
            serializer.run(cwd, job('a', 30)),
            serializer.run(cwd, job('b', 1)),
            serializer.run(`${cwd}${path.sep}.`, job('c', 1)),
        ]);
        expect(results).to.deep.equal(['a', 'b', 'c']);
        expect(events).to.deep.equal(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
    });

    it('lets different repositories run in parallel', async () => {
        const serializer = new QaapGitCwdSerializer();
        const events: string[] = [];
        let releaseFirst: () => void = () => undefined;
        const first = serializer.run(path.join(os.tmpdir(), 'repo-one'), async () => {
            events.push('start:one');
            await new Promise<void>(resolve => { releaseFirst = resolve; });
            events.push('end:one');
        });
        await serializer.run(path.join(os.tmpdir(), 'repo-two'), async () => {
            events.push('two');
        });
        releaseFirst();
        await first;
        expect(events).to.deep.equal(['start:one', 'two', 'end:one']);
    });

    it('does not poison the chain when a job fails, and forgets idle repositories', async () => {
        const serializer = new QaapGitCwdSerializer();
        const cwd = path.join(os.tmpdir(), 'qaap-serial-fail');
        const failing = serializer.run(cwd, async () => { throw new Error('git exploded'); });
        const next = serializer.run(cwd, async () => 'still runs');
        let failure = '';
        await failing.catch((error: Error) => { failure = error.message; });
        expect(failure).to.equal('git exploded');
        expect(await next).to.equal('still runs');
        await new Promise(resolve => setImmediate(resolve));
        expect(serializer.pendingKeys).to.equal(0);
    });
});

describe('computeGitDiffStats (async)', () => {

    it('sums committed and uncommitted numstat through the async seam', async () => {
        const seen: string[][] = [];
        const stats = await computeGitDiffStats('/repo', 'abc123', async (_cwd, args) => {
            seen.push([...args]);
            return args.includes('abc123..HEAD') ? ok('3\t1\ta.ts\n') : ok('2\t4\tb.ts\n');
        });
        expect(stats).to.deep.equal({ added: 5, removed: 5 });
        expect(seen.map(args => args[args.length - 1])).to.deep.equal(['abc123..HEAD', 'HEAD']);
    });

    it('returns undefined (non-fatal) when git fails or times out', async () => {
        const stats = await computeGitDiffStats('/repo', 'abc123', async () => ({ status: null, stdout: '', stderr: 'timeout', timedOut: true }));
        expect(stats).to.equal(undefined);
        const thrown = await computeGitDiffStats('/repo', undefined, async () => { throw new Error('spawn failed'); });
        expect(thrown).to.equal(undefined);
    });
});

describe('captureCheckpointExtracted (async)', () => {

    it('runs read-tree, add -A, write-tree, commit-tree, update-ref in order on a throwaway index', async () => {
        const calls: RecordedGitCall[] = [];
        const ctx = fakeCheckpointCtx(args => {
            if (args[0] === 'write-tree') {
                return ok('tree123\n');
            }
            if (args.includes('commit-tree')) {
                return ok('commit456\n');
            }
            return ok();
        }, calls);
        const checkpoint = await captureCheckpointExtracted(ctx, '/repo', 'conv-1', 'msg-1', 'Fix it', { added: 2, removed: 1 });
        expect(calls.map(call => call.args.find(arg => !arg.startsWith('-') && !arg.includes('=')))).to.deep.equal([
            'read-tree', 'add', 'write-tree', 'commit-tree', 'update-ref',
        ]);
        const indexFile = calls[0].indexFile;
        expect(indexFile).to.be.a('string');
        expect(calls.slice(0, 4).every(call => call.indexFile === indexFile)).to.equal(true);
        // update-ref writes the real ref store, not the throwaway index.
        expect(calls[4].indexFile).to.equal(undefined);
        expect(calls[1].timeoutMs).to.equal(QAAP_GIT_ADD_ALL_TIMEOUT_MS);
        expect(calls[4].args[0]).to.equal('update-ref');
        expect(calls[4].args[1]).to.match(/^refs\/qaap\/checkpoints\/conv-1\/msg-1-\d+$/);
        expect(checkpoint).to.include({ messageId: 'msg-1', label: 'Fix it', commit: 'commit456', added: 2, removed: 1 });
        expect(fs.existsSync(indexFile!)).to.equal(false);
    });

    it('is non-fatal: a failed or timed-out add -A yields no checkpoint and stops the sequence', async () => {
        const calls: RecordedGitCall[] = [];
        const ctx = fakeCheckpointCtx(args => args[0] === 'add'
            ? { status: null, stdout: '', stderr: 'killed', timedOut: true }
            : ok(), calls);
        const checkpoint = await captureCheckpointExtracted(ctx, '/repo', 'conv-1', 'msg-1', 'Turn');
        expect(checkpoint).to.equal(undefined);
        expect(calls.map(call => call.args[0])).to.deep.equal(['read-tree', 'add']);
    });

    it('uses the default timeout for the non-add commands', async () => {
        const calls: RecordedGitCall[] = [];
        const ctx = fakeCheckpointCtx(() => ok(), calls);
        await captureCheckpointExtracted(ctx, '/repo', 'conv-1', 'msg-1', 'Turn');
        // write-tree returned an empty tree id -> sequence stops after it.
        expect(calls.map(call => call.args[0])).to.deep.equal(['read-tree', 'add', 'write-tree']);
        expect(calls[0].timeoutMs === undefined || calls[0].timeoutMs === QAAP_GIT_DEFAULT_TIMEOUT_MS).to.equal(true);
    });

    const gitAvailable = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
    (gitAvailable ? it : it.skip)('captures a real checkpoint commit without touching the real index', async function (): Promise<void> {
        this.timeout(30_000);
        const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-ckpt-repo-'));
        const git = (args: string[]): string => spawnSync('git', args, { cwd: repo, encoding: 'utf8' }).stdout;
        try {
            git(['init', '-q']);
            fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
            git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', 'a.txt']);
            git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init']);
            fs.writeFileSync(path.join(repo, 'b.txt'), 'untracked\n');
            const ctx = {
                mutatingGit: (cwd: string, args: string[], env?: NodeJS.ProcessEnv, timeoutMs?: number) =>
                    runGitAsync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: env ?? process.env, timeoutMs: timeoutMs ?? QAAP_GIT_DEFAULT_TIMEOUT_MS }),
            } as unknown as QaapAgentConversationStoreContext;
            const checkpoint = await captureCheckpointExtracted(ctx, repo, 'conv', 'msg', 'Real');
            expect(checkpoint?.commit).to.match(/^[0-9a-f]{40,64}$/);
            expect(git(['rev-parse', checkpoint!.ref]).trim()).to.equal(checkpoint!.commit);
            expect(git(['ls-tree', '--name-only', checkpoint!.commit]).split('\n')).to.include('b.txt');
            // The real index is untouched: b.txt is still untracked.
            expect(git(['status', '--porcelain'])).to.contain('?? b.txt');
        } finally {
            fs.rmSync(repo, { recursive: true, force: true });
        }
    });
});
