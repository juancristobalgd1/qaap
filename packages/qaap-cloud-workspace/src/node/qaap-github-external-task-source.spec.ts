// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { GithubApiError } from '@theia/qaap-shared-core/lib/node/qaap-github-api';
import { QAAP_EXTERNAL_TASK_COMMENT_MARKER, type QaapExternalTaskTriggerEvent } from '../common/qaap-external-task';
import { QaapGithubExternalTaskSource } from './qaap-github-external-task-source';

function event(overrides: Partial<QaapExternalTaskTriggerEvent> = {}): QaapExternalTaskTriggerEvent {
    return {
        source: 'github',
        trigger: 'label',
        deliveryId: 'd1',
        owner: 'acme',
        repo: 'demo',
        repositoryId: 99,
        issueNumber: 7,
        issueUrl: 'https://github.com/acme/demo/issues/7',
        issueTitle: 'Fix it',
        issueBody: 'Line 1\nLine 2',
        issueAuthor: 'alice',
        requester: 'alice',
        ...overrides,
    };
}

describe('QaapGithubExternalTaskSource', () => {
    let calls: string[];
    let api: any;
    let source: QaapGithubExternalTaskSource;

    beforeEach(() => {
        calls = [];
        api = {
            repositoryAccess: async () => ({ id: 99, fullName: 'acme/demo', private: false, push: true }),
            issue: async () => ({
                number: 7, title: 'Fix it', body: 'Line 1\nLine 2', authorLogin: 'alice', authorAssociation: 'OWNER',
                pullRequest: false, htmlUrl: '', state: 'open',
            }),
            issueComment: async () => ({ id: 55, body: '@qaap go', authorLogin: 'alice', createdAt: 't1', updatedAt: 't1' }),
            labelEvents: async () => [{ actorLogin: 'Alice', label: 'qaap', createdAt: 't' }],
            createComment: async (...args: unknown[]) => { calls.push(String(args[4])); },
        };
        source = new QaapGithubExternalTaskSource();
        (source as any).api = api;
    });

    it('confirms the happy label path', async () => {
        expect(await source.verify(event(), 'tok')).to.deep.equal({ ok: true });
    });

    it('refuses a repository id mismatch', async () => {
        const result = await source.verify(event({ repositoryId: 1 }), 'tok');
        expect(result).to.include({ ok: false, reason: 'not-confirmed' });
    });

    it('refuses without push permission', async () => {
        api.repositoryAccess = async () => ({ id: 99, fullName: 'a/b', private: false, push: false });
        expect(await source.verify(event(), 'tok')).to.include({ ok: false, reason: 'no-push-permission' });
    });

    it('refuses an edited issue but treats CRLF as equal', async () => {
        expect(await source.verify(event({ issueBody: 'other' }), 'tok')).to.include({ ok: false, reason: 'issue-edited' });
        expect(await source.verify(event({ issueBody: 'Line 1\r\nLine 2' }), 'tok')).to.deep.equal({ ok: true });
    });

    it('refuses pull requests', async () => {
        api.issue = async () => ({ title: 'Fix it', body: 'Line 1\nLine 2', authorLogin: 'alice', authorAssociation: 'OWNER', pullRequest: true });
        expect(await source.verify(event(), 'tok')).to.include({ ok: false, reason: 'not-confirmed' });
    });

    it('refuses an untrusted author who is not the requester', async () => {
        for (const association of ['NONE', 'CONTRIBUTOR']) {
            api.issue = async () => ({ title: 'Fix it', body: 'Line 1\nLine 2', authorLogin: 'mallory', authorAssociation: association, pullRequest: false });
            expect(await source.verify(event({ issueAuthor: 'mallory' }), 'tok')).to.include({ ok: false, reason: 'untrusted-author' });
        }
        api.issue = async () => ({ title: 'Fix it', body: 'Line 1\nLine 2', authorLogin: 'mallory', authorAssociation: 'MEMBER', pullRequest: false });
        expect(await source.verify(event({ issueAuthor: 'mallory' }), 'tok')).to.deep.equal({ ok: true });
    });

    it('accepts the requester as author even with association NONE', async () => {
        api.issue = async () => ({ title: 'Fix it', body: 'Line 1\nLine 2', authorLogin: 'Alice', authorAssociation: 'NONE', pullRequest: false });
        expect(await source.verify(event(), 'tok')).to.deep.equal({ ok: true });
    });

    it('refuses a label applied by someone else', async () => {
        api.labelEvents = async () => [{ actorLogin: 'bob', label: 'qaap', createdAt: 't' }];
        expect(await source.verify(event(), 'tok')).to.include({ ok: false, reason: 'not-confirmed' });
    });

    describe('comment path', () => {
        const commentEvent = (): QaapExternalTaskTriggerEvent => event({ trigger: 'comment', comment: { id: 55, body: '@qaap go' } });

        it('confirms an untouched comment by the requester', async () => {
            expect(await source.verify(commentEvent(), 'tok')).to.deep.equal({ ok: true });
        });

        it('refuses another author', async () => {
            api.issueComment = async () => ({ id: 55, body: '@qaap go', authorLogin: 'bob', createdAt: 't1', updatedAt: 't1' });
            expect(await source.verify(commentEvent(), 'tok')).to.include({ ok: false, reason: 'not-confirmed' });
        });

        it('refuses a changed body or an updated comment', async () => {
            api.issueComment = async () => ({ id: 55, body: '@qaap evil', authorLogin: 'alice', createdAt: 't1', updatedAt: 't1' });
            expect(await source.verify(commentEvent(), 'tok')).to.include({ ok: false, reason: 'issue-edited' });
            api.issueComment = async () => ({ id: 55, body: '@qaap go', authorLogin: 'alice', createdAt: 't1', updatedAt: 't2' });
            expect(await source.verify(commentEvent(), 'tok')).to.include({ ok: false, reason: 'issue-edited' });
        });
    });

    describe('errors', () => {
        it('maps 404 and 403 to not-confirmed', async () => {
            api.repositoryAccess = async () => { throw new GithubApiError('nope', 404); };
            expect(await source.verify(event(), 'tok')).to.include({ ok: false, reason: 'not-confirmed' });
            api.repositoryAccess = async () => { throw new GithubApiError('nope', 403); };
            expect(await source.verify(event(), 'tok')).to.include({ ok: false, reason: 'not-confirmed' });
        });

        it('maps rate limits and other errors to failed', async () => {
            api.repositoryAccess = async () => { throw new GithubApiError('slow down', 403, true); };
            expect(await source.verify(event(), 'tok')).to.include({ ok: false, reason: 'failed' });
            api.repositoryAccess = async () => { throw new Error('boom'); };
            expect(await source.verify(event(), 'tok')).to.include({ ok: false, reason: 'failed', detail: 'boom' });
        });
    });

    it('postStatus creates a comment carrying the marker', async () => {
        const origin = { source: 'github', owner: 'acme', repo: 'demo', repositoryId: 99, issueNumber: 7, issueUrl: '', requester: 'alice', issueAuthor: 'alice', deliveryId: 'd1', requestedAt: 1 } as const;
        await source.postStatus(origin, 'tok', { kind: 'no-changes' });
        expect(calls).to.have.length(1);
        expect(calls[0]).to.contain(QAAP_EXTERNAL_TASK_COMMENT_MARKER);
    });
});
