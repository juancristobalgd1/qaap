// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// ****************************************************************************

import { expect } from 'chai';
import { parseHTML } from 'linkedom';
import type { MobileProjectsProjectActionsHost } from './mobile-projects-project-actions-ui';
import type { MobileProjectEntry } from './mobile-projects-types';

const testDom = parseHTML('<!DOCTYPE html><html><body></body></html>');
(testDom.document as unknown as { queryCommandSupported: () => boolean }).queryCommandSupported = () => false;
Object.assign(globalThis, {
    document: testDom.document,
    window: testDom.window,
    Element: testDom.window.Element,
    HTMLElement: testDom.window.HTMLElement,
    Node: testDom.window.Node,
    Event: testDom.window.Event,
    KeyboardEvent: testDom.window.KeyboardEvent,
    MouseEvent: testDom.window.MouseEvent,
});
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
});
