// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

describe('execution surface sidebar CSS', () => {
    const workHubCss = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'mobile-workbench-work-hub.css'),
        'utf8',
    );

    it('keeps the Files drawer header compact while preserving safe-area padding', () => {
        expect(workHubCss).to.match(
            /\.theia-mobile-execution-surface-sidebar-header\s*\{[^}]*gap:\s*8px;[^}]*min-height:\s*44px;[^}]*padding:\s*max\(4px,\s*env\(safe-area-inset-top,\s*0px\)\)[^}]*4px\s+max\(12px,\s*env\(safe-area-inset-left,\s*0px\)\)/s,
        );
    });
});
