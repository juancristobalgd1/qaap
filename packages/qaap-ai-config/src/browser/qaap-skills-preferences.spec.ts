// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isQaapSkillEnabled,
    readDisabledSkillNames,
    withQaapSkillEnabled,
} from './qaap-skills-preferences';

describe('qaap-skills-preferences', () => {
    it('reads disabled skill names from preference values', () => {
        expect(readDisabledSkillNames([' review ', '', 3, 'create-skill'])).to.deep.equal([
            'review',
            'create-skill',
        ]);
        expect(readDisabledSkillNames(undefined)).to.deep.equal([]);
    });

    it('toggles skill enabled state in the disabled list', () => {
        expect(isQaapSkillEnabled('review', ['create-skill'])).to.equal(true);
        expect(isQaapSkillEnabled('Review', ['review'])).to.equal(false);
        expect(withQaapSkillEnabled(['review'], 'create-skill', false)).to.deep.equal([
            'create-skill',
            'review',
        ]);
        expect(withQaapSkillEnabled(['review', 'create-skill'], 'review', true)).to.deep.equal([
            'create-skill',
        ]);
    });
});
