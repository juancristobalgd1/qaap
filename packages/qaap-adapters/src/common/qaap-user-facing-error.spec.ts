// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapUserFacingError, QaapUserFacingErrors } from './qaap-user-facing-error';

describe('QaapUserFacingErrors', () => {

    it('uses the readable error of a JSON body, not the JSON', () => {
        const parsed = QaapUserFacingErrors.parse('{"error":"Clone is missing and could not be restored"}', 500);
        expect(parsed.message).to.equal('Clone is missing and could not be restored');
        expect(parsed.code).to.equal(undefined);
    });

    it('prefers message over error and keeps the machine code', () => {
        const parsed = QaapUserFacingErrors.parse('{"error":"plan_repo_limit","message":"Your Starter plan allows 3 repositories."}', 403);
        expect(parsed.message).to.equal('Your Starter plan allows 3 repositories.');
        expect(parsed.code).to.equal('plan_repo_limit');
    });

    it('reads an explicit code field', () => {
        const parsed = QaapUserFacingErrors.parse('{"code":"plan_limit","error":"Out of credits"}', 402);
        expect(parsed.code).to.equal('plan_limit');
        expect(parsed.message).to.equal('Out of credits');
    });

    it('never shows a bare machine code', () => {
        const parsed = QaapUserFacingErrors.parse('{"error":"max_concurrent_runs"}', 429);
        expect(parsed.code).to.equal('max_concurrent_runs');
        expect(parsed.message).to.not.contain('max_concurrent_runs');
        expect(parsed.message).to.contain('429');
    });

    it('keeps plain text, stripping Error: and HTTP prefixes', () => {
        expect(QaapUserFacingErrors.parse('Error: Error: Not found').message).to.equal('Not found');
        expect(QaapUserFacingErrors.parse('502 Bad Gateway: upstream down').message).to.equal('upstream down');
    });

    it('collapses a trailing ".." and whitespace', () => {
        expect(QaapUserFacingErrors.parse('Session expired, sign in again..').message).to.equal('Session expired, sign in again.');
    });

    it('falls back for HTML or empty bodies', () => {
        expect(QaapUserFacingErrors.parse('<html><body>502</body></html>', 502, 'Bad Gateway').message).to.equal('Bad Gateway');
        expect(QaapUserFacingErrors.parse('', 500).message).to.contain('500');
        expect(QaapUserFacingErrors.parse('', undefined, undefined, 'Custom fallback').message).to.equal('Custom fallback');
    });

    it('treats malformed JSON as text', () => {
        expect(QaapUserFacingErrors.parse('{oops', 500).message).to.equal('{oops');
    });

    it('trims very long messages', () => {
        const message = QaapUserFacingErrors.parse('x'.repeat(1000)).message;
        expect(message.length).to.be.at.most(240);
        expect(message.endsWith('…')).to.equal(true);
    });

    it('fromBody keeps status, code and raw details', () => {
        const body = '{"error":"plan_repo_limit","message":"Limit reached"}';
        const error = QaapUserFacingErrors.fromBody(body, 403);
        expect(error).to.be.instanceOf(QaapUserFacingError);
        expect(error.status).to.equal(403);
        expect(error.code).to.equal('plan_repo_limit');
        expect(error.details).to.equal(body);
        expect(error.message).to.equal('Limit reached');
    });

    it('fromResponse reads the body of a failed response', async () => {
        const response = { status: 400, statusText: 'Bad Request', text: async () => '{"error":"Bad branch name"}' } as Response;
        const error = await QaapUserFacingErrors.fromResponse(response);
        expect(error.message).to.equal('Bad branch name');
        expect(error.status).to.equal(400);
    });

    it('toMessage cleans legacy raw-JSON errors and passes typed ones through', () => {
        expect(QaapUserFacingErrors.toMessage(new Error('{"error":"Nope"}'))).to.equal('Nope');
        expect(QaapUserFacingErrors.toMessage(new QaapUserFacingError('Typed'))).to.equal('Typed');
        expect(QaapUserFacingErrors.toMessage('plain')).to.equal('plain');
        expect(QaapUserFacingErrors.toMessage(undefined)).to.contain('Something went wrong');
    });

    it('toDetails exposes the raw text only when something was dropped', () => {
        expect(QaapUserFacingErrors.toDetails(new Error('{"error":"Nope"}'))).to.equal('{"error":"Nope"}');
        expect(QaapUserFacingErrors.toDetails(new Error('Nope'))).to.equal(undefined);
    });
});
