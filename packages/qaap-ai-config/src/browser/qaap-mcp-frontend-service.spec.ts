// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();
FrontendApplicationConfigProvider.set({});

import { expect } from 'chai';
import { QaapMcpFrontendService } from './qaap-mcp-frontend-service';

disableJSDOM();

describe('QaapMcpFrontendService mcp_github_tools alias', () => {

    function create(servers: string[]): { service: QaapMcpFrontendService; fragments: Map<string, string> } {
        const fragments = new Map<string, string>();
        const service = new QaapMcpFrontendService();
        const tools = { tools: [{ name: 'list_issues', description: 'd', inputSchema: { type: 'object', properties: {} } }] };
        Object.assign(service, {
            mcpServerManager: {
                getServerNames: async () => servers,
                getTools: async () => tools,
                getServerDescription: async () => ({ deferLoading: false }),
            },
            toolInvocationRegistry: { registerTool: () => undefined, unregisterAllTools: () => undefined },
            promptService: {
                addBuiltInPromptFragment: (fragment: { id: string; template: string }) => fragments.set(fragment.id, fragment.template),
                removePromptFragment: (id: string) => fragments.delete(id),
            },
            logger: { warn: () => undefined, error: () => undefined },
        });
        return { service, fragments };
    }

    it('resolves mcp_github_tools to the managed tools when the user has no github server', async () => {
        const { service, fragments } = create(['qaap-github']);
        await service.registerTools('qaap-github');
        expect(fragments.get('mcp_qaap-github_tools')).to.contain('mcp_qaap-github_list_issues');
        expect(fragments.get('mcp_github_tools')).to.equal(fragments.get('mcp_qaap-github_tools'));
    });

    it('keeps the user\'s own github server: no alias, and the user\'s fragment wins', async () => {
        const { service, fragments } = create(['qaap-github', 'github']);
        await service.registerTools('qaap-github');
        expect(fragments.has('mcp_github_tools')).to.equal(false);
        await service.registerTools('github');
        expect(fragments.get('mcp_github_tools')).to.contain('mcp_github_list_issues');
    });

    it('drops the alias with the managed tools, but never the user\'s fragment', async () => {
        const managedOnly = create(['qaap-github']);
        await managedOnly.service.registerTools('qaap-github');
        await managedOnly.service.stopServer('qaap-github').catch(() => undefined);
        expect(managedOnly.fragments.has('mcp_github_tools')).to.equal(false);

        const both = create(['qaap-github', 'github']);
        await both.service.registerTools('github');
        await both.service.registerTools('qaap-github');
        (both.service as unknown as { unregisterTools(name: string): void }).unregisterTools('qaap-github');
        expect(both.fragments.get('mcp_github_tools')).to.contain('mcp_github_list_issues');
    });
});
