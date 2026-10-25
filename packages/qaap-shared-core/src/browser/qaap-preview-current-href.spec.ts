// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveCurrentPreviewHref } from './qaap-preview-current-href';

describe('resolveCurrentPreviewHref', () => {
    const saved = 'https://oldlabel.preview.example.test/';

    it('opens the URL of the live claim at click time instead of the saved one', async () => {
        const href = await resolveCurrentPreviewHref(saved, async () => ({ previewUrl: 'https://newlabel.preview.example.test/' }));
        expect(href).to.equal('https://newlabel.preview.example.test/');
    });

    it('falls back to the saved URL when the lookup fails', async () => {
        const href = await resolveCurrentPreviewHref(saved, async () => { throw new Error('network down'); });
        expect(href).to.equal(saved);
    });

    it('falls back to the saved URL when there is no live claim', async () => {
        expect(await resolveCurrentPreviewHref(saved, async () => undefined)).to.equal(saved);
        expect(await resolveCurrentPreviewHref(saved, async () => ({}))).to.equal(saved);
    });

    it('ignores a current URL that is not an http(s) URL', async () => {
        expect(await resolveCurrentPreviewHref(saved, async () => ({ previewUrl: 'javascript:alert(1)' }))).to.equal(saved);
        expect(await resolveCurrentPreviewHref(saved, async () => ({ previewUrl: '   ' }))).to.equal(saved);
    });
});
