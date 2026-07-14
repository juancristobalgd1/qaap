// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import { qaapPerUserSkillsDirectory } from './qaap-system-skills';

describe('qaap-system-skills', () => {
    it('qaapPerUserSkillsDirectory scopes skills by login', () => {
        const home = os.homedir();
        const alice = qaapPerUserSkillsDirectory(home, 'Alice');
        const bob = qaapPerUserSkillsDirectory(home, 'Bob');
        expect(alice).to.not.equal(bob);
        expect(alice).to.equal(path.join(home, '.qaap', 'users', 'alice', 'skills'));
        expect(bob).to.equal(path.join(home, '.qaap', 'users', 'bob', 'skills'));
    });
});
