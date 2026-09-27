// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type {
    QaapGithubOpenRepositoryResponse,
    QaapGithubWorkspaceJob,
    QaapGithubWorkspaceJobRequest,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    QAAP_REPOSITORY_IMPORT_MAX_POLL_FAILURES,
    QaapRepositoryImportError,
    QaapRepositoryImportTracker,
    formatRepositoryImportStatus,
    repositoryImportKey,
    type QaapRepositoryImportApi,
    type QaapRepositoryImportTimers,
} from './qaap-repository-import-tracker';

const RESULT = {
    repository: { fullName: 'octocat/Hello-World' },
    workspaceUri: 'file:///workspace/repos/users/alice/octocat/Hello-World',
} as unknown as QaapGithubOpenRepositoryResponse;

class FakeTimers implements QaapRepositoryImportTimers {
    protected queue: Array<{ id: number; callback: () => void }> = [];
    protected nextId = 1;
    setTimeout(callback: () => void): unknown {
        const id = this.nextId++;
        this.queue.push({ id, callback });
        return id;
    }
    clearTimeout(handle: unknown): void {
        this.queue = this.queue.filter(entry => entry.id !== handle);
    }
    now(): number {
        return 0;
    }
    get pending(): number {
        return this.queue.length;
    }
    /** Run the scheduled polls and let their promises settle. */
    async tick(): Promise<void> {
        const due = this.queue;
        this.queue = [];
        due.forEach(entry => entry.callback());
        await flush();
    }
}

async function flush(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}

function job(patch: Partial<QaapGithubWorkspaceJob>): QaapGithubWorkspaceJob {
    return { id: 'job-1', kind: 'clone', label: 'octocat/Hello-World', state: 'running', phase: 'queued', startedAt: 0, updatedAt: 0, ...patch };
}

function httpError(status: number): Error {
    return Object.assign(new Error(`HTTP ${status}`), { status });
}

const CLONE: QaapGithubWorkspaceJobRequest = { kind: 'clone', repository: 'https://github.com/octocat/Hello-World.git' };

