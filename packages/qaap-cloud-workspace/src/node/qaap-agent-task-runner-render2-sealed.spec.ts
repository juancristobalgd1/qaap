// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapSecretCipher, parseQaapSecretKeys } from '@theia/qaap-persistence/lib/node/qaap-secret-cipher';
import { openHelperTokens, sealHelperTokens } from './qaap-agent-task-runner-render2';

const KEY = Buffer.alloc(32, 5).toString('base64');
const cipher = new QaapSecretCipher(parseQaapSecretKeys(`k1:${KEY}`));

describe('helper task tokens sealed at rest (render2)', () => {

    it('seals every token bound to its owner and never writes the plain token', () => {
        const sealed = sealHelperTokens(new Map([['alice', 'tok-alice-123']]), cipher);
        expect(sealed.alice).to.match(/^qaapenc:v1:k1:/);
        expect(JSON.stringify(sealed)).not.to.contain('tok-alice-123');
        expect(openHelperTokens(sealed, cipher).get('alice')).to.equal('tok-alice-123');
    });

    it('accepts legacy plain tokens', () => {
        expect(openHelperTokens({ alice: 'tok-legacy' }, cipher).get('alice')).to.equal('tok-legacy');
    });

    it('skips a token moved to another owner entry instead of accepting it', () => {
        const sealed = sealHelperTokens(new Map([['alice', 'tok-alice-123']]), cipher);
        const opened = openHelperTokens({ mallory: sealed.alice }, cipher);
        expect(opened.has('mallory')).to.equal(false);
    });

    it('keeps tokens in plain text when no key is configured', () => {
        const plain = new QaapSecretCipher();
        expect(sealHelperTokens(new Map([['alice', 'tok-plain']]), plain)).to.deep.equal({ alice: 'tok-plain' });
    });
});
