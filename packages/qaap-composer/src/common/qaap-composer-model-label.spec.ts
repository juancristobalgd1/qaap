// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { humanizeModelSlug } from './qaap-composer-model-label';

describe('qaap-composer-model-label', () => {
    it('reads a GPT slug as a name with the acronym kept', () => {
        expect(humanizeModelSlug('gpt-5.6-sol')).to.equal('GPT 5.6 Sol');
    });

    it('drops the provider path before humanising', () => {
        expect(humanizeModelSlug('openrouter/anthropic/claude-opus-4.6')).to.equal('Claude Opus 4.6');
        expect(humanizeModelSlug('opencode/big-pickle')).to.equal('Big Pickle');
    });

    it('returns the id when there is nothing after the provider path', () => {
        expect(humanizeModelSlug('openrouter/')).to.equal('openrouter/');
    });
});