describe('QaapRepositoryImportTracker', () => {

    it('polls until the job succeeds, reporting monotonic progress', async () => {
        const timers = new FakeTimers();
        const polls = [
            job({ phase: 'cloning', percent: 40, detail: 'Receiving objects: 45%' }),
            job({ phase: 'cloning', percent: 30 }),
            job({ state: 'succeeded', phase: 'ready', percent: 100, result: RESULT }),
        ];
        const api: QaapRepositoryImportApi = {
            start: async () => job({ phase: 'resolving', percent: 2 }),
            get: async () => polls.shift()!,
            cancel: async () => { throw new Error('unexpected'); },
            legacy: async () => { throw new Error('unexpected'); },
        };
        const tracker = new QaapRepositoryImportTracker(api, timers);
        const repositoryImport = tracker.start(CLONE, 'octocat/Hello-World');
        const seen: Array<number | undefined> = [];
        repositoryImport.onDidChange(current => seen.push(current.percent));
        await flush();
        expect(repositoryImport.job.phase).to.equal('resolving');

        await timers.tick();
        expect(formatRepositoryImportStatus(repositoryImport.job)).to.equal('Cloning repository… 40%');
        await timers.tick();
        expect(repositoryImport.job.percent).to.equal(40, 'a reordered poll never moves the bar back');
        await timers.tick();
        expect(await repositoryImport.result).to.equal(RESULT);
        expect(repositoryImport.running).to.equal(false);
        expect(timers.pending).to.equal(0);
        expect(seen).to.deep.equal([2, 40, 40, 100]);
    });

    it('joins an import of the same repository instead of starting another', async () => {
        let starts = 0;
        const api: QaapRepositoryImportApi = {
            start: async () => { starts++; return job({}); },
            get: async () => job({}),
            cancel: async () => job({ state: 'cancelled' }),
            legacy: async () => RESULT,
        };
        const tracker = new QaapRepositoryImportTracker(api, new FakeTimers());
        const first = tracker.start(CLONE, 'octocat/Hello-World');
        const second = tracker.start({ kind: 'open', owner: 'Octocat', name: 'hello-world' }, 'octocat/Hello-World');
        await flush();
        expect(second).to.equal(first);
        expect(starts).to.equal(1);
        expect(tracker.running()).to.deep.equal([first]);
    });

    it('surfaces a failed job with its message and code', async () => {
        const timers = new FakeTimers();
        const api: QaapRepositoryImportApi = {
            start: async () => job({}),
            get: async () => job({ state: 'failed', error: 'GitHub repository not found', errorCode: 'forbidden' }),
            cancel: async () => job({}),
            legacy: async () => RESULT,
        };
        const repositoryImport = new QaapRepositoryImportTracker(api, timers).start(CLONE, 'x');
        await flush();
        await timers.tick();
        const err = await repositoryImport.result.then(() => undefined, (e: unknown) => e);
        expect(err).to.be.instanceOf(QaapRepositoryImportError);
        expect((err as QaapRepositoryImportError).message).to.equal('GitHub repository not found');
        expect((err as QaapRepositoryImportError).code).to.equal('forbidden');
        expect((err as QaapRepositoryImportError).cancelled).to.equal(false);
    });

    it('cancels on the server and rejects as cancelled', async () => {
        const timers = new FakeTimers();
        let cancelledId: string | undefined;
        const api: QaapRepositoryImportApi = {
            start: async () => job({ phase: 'cloning' }),
            get: async () => job({ phase: 'cloning' }),
            cancel: async id => { cancelledId = id; return job({ state: 'cancelled', error: 'Import cancelled.' }); },
            legacy: async () => RESULT,
        };
        const repositoryImport = new QaapRepositoryImportTracker(api, timers).start(CLONE, 'x');
        await flush();
        await repositoryImport.cancel();
        expect(cancelledId).to.equal('job-1');
        const err = await repositoryImport.result.then(() => undefined, (e: unknown) => e) as QaapRepositoryImportError;
        expect(err.cancelled).to.equal(true);
        expect(timers.pending).to.equal(0, 'no polling after the import settled');
    });

    it('cancels once the start request answers when cancel was asked early', async () => {
        let cancelCalls = 0;
        const api: QaapRepositoryImportApi = {
            start: async () => job({}),
            get: async () => job({}),
            cancel: async () => { cancelCalls++; return job({ state: 'cancelled' }); },
            legacy: async () => RESULT,
        };
        const repositoryImport = new QaapRepositoryImportTracker(api, new FakeTimers()).start(CLONE, 'x');
        await repositoryImport.cancel();
        await flush();
        expect(cancelCalls).to.equal(1);
        expect(repositoryImport.job.state).to.equal('cancelled');
    });

    it('falls back to the single-request import on backends without the jobs API', async () => {
        let legacyRequest: QaapGithubWorkspaceJobRequest | undefined;
        const api: QaapRepositoryImportApi = {
            start: async () => { throw httpError(404); },
            get: async () => { throw new Error('unexpected'); },
            cancel: async () => { throw new Error('unexpected'); },
            legacy: async request => { legacyRequest = request; return RESULT; },
        };
        const repositoryImport = new QaapRepositoryImportTracker(api, new FakeTimers()).start(CLONE, 'x');
        expect(await repositoryImport.result).to.equal(RESULT);
        expect(legacyRequest).to.equal(CLONE);
        expect(repositoryImport.job.label).to.equal('octocat/Hello-World');
    });

    it('tolerates transient poll failures but gives up after the limit', async () => {
        const timers = new FakeTimers();
        const api: QaapRepositoryImportApi = {
            start: async () => job({}),
            get: async () => { throw httpError(502); },
            cancel: async () => job({}),
            legacy: async () => RESULT,
        };
        const repositoryImport = new QaapRepositoryImportTracker(api, timers).start(CLONE, 'x');
        await flush();
        for (let i = 0; i < QAAP_REPOSITORY_IMPORT_MAX_POLL_FAILURES - 1; i++) {
            await timers.tick();
        }
        expect(repositoryImport.running).to.equal(true);
        await timers.tick();
        expect(repositoryImport.running).to.equal(false);
        expect(repositoryImport.job.state).to.equal('failed');
        expect(repositoryImport.job.error).to.contain('Lost the connection');
    });

    it('fails immediately when the server no longer knows the job', async () => {
        const timers = new FakeTimers();
        const api: QaapRepositoryImportApi = {
            start: async () => job({}),
            get: async () => { throw httpError(404); },
            cancel: async () => job({}),
            legacy: async () => RESULT,
        };
        const repositoryImport = new QaapRepositoryImportTracker(api, timers).start(CLONE, 'x');
        await flush();
        await timers.tick();
        expect(repositoryImport.job.state).to.equal('failed');
        expect(repositoryImport.job.error).to.contain('lost track');
    });

    it('starts a fresh import after a failed one (retry)', async () => {
        let starts = 0;
        const api: QaapRepositoryImportApi = {
            start: async () => { starts++; throw httpError(500); },
            get: async () => job({}),
            cancel: async () => job({}),
            legacy: async () => RESULT,
        };
        const tracker = new QaapRepositoryImportTracker(api, new FakeTimers());
        const first = tracker.start(CLONE, 'x');
        await flush();
        expect(first.running).to.equal(false);
        const second = tracker.start(CLONE, 'x');
        await flush();
        expect(second).to.not.equal(first);
        expect(starts).to.equal(2);
    });
});

describe('repositoryImportKey', () => {
    it('normalizes URLs, owner/name and open requests to one key', () => {
        expect(repositoryImportKey({ kind: 'clone', repository: 'https://github.com/Octocat/Hello-World.git' })).to.equal('octocat/hello-world');
        expect(repositoryImportKey({ kind: 'clone', repository: 'octocat/hello-world/' })).to.equal('octocat/hello-world');
        expect(repositoryImportKey({ kind: 'open', owner: 'octocat', name: 'Hello-World' })).to.equal('octocat/hello-world');
    });
});
