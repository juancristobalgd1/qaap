// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { adoptPendingComposerEffort, resolveComposerEffortLevel, writeComposerEffortLevel } from './qaap-composer-effort';

describe('qaap-composer-effort', () => {
    let disableJSDOM: () => void;

    beforeEach(() => { disableJSDOM = enableJSDOM(); });
    afterEach(() => disableJSDOM());

    it('applies an effort picked before any model to the next model of that harness', () => {
        writeComposerEffortLevel('/repo', 'codex', undefined, 'high');
        expect(resolveComposerEffortLevel('/repo', 'codex', 'gpt-5-6-sol')).to.equal('high');
        adoptPendingComposerEffort('/repo', 'codex', 'gpt-5-6-sol');
        writeComposerEffortLevel('/repo', 'codex', 'gpt-5-6-sol', 'high');
        expect(resolveComposerEffortLevel('/repo', 'codex', 'gpt-5-6-sol')).to.equal('high');
    });

    it('keeps the model own effort over the pending one', () => {
        writeComposerEffortLevel('/repo', 'codex', 'gpt-5-6-sol', 'low');
        writeComposerEffortLevel('/repo', 'codex', undefined, 'high');
        adoptPendingComposerEffort('/repo', 'codex', 'gpt-5-6-sol');
        expect(resolveComposerEffortLevel('/repo', 'codex', 'gpt-5-6-sol')).to.equal('low');
    });
});
