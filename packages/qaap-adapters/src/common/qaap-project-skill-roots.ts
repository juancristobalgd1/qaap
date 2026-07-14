// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as path from 'path';
import type { Event } from '@theia/core/lib/common/event';

/** Work Hub project roots whose skill folders should be scanned without opening the IDE workspace. */
export const QaapProjectSkillRoots = Symbol('QaapProjectSkillRoots');

export interface QaapProjectSkillRoots {
    /** Absolute project root directories (repo cwd), not skill folder paths. */
    getProjectRootPaths(): readonly string[];
    readonly onDidChange: Event<void>;
}

/** Standard Theia / agent skill directories under a project root. */
export function qaapProjectSkillDirectoryPaths(projectRoot: string): string[] {
    const root = projectRoot.trim();
    if (!root) {
        return [];
    }
    return [
        path.join(root, '.prompts', 'skills'),
        path.join(root, '.agents', 'skills'),
    ];
}
