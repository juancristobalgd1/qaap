// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveListenerInRootExtracted } from './qaap-dev-preview-endpoint-render';
import type { QaapDevPreviewEndpointContext } from './qaap-dev-preview-endpoint-context';

describe('qaap-dev-preview listener-in-root evidence', () => {
    const ctxWith = (cwds: string[]): { ctx: QaapDevPreviewEndpointContext; lookups: () => number } => {
        let calls = 0;
        const ctx = { resolvePortListenerCwds: () => { calls++; return cwds; } } as unknown as QaapDevPreviewEndpointContext;
        return { ctx, lookups: () => calls };
    };

    it('accepts a listener running in the project root, given as a file URI or a path', () => {
        expect(resolveListenerInRootExtracted(ctxWith(['/work/app']).ctx, 5173, 'local', 'file:///work/app')).to.equal(true);
        expect(resolveListenerInRootExtracted(ctxWith(['/work/app']).ctx, 5173, 'local', '/work/app')).to.equal(true);
    });

    it('accepts a subfolder app of the project', () => {
        expect(resolveListenerInRootExtracted(ctxWith(['/work/app/apps/web']).ctx, 5173, 'local', 'file:///work/app')).to.equal(true);
    });

    it('rejects a foreign listener, a sibling with a shared prefix, a partial answer and a relative root', () => {
        expect(resolveListenerInRootExtracted(ctxWith(['/work/kalea-social/api']).ctx, 3000, 'local', 'file:///work/app')).to.equal(false);
        expect(resolveListenerInRootExtracted(ctxWith(['/work/app-other']).ctx, 3000, 'local', 'file:///work/app')).to.equal(false);
        expect(resolveListenerInRootExtracted(ctxWith(['/work/app', '/elsewhere']).ctx, 3000, 'local', 'file:///work/app')).to.equal(false);
        expect(resolveListenerInRootExtracted(ctxWith([]).ctx, 3000, 'local', 'file:///work/app')).to.equal(false);
        expect(resolveListenerInRootExtracted(ctxWith(['/work/app']).ctx, 3000, 'local', 'work/app')).to.equal(false);
    });

    it('looks the listener up once per port and root within the cache window', () => {
        const { ctx, lookups } = ctxWith(['/work/app']);
        resolveListenerInRootExtracted(ctx, 5173, 'local', 'file:///work/app');
        resolveListenerInRootExtracted(ctx, 5173, 'local', 'file:///work/app');
        expect(lookups()).to.equal(1);
    });
});
