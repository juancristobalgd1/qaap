// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ConfirmDialog } from '@theia/core/lib/browser';
import { nls } from '@theia/core/lib/common/nls';
import type { MobileProjectEntry } from './mobile-projects-types';

export function removeProjectConfirmCopy(project: MobileProjectEntry): { readonly title: string; readonly msg: string } {
    if (project.github) {
        return {
            title: nls.localize('qaap/mobileProjects/removeFromVps', 'Remove from this VPS'),
            msg: nls.localize(
                'qaap/mobileProjects/removeGithubConfirm',
                'Remove {0} from this VPS? This deletes the local clone, its tasks, and previews. The GitHub repository is not deleted.',
                project.github.fullName || `${project.github.owner}/${project.github.name}`,
            ),
        };
    }
    return {
        title: nls.localize('qaap/mobileProjects/remove', 'Remove'),
        msg: nls.localize(
            'qaap/mobileProjects/removeConfirm',
            'Remove {0} from Projects? This cannot be undone.',
            project.name,
        ),
    };
}

/** Confirm dialog for removing a Work Hub project from this VPS / Projects list. */
export function createRemoveProjectConfirmDialog(project: MobileProjectEntry): ConfirmDialog {
    return new ConfirmDialog(removeProjectConfirmCopy(project));
}

export function confirmRemoveProjectDialog(project: MobileProjectEntry): Promise<boolean | undefined> {
    return createRemoveProjectConfirmDialog(project).open();
}
