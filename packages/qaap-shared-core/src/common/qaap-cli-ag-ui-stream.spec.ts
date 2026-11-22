// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAntigravityAgUiStreamEmitter } from './qaap-antigravity-ag-ui-stream';
import { createAgUiCliStreamEmitter } from './qaap-cli-ag-ui-stream';
import { QaapCodexAgUiStreamEmitter } from './qaap-codex-ag-ui-stream';
import { QaapAcpSniffingAgUiEmitter } from './qaap-acp-bridge-stream';
import { QaapQaiqAgUiStreamEmitter } from './qaap-qaiq-ag-ui-stream';

describe('createAgUiCliStreamEmitter', () => {
    it('returns provider-specific emitters', () => {
        expect(createAgUiCliStreamEmitter('qaiq')).to.be.instanceOf(QaapQaiqAgUiStreamEmitter);
        expect(createAgUiCliStreamEmitter('claude')).to.be.instanceOf(QaapQaiqAgUiStreamEmitter);
        expect(createAgUiCliStreamEmitter('codex')).to.be.instanceOf(QaapCodexAgUiStreamEmitter);
        // OpenCode can run natively or through the ACP bridge: its emitter picks the format from the first line.
        expect(createAgUiCliStreamEmitter('opencode')).to.be.instanceOf(QaapAcpSniffingAgUiEmitter);
        expect(createAgUiCliStreamEmitter('antigravity')).to.be.instanceOf(QaapAntigravityAgUiStreamEmitter);
        expect(createAgUiCliStreamEmitter('gemini')).to.be.instanceOf(QaapAntigravityAgUiStreamEmitter);
        expect(createAgUiCliStreamEmitter('shell')).to.equal(undefined);
    });
});
