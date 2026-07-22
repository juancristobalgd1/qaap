// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    cwdMatchesProject,
    MobileProjectsActiveTasks,
    normalizeCwd,
    sortTasks,
    toTaskView,
} from './mobile-projects-active-tasks';

class TestActiveTasks extends MobileProjectsActiveTasks {
    constructor() {
        super({
            scheduleFrame: () => 1,
            cancelFrame: () => undefined,
            setTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
            clearTimeout: () => undefined,
        });
    }

    protected override resolveChangeCoalesceDelayMs(): number {
        return 0;
    }

    flushChanges(): void {
        this.changeScheduler.flushNow();
    }

    fireCreated(id: string): void {
        this.applyEvent('created', {
            id,
            cwd: '/repo/mobile',
            state: 'running',
            title: id,
            createdAt: Date.now(),
        });
    }

    fireCompleted(id: string): void {
        this.applyEvent('completed', {
            id,
            cwd: '/repo/mobile',
            state: 'completed',
            title: id,
            createdAt: Date.now(),
            finishedAt: Date.now(),
        });
    }
}

describe('normalizeCwd', () => {
    it('strips trailing slashes', () => {
        expect(normalizeCwd('/home/user/project/')).to.equal('/home/user/project');
        expect(normalizeCwd('/home/user/project///')).to.equal('/home/user/project');
    });

    it('normalizes backslashes to forward slashes', () => {
        expect(normalizeCwd('C:\\Users\\user\\project')).to.equal('C:/Users/user/project');
    });

    it('preserves root slash', () => {
        expect(normalizeCwd('/')).to.equal('/');
    });

    it('leaves already-normalized paths unchanged', () => {
        expect(normalizeCwd('/home/user/project')).to.equal('/home/user/project');
    });
});

describe('cwdMatchesProject', () => {
    it('matches by basename equality', () => {
        expect(cwdMatchesProject('/home/user/my-app', { name: 'my-app' })).to.be.true;
        expect(cwdMatchesProject('/home/user/other', { name: 'my-app' })).to.be.false;
    });

    it('matches by github owner/name path suffix', () => {
        const project = { name: 'repo', github: { owner: 'acme', name: 'repo' } };
        expect(cwdMatchesProject('/home/user/acme/repo', project)).to.be.true;
        expect(cwdMatchesProject('/home/user/repos/acme/repo', project)).to.be.true;
    });

    it('is case-insensitive', () => {
        expect(cwdMatchesProject('/home/user/My-App', { name: 'my-app' })).to.be.true;
    });

    it('does not match partial basename', () => {
        expect(cwdMatchesProject('/home/user/my-app-extra', { name: 'my-app' })).to.be.false;
    });
});

describe('sortTasks', () => {
    it('puts running tasks before completed ones', () => {
        const tasks = [
            { id: 'a', title: 'A', command: '', cwd: '/', state: 'completed', createdAt: 2000 },
            { id: 'b', title: 'B', command: '', cwd: '/', state: 'running', createdAt: 1000 },
        ];
        const sorted = sortTasks(tasks);
        expect(sorted[0].id).to.equal('b');
        expect(sorted[1].id).to.equal('a');
    });

    it('sorts by createdAt descending within same state', () => {
        const tasks = [
            { id: 'a', title: 'A', command: '', cwd: '/', state: 'completed', createdAt: 1000 },
            { id: 'b', title: 'B', command: '', cwd: '/', state: 'completed', createdAt: 2000 },
        ];
        const sorted = sortTasks(tasks);
        expect(sorted[0].id).to.equal('b');
    });

    it('does not mutate the input array', () => {
        const tasks = [
            { id: 'a', title: 'A', command: '', cwd: '/', state: 'completed', createdAt: 2000 },
            { id: 'b', title: 'B', command: '', cwd: '/', state: 'running', createdAt: 1000 },
        ];
        const original = [...tasks];
        sortTasks(tasks);
        expect(tasks).to.deep.equal(original);
    });
});

