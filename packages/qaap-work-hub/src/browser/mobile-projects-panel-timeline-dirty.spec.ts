// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapDirtyWorkspaceCancelledError } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { createProjectChatSessionExtracted } from './mobile-projects-panel-timeline';
import type { MobileProjectsPanelContext } from './mobile-projects-panel-context';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';

/** The transcript "new task" path must reach the same dirty-tree decision as the New task panel. */
describe('createProjectChatSessionExtracted (transcript new task)', () => {
    const project = { id: 'p', name: 'repo' } as MobileProjectEntry;

    function contextWith(decision: () => Promise<unknown>): { ctx: MobileProjectsPanelContext; calls: string[] } {
        const calls: string[] = [];
        const ctx = {
            backgroundTaskUi: {
                createWithDirtyWorkspaceDecision: async () => {
                    calls.push('decision');
                    return decision();
                },
                createProjectChatSession: async () => {
                    calls.push('raw');
                    return undefined;
                },
            },
        } as unknown as MobileProjectsPanelContext;
        return { ctx, calls };
    }

    it('goes through the dirty-workspace decision, not the raw create', async () => {
        const created = { summary: { id: 'c1' }, outbound: 'fix it' };
        const { ctx, calls } = contextWith(async () => created);
        const result = await createProjectChatSessionExtracted(ctx, project, '/repo', 'fix it', {});
        expect(result).to.equal(created);
        expect(calls).to.deep.equal(['decision']);
    });

    it('reports a cancelled dialog as a cancellation so the composer keeps the draft silently', async () => {
        const { ctx } = contextWith(async () => undefined);
        let thrown: unknown;
        try {
            await createProjectChatSessionExtracted(ctx, project, '/repo', 'fix it', {});
        } catch (error) {
            thrown = error;
        }
        expect(thrown).to.be.instanceOf(QaapDirtyWorkspaceCancelledError);
    });
});
