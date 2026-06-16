// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { expandComposerSkillSlashCommands, type ComposerSkillSubmitDeps } from './qaap-composer-skill-submit';

describe('qaap-composer-skill-submit', () => {

    const deps: ComposerSkillSubmitDeps = {
        skillService: {
            getSkill: (name: string) => name === 'react-doctor'
                ? { name, description: 'Scan React', location: '/tmp/react-doctor/SKILL.md' }
                : undefined,
        } as ComposerSkillSubmitDeps['skillService'],
        fileService: {
            read: async () => ({ value: '---\nname: react-doctor\n---\n\nRun react-doctor on the diff.' }),
        } as unknown as ComposerSkillSubmitDeps['fileService'],
    };

    it('expands a trailing /skill slash token into inline instructions', async () => {
        const result = await expandComposerSkillSlashCommands('/react-doctor review login', deps);
        expect(result).to.contain('Follow the "react-doctor" skill');
        expect(result).to.contain('Run react-doctor on the diff.');
        expect(result).to.contain('review login');
        expect(result).to.not.contain('/react-doctor');
    });

    it('leaves drafts without a known skill unchanged', async () => {
        const draft = 'fix tests /unknown-skill';
        expect(await expandComposerSkillSlashCommands(draft, deps)).to.equal(draft);
    });
});
