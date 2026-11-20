// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapWorkHubRoutine } from '@theia/qaap-shared-core/lib/common/qaap-work-hub-routine';
import { QaapWorkHubRoutineStore } from './qaap-work-hub-routine-store';

const ROUTINE: QaapWorkHubRoutine = {
    id: 'routine-1',
    ownerLogin: 'alice',
    title: 'Nightly checks',
    prompt: 'Run the checks',
    cwd: '/repo',
    agent: 'qaiq',
    trigger: 'manual',
    intervalHours: 24,
    enabled: true,
    lastRunState: 'running',
    lastRunTaskId: 'task-1',
    createdAt: 1,
    updatedAt: 1,
};

describe('QaapWorkHubRoutineStore load', () => {
    function storeWith(routines: QaapWorkHubRoutine[]): { store: QaapWorkHubRoutineStore; replace: Array<unknown> } {
        const replace: Array<unknown> = [];
        const store = Object.create(QaapWorkHubRoutineStore.prototype) as QaapWorkHubRoutineStore;
        Object.assign(store, {
            routines: new Map<string, QaapWorkHubRoutine>(),
            sqliteStore: {
                migrateLegacy: () => undefined,
                get: () => ({ routines }),
                replace: (entries: unknown) => replace.push(entries),
            },
        });
        return { store, replace };
    }

    it('turns a routine left running by an earlier backend into failed and persists it', () => {
        const { store, replace } = storeWith([ROUTINE]);
        (store as unknown as { loadFromDisk(): void }).loadFromDisk();

        expect(store.get(ROUTINE.id)?.lastRunState).to.equal('failed');
        expect(replace).to.have.length(1);
    });

    it('keeps completed and failed routines as they are and does not rewrite the store', () => {
        const { store, replace } = storeWith([{ ...ROUTINE, lastRunState: 'completed' }]);
        (store as unknown as { loadFromDisk(): void }).loadFromDisk();

        expect(store.get(ROUTINE.id)?.lastRunState).to.equal('completed');
        expect(replace).to.have.length(0);
    });
});
