// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Removes the IDE-only regions (main dock area, bottom panel, active widget) from a serialized
 * shell layout so {@link ShellLayoutRestorer} never inflates editors / terminals while the mobile
 * Work Hub is the visible surface. Side panels are kept (they are collapsed separately and host
 * mobile-specific views). Returns the input unchanged when it cannot be parsed or has nothing to strip.
 */
export function stripIdeRegionsFromSerializedLayout(serialized: string): string {
    let layout: Record<string, unknown> | undefined;
    try {
        const parsed: unknown = JSON.parse(serialized);
        layout = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
    } catch {
        layout = undefined;
    }
    if (!layout) {
        return serialized;
    }
    let changed = false;
    for (const key of ['mainPanel', 'mainPanelPinned', 'bottomPanel', 'activeWidgetId']) {
        if (key in layout) {
            delete layout[key];
            changed = true;
        }
    }
    return changed ? JSON.stringify(layout) : serialized;
}
