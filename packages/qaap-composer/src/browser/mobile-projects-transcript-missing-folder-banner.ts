// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';

export const MISSING_PROJECT_FOLDER_BANNER_CLASS = 'theia-mobile-sticky-composer-missing-folder';

/** Projects whose missing-folder banner the user dismissed this session. Session state only, never persisted. */
const dismissedProjectIds = new Set<string>();

/** Input for {@link showMissingProjectFolderBanner}: the composer column the banner sits above, and the checks it needs. */
export interface MissingProjectFolderBannerInput {
    readonly project: MobileProjectEntry;
    /** Folder path to name in the banner, when the project has one. */
    readonly folderPath: string | undefined;
    readonly anchor: HTMLElement;
    readonly folderExists: (project: MobileProjectEntry) => Promise<boolean | undefined>;
    /** Still the composer that was mounted for this project; a remount discards a stale check. */
    readonly stillMounted: () => boolean;
    /** Existing confirmed remove flow; the banner offers "Remove from list" only when it is wired. */
    readonly removeProject?: (project: MobileProjectEntry) => void | Promise<void>;
}

/** Test seam: forgets this session's dismissals. */
export function resetMissingProjectFolderBannerDismissals(): void {
    dismissedProjectIds.clear();
}

/**
 * Non-blocking: after the composer mounts, checks that the project folder still exists and, when it does not,
 * shows a banner above the composer. The transcript stays readable; the check never delays the mount.
 */
export async function showMissingProjectFolderBanner(input: MissingProjectFolderBannerInput): Promise<void> {
    if (dismissedProjectIds.has(input.project.id)) {
        return;
    }
    const exists = await input.folderExists(input.project);
    if (exists !== false || !input.stillMounted() || !input.anchor.isConnected) {
        return;
    }
    if (input.anchor.parentElement?.querySelector(`.${MISSING_PROJECT_FOLDER_BANNER_CLASS}`)) {
        return;
    }
    input.anchor.before(createMissingProjectFolderBannerElement(input));
}

function createMissingProjectFolderBannerElement(input: MissingProjectFolderBannerInput): HTMLElement {
    const banner = document.createElement('div');
    banner.className = MISSING_PROJECT_FOLDER_BANNER_CLASS;
    banner.setAttribute('role', 'status');
    const icon = document.createElement('span');
    icon.className = `codicon codicon-warning ${MISSING_PROJECT_FOLDER_BANNER_CLASS}-icon`;
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = `${MISSING_PROJECT_FOLDER_BANNER_CLASS}-text`;
    text.textContent = input.folderPath
        ? nls.localize('qaap/mobileProjects/missingProjectFolder', 'This project\'s folder no longer exists: {0}', input.folderPath)
        : nls.localize('qaap/mobileProjects/missingProjectFolderUnnamed', 'This project\'s folder no longer exists.');
    const actions = document.createElement('div');
    actions.className = `${MISSING_PROJECT_FOLDER_BANNER_CLASS}-actions`;
    if (input.removeProject) {
        const remove = createBannerButton(nls.localize('qaap/mobileProjects/missingProjectFolderRemove', 'Remove from list'), () => {
            void input.removeProject?.(input.project);
        });
        actions.append(remove);
    }
    actions.append(createBannerButton(nls.localize('qaap/mobileProjects/missingProjectFolderDismiss', 'Dismiss'), () => {
        dismissedProjectIds.add(input.project.id);
        banner.remove();
    }));
    banner.append(icon, text, actions);
    return banner;
}

function createBannerButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${MISSING_PROJECT_FOLDER_BANNER_CLASS}-action`;
    button.textContent = label;
    button.addEventListener('click', event => {
        event.stopPropagation();
        onClick();
    });
    return button;
}
