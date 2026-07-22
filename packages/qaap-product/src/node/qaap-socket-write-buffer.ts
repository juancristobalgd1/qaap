// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { SocketWriteBuffer } from '@theia/core/lib/common/messaging/socket-write-buffer';
import { injectable } from '@theia/core/shared/inversify';

/**
 * Qaap keeps disconnected browser frontends reconnectable for ten minutes. Plugin synchronization
 * can legitimately exceed Theia's 100 KiB default during that window, so retain a bounded 4 MiB
 * backlog instead of surfacing repeated uncaught RPC buffer errors after a tab reload.
 */
@injectable()
export class QaapSocketWriteBuffer extends SocketWriteBuffer {

    static readonly MAX_DISCONNECTED_BUFFER_SIZE = 4 * 1024 * 1024;

    protected override get maxBufferSize(): number {
        return QaapSocketWriteBuffer.MAX_DISCONNECTED_BUFFER_SIZE;
    }
}
