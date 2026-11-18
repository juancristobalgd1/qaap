// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

describe('settings embedded scroller column edge CSS', () => {
    const workHubCss = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'mobile-workbench-work-hub.css'),
        'utf8',
    );

    it('declares the column edge and bleed on the embedded scroll host, desktop only', () => {
        expect(workHubCss).to.match(
            /@media \(min-width: 768px\) \{\s*\.theia-mobile-work-hub-settings-custom-content\.theia-mod-embedded-settings \{\s*container-type: inline-size;\s*--qaap-settings-embedded-edge: calc\(\(100cqw \+ min\(100cqw, 1040px\)\) \/ 2 \+ 32px\);\s*--qaap-settings-embedded-bleed: calc\(var\(--qaap-settings-embedded-edge\) - min\(100cqw, 1000px\)\);/s,
        );
    });

    it('runs the embedded widget to the column edge at the same !important priority as its inline width', () => {
        // the widget sets an inline `width: 100%`; a non-important rule cannot beat it.
        expect(workHubCss).to.match(
            /\.theia-mobile-work-hub-settings-custom-content\.theia-mod-embedded-settings \.theia-mobile-work-hub-settings-embedded-widget \{\s*width: var\(--qaap-settings-embedded-edge\) !important;\s*max-width: none !important;/s,
        );
    });

    it('moves the bleed into the Harness and MCP scroller padding-right, keeping the content box', () => {
        expect(workHubCss).to.match(
            /\.theia-mobile-work-hub-settings-embedded-widget \.qaap-harness-configuration-content \{\s*padding-right: calc\(20px \+ var\(--qaap-settings-embedded-bleed\)\);/s,
        );
        expect(workHubCss).to.match(
            /\.theia-mobile-work-hub-settings-embedded-widget \.mcp-configuration-container \{\s*padding-right: calc\(20px \+ var\(--qaap-settings-embedded-bleed\)\);/s,
        );
    });

    it('keeps the skills 840px reading column centred while its right edge reaches the column', () => {
        expect(workHubCss).to.match(
            /\.theia-mobile-work-hub-settings-embedded-widget \.ai-skills-configuration-container \{\s*width: auto !important;\s*margin: 0 0 0 calc\(\(min\(100cqw, 1000px\) - min\(100cqw, 840px\)\) \/ 2\) !important;\s*padding-right: calc\(var\(--qaap-settings-embedded-edge\) - min\(100cqw, 840px\) - \(min\(100cqw, 1000px\) - min\(100cqw, 840px\)\) \/ 2\);/s,
        );
    });

    it('runs the sidebar Settings nav scroller to the panel edge, giving back the host 10px inside it', () => {
        const sidebarCss = fs.readFileSync(
            path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-work-hub-sessions-sidebar.css'),
            'utf8',
        );
        expect(sidebarCss).to.match(
            /\.theia-mobile-work-hub-sessions-sidebar-settings \.theia-mobile-work-hub-settings-nav \{[^}]*margin-right: -10px;\s*padding-right: 10px;/s,
        );
    });
});
