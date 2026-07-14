// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildQaapAccountMenuEntries,
    QAAP_WORK_HUB_OVERVIEW_COMMAND,
    QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND,
} from './qaap-workbench-account-menu';

describe('buildQaapAccountMenuEntries', () => {
    describe('signed-in menu', () => {
        let entries: ReturnType<typeof buildQaapAccountMenuEntries>;

        before(() => {
            entries = buildQaapAccountMenuEntries(true);
        });

        it('does not include Work Hub overview', () => {
            const found = entries.some(e => e.commandId === QAAP_WORK_HUB_OVERVIEW_COMMAND);
            expect(found).to.equal(false);
        });

        it('does not include Open IDE', () => {
            const found = entries.some(e => e.commandId === QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND);
            expect(found).to.equal(false);
        });

        it('includes Command Palette as first action', () => {
            const actions = entries.filter(e => e.kind === 'action');
            expect(actions[0].commandId).to.equal('workbench.action.showCommands');
        });

        it('includes Settings', () => {
            const found = entries.some(e => e.kind === 'action' && e.label === 'Settings');
            expect(found).to.equal(true);
        });

        it('separators only appear between non-empty groups', () => {
            // No consecutive separators
            for (let i = 0; i < entries.length - 1; i++) {
                if (entries[i].kind === 'separator') {
                    expect(entries[i + 1].kind).to.not.equal('separator',
                        'Found two consecutive separators');
                }
            }
            // First entry is not a separator
            expect(entries[0].kind).to.not.equal('separator', 'First entry should not be a separator');
            // Last entry is not a separator
            expect(entries[entries.length - 1].kind).to.not.equal('separator', 'Last entry should not be a separator');
        });

        it('preserves order: Command Palette → Settings → Extensions → Keyboard Shortcuts → Sign Out', () => {
            const actions = entries.filter(e => e.kind === 'action').map(e => e.label);
            expect(actions).to.deep.equal([
                'Command Palette…',
                'Settings',
                'Extensions',
                'Keyboard Shortcuts',
                'Sign Out',
            ]);
        });
    });

    describe('signed-out menu', () => {
        let entries: ReturnType<typeof buildQaapAccountMenuEntries>;

        before(() => {
            entries = buildQaapAccountMenuEntries(false);
        });

        it('does not include Work Hub overview', () => {
            const found = entries.some(e => e.commandId === QAAP_WORK_HUB_OVERVIEW_COMMAND);
            expect(found).to.equal(false);
        });

        it('does not include Open IDE in signed-out menu', () => {
            const found = entries.some(e => e.commandId === QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND);
            expect(found).to.equal(false);
        });
    });
});
