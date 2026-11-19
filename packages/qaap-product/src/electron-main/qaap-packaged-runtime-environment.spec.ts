// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as path from 'path';
import { applyQaapPackagedRuntimeEnvironment, resolveQaapPackagedRuntimeEnvironment } from './qaap-packaged-runtime-environment';

const resourcesPath = path.join('/Applications', 'Qaap.app', 'Contents', 'Resources');
const pluginsDirectory = path.join(resourcesPath, 'plugins');

describe('resolveQaapPackagedRuntimeEnvironment', () => {

    it('adds nothing to a development run', () => {
        expect(resolveQaapPackagedRuntimeEnvironment({ isPackaged: false, resourcesPath, env: {}, directoryExists: () => true })).to.deep.equal({});
    });

    it('sets the desktop runtime, local mode and the bundled plugins for an installed build', () => {
        expect(resolveQaapPackagedRuntimeEnvironment({ isPackaged: true, resourcesPath, env: {}, directoryExists: () => true })).to.deep.equal({
            QAAP_DESKTOP: '1',
            QAAP_SKIP_AUTH: '1',
            THEIA_DEFAULT_PLUGINS: `local-dir:${pluginsDirectory}`
        });
    });

    it('does not point at a plugins folder that is not there', () => {
        const additions = resolveQaapPackagedRuntimeEnvironment({ isPackaged: true, resourcesPath, env: {}, directoryExists: () => false });
        expect(additions).to.not.have.property('THEIA_DEFAULT_PLUGINS');
    });

    it('never overrides a variable the operator already set', () => {
        const additions = resolveQaapPackagedRuntimeEnvironment({
            isPackaged: true,
            resourcesPath,
            env: { QAAP_DESKTOP: 'true', QAAP_SKIP_AUTH: '0', THEIA_DEFAULT_PLUGINS: 'local-dir:/custom' },
            directoryExists: () => true
        });
        expect(additions).to.deep.equal({});
    });

    it('applies the additions to the given environment object', () => {
        const env: NodeJS.ProcessEnv = {};
        applyQaapPackagedRuntimeEnvironment({ isPackaged: true, resourcesPath, env, directoryExists: () => true });
        expect(env.QAAP_DESKTOP).to.equal('1');
        expect(env.QAAP_SKIP_AUTH).to.equal('1');
    });
});
