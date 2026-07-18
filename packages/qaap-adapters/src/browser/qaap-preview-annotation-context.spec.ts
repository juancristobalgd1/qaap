// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { buildAnnotateChatAttachArgs } from './qaap-preview-annotation-context';
import type { PreviewAnnotation } from './qaap-preview-annotation-types';

function annotation(partial: Partial<PreviewAnnotation> & Pick<PreviewAnnotation, 'id' | 'comment'>): PreviewAnnotation {
    return {
        workspaceId: 'ws',
        threadId: 't1',
        previewId: 'http://localhost:3001/',
        previewUrl: 'http://localhost:3001/',
        route: '/home',
        viewport: { mode: 'mobile', width: 390, height: 844 },
        anchor: { kind: 'page', documentXRatio: 0.2, documentYRatio: 0.3 },
        documentXRatio: 0.2,
        documentYRatio: 0.3,
        status: 'confirmed',
        createdAt: Date.now(),
        ...partial,
    };
}

describe('qaap-preview-annotation-context', () => {
    it('buildAnnotateChatAttachArgs returns undefined without confirmed annotations', () => {
        expect(buildAnnotateChatAttachArgs([], '/home', 'mobile')).to.equal(undefined);
    });

    it('buildAnnotateChatAttachArgs includes optional screenshot images for Send', () => {
        const confirmed = [
            annotation({ id: 'a1', comment: 'Move button' }),
            annotation({ id: 'a2', comment: 'Fix padding' }),
        ];
        const withoutImages = buildAnnotateChatAttachArgs(confirmed, '/home', 'mobile');
        expect(withoutImages?.submit).to.equal(true);
        expect(withoutImages?.images).to.equal(undefined);
        expect(withoutImages?.dedupeKey).to.contain('a1');
        expect(withoutImages?.contextBody).to.contain('Move button');

        const withImages = buildAnnotateChatAttachArgs(confirmed, '/home', 'mobile', [{
            name: 'preview-screenshot.png',
            mimeType: 'image/png',
            data: 'ZmFrZQ==',
        }]);
        expect(withImages?.images).to.have.length(1);
        expect(withImages?.images?.[0]?.name).to.equal('preview-screenshot.png');
    });
});
