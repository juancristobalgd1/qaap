// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapToolGateAskBroker } from './qaap-tool-gate-ask-broker';

const request = { requestId: 'gate-1', toolUseId: 'call-1', toolName: 'Bash', toolInput: { command: 'npm test' } };

describe('QaapToolGateAskBroker', () => {

    it('lists a pending ask and resolves it with the human answer', async () => {
        const broker = new QaapToolGateAskBroker();
        const outcome = broker.ask('task-1', request, 5_000);
        expect(broker.list('task-1')).to.deep.equal([request]);
        expect(broker.respond('task-1', 'approve', 'call-1')).to.equal(true);
        expect(await outcome).to.equal('approve');
        expect(broker.list('task-1')).to.deep.equal([]);
    });

    it('settles to ttl when nobody answers in time', async () => {
        const broker = new QaapToolGateAskBroker();
        expect(await broker.ask('task-1', request, 10)).to.equal('ttl');
        expect(broker.count('task-1')).to.equal(0);
    });

    it('does not answer an ask of another task or with an unknown id', () => {
        const broker = new QaapToolGateAskBroker();
        void broker.ask('task-1', request, 5_000);
        expect(broker.respond('task-2', 'approve', 'call-1')).to.equal(false);
        expect(broker.respond('task-1', 'approve', 'other')).to.equal(false);
        expect(broker.respond('task-1', 'approve', undefined)).to.equal(false);
        broker.cancelTask('task-1');
    });

    it('cancels pending asks when the task ends or the signal aborts', async () => {
        const broker = new QaapToolGateAskBroker();
        const ended = broker.ask('task-1', request, 5_000);
        broker.cancelTask('task-1');
        expect(await ended).to.equal('cancelled');
        const controller = new AbortController();
        const aborted = broker.ask('task-1', request, 5_000, controller.signal);
        controller.abort();
        expect(await aborted).to.equal('cancelled');
        expect(await broker.ask('task-1', request, 5_000, controller.signal)).to.equal('cancelled');
        expect(broker.count('task-1')).to.equal(0);
    });
});
