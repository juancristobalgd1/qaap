// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { isDirtyWorkspaceCancelled, QaapDirtyWorkspaceCancelledError, QaapDirtyWorkspaceError } from './qaap-agent-conversation-client';

/** A cancelled dialog is silent at every send site; any other failure is still reported. */
describe('isDirtyWorkspaceCancelled', () => {
    it('is true only for a cancelled dirty-workspace dialog', () => {
        expect(isDirtyWorkspaceCancelled(new QaapDirtyWorkspaceCancelledError())).to.equal(true);
        expect(isDirtyWorkspaceCancelled(new QaapDirtyWorkspaceError('dirty', ['a.ts'], 1))).to.equal(false);
        expect(isDirtyWorkspaceCancelled(new Error('network down'))).to.equal(false);
        expect(isDirtyWorkspaceCancelled('cancelled')).to.equal(false);
    });
});
