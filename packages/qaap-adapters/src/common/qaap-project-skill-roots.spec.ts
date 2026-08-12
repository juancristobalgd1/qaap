// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as path from 'path';
import { qaapProjectSkillDirectoryPaths } from './qaap-project-skill-roots';

describe('qaap-project-skill-roots', () => {

    it('qaapProjectSkillDirectoryPaths resolves standard skill folders', () => {
        expect(qaapProjectSkillDirectoryPaths('/workspace/repos/users/alice/acme/demo')).to.deep.equal([
            path.join('/workspace/repos/users/alice/acme/demo', '.prompts', 'skills'),
            path.join('/workspace/repos/users/alice/acme/demo', '.agents', 'skills'),
        ]);
    });

    it('qaapProjectSkillDirectoryPaths ignores blank roots', () => {
        expect(qaapProjectSkillDirectoryPaths('   ')).to.deep.equal([]);
    });
});
