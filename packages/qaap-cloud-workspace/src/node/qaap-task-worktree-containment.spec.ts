// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { QaapToolGateRequest } from '@theia/qaap-shared-core/lib/common/qaap-tool-gate-protocol';
import { resolveQaapWorktreesRoot } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapTaskWorktreeContainment } from './qaap-task-worktree-containment';
import { QaapToolGateService, type QaapToolGateEvaluationEnv, type QaapToolGateHookOutcome } from './qaap-tool-gate-service';
import type { QaapQaiqPendingControlRequest } from '../common/qaap-qaiq-stdio-approvals';

/** Containment with its roots moved into a per-test directory, so the real temp dir is never touched. */
class TestContainment extends QaapTaskWorktreeContainment {
    constructor(protected readonly root: string) {
        super();
    }
    protected override worktreeRoots(): string[] {
        return [path.join(this.root, 'worktrees')];
    }
    protected override scratchRoots(): string[] {
        return [path.join(this.root, 'scratch')];
    }
}

class DefaultRootsContainment extends QaapTaskWorktreeContainment {
    scratch(target: string): boolean {
        return this.isScratchPath(this.realpathNearest(target));
    }
}

class TestGate extends QaapToolGateService {
    constructor(containment: QaapTaskWorktreeContainment) {
        super();
        (this as unknown as { containment: QaapTaskWorktreeContainment }).containment = containment;
    }
}

const OUTSIDE = 'outside the task worktree';

