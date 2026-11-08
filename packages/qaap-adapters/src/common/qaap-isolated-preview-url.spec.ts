// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { parseQaapIsolatedPreviewUrl } from './qaap-isolated-preview-url';

const HOST_LABEL = '0123456789abcdef0123456789abcdef';

describe('parseQaapIsolatedPreviewUrl', () => {
    it('recognizes an isolated preview on a production base domain', () => {
        expect(parseQaapIsolatedPreviewUrl(`https://${HOST_LABEL}.previews.qaap.example/app?x=1#h`, 'https://qaap.example'))
            .to.deep.equal({
                hostLabel: HOST_LABEL,
                origin: `https://${HOST_LABEL}.previews.qaap.example`,
                targetPath: '/app?x=1#h',
            });
    });

    it('recognizes an isolated preview on the local loopback base with a port', () => {
        expect(parseQaapIsolatedPreviewUrl(`http://${HOST_LABEL}.localhost:3101/`, 'http://localhost:3101'))
            .to.deep.equal({
                hostLabel: HOST_LABEL,
                origin: `http://${HOST_LABEL}.localhost:3101`,
                targetPath: '/',
            });
        expect(parseQaapIsolatedPreviewUrl(`http://${HOST_LABEL}.localhost:3101/docs/?q=a`)?.targetPath).to.equal('/docs/?q=a');
    });

    it('ignores plain localhost and same-origin URLs', () => {
        expect(parseQaapIsolatedPreviewUrl('http://localhost:3101/qaap-preview/u-alice-w-x-1/')).to.equal(undefined);
        expect(parseQaapIsolatedPreviewUrl('http://localhost:5173/')).to.equal(undefined);
        expect(parseQaapIsolatedPreviewUrl(`http://${HOST_LABEL}.localhost:3101/`, `http://${HOST_LABEL}.localhost:3101`)).to.equal(undefined);
    });

    it('still rejects a single-label base other than localhost and non-preview hosts', () => {
        expect(parseQaapIsolatedPreviewUrl(`https://${HOST_LABEL}.example/`)).to.equal(undefined);
        expect(parseQaapIsolatedPreviewUrl(`http://${HOST_LABEL}.local/`)).to.equal(undefined);
        expect(parseQaapIsolatedPreviewUrl(`http://${HOST_LABEL.slice(1)}.localhost:3101/`)).to.equal(undefined);
        expect(parseQaapIsolatedPreviewUrl('http://localhost:3101/')).to.equal(undefined);
        expect(parseQaapIsolatedPreviewUrl('https://example.com/')).to.equal(undefined);
    });
});
