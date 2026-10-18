// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    QAAP_EXTERNAL_TASK_INTAKE_SIGNATURE_TTL_MS,
    signQaapExternalTaskIntake,
    verifyQaapExternalTaskIntake,
} from './qaap-external-task-intake-signature';

describe('qaap-external-task-intake-signature', () => {
    const secret = 's3cret';
    const now = 1_000_000_000_000;
    const body = '{"kind":"launch"}';

    it('round-trips', () => {
        const header = signQaapExternalTaskIntake(secret, 'Alice', 'd1', body, now);
        expect(verifyQaapExternalTaskIntake(secret, header, 'alice', 'd1', body, now + 1000)).to.equal(true);
    });

    it('rejects a wrong secret, login, delivery or body', () => {
        const header = signQaapExternalTaskIntake(secret, 'alice', 'd1', body, now);
        expect(verifyQaapExternalTaskIntake('other', header, 'alice', 'd1', body, now)).to.equal(false);
        expect(verifyQaapExternalTaskIntake(secret, header, 'bob', 'd1', body, now)).to.equal(false);
        expect(verifyQaapExternalTaskIntake(secret, header, 'alice', 'd2', body, now)).to.equal(false);
        expect(verifyQaapExternalTaskIntake(secret, header, 'alice', 'd1', `${body} `, now)).to.equal(false);
    });

    it('rejects expired and future-skewed signatures', () => {
        const header = signQaapExternalTaskIntake(secret, 'alice', 'd1', body, now);
        expect(verifyQaapExternalTaskIntake(secret, header, 'alice', 'd1', body, now + QAAP_EXTERNAL_TASK_INTAKE_SIGNATURE_TTL_MS)).to.equal(true);
        expect(verifyQaapExternalTaskIntake(secret, header, 'alice', 'd1', body, now + QAAP_EXTERNAL_TASK_INTAKE_SIGNATURE_TTL_MS + 1)).to.equal(false);
        expect(verifyQaapExternalTaskIntake(secret, header, 'alice', 'd1', body, now - QAAP_EXTERNAL_TASK_INTAKE_SIGNATURE_TTL_MS - 1)).to.equal(false);
    });

    it('rejects malformed or missing input', () => {
        expect(verifyQaapExternalTaskIntake(secret, undefined, 'alice', 'd1', body, now)).to.equal(false);
        expect(verifyQaapExternalTaskIntake(secret, 'garbage', 'alice', 'd1', body, now)).to.equal(false);
        expect(verifyQaapExternalTaskIntake(secret, `v1.${now}.abcd`, 'alice', 'd1', body, now)).to.equal(false);
        expect(verifyQaapExternalTaskIntake(undefined, 'v1.1.' + 'a'.repeat(64), 'alice', 'd1', body, now)).to.equal(false);
    });

    it('rejects a header whose timestamp was altered', () => {
        const header = signQaapExternalTaskIntake(secret, 'alice', 'd1', body, now);
        const forged = header.replace(`v1.${now}.`, `v1.${now + 1}.`);
        expect(verifyQaapExternalTaskIntake(secret, forged, 'alice', 'd1', body, now)).to.equal(false);
    });
});
