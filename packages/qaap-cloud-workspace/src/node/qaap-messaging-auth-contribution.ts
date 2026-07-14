// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { DefaultMessagingService } from '@theia/core/lib/node/messaging/default-messaging-service';
import { installQaapMessagingAuthPatches, installQaapRpcAuthPatches } from './qaap-rpc-auth-patcher';
import { QaapWebsocketAuthRegistry } from './qaap-websocket-auth-registry';

/** Installs per-connection RPC auth scoping for filesystem, workspace, and related services. */
@injectable()
export class QaapMessagingAuthContribution implements BackendApplicationContribution {

    @inject(DefaultMessagingService)
    protected readonly messaging: DefaultMessagingService;

    @inject(QaapWebsocketAuthRegistry)
    protected readonly registry: QaapWebsocketAuthRegistry;

    onStart(): void {
        installQaapRpcAuthPatches(this.registry);
        installQaapMessagingAuthPatches(this.messaging, this.registry);
    }
}
