// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Product rules for the Work Hub chat docked in the classic IDE's right side panel.
 * They live in CSS, so pin them here: removing them silently brings back duplicated
 * views or hides the chat tab.
 */
describe('IDE chat panel CSS', () => {
    const baseCss = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'mobile-workbench-base.css'),
        'utf8',
    );

    it('hides the Browser/Files/Terminal views picker in the IDE chat panel (the IDE has its own views)', () => {
        expect(baseCss).to.match(
            /body\.theia-mobile-mod-desktop-ide\s+\.qaap-work-hub-chat-view-widget\s+\.theia-mobile-projects-header-execution-tabs\s*\{[^}]*display:\s*none\s*!important;/s,
        );
    });

    it('shows the chat tab in the IDE right side panel tab bar', () => {
        expect(baseCss).to.match(
            /body\.theia-mobile-mod-desktop-ide\s+\.lm-TabBar\.theia-app-right\.theia-app-sides\s+#shell-tab-chat-view-widget\s*\{[^}]*display:\s*flex\s*!important;/s,
        );
    });
});
