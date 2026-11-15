// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Collapse whitespace and cut to at most `maxLength` characters (ellipsis included). The cut lands
 * on the last word boundary when that keeps at least half of the budget, so a title never ends
 * mid-word; a trailing separator left before the ellipsis is dropped.
 */
export function truncateTitleAtWordBoundary(text: string, maxLength: number): string {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    if (collapsed.length <= maxLength) {
        return collapsed;
    }
    const budget = maxLength - 1;
    const hard = collapsed.slice(0, budget);
    const lastSpace = hard.lastIndexOf(' ');
    const cut = lastSpace >= Math.floor(budget / 2) ? hard.slice(0, lastSpace) : hard;
    return `${cut.replace(/[\s,;:.\-]+$/, '')}…`;
}
