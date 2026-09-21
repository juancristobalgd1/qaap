// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Channel } from '@theia/core/lib/common/message-rpc/channel';
import { DefaultMessagingService } from '@theia/core/lib/node/messaging/default-messaging-service';
import { ReconnectableSocketChannel } from '@theia/core/lib/node/messaging/websocket-frontend-connection-service';
import type { Socket } from 'socket.io';
import {
    installQaapMessagingAuthPatches,
    resetQaapAuthPatchStateForTests,
} from './qaap-rpc-auth-patcher';
import { QaapWebsocketAuthRegistry } from './qaap-websocket-auth-registry';

describe('Qaap RPC authentication patcher', () => {
    afterEach(() => {
        resetQaapAuthPatchStateForTests();
    });

    it('refreshes the authenticated owner when a main channel reconnects', () => {
        const originalConnect = ReconnectableSocketChannel.prototype.connect;
        let connectCalls = 0;
        (ReconnectableSocketChannel.prototype as ReconnectableSocketChannel & {
            connect(socket: Socket): void;
        }).connect = function fakeConnect(): void {
            connectCalls++;
        };

        try {
            const registry = new QaapWebsocketAuthRegistry();
            const messaging = {
                handleConnection: (_channel: Channel): void => undefined,
                getConnectionChannelHandlers: (_channel: Channel) => ({
                    route: (_path: string, _rpcChannel: Channel): string | false => false,
                }),
            } as unknown as DefaultMessagingService;
            installQaapMessagingAuthPatches(messaging, registry);

            const mainChannel = {} as ReconnectableSocketChannel;
            const socket = { id: 'socket-reconnected' } as Socket;
            ReconnectableSocketChannel.prototype.connect.call(mainChannel, socket);
            registry.bindSocketLogin(socket.id, 'alice');

            const rpcChannel = {} as Channel;
            registry.associateRpcChannel(rpcChannel, mainChannel);

            expect(connectCalls).to.equal(1);
            expect(registry.getLoginForRpcChannel(rpcChannel)).to.equal('alice');
        } finally {
            resetQaapAuthPatchStateForTests();
            ReconnectableSocketChannel.prototype.connect = originalConnect;
        }
    });
});
