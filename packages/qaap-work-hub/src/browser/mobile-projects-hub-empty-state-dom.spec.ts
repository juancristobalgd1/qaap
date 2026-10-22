// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
import { HubEmptyStateDom } from './mobile-projects-hub-empty-state-dom';
import { createTasksEmptyStateExtracted } from './mobile-projects-tasks-hub-ui-streaming';
import type { MobileProjectsTasksHubUiContext } from './mobile-projects-tasks-hub-ui-context';
import { MobileProjectsWorkHubInboxUi, type MobileProjectsWorkHubInboxHost } from './mobile-projects-work-hub-inbox-ui';

disableImportJSDOM();

describe('hub empty and loading states', () => {

    useSuiteJSDOM();

    it('renders a q-empty block with an action that fires', () => {
        let clicked = 0;
        const empty = HubEmptyStateDom.createEmptyState({
            icon: 'codicon-git-pull-request',
            title: 'Nothing',
            hint: 'Hint',
            action: { label: 'Do it', onClick: () => { clicked++; } },
        });
        expect(empty.classList.contains('q-empty')).to.equal(true);
        expect(empty.querySelector('.q-empty-title')?.textContent).to.equal('Nothing');
        const button = empty.querySelector<HTMLButtonElement>('button.q-empty-action');
        button?.click();
        expect(clicked).to.equal(1);
    });

    it('renders an aria-busy skeleton list without spinner text', () => {
        const list = HubEmptyStateDom.createSkeletonList('Loading', 3);
        expect(list.getAttribute('aria-busy')).to.equal('true');
        expect(list.querySelectorAll('.q-skeleton-text').length).to.equal(6);
        expect(list.querySelector('.codicon-loading')).to.equal(null);
    });

    function tasksCtx(query: string, actions: string[]): MobileProjectsTasksHubUiContext {
        return {
            host: { query, onHomeQuickAction: async (action: string) => { actions.push(action); } },
        } as unknown as MobileProjectsTasksHubUiContext;
    }

    it('tasks empty state drops the VPS jargon and offers Start a task', () => {
        const actions: string[] = [];
        const empty = createTasksEmptyStateExtracted(tasksCtx('', actions));
        expect(empty.textContent).to.not.contain('VPS');
        expect(empty.querySelector('.q-empty-title')?.textContent).to.equal('No tasks yet');
        const button = empty.querySelector<HTMLButtonElement>('.q-empty-action');
        expect(button?.textContent).to.equal('Start a task');
        button?.click();
        expect(actions).to.deep.equal(['delegate-task']);
    });

    it('tasks empty state has no action for an empty search', () => {
        const empty = createTasksEmptyStateExtracted(tasksCtx('abc', []));
        expect(empty.querySelector('.q-empty-title')?.textContent).to.equal('No matching tasks');
        expect(empty.querySelector('.q-empty-action')).to.equal(null);
    });

    it('review inbox shows a skeleton while loading and an actionable empty state otherwise', () => {
        const actions: string[] = [];
        const ui = new MobileProjectsWorkHubInboxUi({
            query: '',
            onHomeQuickAction: async (action: string) => { actions.push(action); },
        } as unknown as MobileProjectsWorkHubInboxHost);
        expect(ui.createReviewLoadingState().getAttribute('aria-busy')).to.equal('true');
        const empty = ui.createReviewEmptyState();
        expect(empty.classList.contains('q-empty')).to.equal(true);
        empty.querySelector<HTMLButtonElement>('.q-empty-action')?.click();
        expect(actions).to.deep.equal(['delegate-task']);
        expect(ui.createReviewEmptyState(false).querySelector('.q-empty-action')).to.equal(null);
    });
});
