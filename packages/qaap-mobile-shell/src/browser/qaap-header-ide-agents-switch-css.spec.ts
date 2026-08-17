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

    it('centers the Work Hub switch like the IDE top bar', () => {
        expect(projectsCss).to.match(
            /\.theia-mobile-projects-header-ide-agents-switch\s*\{[^}]*position:\s*absolute;[^}]*left:\s*50%;[^}]*transform:\s*translateX\(-50%\)/s,
        );
        expect(ideCss).to.include('workbench-view-mode-center');
        expect(ideCss).to.match(/left:\s*50%/);
        expect(ideCss).to.match(/transform:\s*translateX\(-50%\)/);
    });

    it('does not keep the IDE/Agents switch in the sessions sidebar', () => {
        expect(sidebarCss).not.to.include('.theia-mobile-work-hub-sessions-sidebar-view-switch');
    });
});
