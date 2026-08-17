// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { isQaapUserCancelledPreviewError } from './qaap-project-bootstrap-types';

describe('isQaapUserCancelledPreviewError', () => {

    it('matches a managed preview stop', () => {
        expect(isQaapUserCancelledPreviewError('Dev server tab closed.')).to.equal(true);
        expect(isQaapUserCancelledPreviewError('Vista previa detenida')).to.equal(true);
    });

    it('ignores real build failures', () => {
        expect(isQaapUserCancelledPreviewError(undefined)).to.equal(false);
        expect(isQaapUserCancelledPreviewError('Port :3001 is already in use.')).to.equal(false);
        expect(isQaapUserCancelledPreviewError('Dev server exited with code 1.')).to.equal(false);
    });
});