describe('toTaskView', () => {
    it('uses title when provided', () => {
        const view = toTaskView({ id: 'x', cwd: '/a', state: 'running', title: 'My task', createdAt: 1000 });
        expect(view.title).to.equal('My task');
    });

    it('falls back to command when title is absent', () => {
        const view = toTaskView({ id: 'x', cwd: '/a', state: 'running', command: 'ls -la', createdAt: 1000 });
        expect(view.title).to.equal('ls -la');
    });

    it('falls back to Background task when both title and command are absent', () => {
        const view = toTaskView({ id: 'x', cwd: '/a', state: 'running', createdAt: 1000 });
        expect(view.title).to.equal('Background task');
    });

    it('truncates long commands to 80 characters in title', () => {
        const cmd = 'a'.repeat(100);
        const view = toTaskView({ id: 'x', cwd: '/a', state: 'running', command: cmd, createdAt: 1000 });
        expect(view.title.length).to.equal(80);
    });

    it('preserves parentId when provided', () => {
        const view = toTaskView({ id: 'x', cwd: '/a', state: 'running', parentId: 'leader', createdAt: 1000 });
        expect(view.parentId).to.equal('leader');
    });

    it('normalizes cwd in the returned view', () => {
        const view = toTaskView({ id: 'x', cwd: '/a/b/', state: 'running', createdAt: 1000 });
        expect(view.cwd).to.equal('/a/b');
    });

    it('carries the backend self-verification result to the view', () => {
        const passed = toTaskView({
            id: 'x', cwd: '/a', state: 'completed', createdAt: 1000,
            verification: { status: 'passed', command: 'npm run build', attempts: 0 },
        });
        expect(passed.verification).to.deep.equal({ status: 'passed', command: 'npm run build', attempts: 0 });

        const failed = toTaskView({
            id: 'y', cwd: '/a', state: 'completed', createdAt: 1000,
            verification: { status: 'failed', command: 'npm run test', attempts: 2, summary: 'boom' },
        });
        expect(failed.verification).to.deep.include({ status: 'failed', attempts: 2 });
    });

    it('leaves verification undefined when the payload omits it', () => {
        const view = toTaskView({ id: 'x', cwd: '/a', state: 'running', createdAt: 1000 });
        expect(view.verification).to.equal(undefined);
    });
});

describe('MobileProjectsActiveTasks', () => {

    it('coalesces bursty active-task changes into one UI notification per frame', () => {
        const activeTasks = new TestActiveTasks();
        let changeCount = 0;
        activeTasks.onDidChange(() => { changeCount++; });

        activeTasks.fireCreated('task-1');
        activeTasks.fireCreated('task-2');
        activeTasks.fireCreated('task-3');

        expect(activeTasks.getForCwd('/repo/mobile')?.activeCount).to.equal(3);
        expect(changeCount).to.equal(0);

        activeTasks.flushChanges();

        expect(changeCount).to.equal(1);
    });

    it('buffers WS output chunks and exposes a live log tail', () => {
        const activeTasks = new TestActiveTasks();
        const tails: string[] = [];
        activeTasks.onDidTaskOutput(tail => tails.push(tail.text));

        activeTasks.applyOutput(
            { id: 'task-log', cwd: '/repo/mobile', state: 'running' },
            'line 1\n',
        );
        activeTasks.applyOutput(
            { id: 'task-log', cwd: '/repo/mobile', state: 'running' },
            'line 2\n',
        );

        expect(activeTasks.getTaskLogTail('task-log')?.text).to.equal('line 1\nline 2\n');
        expect(tails).to.deep.equal(['line 1\n', 'line 1\nline 2\n']);
    });

    it('seeds HTTP log without shrinking a longer live buffer', () => {
        const activeTasks = new TestActiveTasks();
        activeTasks.applyOutput(
            { id: 'task-seed', cwd: '/repo/mobile', state: 'running' },
            'live-a\nlive-b\nlive-c\n',
        );
        const kept = activeTasks.seedTaskLog('task-seed', 'live-a\n');
        expect(kept.text).to.equal('live-a\nlive-b\nlive-c\n');

        const replaced = activeTasks.seedTaskLog('task-seed-2', 'from-server\n');
        expect(replaced.text).to.equal('from-server\n');
        expect(activeTasks.getTaskLogTail('task-seed-2')?.text).to.equal('from-server\n');
    });

    it('drops cancelled task log buffers but keeps completed ones', () => {
        const activeTasks = new TestActiveTasks();
        activeTasks.applyOutput(
            { id: 'keep', cwd: '/repo/mobile', state: 'running' },
            'done\n',
        );
        activeTasks.applyOutput(
            { id: 'drop', cwd: '/repo/mobile', state: 'running' },
            'cancel-me\n',
        );
        activeTasks.recordTaskEnded({
            id: 'drop',
            cwd: '/repo/mobile',
            state: 'cancelled',
        });
        activeTasks.fireCompleted('keep');

        expect(activeTasks.getTaskLogTail('drop')).to.equal(undefined);
        expect(activeTasks.getTaskLogTail('keep')?.text).to.equal('done\n');
    });
});
