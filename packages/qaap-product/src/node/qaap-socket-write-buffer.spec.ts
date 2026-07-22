// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapSocketWriteBuffer } from './qaap-socket-write-buffer';

describe('QaapSocketWriteBuffer', () => {

    it('buffers plugin synchronization payloads larger than the upstream 100 KiB limit', () => {
        const buffer = new QaapSocketWriteBuffer();
        expect(() => buffer.buffer(new Uint8Array(512 * 1024))).not.to.throw();
    });

    it('retains a finite upper bound for disconnected frontends', () => {
        const buffer = new QaapSocketWriteBuffer();
        buffer.buffer(new Uint8Array(QaapSocketWriteBuffer.MAX_DISCONNECTED_BUFFER_SIZE));
        expect(() => buffer.buffer(new Uint8Array(1))).to.throw('Max disconnected buffer size exceeded');
    });
});
