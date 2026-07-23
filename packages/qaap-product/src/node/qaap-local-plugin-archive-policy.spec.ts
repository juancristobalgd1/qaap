// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isLocalPluginArchiveInstallBlocked,
    isLocalPluginArchivePolicyEnabled,
} from './qaap-local-plugin-archive-policy';

describe('qaap-local-plugin-archive-policy', () => {
    const original = process.env.QAAP_ALLOW_LOCAL_VSIX;

    afterEach(() => {
        if (original === undefined) {
            delete process.env.QAAP_ALLOW_LOCAL_VSIX;
        } else {
            process.env.QAAP_ALLOW_LOCAL_VSIX = original;
        }
    });

    it('blocks local-file: by default', () => {
        delete process.env.QAAP_ALLOW_LOCAL_VSIX;
        expect(isLocalPluginArchivePolicyEnabled()).to.equal(true);
        expect(isLocalPluginArchiveInstallBlocked('local-file:/tmp/evil.vsix')).to.equal(true);
        expect(isLocalPluginArchiveInstallBlocked('vscode-extension:publisher.name')).to.equal(false);
    });

    it('allows local-file: when QAAP_ALLOW_LOCAL_VSIX is set', () => {
        process.env.QAAP_ALLOW_LOCAL_VSIX = '1';
        expect(isLocalPluginArchivePolicyEnabled()).to.equal(false);
        expect(isLocalPluginArchiveInstallBlocked('local-file:/tmp/ok.vsix')).to.equal(false);
    });
});
