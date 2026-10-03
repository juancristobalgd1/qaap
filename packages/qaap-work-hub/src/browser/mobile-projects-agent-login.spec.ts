// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { MobileProjectsPanelContext } from './mobile-projects-panel-context';
import { openAgentSignInTerminalExtracted } from './mobile-projects-panel-timeline';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

describe('Work Hub harness connection actions', () => {

    useSuiteJSDOM();

    it('opens BYOK Settings for QAIQ, OpenClaude, Hermes, and Antigravity', () => {
        const settingsHarnesses = ['qaiq', 'openclaude', 'hermes', 'antigravity'];
        const requested: string[] = [];
        const ctx = {
            transcriptController: { state: {} },
            notifyAgentUsesSettingsApiKey: (agentId: string): void => { requested.push(agentId); },
        } as unknown as MobileProjectsPanelContext;

        for (const agentId of settingsHarnesses) {
            openAgentSignInTerminalExtracted(ctx, agentId);
        }

        expect(requested).to.deep.equal(settingsHarnesses);
    });

    it('gives interactive CLIs an explicit tenant-terminal command', () => {
        const messages: string[] = [];
        const ctx = {
            transcriptController: { state: {} },
            messageService: { info: (message: string): Promise<undefined> => {
                messages.push(message);
                return Promise.resolve(undefined);
            } },
        } as unknown as MobileProjectsPanelContext;

        openAgentSignInTerminalExtracted(ctx, 'opencode');
        openAgentSignInTerminalExtracted(ctx, 'openclaw');
        openAgentSignInTerminalExtracted(ctx, 'qwen');
        openAgentSignInTerminalExtracted(ctx, 'kimi');

        expect(messages).to.have.length(4);
        expect(messages[0]).to.include('opencode auth login');
        expect(messages[1]).to.include('openclaw onboard');
        expect(messages[2]).to.include('qwen');
        expect(messages[3]).to.include('kimi');
        expect(messages.every(message => /terminal.*workspace/i.test(message))).to.equal(true);
    });

    it('explains the next step for a custom harness without a registered flow', () => {
        let message = '';
        const ctx = {
            transcriptController: { state: {} },
            messageService: { info: (value: string): Promise<undefined> => {
                message = value;
                return Promise.resolve(undefined);
            } },
        } as unknown as MobileProjectsPanelContext;

        openAgentSignInTerminalExtracted(ctx, 'custom-harness');

        expect(message).to.include('custom-harness');
        expect(message).to.include('tenant workspace');
        expect(message).to.include('refresh the agent list');
    });
});
