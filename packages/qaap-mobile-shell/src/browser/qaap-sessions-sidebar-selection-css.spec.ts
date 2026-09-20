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

    it('uses the active theme surface and restores dark sidebar contrast', () => {
        expect(css).to.include('--qaap-sessions-sidebar-background: var(--theia-sideBar-background, var(--theia-editor-background, #ffffff))');
        expect(css).to.match(/body\.qaap-theme-dark \.theia-mobile-work-hub-sessions-sidebar[\s\S]*?--qaap-sessions-sidebar-background:\s*#0b0908/);
        expect(css).to.match(/\.theia-mobile-work-hub-sessions-sidebar\s*\{[^}]*background:\s*var\(--qaap-sessions-sidebar-background\)/s);
        expect(css).to.match(/\.theia-mobile-work-hub-sessions-sidebar-panel\s*\{[^}]*background:\s*var\(--qaap-sessions-sidebar-background\)/s);
        expect(css).to.match(/\.theia-mod-sessions-sidebar-projects-head\s*\{[^}]*background:\s*var\(--qaap-sessions-sidebar-background\)/s);
    });

    it('keeps the embedded mobile sidebar narrower than the viewport', () => {
        expect(css).to.match(
            /@media \(max-width: 767px\),[\s\S]*?\.theia-mobile-projects>\.theia-mobile-work-hub-sessions-sidebar\.theia-mod-embedded\s*\{[^}]*width:\s*min\(360px, 86vw\)/s,
        );
        expect(css).not.to.match(
            /@media \(max-width: 767px\),[\s\S]*?\.theia-mobile-projects>\.theia-mobile-work-hub-sessions-sidebar\.theia-mod-embedded\s*\{[^}]*width:\s*100%/s,
        );
    });

    it('animates only overflowing titles while keeping the normal ellipsis state', () => {
        expect(css).to.include('.theia-mobile-projects-task-title-text');
        expect(css).to.match(/\.theia-mobile-projects-task-title-text\s*\{[^}]*text-overflow:\s*ellipsis/s);
        expect(css).to.include('@keyframes qaap-task-title-marquee');
        expect(css).to.match(/\.theia-mod-title-overflow \.theia-mobile-projects-task-title-text\s*\{[^}]*width:\s*max-content/s);
        expect(css).to.match(/\.theia-mobile-projects-task-title\.theia-mod-title-overflow::before[\s\S]*?linear-gradient\(/s);
        expect(css).to.match(/\.theia-mobile-projects-task-title\.theia-mod-title-overflow::after[\s\S]*?linear-gradient\(/s);
    });

    it('gives resting titles more room and reserves the action slot on interaction', () => {
        expect(css).to.match(/\.theia-mobile-projects-task-row \.theia-mobile-projects-task-body\s*\{[^}]*padding-right:\s*calc\(var\(--qaap-sessions-row-gutter\) \+ 40px\)/s);
        expect(css).to.match(/\.theia-mobile-projects-task-row:hover \.theia-mobile-projects-task-body[^}]*padding-right:\s*84px/s);
        expect(css).not.to.include('theia-mobile-projects-conversation-pin-btn');
    });

    it('keeps a visible retry action from overlapping compact session titles', () => {
        expect(css).to.include('theia-mobile-projects-conversation-retry-btn');
        expect(css).to.match(/:has\(\.theia-mobile-projects-conversation-retry-btn\)[^}]*padding-right:\s*120px/s);
        expect(css).to.match(/:has\(\.theia-mobile-projects-conversation-retry-btn\)[^{}]*::after\s*\{[^}]*width:\s*136px/s);
    });
});
