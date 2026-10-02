// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

describe('Run variants dialog layout', () => {
    const css = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'mobile-workbench-conversation.css'),
        'utf8',
    );

    it('centers the modal and constrains it to the viewport at every breakpoint', () => {
        expect(css).to.match(
            /\.theia-mobile-agent-log\.theia-mobile-parallel-root\s*\{[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*box-sizing:\s*border-box;[^}]*safe-area-inset/s,
        );
        expect(css).to.match(
            /\.theia-mobile-parallel-root\s+\.theia-mobile-agent-log-sheet\.theia-mod-parallel\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*640px;[^}]*max-height:\s*min\(88vh,\s*720px\);[^}]*border-radius:\s*12px;/s,
        );
    });

    it('keeps long dialog content scrollable inside the bounded modal', () => {
        expect(css).to.match(
            /\.theia-mobile-parallel-body\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*hidden;/s,
        );
    });
});
