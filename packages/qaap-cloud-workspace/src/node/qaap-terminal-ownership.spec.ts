// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Disposable, Emitter, Event } from '@theia/core/lib/common';
import { ManagedProcess, ProcessErrorEvent, IProcessStartEvent, IProcessExitEvent } from '@theia/process/lib/common/process-manager-types';
import { TerminalProcess } from '@theia/process/lib/node';
import { QaapTerminalOwnership, installQaapTerminalOwnership } from './qaap-terminal-ownership';

class FakeProcess implements ManagedProcess {
    readonly onStart: Event<IProcessStartEvent> = new Emitter<IProcessStartEvent>().event;
    readonly onExit: Event<IProcessExitEvent> = new Emitter<IProcessExitEvent>().event;
    readonly onClose: Event<IProcessExitEvent> = new Emitter<IProcessExitEvent>().event;
    readonly onError: Event<ProcessErrorEvent> = new Emitter<ProcessErrorEvent>().event;
    readonly killed = false;
    constructor(readonly id: number) { }
    kill(): void { }
}

describe('qaap-terminal-ownership', () => {
    it('does not apply terminal ownership rules to non-terminal processes', () => {
        const ownership = new QaapTerminalOwnership();
        const process = new FakeProcess(7);
        ownership.bind(process, 'alice');
        expect(ownership.canAccess(process, 'alice')).to.equal(true);
    });

    it('allows only the owner to access a hosted terminal process', () => {
        const previousNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const ownership = new QaapTerminalOwnership();
            const process = fakeTerminalProcess(7);
            ownership.bind(process, 'Alice', 7);
            expect(ownership.canAccess(process, 'alice')).to.equal(true);
            expect(ownership.canAccess(process, 'bob')).to.equal(false);
            expect(ownership.canAccess(process, undefined)).to.equal(false);
        } finally {
            if (previousNodeEnv === undefined) {
                delete process.env.NODE_ENV;
            } else {
                process.env.NODE_ENV = previousNodeEnv;
            }
        }
    });

    it('filters cross-tenant ProcessManager lookups in hosted mode', () => {
        const previousNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const ownership = new QaapTerminalOwnership();
            const process = fakeTerminalProcess(11);
            const manager = {
                register: (_process: ManagedProcess): number => 11,
                get: (id: number): ManagedProcess | undefined => id === 11 ? process : undefined,
            };
            let currentLogin: string | undefined = 'alice';
            installQaapTerminalOwnership(manager, ownership, () => currentLogin);
            manager.register(process);
            expect(manager.get(11)).to.equal(process);
            currentLogin = 'bob';
            expect(manager.get(11)).to.equal(undefined);
        } finally {
            if (previousNodeEnv === undefined) {
                delete process.env.NODE_ENV;
            } else {
                process.env.NODE_ENV = previousNodeEnv;
            }
        }
    });
});

function fakeTerminalProcess(id: number): ManagedProcess {
    const event = (): Disposable => ({ dispose: () => undefined });
    const fake = { id, onStart: event, onExit: event, onClose: event, onError: event, killed: false, kill: () => undefined };
    return Object.setPrototypeOf(fake, TerminalProcess.prototype) as unknown as ManagedProcess;
}
