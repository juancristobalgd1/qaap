// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Container } from '@theia/core/shared/inversify';
import { RemoteConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import { Emitter } from '@theia/core/lib/common/event';
import {
    QAAP_TERMINALS_PATH, QaapHeadlessTerminal, QaapHeadlessTerminalBuffer, QaapHeadlessTerminalService,
    stripTerminalControlSequences,
} from './qaap-headless-terminal-service';
import { QaapIdeShellTerminalServer, QaapIdeTerminalWatcher } from './qaap-ide-bridge';
import { readTerminalTail } from './qaap-project-bootstrap-helpers';

interface FakeChannel {
    emit(data: string): void;
}

function createHarness(): {
    service: QaapHeadlessTerminalService;
    calls: Array<[string, unknown[]]>;
    channels: Map<string, FakeChannel>;
    client: () => Record<string, (event: unknown) => void>;
} {
    const calls: Array<[string, unknown[]]> = [];
    const channels = new Map<string, FakeChannel>();
    let client: Record<string, (event: unknown) => void> = {};
    const server = new Proxy({}, {
        // No `then`: a thenable constant would make inversify treat the binding as async.
        get: (_target, name) => name === 'then' ? undefined : async (...args: unknown[]) => {
            calls.push([String(name), args]);
            return name === 'create' ? 7 : name === 'getProcessId' ? 4242 : undefined;
        }
    });
    // The watcher is the shell terminal server's RPC client: `client()` plays the backend calling it.
    const exitEmitter = new Emitter<unknown>();
    const errorEmitter = new Emitter<unknown>();
    const watcher = { onTerminalExit: exitEmitter.event, onTerminalError: errorEmitter.event };
    client = {
        onTerminalExitChanged: event => exitEmitter.fire(event),
        onTerminalError: event => errorEmitter.fire(event),
    };
    const connectionProvider = {
        createProxy: () => {
            throw new Error('the runner must reuse the terminal package proxy (one channel per path)');
        },
        listen:(path: string, handler: (path: string, channel: unknown) => void) => {
            let onMessage: ((event: () => { readString(): string }) => void) | undefined;
            handler(path, { onMessage: (listener: typeof onMessage) => { onMessage = listener; } });
            channels.set(path, { emit: data => onMessage?.(() => ({ readString: () => data })) });
        },
    };
    const container = new Container();
    container.bind(RemoteConnectionProvider).toConstantValue(connectionProvider);
    container.bind(QaapIdeShellTerminalServer).toConstantValue(server);
    container.bind(QaapIdeTerminalWatcher).toConstantValue(watcher);
    container.bind(QaapHeadlessTerminalService).toSelf().inSingletonScope();
    return { service: container.get(QaapHeadlessTerminalService), calls, channels, client: () => client };
}

describe('QaapHeadlessTerminalService (mobile process runner)', () => {

    it('creates the process on the shell terminal backend with the managed shell invocation', async () => {
        const { service, calls } = createHarness();
        const terminal = await service.newTerminal({ title: 'dev', cwd: '/workspace/app', shellPath: '/bin/sh', shellArgs: ['-lc', 'npm run dev'], kind: 'preview' });
        expect(service.all).to.deep.equal([terminal]);
        expect(await terminal.start()).to.equal(7);
        const create = calls.find(([name]) => name === 'create');
        expect(create?.[1][0]).to.include({ shell: '/bin/sh', rootURI: '/workspace/app', cols: 80, rows: 24 });
        expect((create?.[1][0] as { args: string[] }).args).to.deep.equal(['-lc', 'npm run dev']);
        expect(calls.some(([name, args]) => name === 'onAttachAttempted' && args[0] === 7)).to.equal(true);
        expect(await terminal.processId).to.equal(4242);
        expect(terminal.kind).to.equal('preview');
        expect(terminal.title.label).to.equal('dev');
        expect(terminal.lastCwd?.path.toString()).to.equal('/workspace/app');
    });

    it('streams output from the terminal channel into onOutput and the log-tail buffer', async () => {
        const { service, channels } = createHarness();
        const terminal = await service.newTerminal({ title: 'dev' });
        await terminal.start();
        const received: string[] = [];
        terminal.onOutput(data => received.push(data));
        const channel = channels.get(`${QAAP_TERMINALS_PATH}/7`)!;
        channel.emit('\u001b[32m  VITE v5 ready\u001b[0m\r\n');
        channel.emit('  ➜  Local:   http://localhost:5173/\r\n\r\n');
        expect(received.join('')).to.contain('http://localhost:5173/');
        expect(readTerminalTail(terminal as never)).to.equal('  VITE v5 ready\n  ➜  Local:   http://localhost:5173/');
    });

    it('reports the backend exit like TerminalWatcher and fires onTerminalDidClose on dispose', async () => {
        const { service, client, calls } = createHarness();
        const terminal = await service.newTerminal({ title: 'install' });
        await terminal.start();
        const exits: unknown[] = [];
        service.onTerminalExit(event => exits.push(event));
        let closed: QaapHeadlessTerminal | undefined;
        terminal.onTerminalDidClose(t => { closed = t; });
        client().onTerminalExitChanged({ terminalId: 7, code: 1 });
        expect(exits).to.deep.equal([{ terminalId: 7, code: 1 }]);
        expect(terminal.exitStatus).to.deep.equal({ code: 1, reason: 2 });
        terminal.dispose();
        expect(closed).to.equal(terminal);
        expect(terminal.isDisposed).to.equal(true);
        expect(service.all).to.deep.equal([]);
        // A process that already exited with a code is not closed again.
        expect(calls.some(([name]) => name === 'close')).to.equal(false);
    });

    it('closes the backend process when a running terminal is disposed', async () => {
        const { service, calls } = createHarness();
        const terminal = await service.newTerminal({ title: 'dev' });
        await terminal.start();
        terminal.dispose();
        expect(calls.some(([name, args]) => name === 'close' && args[0] === 7)).to.equal(true);
        expect(terminal.exitStatus).to.deep.equal({ code: undefined, reason: 4 });
    });

    it('keeps only the redrawn text of carriage-return progress lines', () => {
        const buffer = new QaapHeadlessTerminalBuffer();
        buffer.write('installing 10%\rinstalling 55%\rinstalling 100%\ndone\n');
        expect(buffer.getLines(0, buffer.length, true)).to.deep.equal(['installing 100%', 'done', '']);
        expect(stripTerminalControlSequences('\u001b]0;title\u0007ok\u001b[2K')).to.equal('ok');
    });
});
