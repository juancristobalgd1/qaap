// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { Emitter } from '@theia/core/lib/common/event';
import type { QaapProjectSkillRoots } from '@theia/qaap-adapters/lib/common/qaap-project-skill-roots';

@injectable()
export class QaapWorkHubProjectSkillRoots implements QaapProjectSkillRoots {

    protected projectCwds: string[] = [];
    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange = this.onDidChangeEmitter.event;

    getProjectRootPaths(): readonly string[] {
        return this.projectCwds;
    }

    /** Replace Work Hub project cwd roots used for skill discovery. */
    syncProjectCwds(cwds: Iterable<string>): void {
        const next = [...new Set([...cwds].map(cwd => cwd.trim()).filter(Boolean))].sort();
        if (next.length === this.projectCwds.length && next.every((cwd, index) => cwd === this.projectCwds[index])) {
            return;
        }
        this.projectCwds = next;
        this.onDidChangeEmitter.fire();
    }
}
