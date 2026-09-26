// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapGithubOpenRepositoryResponse } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    QaapGithubWorkspaceJobError,
    QaapGithubWorkspaceJobRegistry,
    type QaapGithubWorkspaceJobContext,
} from './qaap-github-workspace-jobs';

const RESULT = {
    repository: { fullName: 'octocat/Hello-World' },
    workspaceUri: 'file:///workspace/repos/users/alice/octocat/Hello-World',
} as unknown as QaapGithubOpenRepositoryResponse;

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(err: unknown): void } {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

describe('QaapGithubWorkspaceJobRegistry', () => {

    const options = { ownerKey: 'alice', kind: 'clone' as const, label: 'octocat/Hello-World', dedupeKey: 'octocat/Hello-World' };

    it('reports progress and succeeds with the result', async () => {
        const registry = new QaapGithubWorkspaceJobRegistry();
        let context!: QaapGithubWorkspaceJobContext;
        const body = deferred<QaapGithubOpenRepositoryResponse>();
        const job = registry.start(options, ctx => { context = ctx; return body.promise; });
        expect(job.state).to.equal('running');
        expect(job.phase).to.equal('queued');
        await Promise.resolve();
        await Promise.resolve();

        context.report({ phase: 'cloning', percent: 40, detail: 'Receiving objects: 40%' });
        context.report({ phase: 'cloning', percent: 30 });
        let snapshot = registry.get('alice', job.id)!;
        expect(snapshot.phase).to.equal('cloning');
        expect(snapshot.percent).to.equal(40, 'percent never decreases');
        expect(snapshot.detail).to.equal('Receiving objects: 40%');

        body.resolve(RESULT);
        await registry.whenSettled(job.id);
        snapshot = registry.get('alice', job.id)!;
        expect(snapshot.state).to.equal('succeeded');
        expect(snapshot.phase).to.equal('ready');
        expect(snapshot.percent).to.equal(100);
        expect(snapshot.detail).to.equal(undefined);
        expect(snapshot.result).to.deep.equal(RESULT);
    });

    it('stores a described failure and the error code', async () => {
        const registry = new QaapGithubWorkspaceJobRegistry();
        const job = registry.start({ ...options, describeError: () => 'friendly message' }, async () => {
            throw new QaapGithubWorkspaceJobError('raw', 'plan_repo_limit');
        });
        await registry.whenSettled(job.id);
        const snapshot = registry.get('alice', job.id)!;
        expect(snapshot.state).to.equal('failed');
        expect(snapshot.error).to.equal('friendly message');
        expect(snapshot.errorCode).to.equal('plan_repo_limit');
    });

    it('cancels through the abort signal and ignores later progress', async () => {
        const registry = new QaapGithubWorkspaceJobRegistry();
        let context!: QaapGithubWorkspaceJobContext;
        const job = registry.start(options, ctx => {
            context = ctx;
            return new Promise((_resolve, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('Git operation cancelled'))));
        });
        await Promise.resolve();
        const cancelled = await registry.cancel('alice', job.id);
        expect(cancelled?.state).to.equal('cancelled');
        expect(cancelled?.error).to.equal('Import cancelled.');
        context.report({ phase: 'cloning', percent: 90 });
        expect(registry.get('alice', job.id)?.percent).to.equal(undefined);
    });

    it('joins a running import of the same repository (case-insensitive) instead of cloning twice', () => {
        const registry = new QaapGithubWorkspaceJobRegistry();
        let starts = 0;
        const body = (): Promise<QaapGithubOpenRepositoryResponse> => { starts++; return new Promise(() => undefined); };
        const first = registry.start(options, body);
        const second = registry.start({ ...options, dedupeKey: 'OCTOCAT/hello-world' }, body);
        expect(second.id).to.equal(first.id);
        expect(registry.list('alice')).to.have.length(1);
        return Promise.resolve().then(() => expect(starts).to.equal(1));
    });

    it('isolates jobs by owner and hides anonymous jobs from listings', () => {
        const registry = new QaapGithubWorkspaceJobRegistry();
        const never = (): Promise<QaapGithubOpenRepositoryResponse> => new Promise(() => undefined);
        const owned = registry.start(options, never);
        const anonymous = registry.start({ ...options, ownerKey: undefined }, never);
        expect(registry.get('mallory', owned.id)).to.equal(undefined);
        expect(registry.get(undefined, owned.id)).to.equal(undefined);
        expect(registry.list('mallory')).to.deep.equal([]);
        expect(registry.list(undefined)).to.deep.equal([]);
        expect(registry.get(undefined, anonymous.id)?.id).to.equal(anonymous.id);
        expect(registry.get('alice', anonymous.id)).to.equal(undefined);
    });

    it('limits concurrent imports per owner', () => {
        const registry = new QaapGithubWorkspaceJobRegistry();
        const never = (): Promise<QaapGithubOpenRepositoryResponse> => new Promise(() => undefined);
        for (let i = 0; i < 4; i++) {
            registry.start({ ...options, dedupeKey: `o/r${i}` }, never);
        }
        expect(() => registry.start({ ...options, dedupeKey: 'o/r4' }, never)).to.throw(QaapGithubWorkspaceJobError);
    });

    it('prunes finished jobs after the retention window', async () => {
        let now = 1_000_000;
        const registry = new (class extends QaapGithubWorkspaceJobRegistry {
            protected override now(): number {
                return now;
            }
        })();
        const job = registry.start(options, async () => RESULT);
        await registry.whenSettled(job.id);
        expect(registry.list('alice')).to.have.length(1);
        now += 16 * 60_000;
        expect(registry.list('alice')).to.deep.equal([]);
    });
});
