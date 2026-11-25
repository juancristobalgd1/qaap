// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import type { QaapGithubPullRequestSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    MobileProjectsPullRequestDetailUi,
    type MobileProjectsPullRequestDetailHost,
} from './mobile-projects-pull-request-detail-ui';

function makePullRequest(overrides: Partial<QaapGithubPullRequestSummary> = {}): QaapGithubPullRequestSummary {
    return {
        owner: 'juancristobalgd1',
        repo: 'qaap',
        number: 567,
        title: 'fix(preview): fix headless screenshots',
        author: 'juancristobalgd1',
        branch: 'fix/preview-launch-and-capture',
        base: 'master',
        state: 'open',
        draft: false,
        mergeable: true,
        adds: 42,
        dels: 10,
        files: 3,
        tests: 'passing',
        updatedAt: '2026-11-25T12:00:00.000Z',
        htmlUrl: 'https://github.com/juancristobalgd1/qaap/pull/567',
        description: 'Fixes `prepareHeadlessChromiumLaunchEnv()` in containers.',
        filesPreview: [],
        ...overrides,
    };
}

describe('MobileProjectsPullRequestDetailUi floating comment and review popover', () => {
    const savedGlobals = new Map<string, unknown>();
    let dom: JSDOM;
    let scroll: HTMLElement;
    let host: MobileProjectsPullRequestDetailHost;
    let ui: MobileProjectsPullRequestDetailUi;

    beforeEach(() => {
        dom = new JSDOM('<!doctype html><html><body><div class="theia-mobile-projects-scroll"></div></body></html>');
        for (const key of ['window', 'document', 'Node', 'HTMLElement', 'HTMLAnchorElement', 'Event', 'KeyboardEvent'] as const) {
            savedGlobals.set(key, (globalThis as Record<string, unknown>)[key]);
            (globalThis as Record<string, unknown>)[key] = (dom.window as unknown as Record<string, unknown>)[key];
        }
        scroll = dom.window.document.querySelector('.theia-mobile-projects-scroll') as HTMLElement;
        host = {
            pullRequestDetail: makePullRequest(),
            inboxPullRequests: [],
            inboxPullRequestsLoading: false,
            inboxPullRequestsLoaded: true,
            inboxGithubSignedIn: true,
            scroll,
            closePullRequestDetail: () => undefined,
            refreshInboxPullRequests: async () => undefined,
        };
        ui = new MobileProjectsPullRequestDetailUi(host);
    });

    afterEach(() => {
        ui.renderEmpty();
        for (const [key, value] of savedGlobals) {
            if (value === undefined) {
                delete (globalThis as Record<string, unknown>)[key];
            } else {
                (globalThis as Record<string, unknown>)[key] = value;
            }
        }
        dom.window.close();
    });

    it('renders a floating trigger button without the old fixed comment bar', () => {
        ui.render();
        expect(scroll.querySelector('.theia-mobile-work-hub-pull-request-comment-row')).to.equal(null);
        const fab = scroll.querySelector<HTMLButtonElement>('.qaap-pr-fab');
        expect(fab).to.not.equal(null);
        expect(fab?.getAttribute('aria-expanded')).to.equal('false');
        expect(scroll.querySelector('.qaap-pr-comment-popover')).to.equal(null);
    });

    it('opens the popover, enables submit live on input, and records a comment in the timeline', () => {
        ui.render();
        scroll.querySelector<HTMLButtonElement>('.qaap-pr-fab')!.click();

        const popover = scroll.querySelector('.qaap-pr-comment-popover');
        expect(popover).to.not.equal(null);
        const textarea = popover!.querySelector<HTMLTextAreaElement>('.qaap-pr-popover-textarea')!;
        const submit = popover!.querySelector<HTMLButtonElement>('.qaap-pr-popover-submit')!;
        expect(submit.disabled).to.equal(true);

        textarea.value = 'Looks great!';
        textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        expect(submit.disabled).to.equal(false);

        submit.click();
        expect(scroll.querySelector('.qaap-pr-comment-popover')).to.equal(null);

        ui.setActiveTab('timeline');
        ui.render();
        const bubbles = [...scroll.querySelectorAll('.qaap-pr-timeline-bubble')].map(el => el.textContent?.trim());
        expect(bubbles).to.include('Looks great!');
    });

    it('supports Review mode with verdict selection and approves without requiring body text', () => {
        ui.render();
        scroll.querySelector<HTMLButtonElement>('.qaap-pr-fab')!.click();
        scroll.querySelector<HTMLButtonElement>('.qaap-pr-popover-tab[data-mode="review"]')!.click();

        const submit = scroll.querySelector<HTMLButtonElement>('.qaap-pr-popover-submit')!;
        expect(submit.disabled).to.equal(true);

        scroll.querySelector<HTMLButtonElement>('.qaap-pr-popover-verdict[data-verdict="approve"]')!.click();
        expect(submit.disabled).to.equal(false);

        submit.click();
        expect(scroll.querySelector('.qaap-pr-comment-popover')).to.equal(null);

        ui.setActiveTab('timeline');
        ui.render();
        const lines = [...scroll.querySelectorAll('.qaap-pr-timeline-line')].map(el => el.textContent?.trim() ?? '');
        expect(lines.some(line => line.includes('approved these changes'))).to.equal(true);
    });

    it('closes on Escape while preserving the unsent draft and marks the FAB', () => {
        ui.render();
        scroll.querySelector<HTMLButtonElement>('.qaap-pr-fab')!.click();
        const textarea = scroll.querySelector<HTMLTextAreaElement>('.qaap-pr-popover-textarea')!;
        textarea.value = 'Draft note';
        textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
        expect(scroll.querySelector('.qaap-pr-comment-popover')).to.equal(null);
        const fab = scroll.querySelector<HTMLButtonElement>('.qaap-pr-fab')!;
        expect(fab.classList.contains('theia-mod-has-draft')).to.equal(true);

        fab.click();
        expect(scroll.querySelector<HTMLTextAreaElement>('.qaap-pr-popover-textarea')?.value).to.equal('Draft note');
    });

    it('hands its navigation row to the hub header, without a chat button (the floating dock opens the chat)', () => {
        ui.render();
        const topbar = ui.getTopbar();
        expect(scroll.querySelector('.qaap-pr-topbar')).to.equal(null);
        expect(topbar.querySelector('.qaap-pr-crumb-number')?.textContent).to.equal(`#${host.pullRequestDetail?.number}`);
        expect(topbar.querySelector('.qaap-pr-primary-action')).to.not.equal(null);
        expect(topbar.querySelector('.codicon-comment-discussion')).to.equal(null);

        host.pullRequestDetail = undefined;
        ui.render();
        expect(topbar.childElementCount).to.equal(0);
    });

    it('opens the floating comment popover from openChat() and resets state on PR switch', () => {
        ui.render();
        ui.openChat();
        expect(scroll.querySelector('.qaap-pr-comment-popover')).to.not.equal(null);

        host.pullRequestDetail = makePullRequest({ number: 568, title: 'Next PR' });
        ui.render();
        expect(scroll.querySelector('.qaap-pr-comment-popover')).to.equal(null);
    });
});
