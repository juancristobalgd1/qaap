// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { isQaapTokenlessGithubMcpEntry } from './qaap-github-mcp-managed';

describe('isQaapTokenlessGithubMcpEntry', () => {

    it('matches the marketplace default, with or without -y, autostart or an empty env', () => {
        expect(isQaapTokenlessGithubMcpEntry({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] })).to.equal(true);
        expect(isQaapTokenlessGithubMcpEntry({ command: 'npx', args: ['@modelcontextprotocol/server-github'], env: {} })).to.equal(true);
    });

    it('matches a bare GitHub Copilot URL without token, OAuth or headers', () => {
        expect(isQaapTokenlessGithubMcpEntry({ serverUrl: 'https://api.githubcopilot.com/mcp/' })).to.equal(true);
        expect(isQaapTokenlessGithubMcpEntry({ serverUrl: 'https://api.githubcopilot.com/mcp/readonly', headers: {} })).to.equal(true);
    });

    it('keeps an entry with a token, OAuth, custom headers or a non-empty env', () => {
        expect(isQaapTokenlessGithubMcpEntry({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'x' } })).to.equal(false);
        expect(isQaapTokenlessGithubMcpEntry({ serverUrl: 'https://api.githubcopilot.com/mcp/', serverAuthToken: 'x' })).to.equal(false);
        expect(isQaapTokenlessGithubMcpEntry({ serverUrl: 'https://api.githubcopilot.com/mcp/', oauth: {} })).to.equal(false);
        expect(isQaapTokenlessGithubMcpEntry({ serverUrl: 'https://api.githubcopilot.com/mcp/', headers: { 'X-Team': 'a' } })).to.equal(false);
    });

    it('ignores other servers and other GitHub URLs', () => {
        expect(isQaapTokenlessGithubMcpEntry({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'] })).to.equal(false);
        expect(isQaapTokenlessGithubMcpEntry({ serverUrl: 'https://example.com/mcp/' })).to.equal(false);
    });
});
