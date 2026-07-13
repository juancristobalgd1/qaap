// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { qaapPreviewFrameMatchesUrl } from './qaap-preview-surface-match';

describe('qaapPreviewFrameMatchesUrl', () => {
    it('matches direct and proxied URLs by the selected dev port', () => {
        expect(qaapPreviewFrameMatchesUrl(
            { src: 'http://localhost:3000/qaap-dev/5180/dashboard' },
            'http://localhost:5180/',
        )).to.equal(true);
        expect(qaapPreviewFrameMatchesUrl(
            { src: 'http://localhost:3000/qaap-dev/5173/' },
            'http://localhost:3000/qaap-dev/5180/',
        )).to.equal(false);
    });

    it('rejects suspended and empty preview frames', () => {
        expect(qaapPreviewFrameMatchesUrl({ src: 'about:blank' }, 'http://localhost:5173/')).to.equal(false);
        expect(qaapPreviewFrameMatchesUrl({ src: '' }, 'http://localhost:5173/')).to.equal(false);
    });
});
