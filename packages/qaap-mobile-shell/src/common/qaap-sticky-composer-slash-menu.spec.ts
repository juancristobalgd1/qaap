// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildStickyComposerSlashSections,
    filterStickyComposerSlashSections,
    removeActiveSlashToken,
    SLASH_MENU_SECTION_VISIBLE_LIMIT,
} from './qaap-sticky-composer-slash-menu';

describe('qaap-sticky-composer-slash-menu', () => {

    it('buildStickyComposerSlashSections groups skills, commands, and modes', () => {
        const sections = buildStickyComposerSlashSections({
            skills: [{ name: 'react-doctor', description: 'Scan React' }],
            commands: [
                { commandName: 'react-doctor', commandDescription: 'dup' },
                { commandName: 'code-review', commandDescription: 'Review code' },
            ],
            modes: [{ id: 'ask', name: 'Ask' }],
        });
        expect(sections.map(section => section.id)).to.deep.equal(['skills', 'commands', 'modes']);
        expect(sections[0].entries.map(entry => entry.label)).to.deep.equal(['react-doctor']);
        expect(sections[1].entries.map(entry => entry.label)).to.deep.equal(['code-review']);
        expect(sections[2].entries[0]).to.include({ kind: 'mode', modeId: 'ask', label: 'Ask' });
    });

    it('filterStickyComposerSlashSections matches label and description', () => {
        const sections = buildStickyComposerSlashSections({
            skills: [
                { name: 'loop', description: 'Recurring prompt' },
                { name: 'web-design-guidelines' },
            ],
            commands: [{ commandName: 'explain' }],
            modes: [{ id: 'plan', name: 'Plan' }],
        });
        const filtered = filterStickyComposerSlashSections(sections, 'web');
        expect(filtered).to.have.length(1);
        expect(filtered[0].id).to.equal('skills');
        expect(filtered[0].entries.map(entry => entry.label)).to.deep.equal(['web-design-guidelines']);
    });

    it('removeActiveSlashToken strips the active slash fragment', () => {
        expect(removeActiveSlashToken('run /rea', 8)).to.deep.equal({ value: 'run ', caret: 4 });
        expect(removeActiveSlashToken('/rea', 4)).to.deep.equal({ value: '', caret: 0 });
    });

    it('exposes a Cursor-like initial visible limit', () => {
        expect(SLASH_MENU_SECTION_VISIBLE_LIMIT).to.equal(3);
    });
});