describe('qaap-task-worktree-containment', () => {

    /** As `os.tmpdir()` spells it: `/var/folders/...` on macOS, whose real path is `/private/var/...`. */
    let lexicalRoot: string;
    let root: string;
    let base: string;
    let worktree: string;
    let lexicalWorktree: string;
    let containment: TestContainment;

    beforeEach(() => {
        lexicalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-contain-'));
        root = fs.realpathSync.native(lexicalRoot);
        base = path.join(root, 'base');
        fs.mkdirSync(path.join(base, '.git', 'worktrees', 'abc'), { recursive: true });
        fs.mkdirSync(path.join(base, 'public'));
        fs.writeFileSync(path.join(base, 'public', 'index.html'), '<h1>base</h1>\n');
        worktree = path.join(root, 'worktrees', '_dev', 'abc');
        lexicalWorktree = path.join(lexicalRoot, 'worktrees', '_dev', 'abc');
        fs.mkdirSync(worktree, { recursive: true });
        fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(base, '.git', 'worktrees', 'abc')}\n`);
        fs.mkdirSync(path.join(root, 'scratch'));
        containment = new TestContainment(lexicalRoot);
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    describe('isIsolatedWorktree', () => {
        it('recognizes a linked worktree under the worktrees root, by either spelling of its path', () => {
            expect(containment.isIsolatedWorktree(worktree)).to.equal(true);
            expect(containment.isIsolatedWorktree(lexicalWorktree)).to.equal(true);
        });

        it('leaves the project checkout and other directories alone', () => {
            expect(containment.isIsolatedWorktree(base)).to.equal(false);
            const elsewhere = path.join(root, 'elsewhere');
            fs.mkdirSync(elsewhere);
            fs.writeFileSync(path.join(elsewhere, '.git'), 'gitdir: x\n');
            expect(containment.isIsolatedWorktree(elsewhere)).to.equal(false);
            expect(containment.isIsolatedWorktree(undefined)).to.equal(false);
            expect(containment.isIsolatedWorktree('relative/dir')).to.equal(false);
        });
    });

    describe('writeTargets', () => {
        it('reads the file path keys of OpenCode, Claude Code and notebook edits', () => {
            expect(containment.writeTargets('edit', 'edit', { filePath: '/a/b.html', oldString: 'x' })).to.deep.equal(['/a/b.html']);
            expect(containment.writeTargets('Write', 'write', { file_path: 'c.txt', content: '' })).to.deep.equal(['c.txt']);
            expect(containment.writeTargets('NotebookEdit', 'other', { notebook_path: '/n.ipynb' })).to.deep.equal(['/n.ipynb']);
        });

        it('reads every file header of an apply_patch envelope and of a unified diff', () => {
            const patch = '*** Begin Patch\n*** Update File: /base/a.js\n@@\n-x\n+y\n*** Add File: b.js\n+z\n*** End Patch\n';
            expect(containment.writeTargets('apply_patch', 'edit', { patchText: patch })).to.deep.equal(['/base/a.js', 'b.js']);
            const diff = '--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1 +1 @@\n-a\n+b\n';
            expect(containment.writeTargets('patch', 'edit', { input: [diff] })).to.deep.equal(['src/x.ts', 'src/x.ts']);
        });

        it('ignores read tools', () => {
            expect(containment.writeTargets('read', 'read', { filePath: '/etc/hosts' })).to.deep.equal([]);
        });
    });

    describe('findWriteEscape', () => {
        it('allows paths inside the worktree, relative or absolute, and scratch space', () => {
            expect(containment.findWriteEscape('edit', 'edit', { filePath: 'public/index.html' }, worktree, worktree)).to.equal(undefined);
            expect(containment.findWriteEscape('edit', 'edit', { filePath: path.join(worktree, 'new', 'deep.txt') }, worktree, worktree)).to.equal(undefined);
            expect(containment.findWriteEscape('write', 'write', { filePath: path.join(root, 'scratch', 'out.log') }, worktree, worktree)).to.equal(undefined);
        });

        it('refuses the parent repository and says it is outside the task worktree', () => {
            const reason = containment.findWriteEscape('edit', 'edit', { filePath: path.join(base, 'public', 'index.html') }, worktree, worktree);
            expect(reason).to.contain(OUTSIDE);
            expect(containment.findWriteEscape('write', 'write', { filePath: '../../../base/x.txt' }, worktree, worktree)).to.contain(OUTSIDE);
        });

        it('compares /var and /private/var spellings by their real path', () => {
            expect(containment.findWriteEscape('edit', 'edit', { filePath: path.join(worktree, 'a.txt') }, lexicalWorktree, lexicalWorktree)).to.equal(undefined);
            expect(containment.findWriteEscape('edit', 'edit', { filePath: path.join(lexicalWorktree, 'a.txt') }, worktree, worktree)).to.equal(undefined);
            expect(containment.findWriteEscape('edit', 'edit', { filePath: path.join(lexicalRoot, 'base', 'a.txt') }, worktree, worktree)).to.contain(OUTSIDE);
        });

        it('follows a symlink inside the worktree that escapes it, existing or dangling', () => {
            fs.symlinkSync(base, path.join(worktree, 'link'));
            expect(containment.findWriteEscape('edit', 'edit', { filePath: 'link/public/index.html' }, worktree, worktree)).to.contain(OUTSIDE);
            expect(containment.findWriteEscape('write', 'write', { filePath: 'link/new/file.txt' }, worktree, worktree)).to.contain(OUTSIDE);
            fs.symlinkSync(path.join(base, 'missing.txt'), path.join(worktree, 'dangling'));
            expect(containment.findWriteEscape('write', 'write', { filePath: 'dangling' }, worktree, worktree)).to.contain(OUTSIDE);
        });

        it('refuses another task worktree even though it is under the temp dir', () => {
            const other = path.join(root, 'worktrees', '_dev', 'other');
            fs.mkdirSync(other, { recursive: true });
            expect(containment.findWriteEscape('write', 'write', { filePath: path.join(other, 'x') }, worktree, worktree)).to.contain(OUTSIDE);
        });
    });

    describe('shellTargets', () => {
        it('finds absolute, home and parent-relative paths, also inside quotes and redirections', () => {
            expect(containment.shellTargets(`cp -r ${base}/. ${worktree}/`, worktree)).to.include(path.join(base, '.'));
            expect(containment.shellTargets(`echo x >${base}/f`, worktree)).to.include(path.join(base, 'f'));
            expect(containment.shellTargets(`node -e "require('fs').writeFileSync('${base}/f', '')"`, worktree)).to.include(path.join(base, 'f'));
            expect(containment.shellTargets('cd .. && ls', worktree)).to.include(path.dirname(worktree));
            expect(containment.shellTargets('cat ~/notes.txt', worktree)).to.include(path.join(os.homedir(), 'notes.txt'));
        });

        it('skips regex-like words, URLs and system tool locations', () => {
            expect(containment.shellTargets('awk \'/qaapnosuchdir/ { print }\' a.txt', worktree)).to.deep.equal([]);
            expect(containment.shellTargets('curl -s https://example.com/x', worktree)).to.deep.equal([]);
            expect(containment.shellTargets('/usr/bin/env node --check server.js', worktree)).to.deep.equal([]);
            expect(containment.shellTargets('npm test', worktree)).to.deep.equal([]);
        });
    });

    describe('default roots', () => {
        it('treats the temp dir as scratch, but not the Qaap worktrees root inside it', () => {
            const defaults = new DefaultRootsContainment();
            expect(defaults.scratch(path.join(os.tmpdir(), 'qaap-spec-scratch', 'x.txt'))).to.equal(true);
            expect(defaults.scratch('/tmp/qaap-spec-scratch.txt')).to.equal(true);
            expect(defaults.scratch(path.join(resolveQaapWorktreesRoot(), '_dev', 'someone-else', 'x.txt'))).to.equal(false);
        });
    });

    describe('HTTP tool gate', () => {
        let asks: number;
        let gate: TestGate;

        beforeEach(() => {
            asks = 0;
            gate = new TestGate(containment);
        });

        const envFor = (overrides: Partial<QaapToolGateEvaluationEnv> = {}): QaapToolGateEvaluationEnv => ({
            taskId: 'task-contain',
            owner: undefined,
            workspace: lexicalWorktree,
            autoApprove: true,
            readOnlyWorkspace: false,
            askTtlSec: 600,
            checkGitExecConfig: () => undefined,
            checkPathsInsideCwd: () => undefined,
            ask: async () => {
                asks++;
                return 'reject';
            },
            ...overrides,
        });

        const call = (toolKind: QaapToolGateRequest['toolKind'], rawToolName: string, input: Record<string, unknown>, cwd = lexicalWorktree): QaapToolGateRequest => ({
            agentId: 'opencode', toolKind, rawToolName, input, cwd, harnessCallId: `call-${Math.random()}`,
        });

        it('denies an OpenCode edit of the parent checkout, with the worktree reason', async () => {
            const decision = await gate.evaluate(call('edit', 'edit', { filePath: path.join(base, 'public', 'index.html') }), envFor());
            expect(decision.kind).to.equal('deny');
            expect(decision.kind === 'deny' && decision.reason).to.contain(OUTSIDE);
        });

        it('still allows edits inside the worktree', async () => {
            const decision = await gate.evaluate(call('edit', 'edit', { filePath: path.join(worktree, 'public', 'index.html') }), envFor());
            expect(decision.kind).to.equal('allow');
        });

        it('denies a shell command naming the parent checkout in auto-approve runs', async () => {
            const decision = await gate.evaluate(call('shell', 'bash', { command: `cp -r ${base}/. ${worktree}/` }), envFor());
            expect(decision.kind === 'deny' && decision.reason).to.contain(OUTSIDE);
            expect(asks).to.equal(0);
        });

        it('asks the user for such a shell command in request-approval runs, even past a hook allow', async () => {
            const hooks = async (): Promise<QaapToolGateHookOutcome> => ({ decision: 'allow' });
            const decision = await gate.evaluate(call('shell', 'bash', { command: `cp -r ${base}/. .` }), envFor({ autoApprove: false, hooks }));
            expect(decision.kind).to.equal('deny');
            expect(decision.source).to.equal('user');
            expect(asks).to.equal(1);
        });

        it('lets a hook-rewritten input escape nothing', async () => {
            const hooks = async (): Promise<QaapToolGateHookOutcome> => ({ updatedInput: { filePath: path.join(base, 'x.txt') } });
            const decision = await gate.evaluate(call('write', 'write', { filePath: 'x.txt' }), envFor({ hooks }));
            expect(decision.kind === 'deny' && decision.reason).to.contain(OUTSIDE);
        });

        it('leaves shared-tree tasks exactly as before', async () => {
            const env = envFor({ workspace: base });
            const edit = await gate.evaluate(call('edit', 'edit', { filePath: path.join(root, 'elsewhere.txt') }, base), env);
            expect(edit.kind).to.equal('allow');
            const shell = await gate.evaluate(call('shell', 'bash', { command: `cp -r ${worktree}/. ${root}/copy` }, base), env);
            expect(shell.kind).to.equal('allow');
        });
    });

    describe('stdio control requests (QAIQ / Claude Code)', () => {
        const gateFor = (): TestGate => new TestGate(containment);
        const request = (toolName: string, toolInput: Record<string, unknown>): QaapQaiqPendingControlRequest => ({
            requestId: 'r1', toolUseId: 't1', toolName, toolInput,
        });
        type StdioOutcome = ReturnType<QaapToolGateService['evaluateQaiqControlRequest']>;
        const evaluate = (req: QaapQaiqPendingControlRequest, containWorkspace: string | undefined, autoApprove = true): StdioOutcome =>
            gateFor().evaluateQaiqControlRequest({
                command: 'claude --dangerously-skip-permissions',
                autoApprove,
                request: req,
                cwd: lexicalWorktree,
                options: { autoApproveReadOnlyShell: false, cwd: lexicalWorktree, checkGitExecConfig: () => undefined, checkPathsInsideCwd: () => undefined },
                reservedPort: () => undefined,
                ...(containWorkspace ? { containWorkspace } : {}),
            });

        it('denies a Claude Edit or NotebookEdit of the parent checkout', () => {
            const edit = evaluate(request('Edit', { file_path: path.join(base, 'public', 'index.html'), old_string: 'a', new_string: 'b' }), lexicalWorktree);
            expect(edit.action).to.equal('deny');
            expect(edit.denyMessage).to.contain(OUTSIDE);
            expect(edit.observabilityDecision).to.equal('reject');
            const notebook = evaluate(request('NotebookEdit', { notebook_path: path.join(base, 'n.ipynb') }), lexicalWorktree);
            expect(notebook.action).to.equal('deny');
        });

        it('denies a Bash escape in auto-approve runs and queues it under request-approval', () => {
            const command = { command: `cp -r ${base}/. .` };
            const auto = evaluate(request('Bash', command), lexicalWorktree);
            expect(auto.action).to.equal('deny');
            expect(auto.denyMessage).to.contain(OUTSIDE);
            expect(evaluate(request('Bash', command), lexicalWorktree, false).action).to.equal('queue');
        });

        it('changes nothing for calls inside the worktree or without containment', () => {
            const inside = request('Edit', { file_path: path.join(worktree, 'a.txt'), old_string: 'a', new_string: 'b' });
            expect(evaluate(inside, lexicalWorktree)).to.deep.equal(evaluate(inside, undefined));
            const outside = request('Edit', { file_path: path.join(base, 'a.txt'), old_string: 'a', new_string: 'b' });
            expect(evaluate(outside, undefined).denyMessage ?? '').not.to.contain(OUTSIDE);
        });
    });
});
