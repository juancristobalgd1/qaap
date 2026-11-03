// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    clearComposerDraftRestored,
    isComposerDraftRestored,
    markComposerDraftRestored,
    resolveComposerRestoredDraftKey,
} from './qaap-composer-restored-draft';

describe('qaap-composer-restored-draft', () => {
    it('scopes the shared idle summary by project and keeps conversations apart', () => {
        expect(resolveComposerRestoredDraftKey('p1', '__idle__', true)).to.equal('project:p1');
        expect(resolveComposerRestoredDraftKey('p2', '__idle__', true)).to.equal('project:p2');
        expect(resolveComposerRestoredDraftKey('p1', 'c1', false)).to.equal('conversation:c1');
    });

    it('marks a restored draft until it is cleared by a send or a clear', () => {
        const key = resolveComposerRestoredDraftKey('p1', 'restore-spec-c1', false);
        expect(isComposerDraftRestored(key)).to.equal(false);
        markComposerDraftRestored(key);
        expect(isComposerDraftRestored(key)).to.equal(true);
        clearComposerDraftRestored(key);
        expect(isComposerDraftRestored(key)).to.equal(false);
    });
});
