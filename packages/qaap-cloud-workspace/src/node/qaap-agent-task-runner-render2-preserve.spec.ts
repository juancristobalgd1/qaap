// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapSecretCipher, parseQaapSecretKeys } from '@theia/qaap-persistence/lib/node/qaap-secret-cipher';
import { openHelperTokens, sealHelperTokens } from './qaap-agent-task-runner-render2';

const KEY_1 = Buffer.alloc(32, 8).toString('base64');
const KEY_2 = Buffer.alloc(32, 9).toString('base64');
const k1 = new QaapSecretCipher(parseQaapSecretKeys(`k1:${KEY_1}`));
const k2 = new QaapSecretCipher(parseQaapSecretKeys(`k2:${KEY_2}`));

describe('helper task tokens: unreadable entries are never overwritten or dropped (render2)', () => {

    it('keeps an unreadable sealed token verbatim when a new token is persisted for another owner', () => {
        const stored = sealHelperTokens(new Map([['alice', 'tok-alice']]), k1);
        const aliceEnvelope = stored.alice;
        // Running with the rotated key set: alice is unreadable, bob is new.
        expect(openHelperTokens(stored, k2).has('alice')).to.equal(false);
        const persisted = sealHelperTokens(new Map([['bob', 'tok-bob']]), k2, stored);
        expect(persisted.alice).to.equal(aliceEnvelope);
        expect(k1.decrypt(persisted.alice, 'task-token:alice')).to.equal('tok-alice');
        expect(persisted.bob).to.match(/^qaapenc:v1:k2:/);
    });

    it('does not persist an in-memory token over an unreadable entry; the original opens again after rotation back', () => {
        const stored = sealHelperTokens(new Map([['alice', 'tok-alice']]), k1);
        const persisted = sealHelperTokens(new Map([['alice', 'tok-issued-in-memory']]), k2, stored);
        expect(persisted.alice).to.equal(stored.alice);
        expect(openHelperTokens(persisted, k1).get('alice')).to.equal('tok-alice');
    });

    it('still overwrites an entry this process can open (normal rotation of the in-memory token)', () => {
        const stored = sealHelperTokens(new Map([['alice', 'tok-old']]), k1);
        const persisted = sealHelperTokens(new Map([['alice', 'tok-new']]), k1, stored);
        expect(openHelperTokens(persisted, k1).get('alice')).to.equal('tok-new');
    });
});
