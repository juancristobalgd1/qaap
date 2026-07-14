// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { AsyncLocalStorage } from 'async_hooks';
import { injectable } from '@theia/core/shared/inversify';
import { Channel } from '@theia/core/lib/common/message-rpc/channel';

/**
 * Binds websocket sessions and multiplexed RPC channels to the authenticated GitHub login.
 * {@link getCurrentLogin} is populated per inbound RPC via AsyncLocalStorage.
 */
@injectable()
export class QaapWebsocketAuthRegistry {

    protected readonly loginBySocketId = new Map<string, string>();
    protected readonly socketIdByMainChannel = new WeakMap<Channel, string>();
    protected readonly mainChannelByRpcChannel = new WeakMap<Channel, Channel>();
    protected readonly scope = new AsyncLocalStorage<string | undefined>();

    bindSocketLogin(socketId: string, userLogin: string): void {
        this.loginBySocketId.set(socketId, userLogin);
    }

    unbindSocket(socketId: string): void {
        this.loginBySocketId.delete(socketId);
    }

    bindMainChannel(mainChannel: Channel, socketId: string | undefined): void {
        if (!socketId) {
            return;
        }
        this.socketIdByMainChannel.set(mainChannel, socketId);
    }

    associateRpcChannel(rpcChannel: Channel, mainChannel: Channel): void {
        this.mainChannelByRpcChannel.set(rpcChannel, mainChannel);
    }

    getLoginForSocket(socketId: string | undefined): string | undefined {
        if (!socketId) {
            return undefined;
        }
        return this.loginBySocketId.get(socketId);
    }

    getLoginForMainChannel(mainChannel: Channel | undefined): string | undefined {
        if (!mainChannel) {
            return undefined;
        }
        const socketId = this.socketIdByMainChannel.get(mainChannel);
        return this.getLoginForSocket(socketId);
    }

    getLoginForRpcChannel(rpcChannel: Channel | undefined): string | undefined {
        if (!rpcChannel) {
            return undefined;
        }
        const mainChannel = this.mainChannelByRpcChannel.get(rpcChannel);
        return this.getLoginForMainChannel(mainChannel);
    }

    runWithLogin<T>(userLogin: string | undefined, fn: () => T): T {
        return this.scope.run(userLogin, fn);
    }

    runWithRpcChannel<T>(rpcChannel: Channel, fn: () => T): T {
        const login = this.getLoginForRpcChannel(rpcChannel);
        return this.runWithLogin(login, fn);
    }

    getCurrentLogin(): string | undefined {
        return this.scope.getStore();
    }
}
