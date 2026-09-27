// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Explicit result of an app-picker action, useful to keep preview state transitions honest. */
export type QaapMonorepoPreviewSwitchResult = 'no-op' | 'superseded' | 'switched';

export interface QaapMonorepoPreviewSwitchOptions<T> {
    readonly appCount: number;
    readonly currentAppPath: string | undefined;
    readonly nextApp: T | undefined;
    readonly nextAppPath: string | undefined;
    readonly previewIsActive: boolean;
    /** Stops the exact preview process that Qaap owns, never a process selected by name. */
    readonly stopActivePreview: () => Promise<void>;
    /** True while this picker action is still the most recent user intent. */
    readonly isCurrent: () => boolean;
    readonly applySelection: (nextApp: T | undefined) => void;
    /** Moves state to starting and launches the newly selected app when appropriate. */
    readonly launchSelectedPreview: () => Promise<void>;
}

/**
 * Performs the ordered half of a monorepo app switch independently of Theia UI/terminal APIs.
 * In particular, selection is not published until the old managed process has been stopped.
 */
export async function switchQaapMonorepoPreviewApp<T>(
    options: QaapMonorepoPreviewSwitchOptions<T>,
): Promise<QaapMonorepoPreviewSwitchResult> {
    if (options.appCount <= 1 || options.currentAppPath === options.nextAppPath) {
        return 'no-op';
    }
    if (options.previewIsActive) {
        await options.stopActivePreview();
        if (!options.isCurrent()) {
            return 'superseded';
        }
    }
    options.applySelection(options.nextApp);
    if (!options.isCurrent()) {
        return 'superseded';
    }
    await options.launchSelectedPreview();
    return 'switched';
}
