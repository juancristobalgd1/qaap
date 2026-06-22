// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';

describe('qaap-backend-startup-log-filter patterns', () => {

    const patterns = [
        /^Failed to load plugin localization bundles from /,
        /^Failed reading translation file from: /,
        /^Failed to localize plugin '/,
        /^Failed to load translation from: /,
        /^Could not read '.*' contribution 'localizations'\./,
    ];

    it('matches common optional plugin localization failures', () => {
        const samples = [
            'Failed to load plugin localization bundles from file:///tmp/plugins/foo.',
            'Failed reading translation file from: /tmp/plugins/bar/package.nls.json Error: ENOENT',
            "Failed to localize plugin 'dbaeumer.vscode-eslint'.",
            'Could not read \'ms-python.python\' contribution \'localizations\'.',
        ];
        for (const sample of samples) {
            expect(patterns.some(pattern => pattern.test(sample)), sample).to.equal(true);
        }
    });

    it('does not match unrelated backend errors', () => {
        expect(patterns.some(pattern => pattern.test('Failed to start backend server'))).to.equal(false);
    });

});
