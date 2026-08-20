// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isWorkHubCommandPaletteCommand,
    QAAP_WORK_HUB_NEW_AGENT_COMMAND,
    QAAP_WORK_HUB_OPEN_BILLING_COMMAND,
    QAAP_WORK_HUB_OPEN_REPOSITORY_COMMAND,
    QAAP_WORK_HUB_OPEN_SETTINGS_COMMAND,
    QAAP_WORK_HUB_SEARCH_COMMAND,
} from './qaap-work-hub-command-palette';

describe('isWorkHubCommandPaletteCommand', () => {
    it('includes qaap surface commands', () => {
        expect(isWorkHubCommandPaletteCommand({
            id: QAAP_WORK_HUB_OPEN_SETTINGS_COMMAND,
            label: 'Settings',
        })).to.equal(true);
        expect(isWorkHubCommandPaletteCommand({
            id: QAAP_WORK_HUB_OPEN_BILLING_COMMAND,
            label: 'Billing',
        })).to.equal(true);
        expect(isWorkHubCommandPaletteCommand({
            id: QAAP_WORK_HUB_NEW_AGENT_COMMAND,
            label: 'New agent',
        })).to.equal(true);
        expect(isWorkHubCommandPaletteCommand({
            id: QAAP_WORK_HUB_SEARCH_COMMAND,
            label: 'Search Work Hub…',
        })).to.equal(true);
        expect(isWorkHubCommandPaletteCommand({
            id: QAAP_WORK_HUB_OPEN_REPOSITORY_COMMAND,
            label: 'Add repository',
        })).to.equal(true);
        expect(isWorkHubCommandPaletteCommand({
            id: 'qaap.mobile.openDesktopIde',
            label: 'Open IDE',
        })).to.equal(true);
    });

    it('includes shared hub catalog / preferences commands', () => {
        expect(isWorkHubCommandPaletteCommand({
            id: 'workbench.action.selectTheme',
            label: 'Color Theme',
        })).to.equal(true);
        expect(isWorkHubCommandPaletteCommand({
            id: 'aiConfiguration:open',
            label: 'AI Configuration',
        })).to.equal(true);
        expect(isWorkHubCommandPaletteCommand({
            id: 'preferences:open',
            label: 'Open Settings (UI)',
        })).to.equal(true);
    });

    it('excludes arg-required, IDE-header, and IDE-chrome qaap commands', () => {
        expect(isWorkHubCommandPaletteCommand({
            id: 'qaap.workHub.submitComposerPrompt',
            label: 'Submit prompt',
        })).to.equal(false);
        expect(isWorkHubCommandPaletteCommand({
            id: 'qaap.mobile.ideHeaderView.activate',
            label: 'Activate',
        })).to.equal(false);
        expect(isWorkHubCommandPaletteCommand({
            id: 'qaap.chat.maximize',
            label: 'Maximize Chat',
        })).to.equal(false);
        expect(isWorkHubCommandPaletteCommand({
            id: 'qaap.hub.resumePreview',
            label: 'Resume preview',
        })).to.equal(false);
        expect(isWorkHubCommandPaletteCommand({
            id: 'qaap.pickElement',
            label: 'Pick an element',
        })).to.equal(false);
    });

    it('excludes classic IDE commands unrelated to Work Hub', () => {
        expect(isWorkHubCommandPaletteCommand({
            id: 'workbench.action.files.newUntitledFile',
            label: 'New Untitled Text File',
        })).to.equal(false);
        expect(isWorkHubCommandPaletteCommand({
            id: 'editor.action.formatDocument',
            label: 'Format Document',
        })).to.equal(false);
        expect(isWorkHubCommandPaletteCommand({
            id: 'workbench.view.extensions',
            label: 'Extensions',
        })).to.equal(false);
    });
});
