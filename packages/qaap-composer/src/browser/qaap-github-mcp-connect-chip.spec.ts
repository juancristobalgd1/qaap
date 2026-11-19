// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();
FrontendApplicationConfigProvider.set({});

import { expect } from 'chai';
import * as React from '@theia/core/shared/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Emitter } from '@theia/core/lib/common/event';
import type { HoverService } from '@theia/core/lib/browser';
import type { ChatInputProductChromeContext } from '@theia/ai-chat-ui/lib/browser/chat-input-product-chrome';
import type {
    QaapGithubMcpConnectionKind,
    QaapGithubMcpConnectionSnapshot,
    QaapGithubMcpConnectionState
} from '@theia/qaap-shared-core/lib/browser/qaap-github-mcp-connection-state';
import { qaapGithubMcpConnectChipText, QAAP_GITHUB_MCP_CONNECT_CHIP_CLASS } from './qaap-github-mcp-connect-chip';
import { createQaapChatInputProductChrome } from './qaap-chat-input-product-chrome';

disableJSDOM();

describe('QaapGithubMcpConnectChip', () => {

    const snapshot = (kind: QaapGithubMcpConnectionKind, desktop = false): QaapGithubMcpConnectionSnapshot => ({ kind, desktop });

    function stateOf(kind: QaapGithubMcpConnectionKind, desktop = false): QaapGithubMcpConnectionState {
        return { snapshot: snapshot(kind, desktop), onDidChange: new Emitter<QaapGithubMcpConnectionSnapshot>().event, connect: async () => undefined };
    }

    const context = { pending: false, isEnabled: true, quickCommands: [], hoverService: {} as HoverService } as unknown as ChatInputProductChromeContext;

    function render(state: QaapGithubMcpConnectionState | undefined): string {
        const node = createQaapChatInputProductChrome({ githubMcp: state }).renderBeforeOptions(context);
        return node ? renderToStaticMarkup(React.createElement(React.Fragment, undefined, node)) : '';
    }

    it('shows a chip only when the user can act on it', () => {
        for (const kind of ['needs-credential', 'auth-required', 'untrusted'] as const) {
            expect(qaapGithubMcpConnectChipText(snapshot(kind)), kind).to.not.equal(undefined);
        }
        for (const kind of ['unknown', 'connected', 'policy-rejected', 'error'] as const) {
            expect(qaapGithubMcpConnectChipText(snapshot(kind)), kind).to.equal(undefined);
        }
    });

    it('names the action per state and adds the gh hint to the tooltip on the desktop', () => {
        expect(qaapGithubMcpConnectChipText(snapshot('needs-credential'))?.label).to.equal('Connect GitHub');
        expect(qaapGithubMcpConnectChipText(snapshot('auth-required'))?.label).to.equal('Reconnect GitHub');
        expect(qaapGithubMcpConnectChipText(snapshot('untrusted'))?.label).to.equal('Trust workspace for GitHub');
        expect(qaapGithubMcpConnectChipText(snapshot('needs-credential', true))?.tooltip).to.contain('gh auth login');
        expect(qaapGithubMcpConnectChipText(snapshot('needs-credential', false))?.tooltip).to.not.contain('gh auth login');
    });

    it('renders in the chat input chrome only with a connection state that needs an action', () => {
        expect(render(stateOf('needs-credential'))).to.contain(QAAP_GITHUB_MCP_CONNECT_CHIP_CLASS).and.to.contain('Connect GitHub');
        expect(render(stateOf('policy-rejected'))).to.not.contain(QAAP_GITHUB_MCP_CONNECT_CHIP_CLASS);
        expect(render(undefined)).to.equal('');
    });
});
