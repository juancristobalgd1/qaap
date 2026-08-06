// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapTerminalEnvironmentContribution } from './qaap-terminal-environment-contribution';

describe('QaapTerminalEnvironmentContribution', () => {
    const originalPrefix = process.env.npm_config_prefix;

    afterEach(() => {
        if (originalPrefix === undefined) {
            delete process.env.npm_config_prefix;
        } else {
            process.env.npm_config_prefix = originalPrefix;
        }
    });

    it('removes the npm prefix inherited by the IDE backend', () => {
        process.env.npm_config_prefix = '/Users/jc/qaap/examples/browser';

        new QaapTerminalEnvironmentContribution().initialize();

        expect(process.env.npm_config_prefix).to.be.undefined;
    });
});
