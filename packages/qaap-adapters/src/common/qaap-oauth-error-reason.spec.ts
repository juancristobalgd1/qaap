// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { QAAP_OAUTH_ERROR_REASONS, QaapOAuthErrorMessages } from './qaap-oauth-error-reason';

describe('QaapOAuthErrorMessages', () => {
    it('gives every known reason its own human sentence without leaking the raw code', () => {
        const seen = new Set<string>();
        for (const reason of QAAP_OAUTH_ERROR_REASONS) {
            const message = QaapOAuthErrorMessages.describe(reason);
            expect(message, reason).not.to.contain('_');
            seen.add(message);
        }
        expect(seen.size).to.equal(QAAP_OAUTH_ERROR_REASONS.length);
    });

    it('falls back to a generic message for unknown or missing reasons', () => {
        const generic = QaapOAuthErrorMessages.describe('github_error');
        expect(QaapOAuthErrorMessages.describe(undefined)).to.equal(generic);
        expect(QaapOAuthErrorMessages.describe('bad token: abc')).to.equal(generic);
    });

    it('stays in sync with the static login gate mapping', () => {
        const gate = fs.readFileSync(path.resolve(__dirname, '../../../qaap-product/resources/qaap-login-gate.js'), 'utf8');
        for (const reason of QAAP_OAUTH_ERROR_REASONS) {
            expect(gate, reason).to.contain(`${reason}:`);
        }
    });
});
