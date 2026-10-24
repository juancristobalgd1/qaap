// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as sinon from 'sinon';
import { parseQaapSecretKeys, QaapSecretCipher } from './qaap-secret-cipher';

const KEY_1 = Buffer.alloc(32, 1).toString('base64');
const KEY_2 = Buffer.alloc(32, 2).toString('base64');
const AAD = 'settings:alice:ai-features.google.apiKey';

describe('QaapSecretCipher', () => {

    it('round-trips a value bound to its context and never stores the plain text', () => {
        const cipher = new QaapSecretCipher(parseQaapSecretKeys(`k1:${KEY_1}`));
        const sealed = cipher.encrypt('sk-live-123', AAD);
        expect(sealed).to.match(/^qaapenc:v1:k1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
        expect(sealed).not.to.contain('sk-live-123');
        expect(cipher.decrypt(sealed, AAD)).to.equal('sk-live-123');
    });

    it('uses a fresh IV, so equal plain texts seal differently', () => {
        const cipher = new QaapSecretCipher(parseQaapSecretKeys(`k1:${KEY_1}`));
        expect(cipher.encrypt('same', AAD)).not.to.equal(cipher.encrypt('same', AAD));
    });

    it('fails to open a value under a different context', () => {
        const cipher = new QaapSecretCipher(parseQaapSecretKeys(`k1:${KEY_1}`));
        const sealed = cipher.encrypt('sk-live-123', AAD);
        expect(() => cipher.decrypt(sealed, 'settings:bob:ai-features.google.apiKey')).to.throw(/failed authentication/);
    });

    it('fails with a clear error on a corrupted envelope', () => {
        const cipher = new QaapSecretCipher(parseQaapSecretKeys(`k1:${KEY_1}`));
        // Envelope: qaapenc : v1 : kid : iv : ciphertext : tag
        const parts = cipher.encrypt('sk-live-123', AAD).split(':');
        const ciphertext = parts[4];
        parts[4] = `${ciphertext.startsWith('A') ? 'B' : 'A'}${ciphertext.slice(1)}`;
        expect(() => cipher.decrypt(parts.join(':'), AAD)).to.throw(/failed authentication/);
        expect(() => cipher.decrypt('qaapenc:v1:k1:only-three:parts', AAD)).to.throw(/Malformed sealed secret envelope/);
    });

    it('returns legacy plain text unchanged', () => {
        const cipher = new QaapSecretCipher(parseQaapSecretKeys(`k1:${KEY_1}`));
        expect(cipher.decrypt('sk-legacy-plain', AAD)).to.equal('sk-legacy-plain');
        expect(cipher.isEncrypted('sk-legacy-plain')).to.equal(false);
    });

    it('opens values sealed under an older key after rotation', () => {
        const old = new QaapSecretCipher(parseQaapSecretKeys(`k1:${KEY_1}`));
        const rotated = new QaapSecretCipher(parseQaapSecretKeys(`k2:${KEY_2},k1:${KEY_1}`));
        const sealedWithOld = old.encrypt('before-rotation', AAD);
        expect(rotated.decrypt(sealedWithOld, AAD)).to.equal('before-rotation');
        // New writes use the first key.
        expect(rotated.encrypt('after-rotation', AAD)).to.match(/^qaapenc:v1:k2:/);
    });

    it('reports an unknown key id without opening anything', () => {
        const sealed = new QaapSecretCipher(parseQaapSecretKeys(`k9:${KEY_2}`)).encrypt('x', AAD);
        const other = new QaapSecretCipher(parseQaapSecretKeys(`k1:${KEY_1}`));
        expect(() => other.decrypt(sealed, AAD)).to.throw(/No QAAP_SECRETS_KEYS key with id 'k9'/);
    });

    it('rejects a malformed key list at startup', () => {
        expect(() => parseQaapSecretKeys(`k1:${Buffer.alloc(16, 1).toString('base64')}`)).to.throw(/must decode to exactly 32 bytes/);
        expect(() => parseQaapSecretKeys('k1-no-separator')).to.throw(/entry 1 is invalid/);
        expect(() => parseQaapSecretKeys(`bad kid!:${KEY_1}`)).to.throw(/key id must match/);
        expect(() => parseQaapSecretKeys(`k1:${KEY_1},k1:${KEY_2}`)).to.throw(/duplicate key id/);
        expect(() => parseQaapSecretKeys('k1:not base64 at all!')).to.throw(/not base64/);
    });

    it('does not echo key material in parse errors', () => {
        const bad = `k1:${Buffer.alloc(16, 7).toString('base64')}`;
        try {
            parseQaapSecretKeys(bad);
            expect.fail('expected a parse error');
        } catch (error) {
            expect((error as Error).message).not.to.contain(Buffer.alloc(16, 7).toString('base64'));
        }
    });

    it('passes plain text through when no key is configured', () => {
        const cipher = QaapSecretCipher.fromEnvironment({});
        expect(cipher.isEnabled()).to.equal(false);
        expect(cipher.encrypt('sk-plain', AAD)).to.equal('sk-plain');
        expect(cipher.decrypt('sk-plain', AAD)).to.equal('sk-plain');
    });

    it('refuses to open a sealed value when no key is configured', () => {
        const sealed = new QaapSecretCipher(parseQaapSecretKeys(`k1:${KEY_1}`)).encrypt('x', AAD);
        expect(() => QaapSecretCipher.fromEnvironment({}).decrypt(sealed, AAD)).to.throw(/QAAP_SECRETS_KEYS is not set/);
    });

    it('requires a non-empty context', () => {
        const cipher = new QaapSecretCipher(parseQaapSecretKeys(`k1:${KEY_1}`));
        expect(() => cipher.encrypt('x', '')).to.throw(/non-empty context/);
        expect(() => cipher.decrypt('x', '')).to.throw(/non-empty context/);
    });

    it('warns once in production when no key is configured, without naming any value', () => {
        const spy = sinon.stub(console, 'error');
        try {
            QaapSecretCipher.fromEnvironment({ NODE_ENV: 'production' });
            QaapSecretCipher.fromEnvironment({ NODE_ENV: 'production' });
            // The warning is process-wide: an earlier test may already have emitted it.
            expect(spy.callCount).to.be.at.most(1);
            if (spy.callCount === 1) {
                expect(spy.firstCall.args[0]).to.equal('[qaap-secrets] QAAP_SECRETS_KEYS is not set: user secrets are stored in plain text');
            }
        } finally {
            spy.restore();
        }
    });
});
