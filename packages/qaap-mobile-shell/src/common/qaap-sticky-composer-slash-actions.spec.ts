// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_WORK_HUB_AI_CONFIGURATION_MCP_TAB } from './mobile-work-hub-catalog';
import {
    executeStickyComposerSlashAction,
    openComposerMcpConfigurationSheet,
} from './qaap-sticky-composer-slash-actions';

describe('qaap-sticky-composer-slash-actions', () => {

    it('openComposerMcpConfigurationSheet selects the MCP tab', async () => {
        let tabId: string | undefined;
        await openComposerMcpConfigurationSheet(async id => { tabId = id; });
        expect(tabId).to.equal(QAAP_WORK_HUB_AI_CONFIGURATION_MCP_TAB);
    });

    it('executeStickyComposerSlashAction routes fork, new, and plugin tools', async () => {
        const calls: string[] = [];
        await executeStickyComposerSlashAction('fork', 'keep', {
            forkConversation: async () => { calls.push('fork'); },
            startNewAgentWithPrompt: () => { calls.push('new'); },
            openMcpConfiguration: async () => { calls.push('mcp'); },
        });
        expect(calls).to.deep.equal(['fork']);

        await executeStickyComposerSlashAction('new', 'draft text', {
            startNewAgentWithPrompt: prompt => { calls.push(`new:${prompt}`); },
        });
        expect(calls).to.include('new:draft text');

        await executeStickyComposerSlashAction('add-plugin', '', {
            openMcpConfiguration: async () => { calls.push('add-plugin'); },
        });
        expect(calls).to.not.include('add-plugin');
    });
});
