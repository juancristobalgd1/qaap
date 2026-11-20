// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Right-panel glyph on a 16px grid: the desktop right-panel toggle in the chat header and in the Settings header. */
export const QAAP_WORK_HUB_RIGHT_PANEL_GLYPH_PATH = 'M3.5 2.5h9a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12V4a1.5 1.5 0 0 1 1.5-1.5Z M10 2.5v11';

/** The right-panel glyph as an inline SVG; it takes its stroke from the surrounding `currentColor` styling. */
export function createQaapWorkHubRightPanelGlyph(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'qaap-glyph-right-panel');
    path.setAttribute('d', QAAP_WORK_HUB_RIGHT_PANEL_GLYPH_PATH);
    svg.append(path);
    return svg;
}
