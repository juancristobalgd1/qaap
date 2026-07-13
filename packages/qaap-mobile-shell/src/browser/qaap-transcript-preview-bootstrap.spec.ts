// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    collectTrustedBootstrapPreviewPorts,
    extractDevPreviewPortFromUrl,
} from './qaap-transcript-preview-bootstrap';

describe('qaap-transcript-preview-bootstrap', () => {
    it('extractDevPreviewPortFromUrl reads qaap-dev proxy paths', () => {
        expect(extractDevPreviewPortFromUrl('http://localhost:3000/qaap-dev/5173/')).to.equal(5173);
        expect(extractDevPreviewPortFromUrl('http://localhost:3000/qaap-dev/5184/app')).to.equal(5184);
    });

    it('extractDevPreviewPortFromUrl reads direct localhost URLs', () => {
        expect(extractDevPreviewPortFromUrl('http://localhost:5173/')).to.equal(5173);
        expect(extractDevPreviewPortFromUrl('http://127.0.0.1:3001')).to.equal(3001);
    });

    it('only probes ports tied to the current workspace bootstrap history', () => {
        expect(collectTrustedBootstrapPreviewPorts({
            previewUrl: 'http://localhost:3000/qaap-dev/5180/',
            lastPort: 5179,
            activePort: 5180,
        })).to.deep.equal([5180, 5179]);
        expect(collectTrustedBootstrapPreviewPorts({})).to.deep.equal([]);
    });
});
