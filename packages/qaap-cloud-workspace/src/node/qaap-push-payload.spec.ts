// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_PUSH_BODY_MAX_LENGTH, QAAP_PUSH_TITLE_MAX_LENGTH, sanitizeQaapPushRequest, sanitizeQaapPushUrl } from './qaap-push-payload';

describe('Qaap push payload sanitizer', () => {

    it('cuts title and body to their limits', () => {
        const sanitized = sanitizeQaapPushRequest({ title: 'x'.repeat(500), body: 'y'.repeat(5_000) });
        expect(sanitized?.title).to.have.length(QAAP_PUSH_TITLE_MAX_LENGTH);
        expect(sanitized?.body).to.have.length(QAAP_PUSH_BODY_MAX_LENGTH);
    });

    it('rejects a request without a usable title or body', () => {
        expect(sanitizeQaapPushRequest({ title: '', body: 'b' })).to.equal(undefined);
        expect(sanitizeQaapPushRequest({ title: 't', body: 42 })).to.equal(undefined);
        expect(sanitizeQaapPushRequest(undefined)).to.equal(undefined);
    });

    it('drops a recipient field supplied by the caller', () => {
        const sanitized = sanitizeQaapPushRequest({ title: 't', body: 'b', userLogin: 'mallory' });
        expect(sanitized).to.not.have.property('userLogin');
    });

    it('keeps only same-origin relative paths as url', () => {
        expect(sanitizeQaapPushUrl('/conversation/42')).to.equal('/conversation/42');
        expect(sanitizeQaapPushUrl('https://evil.example/x')).to.equal(undefined);
        expect(sanitizeQaapPushUrl('//evil.example/x')).to.equal(undefined);
        expect(sanitizeQaapPushUrl('/\\evil.example')).to.equal(undefined);
        expect(sanitizeQaapPushUrl('/x\u0007')).to.equal(undefined);
        expect(sanitizeQaapPushUrl(`/${'a'.repeat(600)}`)).to.equal(undefined);
    });
});
