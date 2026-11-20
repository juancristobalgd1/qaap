// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

describe('transcript scroller column edge CSS', () => {
    const workHubCss = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'mobile-workbench-work-hub.css'),
        'utf8',
    );

    it('re-applies the clip bleed for desktop IDE at the same !important priority as the base sheet pin', () => {
        // base sheet pins the clip with `width: 100% !important` / `margin-inline: auto !important`;
        // without this override the bleed above never applies and the scrollbar sits inside the column.
        expect(workHubCss).to.match(
            /body\.theia-mobile-mod-desktop-ide \.theia-mobile-projects\.theia-mod-agents-hub-shell-active \.theia-mobile-agents-hub-inline-transcript \.theia-mobile-agent-transcript-real-chat,\s*body\.theia-mobile-mod-desktop-ide \.theia-mobile-projects\.theia-mod-agents-hub-inline-active \.theia-mobile-agents-hub-inline-transcript \.theia-mobile-agent-transcript-real-chat\s*\{[^}]*width:\s*calc\(100% \+ var\(--qaap-transcript-column-bleed-start\) \+ var\(--qaap-transcript-column-bleed-end\)\)\s*!important;[^}]*margin-left:\s*calc\(-1 \* var\(--qaap-transcript-column-bleed-start\)\)\s*!important;[^}]*margin-right:\s*calc\(-1 \* var\(--qaap-transcript-column-bleed-end\)\)\s*!important;/s,
        );
    });

    it('restores the scroller gutter on top of the bleed so the reading column keeps its content box', () => {
        expect(workHubCss).to.match(
            /body\.theia-mobile-mod-desktop-ide \.theia-mobile-projects \.theia-mobile-agents-hub-inline-transcript \.theia-mobile-agent-transcript-real-chat>\.theia-mobile-agent-transcript\.theia-mobile-agent-transcript\s*\{\s*padding-left:\s*calc\(var\(--qaap-transcript-column-bleed-start, 0px\) \+ var\(--theia-mobile-execution-chrome-pad-x, 12px\)\);\s*padding-right:\s*calc\(var\(--qaap-transcript-column-bleed-end, 0px\) \+ var\(--theia-mobile-execution-chrome-pad-x, 12px\)\);/s,
        );
    });

    it('keeps the no-bottom-chrome override desktop-only so narrow layouts are unchanged', () => {
        expect(workHubCss).to.match(
            /@media \(min-width: 768px\) \{\s*body\.theia-mobile-mod-workhub-no-bottom-chrome \.theia-mobile-projects\.theia-mod-agents-hub-shell-active \.theia-mobile-agents-hub-inline-transcript \.theia-mobile-agent-transcript-real-chat,/s,
        );
    });
});
