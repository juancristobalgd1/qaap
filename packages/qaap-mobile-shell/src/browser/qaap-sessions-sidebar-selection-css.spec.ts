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

    it('uses the reference dark surface for the sessions sidebar and panel', () => {
        expect(css).to.include('--qaap-sessions-sidebar-background: var(--theia-sideBar-background, var(--theia-editor-background, #ffffff))');
        expect(css).to.include('body.qaap-theme-dark .theia-mobile-work-hub-sessions-sidebar');
        expect(css).to.include('--qaap-sessions-sidebar-background: #0b0908');
        expect(css).to.match(/\.theia-mobile-work-hub-sessions-sidebar\s*\{[^}]*background:\s*var\(--qaap-sessions-sidebar-background\)/s);
        expect(css).to.match(/\.theia-mobile-work-hub-sessions-sidebar-panel\s*\{[^}]*background:\s*var\(--qaap-sessions-sidebar-background\)/s);
        expect(css).to.match(/\.theia-mod-sessions-sidebar-projects-head\s*\{[^}]*background:\s*var\(--qaap-sessions-sidebar-background\)/s);
    });

    it('animates only overflowing titles while keeping the normal ellipsis state', () => {
        expect(css).to.include('.theia-mobile-projects-task-title-text');
        expect(css).to.match(/\.theia-mobile-projects-task-title-text\s*\{[^}]*text-overflow:\s*ellipsis/s);
        expect(css).to.include('@keyframes qaap-task-title-marquee');
        expect(css).to.match(/\.theia-mod-title-overflow \.theia-mobile-projects-task-title-text\s*\{[^}]*width:\s*max-content/s);
    });

    it('gives resting titles more room and reserves the action slot on interaction', () => {
        expect(css).to.match(/\.theia-mobile-projects-task-row \.theia-mobile-projects-task-body\s*\{[^}]*padding-right:\s*calc\(var\(--qaap-sessions-row-gutter\) \+ 40px\)/s);
        expect(css).to.match(/\.theia-mobile-projects-task-row:hover \.theia-mobile-projects-task-body[^}]*padding-right:\s*112px/s);
    });
});
