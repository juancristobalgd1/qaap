// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// ****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { expect } from 'chai';
import type { MobileProjectsProjectActionsHost } from './mobile-projects-project-actions-ui';
import type { MobileProjectEntry } from './mobile-projects-types';

// Use the shared jsdom environment instead of a private linkedom DOM. Assigning
// linkedom's DOM classes (Element/HTMLElement/Event/MouseEvent/...) onto the global
// scope at load time leaked those classes for the rest of the mocha process, so later
// jsdom-based specs ended up with a jsdom window/document but linkedom event classes —
// producing "Cannot set property eventPhase", "instanceof", and "extends undefined" errors.
enableJSDOM();
// The action module imports Theia browser widgets, which inspect the DOM while loading.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MobileProjectsProjectActionsUi } = require('./mobile-projects-project-actions-ui') as typeof import('./mobile-projects-project-actions-ui');

const project = (id: string): MobileProjectEntry => ({
    id,
    name: id,
    color: '#000',
    branch: 'main',
    status: 'idle',
    task: '',
    progress: 0,
    agents: [],
    lastActive: '—',
    tokens: '—',
    cost: '—',
    pinned: false,
    isCurrent: false,
});

describe('MobileProjectsProjectActionsUi', () => {
    it('removes a project optimistically before persistence completes', async () => {
        const removed = project('removed');
        const kept = project('kept');
        let finishRemoval!: (value: boolean) => void;
        const pendingRemoval = new Promise<boolean>(resolve => { finishRemoval = resolve; });
        let renders = 0;
        const host = {
            projects: [removed, kept],
            projectsService: {
                canRemove: () => true,
                removeProject: () => pendingRemoval,
                loadProjects: async () => [kept],
            },
            cardMenuUi: { closeCardMenu: () => undefined },
            delegate: {},
            render: () => { renders++; },
        } as unknown as MobileProjectsProjectActionsHost;

        const completion = new MobileProjectsProjectActionsUi(host).onRemoveProject(removed);

        expect(host.projects.map(candidate => candidate.id)).to.deep.equal(['kept']);
        expect(renders).to.equal(1);
        finishRemoval(true);
        await completion;
        expect(host.projects.map(candidate => candidate.id)).to.deep.equal(['kept']);
    });

    it('rolls an optimistic removal back when persistence fails', async () => {
        const removed = project('removed');
        const kept = project('kept');
        const errors: string[] = [];
        const host = {
            projects: [removed, kept],
            projectsService: {
                canRemove: () => true,
                removeProject: async () => { throw new Error('storage unavailable'); },
            },
            cardMenuUi: { closeCardMenu: () => undefined },
            delegate: {},
            messageService: { error: (message: string) => { errors.push(message); } },
            render: () => undefined,
        } as unknown as MobileProjectsProjectActionsHost;

        await new MobileProjectsProjectActionsUi(host).onRemoveProject(removed);

        expect(host.projects).to.deep.equal([removed, kept]);
        expect(errors).to.have.length(1);
        expect(errors[0]).to.contain('storage unavailable');
    });

    it('releases each conversation preview before removing the project', async () => {
        const removed = project('removed');
        const kept = project('kept');
        const released: string[] = [];
        const host = {
            projects: [removed, kept],
            projectsService: {
                canRemove: () => true,
                removeProject: async () => true,
                loadProjects: async () => [kept],
            },
            cardMenuUi: { closeCardMenu: () => undefined },
            delegate: {},
            render: () => undefined,
            conversationIndexUi: {
                conversationsForProject: (entry: MobileProjectEntry) => entry.id === 'removed'
                    ? [{ id: 'task-a' }, { id: 'task-b' }] as any
                    : [],
            },
            releasePreviewForConversation: (_project: { id: string }, summary: { id: string }) => { released.push(summary.id); },
        } as unknown as MobileProjectsProjectActionsHost;

        await new MobileProjectsProjectActionsUi(host).onRemoveProject(removed);

        expect(released).to.deep.equal(['task-a', 'task-b']);
    });

    it('resolveFailedTasksToClear keeps only the selected failed ids when provided', () => {
        const { resolveFailedTasksToClear } = require('./mobile-projects-project-actions-ui') as typeof import('./mobile-projects-project-actions-ui');
        const failed = [
            { id: 'keep-failed' },
            { id: 'delete-me' },
        ] as any[];
        expect(resolveFailedTasksToClear(failed, ['delete-me']).map((row: { id: string }) => row.id)).to.deep.equal(['delete-me']);
        expect(resolveFailedTasksToClear(failed).map((row: { id: string }) => row.id)).to.deep.equal(['keep-failed', 'delete-me']);
    });
});
