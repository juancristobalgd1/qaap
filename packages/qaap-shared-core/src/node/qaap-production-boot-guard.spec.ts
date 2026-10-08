// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { reportQaapFatalBootReason } from './qaap-production-boot-guard';

describe('reportQaapFatalBootReason', () => {

    it('writes the fatal reason synchronously to stderr so docker logs shows why the backend exited', () => {
        const writes: Array<[number, string]> = [];
        reportQaapFatalBootReason('Refusing to serve third-party tenants', (fd, text) => writes.push([fd, text]));
        expect(writes).to.deep.equal([[2, '[qaap-security] Refusing to serve third-party tenants\n']]);
    });

    it('never throws when stderr is unavailable, so the exit still happens', () => {
        expect(() => reportQaapFatalBootReason('x', () => { throw new Error('EBADF'); })).to.not.throw();
    });
});
