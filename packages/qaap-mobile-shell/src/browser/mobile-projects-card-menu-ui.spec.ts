// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { expect } from 'chai';
import type { MobileProjectsCardMenuHost } from './mobile-projects-card-menu-ui';
import type { MobileProjectEntry } from './mobile-projects-types';

enableJSDOM();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MobileProjectsCardMenuUi } = require('./mobile-projects-card-menu-ui') as typeof import('./mobile-projects-card-menu-ui');

const project = (overrides: Partial<MobileProjectEntry> = {}): MobileProjectEntry => ({
    id: 'proj-1',
    name: 'proj-1',
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
    ...overrides,
});

describe('MobileProjectsCardMenuUi.buildProjectOptionsMenu', () => {
    it('lists Pin first (New agent is now a standalone row button)', () => {
        const target = project({ id: 'alpha' });
        const host = {
            projectsService: { canRemove: () => true },
            conversationIndexUi: {
                conversationsForProject: () => [],
                countFailedTasks: () => 0,
            },
            onTogglePin: async () => undefined,
            onRemoveProject: async () => undefined,
            onClearProjectChats: async () => undefined,
            onClearFailedTasks: async () => undefined,
            closeCurrentWorkspace: async () => undefined,
        } as unknown as MobileProjectsCardMenuHost;

        const ui = new MobileProjectsCardMenuUi(host);
        const menu = ui.buildProjectOptionsMenu(target);
        const items = [...menu.querySelectorAll('.theia-mobile-projects-card-menu-item')];
        expect(items.map(item => item.textContent?.trim())).to.deep.equal([
            'Pin',
            'Remove',
            'Clear all tasks',
        ]);
        expect(items[0]?.querySelector('.codicon-add')).to.equal(null);
    });
});
