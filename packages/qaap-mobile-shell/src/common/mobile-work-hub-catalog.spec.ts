// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    countCatalogItems,
    filterCatalogSections,
    QAAP_WORK_HUB_WORKFLOWS,
} from './mobile-work-hub-catalog';

describe('mobile-work-hub-catalog', () => {

    it('filters workflows by title and search text', () => {
        const filtered = filterCatalogSections(QAAP_WORK_HUB_WORKFLOWS, 'pull request');
        expect(filtered).to.have.lengthOf(1);
        expect(filtered[0].id).to.equal('agentic');
        expect(filtered[0].items).to.have.lengthOf(1);
        expect(filtered[0].items[0].id).to.equal('workflow-review-prs');
    });

    it('returns all workflows when query is empty', () => {
        const filtered = filterCatalogSections(QAAP_WORK_HUB_WORKFLOWS, '   ');
        expect(countCatalogItems(filtered)).to.equal(countCatalogItems(QAAP_WORK_HUB_WORKFLOWS));
    });

    it('does not expose the removed standalone working-changes view', () => {
        const items = QAAP_WORK_HUB_WORKFLOWS.flatMap(section => section.items);
        expect(items.some(item => item.id === 'workflow-diff')).to.equal(false);
        expect(items.some(item => item.title.toLowerCase().includes('working changes'))).to.equal(false);
        expect(items.some(item => item.action.type === 'hub-view' && item.action.view === 'tasks')).to.equal(false);
    });
});
