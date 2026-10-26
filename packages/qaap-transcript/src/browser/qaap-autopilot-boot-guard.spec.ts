// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { isPreviewRootBootingInBootstrap } from './qaap-autopilot-boot-guard';

describe('isPreviewRootBootingInBootstrap', () => {
    const ROOT = '/workspace/app';
    const ROOT_URI = URI.fromFilePath(ROOT).toString();

    it('is true while the same root is starting', () => {
        expect(isPreviewRootBootingInBootstrap('starting', ROOT_URI, ROOT)).to.equal(true);
    });

    it('is true while the install of the same root runs', () => {
        expect(isPreviewRootBootingInBootstrap('installing', ROOT_URI, ROOT)).to.equal(true);
    });

    it('is false once the preview runs or is idle', () => {
        expect(isPreviewRootBootingInBootstrap('running', ROOT_URI, ROOT)).to.equal(false);
        expect(isPreviewRootBootingInBootstrap('ready-to-run', ROOT_URI, ROOT)).to.equal(false);
        expect(isPreviewRootBootingInBootstrap('idle', ROOT_URI, ROOT)).to.equal(false);
    });

    it('is false for a different root, so another project is not held back', () => {
        expect(isPreviewRootBootingInBootstrap('starting', ROOT_URI, '/workspace/other')).to.equal(false);
    });

    it('is false when the root or the descriptor is unknown', () => {
        expect(isPreviewRootBootingInBootstrap('starting', undefined, ROOT)).to.equal(false);
        expect(isPreviewRootBootingInBootstrap('starting', ROOT_URI, undefined)).to.equal(false);
    });
});
