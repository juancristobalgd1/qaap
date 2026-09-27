// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { removeProjectConfirmCopy } from './mobile-projects-remove-confirm';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';

disableImportJSDOM();

function sampleProject(overrides: Partial<MobileProjectEntry> = {}): MobileProjectEntry {
    return {
        id: 'p1',
        name: 'Demo',
        color: '#8EB5DC',
        branch: 'main',
        status: 'idle',
        task: '',
        progress: 0,
        agents: [],
        lastActive: 'now',
        tokens: '0',
        cost: '$0',
        pinned: false,
        isCurrent: true,
        ...overrides,
    };
}

describe('removeProjectConfirmCopy', () => {
    it('warns that a GitHub clone is deleted locally, not on GitHub', () => {
        const copy = removeProjectConfirmCopy(sampleProject({
            name: 'widget',
            github: {
                owner: 'alice',
                name: 'widget',
                fullName: 'alice/widget',
                htmlUrl: 'https://github.com/alice/widget',
                private: false,
            },
        }));
        expect(copy.title).to.equal('Remove from this VPS');
        expect(copy.msg).to.include('alice/widget');
        expect(copy.msg).to.include('The GitHub repository is not deleted');
    });

    it('uses the local-projects copy when the entry is not a GitHub clone', () => {
        const copy = removeProjectConfirmCopy(sampleProject({ name: 'scratch' }));
        expect(copy.title).to.equal('Remove');
        expect(copy.msg).to.include('scratch');
        expect(copy.msg).to.not.include('GitHub');
    });
});
