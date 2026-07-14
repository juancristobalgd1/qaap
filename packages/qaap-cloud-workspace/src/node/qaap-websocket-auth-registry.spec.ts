// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Channel } from '@theia/core/lib/common/message-rpc/channel';
import { QaapWebsocketAuthRegistry } from './qaap-websocket-auth-registry';

class FakeChannel implements Channel {
    readonly onClose = () => ({ dispose: () => undefined });
    readonly onError = () => ({ dispose: () => undefined });
    readonly onMessage = () => ({ dispose: () => undefined });
    getWriteBuffer(): never {
        throw new Error('not implemented');
    }
    close(): void {
        /* noop */
    }
}

describe('QaapWebsocketAuthRegistry', () => {
    it('scopes rpc channels to the login of their parent websocket', () => {
        const registry = new QaapWebsocketAuthRegistry();
        const main = new FakeChannel();
        const rpc = new FakeChannel();
        registry.bindSocketLogin('socket-a', 'alice');
        registry.bindMainChannel(main, 'socket-a');
        registry.associateRpcChannel(rpc, main);

        let seen: string | undefined;
        registry.runWithRpcChannel(rpc, () => {
            seen = registry.getCurrentLogin();
        });
        expect(seen).to.equal('alice');
        expect(registry.getLoginForRpcChannel(rpc)).to.equal('alice');
    });

    it('does not leak bob login into alice rpc scope', () => {
        const registry = new QaapWebsocketAuthRegistry();
        const mainAlice = new FakeChannel();
        const mainBob = new FakeChannel();
        const rpcAlice = new FakeChannel();
        const rpcBob = new FakeChannel();
        registry.bindSocketLogin('socket-alice', 'alice');
        registry.bindSocketLogin('socket-bob', 'bob');
        registry.bindMainChannel(mainAlice, 'socket-alice');
        registry.bindMainChannel(mainBob, 'socket-bob');
        registry.associateRpcChannel(rpcAlice, mainAlice);
        registry.associateRpcChannel(rpcBob, mainBob);

        let aliceLogin: string | undefined;
        let bobLogin: string | undefined;
        registry.runWithRpcChannel(rpcAlice, () => {
            aliceLogin = registry.getCurrentLogin();
        });
        registry.runWithRpcChannel(rpcBob, () => {
            bobLogin = registry.getCurrentLogin();
        });
        expect(aliceLogin).to.equal('alice');
        expect(bobLogin).to.equal('bob');
    });
});
