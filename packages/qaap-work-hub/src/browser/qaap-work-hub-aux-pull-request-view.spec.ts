// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// The view touches the DOM only when constructed; keep jsdom off while the modules load.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { QaapGithubPullRequestLookup } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import type { QaapGithubPullRequestSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import type { QaapWorkHubPullRequestTarget } from './qaap-work-hub-aux-pull-request-model';
import { QaapWorkHubAuxPullRequestView } from './qaap-work-hub-aux-pull-request-view';

disableImportJSDOM();

describe('qaap-work-hub-aux-pull-request-view', () => {

    let disableJSDOM: (() => void) | undefined;
    const views: QaapWorkHubAuxPullRequestView[] = [];

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    afterEach(() => {
        views.splice(0).forEach(view => view.dispose());
        document.body.innerHTML = '';
    });

    const taskTarget: QaapWorkHubPullRequestTarget = {
        owner: 'acme', repo: 'app', number: 7, branch: 'qaap/task/c1', scope: 'task:c1',
    };
    const otherTarget: QaapWorkHubPullRequestTarget = { owner: 'acme', repo: 'app', branch: 'qaap/task/c2', scope: 'task:c2' };

    function pullRequest(overrides: Partial<QaapGithubPullRequestSummary> = {}): QaapGithubPullRequestSummary {
        return {
            owner: 'acme', repo: 'app', number: 7, title: 'Fix the login redirect', branch: 'qaap/task/c1', base: 'main',
            author: 'jc', files: 3, adds: 42, dels: 5, tests: 'unknown', state: 'open', draft: false,
            htmlUrl: 'https://github.com/acme/app/pull/7', filesPreview: [], updatedAt: '2026-11-17T10:00:00Z',
            checks: [
                { name: 'build', status: 'completed', conclusion: 'success' },
                { name: 'lint', status: 'completed', conclusion: 'failure', url: 'https://ci.example/lint' },
                { name: 'e2e', status: 'in_progress' },
            ],
            reviews: [{ login: 'alice', state: 'commented' }],
            timeline: [{ kind: 'commented', actor: 'alice', text: 'Looks close.', createdAt: '2026-11-17T09:00:00Z' }],
            ...overrides,
        };
    }

    /** Lookup stub that answers from a queue, one step per call, and counts the calls. */
    function stubLookup(answers: QaapGithubPullRequestLookup[]): { lookup: (target: QaapWorkHubPullRequestTarget) => Promise<QaapGithubPullRequestLookup>; calls: QaapWorkHubPullRequestTarget[] } {
        const calls: QaapWorkHubPullRequestTarget[] = [];
        return {
            calls,
            lookup: async target => {
                calls.push(target);
                return answers.length > 1 ? answers.shift()! : answers[0];
            },
        };
    }

    function create(options: ConstructorParameters<typeof QaapWorkHubAuxPullRequestView>[0] = {}): QaapWorkHubAuxPullRequestView {
        const view = new QaapWorkHubAuxPullRequestView({ refreshMs: 1_000_000, ...options });
        views.push(view);
        document.body.append(view.element);
        return view;
    }

    const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

    it('shows a skeleton while loading, then the pull request with its checks, review and comments', async () => {
        const stub = stubLookup([{ kind: 'found', pullRequest: pullRequest() }]);
        const opened: string[] = [];
        const view = create({ lookup: stub.lookup, openExternal: url => opened.push(url) });
        view.sync(taskTarget, true);
        expect(view.element.querySelector('.qaap-work-hub-aux-pr-skeleton')).to.not.equal(null);
        await settle();

        expect(view.element.querySelector('.qaap-work-hub-aux-pr-title')?.textContent).to.equal('Fix the login redirect');
        expect(view.element.querySelector('.qaap-work-hub-aux-pr-number')?.textContent).to.equal('#7');
        expect(view.element.querySelector('.qaap-work-hub-aux-pr-state')?.textContent).to.equal('Open');
        expect(view.element.querySelector('.qaap-work-hub-aux-pr-branches')?.textContent).to.equal('main ← qaap/task/c1');
        expect(view.element.querySelector('.qaap-work-hub-aux-pr-checks-summary')?.textContent).to.equal('1 passed, 1 failed, 1 pending');
        const failed = view.element.querySelector<HTMLButtonElement>('.qaap-work-hub-aux-pr-check-failed .qaap-work-hub-aux-pr-check-link');
        expect(failed?.textContent).to.equal('lint');
        failed!.click();
        expect(opened).to.deep.equal(['https://ci.example/lint']);
        expect(view.element.querySelector('.qaap-work-hub-aux-pr-review')?.textContent).to.equal('Commented');
        expect(view.element.querySelector('.qaap-work-hub-aux-pr-comments p')?.textContent).to.equal('Looks close.');
        expect(stub.calls).to.deep.equal([taskTarget]);
    });

    it('shows the state of a draft or merged pull request', async () => {
        const view = create({ lookup: stubLookup([{ kind: 'found', pullRequest: pullRequest({ draft: true }) }]).lookup });
        view.sync(taskTarget, true);
        await settle();
        expect(view.element.querySelector('.qaap-work-hub-aux-pr-state')?.textContent).to.equal('Draft');

        const merged = create({ lookup: stubLookup([{ kind: 'found', pullRequest: pullRequest({ state: 'merged' }) }]).lookup });
        merged.sync(taskTarget, true);
        await settle();
        expect(merged.element.querySelector('.qaap-work-hub-aux-pr-state')?.textContent).to.equal('Merged');
    });

    it('says when the checks have not reported yet and when there are no comments', async () => {
        const view = create({ lookup: stubLookup([{ kind: 'found', pullRequest: pullRequest({ checks: [], timeline: [] }) }]).lookup });
        view.sync(taskTarget, true);
        await settle();
        expect(view.element.querySelector('.qaap-work-hub-aux-pr-section')?.textContent).to.contain('No checks reported.');
        expect(view.element.textContent).to.contain('No comments yet.');
    });

    it('offers Connect GitHub when there is no GitHub session and starts the sign-in', async () => {
        let signIns = 0;
        const view = create({ lookup: stubLookup([{ kind: 'signed-out' }]).lookup, startSignIn: () => signIns++ });
        view.sync(taskTarget, true);
        await settle();
        const action = view.element.querySelector<HTMLButtonElement>('.q-empty-action');
        expect(view.element.querySelector('.q-empty-title')?.textContent).to.equal('Connect GitHub');
        action?.click();
        expect(signIns).to.equal(1);
    });

    it('says there is no pull request for the branch, without offering to create one', async () => {
        const view = create({ lookup: stubLookup([{ kind: 'none' }]).lookup });
        view.sync(otherTarget, true);
        await settle();
        expect(view.element.querySelector('.q-empty-title')?.textContent).to.equal('No pull request for this branch');
        expect(view.element.querySelector('.q-empty-hint')?.textContent).to.equal('Branch qaap/task/c2 has no pull request yet.');
        expect(view.element.querySelector('.q-empty-action')).to.equal(null);
    });

    it('shows the failure with a retry that loads again', async () => {
        const stub = stubLookup([{ kind: 'error', message: 'GitHub is down' }, { kind: 'found', pullRequest: pullRequest() }]);
        const view = create({ lookup: stub.lookup });
        view.sync(taskTarget, true);
        await settle();
        expect(view.element.querySelector('.q-empty-hint')?.textContent).to.equal('GitHub is down');
        view.element.querySelector<HTMLButtonElement>('.q-empty-action')!.click();
        await settle();
        expect(stub.calls).to.have.length(2);
        expect(view.element.querySelector('.qaap-work-hub-aux-pr-title')?.textContent).to.equal('Fix the login redirect');
    });

    it('treats a lookup that throws as an error, never as an empty view', async () => {
        const view = create({ lookup: async () => { throw new Error('offline'); } });
        view.sync(taskTarget, true);
        await settle();
        expect(view.element.querySelector('.q-empty-title')?.textContent).to.equal('Could not load the pull request');
    });

    it('refetches when the target changes, but not when the same target is synced again', async () => {
        const stub = stubLookup([{ kind: 'found', pullRequest: pullRequest() }]);
        const view = create({ lookup: stub.lookup });
        view.sync(taskTarget, true);
        await settle();
        view.sync({ ...taskTarget }, true);
        view.sync({ ...taskTarget }, true);
        await settle();
        expect(stub.calls).to.have.length(1);
        view.sync(otherTarget, true);
        await settle();
        expect(stub.calls).to.have.length(2);
        expect(stub.calls[1]).to.deep.equal(otherTarget);
    });

    it('shows no project hint and never looks anything up without a target', () => {
        const stub = stubLookup([{ kind: 'none' }]);
        const view = create({ lookup: stub.lookup });
        view.sync(undefined, true);
        expect(view.element.querySelector('.q-empty-title')?.textContent).to.equal('No project open');
        expect(stub.calls).to.deep.equal([]);
    });

    it('refreshes while visible on an interval and stops when hidden', async () => {
        // jsdom reports a hidden document unless it pretends to be visible; the browser tab is visible here.
        const hidden = Object.getOwnPropertyDescriptor(document, 'hidden');
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        try {
            const stub = stubLookup([{ kind: 'found', pullRequest: pullRequest() }]);
            const view = create({ lookup: stub.lookup, refreshMs: 15, minAutoGapMs: 0 });
            view.sync(taskTarget, true);
            await new Promise(resolve => setTimeout(resolve, 80));
            expect(stub.calls.length).to.be.greaterThan(1);

            view.sync(taskTarget, false);
            const atHide = stub.calls.length;
            await new Promise(resolve => setTimeout(resolve, 60));
            expect(stub.calls.length).to.equal(atHide);
        } finally {
            if (hidden) {
                Object.defineProperty(document, 'hidden', hidden);
            } else {
                delete (document as unknown as { hidden?: boolean }).hidden;
            }
        }
    });

    /** Pretends the document is visible (jsdom reports it hidden) while `run` executes. */
    async function whileDocumentVisible(run: () => Promise<void>): Promise<void> {
        const hidden = Object.getOwnPropertyDescriptor(document, 'hidden');
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        try {
            await run();
        } finally {
            if (hidden) {
                Object.defineProperty(document, 'hidden', hidden);
            } else {
                delete (document as unknown as { hidden?: boolean }).hidden;
            }
        }
    }

    const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

    it('has no timer without a GitHub session, without a pull request, or for merged, closed and failed answers', async () => {
        const answers: QaapGithubPullRequestLookup[] = [
            { kind: 'signed-out' },
            { kind: 'none' },
            { kind: 'error', message: 'GitHub is down' },
            { kind: 'found', pullRequest: pullRequest({ state: 'merged' }) },
            { kind: 'found', pullRequest: pullRequest({ state: 'closed' }) },
        ];
        await whileDocumentVisible(async () => {
            for (const answer of answers) {
                const stub = stubLookup([answer]);
                const view = create({ lookup: stub.lookup, refreshMs: 10, minAutoGapMs: 0 });
                view.sync(taskTarget, true);
                await wait(60);
                expect(stub.calls, answer.kind).to.have.length(1);
                view.stop();
            }
        });
    });

    it('polls an open or draft pull request while the panel is visible, and stops when it is hidden', async () => {
        await whileDocumentVisible(async () => {
            for (const pr of [pullRequest(), pullRequest({ draft: true })]) {
                const stub = stubLookup([{ kind: 'found', pullRequest: pr }]);
                const view = create({ lookup: stub.lookup, refreshMs: 10, minAutoGapMs: 0 });
                view.sync(taskTarget, true);
                await wait(60);
                expect(stub.calls.length).to.be.greaterThan(1);
                view.sync(taskTarget, false);
                const atHide = stub.calls.length;
                await wait(40);
                expect(stub.calls.length).to.equal(atHide);
            }
        });
    });

    it('re-renders with the same target, or an equal copy of it, never fetch again', async () => {
        const stub = stubLookup([{ kind: 'found', pullRequest: pullRequest() }]);
        const view = create({ lookup: stub.lookup });
        view.sync(taskTarget, true);
        await settle();
        for (let render = 0; render < 5; render++) {
            view.sync({ ...taskTarget }, true);
        }
        await settle();
        expect(stub.calls).to.have.length(1);
    });

    it('never starts a second lookup for a target while one is in flight', async () => {
        const calls: QaapWorkHubPullRequestTarget[] = [];
        let release: (answer: QaapGithubPullRequestLookup) => void = () => undefined;
        const view = create({
            lookup: target => {
                calls.push(target);
                return new Promise<QaapGithubPullRequestLookup>(resolve => { release = resolve; });
            },
        });
        view.sync(taskTarget, true);
        view.sync({ ...taskTarget }, true);
        view.sync({ ...taskTarget }, true);
        expect(calls).to.have.length(1);
        release({ kind: 'found', pullRequest: pullRequest() });
        await settle();
        expect(calls).to.have.length(1);
    });

    it('spaces automatic fetches of the same target by the minimum gap', async () => {
        await whileDocumentVisible(async () => {
            const stub = stubLookup([{ kind: 'found', pullRequest: pullRequest() }]);
            const view = create({ lookup: stub.lookup, refreshMs: 10, minAutoGapMs: 1_000_000 });
            view.sync(taskTarget, true);
            await wait(60);
            expect(stub.calls).to.have.length(1);
            view.stop();
        });
    });

    it('opens the pull request on GitHub from its footer button', async () => {
        const opened: string[] = [];
        const view = create({ lookup: stubLookup([{ kind: 'found', pullRequest: pullRequest() }]).lookup, openExternal: url => opened.push(url) });
        view.sync(taskTarget, true);
        await settle();
        view.element.querySelector<HTMLButtonElement>('.qaap-work-hub-aux-pr-open')!.click();
        expect(opened).to.deep.equal(['https://github.com/acme/app/pull/7']);
    });

    it('offers Watch and toggles to Stop watching for open pull requests', async () => {
        let watching = false;
        let toggles = 0;
        const view = create({
            lookup: stubLookup([{ kind: 'found', pullRequest: pullRequest() }]).lookup,
            resolveWatchAction: () => ({
                watching,
                onToggle: async () => {
                    toggles++;
                    watching = !watching;
                },
            }),
        });
        view.sync(taskTarget, true);
        await settle();
        const btn = view.element.querySelector<HTMLButtonElement>('.qaap-work-hub-aux-pr-watch')!;
        expect(btn.textContent).to.equal('Watch');
        btn.click();
        await settle();
        expect(toggles).to.equal(1);
        expect(view.element.querySelector<HTMLButtonElement>('.qaap-work-hub-aux-pr-watch')?.textContent).to.equal('Stop watching');
    });
    describe('a specific pull request', () => {
        const pinned: QaapWorkHubPullRequestTarget = { owner: 'zed', repo: 'lib', number: 117, scope: 'pinned:zed/lib#117' };

        it('looks it up by owner, repo and number and says which one it shows', async () => {
            const stub = stubLookup([{ kind: 'found', pullRequest: pullRequest({ owner: 'zed', repo: 'lib', number: 117 }) }]);
            const view = create({ lookup: stub.lookup });
            view.sync(pinned, true);
            await settle();
            expect(stub.calls[0]).to.deep.include({ owner: 'zed', repo: 'lib', number: 117 });
            expect(view.element.querySelector('.qaap-work-hub-aux-pr-pinned-label')?.textContent).to.contain('zed/lib#117');
            expect(view.element.querySelector('.qaap-work-hub-aux-pr-title')?.textContent).to.equal('Fix the login redirect');
        });

        it('offers Back only when a branch pull request can be returned to', async () => {
            const stub = stubLookup([{ kind: 'found', pullRequest: pullRequest() }]);
            const view = create({ lookup: stub.lookup });
            view.sync(pinned, true);
            await settle();
            expect(view.element.querySelector('.qaap-work-hub-aux-pr-back')).to.equal(null);
            let backs = 0;
            view.sync(pinned, true, () => backs++);
            view.element.querySelector<HTMLButtonElement>('.qaap-work-hub-aux-pr-back')!.click();
            expect(backs).to.equal(1);
        });

        it('has no banner for the branch pull request and says "not found" for a missing one', async () => {
            const view = create({ lookup: stubLookup([{ kind: 'none' }]).lookup });
            view.sync(taskTarget, true);
            await settle();
            expect(view.element.querySelector('.qaap-work-hub-aux-pr-pinned')).to.equal(null);
            view.sync(pinned, true);
            await settle();
            expect(view.element.textContent).to.contain('Pull request not found');
        });
    });
});
