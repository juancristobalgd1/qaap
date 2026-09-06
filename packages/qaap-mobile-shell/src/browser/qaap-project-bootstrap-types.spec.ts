// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { isQaapUserCancelledPreviewError, qaapBootstrapFailureKind } from './qaap-project-bootstrap-types';

describe('isQaapUserCancelledPreviewError', () => {

    it('matches a managed preview stop', () => {
        expect(isQaapUserCancelledPreviewError('Dev server tab closed.')).to.equal(true);
        expect(isQaapUserCancelledPreviewError('Preview stopped')).to.equal(true);
        expect(isQaapUserCancelledPreviewError('Vista previa detenida')).to.equal(true);
    });

    it('ignores real build failures', () => {
        expect(isQaapUserCancelledPreviewError(undefined)).to.equal(false);
        expect(isQaapUserCancelledPreviewError('Port :3001 is already in use.')).to.equal(false);
        expect(isQaapUserCancelledPreviewError('Dev server exited with code 1.')).to.equal(false);
    });
});

describe('qaapBootstrapFailureKind', () => {

    it('does not treat a user-stopped preview as a failure notice', () => {
        expect(qaapBootstrapFailureKind('run-failed', 'Dev server tab closed.')).to.equal('cancelled');
    });

    it('classifies install vs preview failures', () => {
        expect(qaapBootstrapFailureKind('install-failed', 'npm ERR!')).to.equal('install');
        expect(qaapBootstrapFailureKind('run-failed', 'Port :3001 is already in use.')).to.equal('preview');
        expect(qaapBootstrapFailureKind('running')).to.equal(undefined);
    });
});
