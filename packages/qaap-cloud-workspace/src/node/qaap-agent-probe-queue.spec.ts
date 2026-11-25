// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAgentProbeQueue } from './qaap-agent-probe-queue';

/** A queue whose turns the spec advances by hand. */
function manualQueue(maxConcurrent: number): { queue: QaapAgentProbeQueue; turn: () => Promise<void> } {
    const turns: Array<() => void> = [];
    const queue = new QaapAgentProbeQueue(maxConcurrent, callback => { turns.push(callback); });
    const turn = async (): Promise<void> => {
        // Let settled tasks schedule their follow-up turns first.
        await new Promise(resolve => setImmediate(resolve));
        const due = turns.splice(0);
        due.forEach(callback => callback());
    };
    return { queue, turn };
}

describe('QaapAgentProbeQueue', () => {

    it('never starts a probe in the caller\'s turn and starts one per turn', async () => {
        const { queue, turn } = manualQueue(2);
        const started: string[] = [];
        const never = (id: string) => (): Promise<void> => { started.push(id); return new Promise<void>(() => undefined); };
        void queue.run(never('a'));
        void queue.run(never('b'));
        expect(started).to.deep.equal([]);
        await turn();
        expect(started).to.deep.equal(['a']);
        await turn();
        expect(started).to.deep.equal(['a', 'b']);
    });

    it('caps concurrency and starts the next one after a probe settles', async () => {
        const { queue, turn } = manualQueue(1);
        let finishFirst: () => void = () => undefined;
        const started: string[] = [];
        const first = queue.run(() => { started.push('a'); return new Promise<string>(resolve => { finishFirst = () => resolve('A'); }); });
        const second = queue.run(async () => { started.push('b'); return 'B'; });
        await turn();
        await turn();
        expect(started).to.deep.equal(['a']);
        expect(queue.queued).to.equal(1);
        finishFirst();
        expect(await first).to.equal('A');
        await turn();
        expect(await second).to.equal('B');
        expect(started).to.deep.equal(['a', 'b']);
    });

    it('settles like the task, including a task that throws synchronously', async () => {
        const queue = new QaapAgentProbeQueue();
        const failure = queue.run((): Promise<void> => { throw new Error('spawn failed'); });
        const next = queue.run(async () => 'ok');
        let message = '';
        await failure.catch((error: Error) => { message = error.message; });
        expect(message).to.equal('spawn failed');
        expect(await next).to.equal('ok');
    });
});
