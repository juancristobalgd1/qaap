// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { buildQaapPreviewId } from './qaap-preview-identity';
import { formatQaapPreviewRoutes, parseQaapPreviewRoutes, qaapPreviewRouteMatchesTenant } from './qaap-preview-route';

describe('qaap-preview-route', () => {
    const alicePreview = buildQaapPreviewId({
        userId: 'Alice', workspaceId: 'file:///w', projectId: 'file:///w', conversationId: 'c', processId: '1b2c3d4e-0000-0000-0000-000000000000',
    });

    it('round-trips preview ids and share tokens', () => {
        const header = formatQaapPreviewRoutes([{ kind: 'preview', id: alicePreview }, { kind: 'share', id: 'AbCdEfGh_123-xy' }]);
        expect(parseQaapPreviewRoutes(header)).to.deep.equal([
            { kind: 'preview', id: alicePreview },
            { kind: 'share', id: 'AbCdEfGh_123-xy' },
        ]);
    });

    it('drops malformed, unknown-kind and oversized entries', () => {
        expect(parseQaapPreviewRoutes('preview:Not_A_Label, share:short, host:x, share:../../etc, garbage')).to.deep.equal([]);
        expect(formatQaapPreviewRoutes([{ kind: 'share', id: 'bad token!' }])).to.equal('');
        const many = Array.from({ length: 20 }, (_, index) => `share:token-${String(index).padStart(4, '0')}`).join(',');
        expect(parseQaapPreviewRoutes(many)).to.have.length(8);
        expect(parseQaapPreviewRoutes(undefined)).to.deep.equal([]);
    });

    it('accepts a process preview id only for the tenant it names', () => {
        expect(qaapPreviewRouteMatchesTenant({ kind: 'preview', id: alicePreview }, 'alice')).to.equal(true);
        expect(qaapPreviewRouteMatchesTenant({ kind: 'preview', id: alicePreview }, 'mallory')).to.equal(false);
        // Shares and legacy ids carry no owner; they rely on unguessability + first-wins.
        expect(qaapPreviewRouteMatchesTenant({ kind: 'share', id: 'AbCdEfGh_123-xy' }, 'mallory')).to.equal(true);
    });
});
