// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_PI_LOGIN_PROVIDERS } from './qaap-pi-login-providers';
import { resolvePiProviderMarkSvg } from './qaap-pi-provider-marks';

describe('resolvePiProviderMarkSvg', () => {
    it('has a mark for every Pi provider but TypeSafe (monogram)', () => {
        const missing = QAAP_PI_LOGIN_PROVIDERS.filter(provider => !resolvePiProviderMarkSvg(provider.id)).map(provider => provider.id);
        expect(missing).to.deep.equal(['typesafe']);
    });

    it('only ships inert, theme-following markup: <svg> with <path> children filled with currentColor', () => {
        for (const provider of QAAP_PI_LOGIN_PROVIDERS) {
            const svg = resolvePiProviderMarkSvg(provider.id);
            if (!svg) {
                continue;
            }
            expect(svg, provider.id).to.match(/^<svg [^>]*>(<path [^<>]*\/>)+<\/svg>$/);
            expect(svg, provider.id).to.contain('fill="currentColor"');
            expect(svg, provider.id).not.to.match(/script|href|style=|on[a-z]+=/i);
        }
    });

    it('resolves ids case-insensitively and returns nothing for an unknown provider', () => {
        expect(resolvePiProviderMarkSvg(' OpenRouter ')).to.equal(resolvePiProviderMarkSvg('openrouter'));
        expect(resolvePiProviderMarkSvg('unknown-provider')).to.equal(undefined);
    });
});
