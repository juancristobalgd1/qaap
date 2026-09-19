// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

describe('header IDE/Agents switch CSS', () => {

    const projectsCss = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'mobile-workbench-projects.css'),
        'utf8',
    );
    const sidebarCss = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-work-hub-sessions-sidebar.css'),
        'utf8',
    );
    const ideCss = fs.readFileSync(
        path.join(__dirname, '..', '..', '..', 'qaap-product-theme', 'src', 'browser', 'style', 'qaap-workbench-top-bar.css'),
        'utf8',
    );
    const workHubCss = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'mobile-workbench-work-hub.css'),
        'utf8',
    );
    const conversationCss = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'mobile-workbench-conversation.css'),
        'utf8',
    );
    const legacyWorkbenchCss = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'mobile-workbench.css'),
        'utf8',
    );

    it('centers the Work Hub switch like the IDE top bar', () => {
        expect(projectsCss).to.match(
            /\.theia-mobile-projects-header-ide-agents-switch\s*\{[^}]*position:\s*absolute;[^}]*left:\s*50%;[^}]*transform:\s*translateX\(-50%\)/s,
        );
        expect(ideCss).to.include('workbench-view-mode-center');
        expect(ideCss).to.match(/left:\s*50%/);
        expect(ideCss).to.match(/transform:\s*translateX\(-50%\)/);
    });

    it('keeps the shared switch compact for icon-only controls', () => {
        expect(ideCss).to.match(
            /\.theia-workbench-view-mode-switch\s*\{[^}]*width:\s*72px;[^}]*max-width:\s*72px/s,
        );
        expect(ideCss).to.match(
            /@container \(max-width:\s*104px\)[\s\S]*?\.theia-workbench-view-mode-switch \.theia-qaap-segmented-option-label\s*\{[^}]*display:\s*none/s,
        );
        expect(ideCss).to.match(
            /\.theia-workbench-view-mode-switch \.theia-qaap-segmented-option-label\s*\{[^}]*display:\s*none/s,
        );
        expect(ideCss).to.match(
            /\.theia-workbench-view-mode-switch \.theia-qaap-segmented-option\s*\{[^}]*flex:\s*0 0 28px;[^}]*width:\s*28px;[^}]*padding:\s*5px 4px/s,
        );
    });

    it('does not keep the IDE/Agents switch in the sessions sidebar', () => {
        expect(sidebarCss).not.to.include('.theia-mobile-work-hub-sessions-sidebar-view-switch');
    });

    it('pins the execution cluster to the right of the header, away from the switch', () => {
        expect(projectsCss).to.match(
            /\.theia-mobile-projects-header-execution-cluster\s*\{[^}]*margin-left:\s*auto/s,
        );
        expect(projectsCss).to.match(
            /\.theia-mobile-projects-header-main:has\(\.theia-mobile-projects-header-ide-agents-switch:not\(\[hidden\]\)\)\s+\.theia-mobile-projects-header-execution-cluster\s*\{[^}]*margin-left:\s*auto/s,
        );
        expect(workHubCss).to.match(
            /\.theia-mobile-projects\.theia-mod-agents-hub-shell-active\s+\.theia-mobile-projects-header-execution-cluster,[\s\S]*?\.qaap-work-hub-chat-view-widget\s+\.theia-mobile-projects-header-execution-cluster\s*\{[^}]*margin-left:\s*auto/s,
        );
        expect(projectsCss).to.include('.theia-mobile-projects-header-actions:not(:has(> :not([hidden])))');
    });

    it('keeps the execution cluster from creating page-level horizontal overflow', () => {
        for (const css of [workHubCss, legacyWorkbenchCss]) {
            expect(css).to.match(
                /\.theia-mobile-projects\.theia-mod-agents-hub-shell-active\s+\.theia-mobile-projects-header-execution-cluster,[\s\S]*?\.qaap-work-hub-chat-view-widget\s+\.theia-mobile-projects-header-execution-cluster\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?flex-shrink:\s*0;[\s\S]*?justify-content:\s*flex-end;/,
            );
        }
    });

    it('removes Chat chrome while the Work Hub Settings surface is active', () => {
        expect(workHubCss).to.match(
            /\.theia-mobile-projects\.theia-mod-work-hub-settings-active\s*>\s*\.theia-mobile-projects-header\s*\{[^}]*display:\s*none\s*!important/s,
        );
    });

    it('only shows the Settings sidebar opener while the sidebar is collapsed', () => {
        expect(workHubCss).to.match(
            /\.theia-mobile-work-hub-settings-sidebar-toggle-open\s*\{[^}]*display:\s*none\s*!important/s,
        );
        expect(workHubCss).to.match(
            /\.theia-mobile-work-hub-settings-layout\.theia-mod-sidebar-collapsed\s+\.theia-mobile-work-hub-settings-sidebar-toggle-open\s*\{[^}]*display:\s*inline-flex\s*!important/s,
        );
    });

    it('keeps compact project labels short on narrow headers', () => {
        expect(workHubCss).to.match(
            /@media \(max-width:\s*767px\)[\s\S]*?\.theia-mobile-projects-header-project\.theia-mod-compact-project \.theia-mobile-projects-header-project-label\s*\{[\s\S]*?max-width:\s*clamp\(96px,\s*34vw,\s*148px\)/,
        );
    });

    it('hides Codex context controls while the input is focused', () => {
        expect(conversationCss).to.match(
            /\.theia-mobile-projects-sticky-composer-card\.theia-mod-codex\.theia-mod-input-expanded \.theia-mobile-projects-sticky-composer-stage\s*\{[^}]*padding-bottom:\s*0/s,
        );
        expect(conversationCss).to.match(
            /\.theia-mobile-projects-sticky-composer-card\.theia-mod-codex\.theia-mod-input-expanded \.theia-mobile-projects-sticky-composer-stage>\.qaap-codex-context-tray,[\s\S]*?pointer-events:\s*none/s,
        );
    });
});
