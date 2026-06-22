// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { qaapIsQuietStartupConsoleMessageForTests } from './qaap-backend-startup-log-filter';

describe('qaap-backend-startup-log-filter patterns', () => {

    it('matches common optional plugin localization failures', () => {
        const samples = [
            'Failed to load plugin localization bundles from file:///tmp/plugins/foo.',
            'Failed reading translation file from: /tmp/plugins/bar/package.nls.json Error: ENOENT',
            "Failed to localize plugin 'dbaeumer.vscode-eslint'.",
            'Could not read \'ms-python.python\' contribution \'localizations\'.',
            'The local plugin referenced by local-dir:/Users/jc/.theia/plugins does not exist.',
        ];
        for (const sample of samples) {
            expect(qaapIsQuietStartupConsoleMessageForTests(sample), sample).to.equal(true);
        }
    });

    it('does not match unrelated backend errors', () => {
        expect(qaapIsQuietStartupConsoleMessageForTests('Failed to start backend server')).to.equal(false);
    });

});
