// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// ****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import URI from '@theia/core/lib/common/uri';
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
            confirmRemoveProject: async () => true,
            delegate: {},
            render: () => { renders++; },
        } as unknown as MobileProjectsProjectActionsHost;

        const completion = new MobileProjectsProjectActionsUi(host).onRemoveProject(removed);
        await Promise.resolve();

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
            confirmRemoveProject: async () => true,
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
            confirmRemoveProject: async () => true,
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

    it('does not remove a project when the user cancels confirmation', async () => {
        const removed = project('removed');
        const kept = project('kept');
        let removeCalled = false;
        const host = {
            projects: [removed, kept],
            projectsService: {
                canRemove: () => true,
                removeProject: async () => { removeCalled = true; return true; },
            },
            cardMenuUi: { closeCardMenu: () => undefined },
            confirmRemoveProject: async () => false,
            delegate: {},
            render: () => undefined,
        } as unknown as MobileProjectsProjectActionsHost;

        await new MobileProjectsProjectActionsUi(host).onRemoveProject(removed);

        expect(removeCalled).to.equal(false);
        expect(host.projects.map(candidate => candidate.id)).to.deep.equal(['removed', 'kept']);
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

describe('MobileProjectsService.canRemove', () => {
    it('allows removing a GitHub clone that is not the active workspace', () => {
        const { MobileProjectsService } = require('./mobile-projects-service') as typeof import('./mobile-projects-service');
        const service = Object.create(MobileProjectsService.prototype) as InstanceType<typeof MobileProjectsService>;
        const github = {
            ...project('github:acme/app'),
            github: { owner: 'acme', name: 'app', fullName: 'acme/app', htmlUrl: 'https://github.com/acme/app', private: false },
            isCurrent: false,
        };
        expect(service.canRemove(github)).to.equal(true);
        expect(service.canRemove({ ...github, isCurrent: true })).to.equal(false);
    });
});

describe('MobileProjectsService.removeProject', () => {
    it('removes a custom project and its matching recent workspace', async () => {
        const { removeProjectExtracted } = require('./mobile-projects-service-streaming2') as typeof import('./mobile-projects-service-streaming2');
        const removedProject = {
            ...project('custom:file:///workspace/laaaaa'),
            uri: new URI('file:///workspace/laaaaa'),
        };
        let customProjects = [{ id: removedProject.id }];
        let displayNames: Record<string, string> = { [removedProject.id]: 'laaaaa' };
        let hiddenIds = new Set<string>();
        const removedRecentWorkspaces: string[] = [];
        const ctx = {
            canRemove: () => true,
            readCustomProjects: () => customProjects,
            writeCustomProjects: (next: typeof customProjects) => { customProjects = next; },
            readDisplayNames: () => displayNames,
            writeDisplayNames: (next: Record<string, string>) => { displayNames = next; },
            readHiddenProjectIds: () => hiddenIds,
            writeHiddenProjectIds: (next: Set<string>) => { hiddenIds = next; },
            workspaceService: {
                removeRecentWorkspace: async (uri: string) => { removedRecentWorkspaces.push(uri); },
            },
        };

        expect(await removeProjectExtracted(ctx, removedProject)).to.equal(true);
        expect(customProjects).to.deep.equal([]);
        expect(displayNames).to.deep.equal({});
        expect(removedRecentWorkspaces).to.deep.equal(['file:///workspace/laaaaa']);
        expect([...hiddenIds]).to.have.members([
            removedProject.id,
            'recent:file:///workspace/laaaaa',
        ]);
    });
});
