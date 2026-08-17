// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

describe('sessions sidebar selection CSS', () => {

    const css = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-work-hub-sessions-sidebar.css'),
        'utf8',
    );

    it('uses one gutter token for project rows, session pills, and list chrome', () => {
        expect(css).to.include('--qaap-sessions-row-gutter: 8px');
        expect(css).to.match(/\.theia-mobile-projects-chats-list\s*\{[^}]*padding:\s*0 var\(--qaap-sessions-row-gutter\)/s);
        expect(css).to.match(/\.theia-mobile-work-hub-sessions-sidebar-project-row-wrap\s*\{[^}]*margin:\s*0 var\(--qaap-sessions-row-gutter\)/s);
        expect(css).to.match(/\.theia-mobile-work-hub-sessions-sidebar-project-row-wrap\s*\{[^}]*padding:\s*0 var\(--qaap-sessions-row-gutter\)/s);
    });

    it('fills the selected session pill without an extra horizontal inset', () => {
        expect(css).to.match(
            /\.theia-mobile-projects-task-row\.theia-mod-current::before\s*\{[^}]*inset:\s*0;/s,
        );
        expect(css).not.to.match(
            /\.theia-mobile-projects-task-row\.theia-mod-current::before\s*\{[^}]*inset:\s*0 8px/s,
        );
    });
});
