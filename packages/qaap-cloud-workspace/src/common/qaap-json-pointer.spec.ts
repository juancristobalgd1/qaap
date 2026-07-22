// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isValidQaapJsonPointer,
    replaceQaapJsonPointer,
    resolveQaapJsonPointer,
} from './qaap-json-pointer';

describe('qaap-json-pointer', () => {

    it('resolves escaped RFC 6901 object keys and array indexes', () => {
        const value = { 'a/b': { '~key': [4, 7] } };
        expect(resolveQaapJsonPointer(value, '/a~1b/~0key/1')).to.deep.equal({ found: true, value: 7 });
    });

    it('immutably replaces only an existing target', () => {
        const original = { config: { threshold: 1 }, untouched: true };
        const replaced = replaceQaapJsonPointer(original, '/config/threshold', 9);

        expect(replaced).to.deep.equal({ found: true, value: { config: { threshold: 9 }, untouched: true } });
        expect(original.config.threshold).to.equal(1);
        expect(replaceQaapJsonPointer(original, '/config/missing', 9).found).to.equal(false);
    });

    it('rejects malformed escapes and prototype mutation targets', () => {
        expect(isValidQaapJsonPointer('/bad~2escape')).to.equal(false);
        expect(replaceQaapJsonPointer({ safe: {} }, '/safe/__proto__', { polluted: true }).found).to.equal(false);
        expect(({} as { polluted?: boolean }).polluted).to.equal(undefined);
    });
});
