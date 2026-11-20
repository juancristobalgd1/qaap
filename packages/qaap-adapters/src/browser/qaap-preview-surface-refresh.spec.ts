// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { rebaseQaapPreviewUrl } from './qaap-preview-surface-refresh';

describe('rebaseQaapPreviewUrl', () => {
    it('moves route, query and hash to the new isolated hostname and drops the cache bust', () => {
        expect(rebaseQaapPreviewUrl('http://old.localhost:5000/items/7?tab=2&_qaap_cache_bust=9#top', 'http://new.localhost:5000/'))
            .to.equal('http://new.localhost:5000/items/7?tab=2#top');
    });

    it('moves the route between identity-prefixed URLs and to and from isolated hosts', () => {
        expect(rebaseQaapPreviewUrl('http://localhost:3000/qaap-preview/u-old/items?x=1', 'http://localhost:3000/qaap-preview/u-new/'))
            .to.equal('http://localhost:3000/qaap-preview/u-new/items?x=1');
        expect(rebaseQaapPreviewUrl('http://localhost:3000/qaap-preview/u-old/items', 'http://new.localhost:3000/'))
            .to.equal('http://new.localhost:3000/items');
    });

    it('falls back to the new base without a usable current URL', () => {
        expect(rebaseQaapPreviewUrl(undefined, 'http://new.localhost:5000/')).to.equal('http://new.localhost:5000/');
        expect(rebaseQaapPreviewUrl('not a url', 'http://new.localhost:5000/')).to.equal('http://new.localhost:5000/');
    });
});
