// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { createAgUiCliStreamEmitter } from './qaap-cli-ag-ui-stream';
import { QaapCodexAgUiStreamEmitter } from './qaap-codex-ag-ui-stream';
import { QaapOpencodeAgUiStreamEmitter } from './qaap-opencode-ag-ui-stream';
import { QaapQaiqAgUiStreamEmitter } from './qaap-qaiq-ag-ui-stream';

describe('createAgUiCliStreamEmitter', () => {
    it('returns provider-specific emitters', () => {
        expect(createAgUiCliStreamEmitter('qaiq')).to.be.instanceOf(QaapQaiqAgUiStreamEmitter);
        expect(createAgUiCliStreamEmitter('claude')).to.be.instanceOf(QaapQaiqAgUiStreamEmitter);
        expect(createAgUiCliStreamEmitter('codex')).to.be.instanceOf(QaapCodexAgUiStreamEmitter);
        expect(createAgUiCliStreamEmitter('opencode')).to.be.instanceOf(QaapOpencodeAgUiStreamEmitter);
        expect(createAgUiCliStreamEmitter('shell')).to.equal(undefined);
    });
});
