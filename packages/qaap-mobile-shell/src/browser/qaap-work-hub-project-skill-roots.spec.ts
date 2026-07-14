// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapWorkHubProjectSkillRoots } from './qaap-work-hub-project-skill-roots';

describe('qaap-work-hub-project-skill-roots', () => {

    it('syncProjectCwds deduplicates, trims, and notifies on change', () => {
        const roots = new QaapWorkHubProjectSkillRoots();
        let changeCount = 0;
        roots.onDidChange(() => { changeCount++; });

        roots.syncProjectCwds([' /repo/a ', '/repo/a', '/repo/b']);
        expect(roots.getProjectRootPaths()).to.deep.equal(['/repo/a', '/repo/b']);
        expect(changeCount).to.equal(1);

        roots.syncProjectCwds(['/repo/b', '/repo/a']);
        expect(changeCount).to.equal(1);
    });
});
