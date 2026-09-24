// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { buildStickyComposerSlashSections, filterStickyComposerSlashSections, removeActiveSlashToken, SLASH_MENU_SECTION_VISIBLE_LIMIT } from './qaap-sticky-composer-slash-menu';

describe('qaap-sticky-composer-slash-menu', () => {
    it('buildStickyComposerSlashSections groups actions, skills, and tools', () => {
        const sections = buildStickyComposerSlashSections({
            skills: [{ name: 'react-doctor', description: 'Scan React' }],
            canFork: true,
            canManagePlugins: true,
        });
        expect(sections.map(section => section.id)).to.deep.equal(['actions', 'skills', 'tools']);
        expect(sections[0].entries.map(entry => entry.label)).to.deep.equal(['fork', 'new']);
        expect(sections[0].entries[1].description).to.include('new agent');
        expect(sections[1].entries.map(entry => entry.label)).to.deep.equal(['react-doctor']);
        expect(sections[2].entries.map(entry => entry.label)).to.deep.equal(['add-plugin', 'remove-plugin']);
    });

    it('omits fork when canFork is false', () => {
        const sections = buildStickyComposerSlashSections({ skills: [], canFork: false });
        expect(sections[0].entries.map(entry => entry.label)).to.deep.equal(['new']);
    });

    it('filterStickyComposerSlashSections matches label and description', () => {
        const sections = buildStickyComposerSlashSections({
            skills: [
                { name: 'loop', description: 'Recurring prompt' },
                { name: 'web-design-guidelines' },
            ],
            canFork: false,
        });
        const filtered = filterStickyComposerSlashSections(sections, 'new agent');
        expect(filtered).to.have.length(1);
        expect(filtered[0].id).to.equal('actions');
        expect(filtered[0].entries.map(entry => entry.label)).to.deep.equal(['new']);
    });

    it('removeActiveSlashToken strips the active slash fragment', () => {
        expect(removeActiveSlashToken('run /rea', 8)).to.deep.equal({ value: 'run ', caret: 4 });
        expect(removeActiveSlashToken('/rea', 4)).to.deep.equal({ value: '', caret: 0 });
    });

    it('exposes a Cursor-like initial visible limit', () => {
        expect(SLASH_MENU_SECTION_VISIBLE_LIMIT).to.equal(3);
    });

});
