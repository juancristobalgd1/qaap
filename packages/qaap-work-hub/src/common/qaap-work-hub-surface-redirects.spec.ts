// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isWorkHubSettingsSectionVisible,
    parseWorkHubSettingsSectionQuery,
    resolveWorkHubSettingsSectionId,
    WORK_HUB_CHECK_FOR_UPDATES_COMMAND_ID,
    WORK_HUB_SETTINGS_COMMAND_REDIRECTS,
    workHubSettingsSectionQuery,
} from './qaap-work-hub-surface-redirects';

describe('qaap-work-hub-surface-redirects', () => {

    describe('workHubSettingsSectionQuery / parseWorkHubSettingsSectionQuery', () => {
        it('round-trips a section id', () => {
            expect(parseWorkHubSettingsSectionQuery(workHubSettingsSectionQuery('keybindings'))).to.equal('keybindings');
            expect(parseWorkHubSettingsSectionQuery(workHubSettingsSectionQuery('general'))).to.equal('general');
        });

        it('returns undefined for plain search terms, deep-link queries and empty input', () => {
            expect(parseWorkHubSettingsSectionQuery(undefined)).to.equal(undefined);
            expect(parseWorkHubSettingsSectionQuery('')).to.equal(undefined);
            expect(parseWorkHubSettingsSectionQuery('ai-features')).to.equal(undefined);
            expect(parseWorkHubSettingsSectionQuery('keybindings')).to.equal(undefined);
            expect(parseWorkHubSettingsSectionQuery('section:')).to.equal(undefined);
            expect(parseWorkHubSettingsSectionQuery('section:   ')).to.equal(undefined);
        });
    });

    describe('WORK_HUB_SETTINGS_COMMAND_REDIRECTS', () => {
        const sectionOf = (commandId: string): string | undefined =>
            WORK_HUB_SETTINGS_COMMAND_REDIRECTS.find(redirect => redirect.commandId === commandId)?.sectionId;

        it('maps Settings, Keyboard Shortcuts and Color Theme to their Work Hub sections', () => {
            expect(sectionOf('preferences:open')).to.equal('general');
            expect(sectionOf('keymaps:open')).to.equal('keybindings');
            expect(sectionOf('workbench.action.selectTheme')).to.equal('appearance');
        });

        it('does not redirect File Icon Theme (removed from the menu instead)', () => {
            expect(sectionOf('workbench.action.selectIconTheme')).to.equal(undefined);
        });

        it('names only sections the Work Hub Settings page defines', () => {
            const known = new Set(['general', 'appearance', 'keybindings', 'agents', 'mcp', 'skills', 'profile', 'plan-usage']);
            for (const redirect of WORK_HUB_SETTINGS_COMMAND_REDIRECTS) {
                expect(known.has(redirect.sectionId), redirect.sectionId).to.equal(true);
            }
        });
    });

    it('names the sample updater command behind the native Check for Updates item', () => {
        expect(WORK_HUB_CHECK_FOR_UPDATES_COMMAND_ID).to.equal('electron-sample:check-for-updates');
    });

    describe('Plan section visibility', () => {
        it('hides Plan on desktop only', () => {
            expect(isWorkHubSettingsSectionVisible('plan-usage', true)).to.equal(false);
            expect(isWorkHubSettingsSectionVisible('plan-usage', false)).to.equal(true);
        });

        it('keeps every other section on desktop', () => {
            for (const sectionId of ['general', 'profile', 'appearance', 'agents', 'mcp', 'skills', 'keybindings']) {
                expect(isWorkHubSettingsSectionVisible(sectionId, true), sectionId).to.equal(true);
            }
        });

        it('redirects a deep link to Plan on desktop to General instead of an empty page', () => {
            expect(resolveWorkHubSettingsSectionId('plan-usage', true)).to.equal('general');
            expect(resolveWorkHubSettingsSectionId('plan-usage', false)).to.equal('plan-usage');
            expect(resolveWorkHubSettingsSectionId('keybindings', true)).to.equal('keybindings');
        });
    });
});
